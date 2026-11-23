import { createClient } from '@libsql/client';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { schemaSql } from './db/schema.js';

const defaultDatabaseFile = fileURLToPath(new URL('../data/bank.sqlite', import.meta.url));

function rowToObject(columns, row) {
  const object = {};
  columns.forEach((column, index) => { object[column] = row[index]; });
  return object;
}

function normalizeArgs(args) {
  return args.map((value) => (value === undefined ? null : value));
}

class Statement {
  constructor(executor, sql) {
    this.executor = executor;
    this.sql = sql;
  }

  async get(...args) {
    const result = await this.executor.execute({ sql: this.sql, args: normalizeArgs(args) });
    return result.rows.length ? rowToObject(result.columns, result.rows[0]) : undefined;
  }

  async all(...args) {
    const result = await this.executor.execute({ sql: this.sql, args: normalizeArgs(args) });
    return result.rows.map((row) => rowToObject(result.columns, row));
  }

  async run(...args) {
    const result = await this.executor.execute({ sql: this.sql, args: normalizeArgs(args) });
    return {
      changes: result.rowsAffected,
      lastInsertRowid: result.lastInsertRowid === undefined ? undefined : Number(result.lastInsertRowid)
    };
  }
}

/**
 * Small async wrapper around a libSQL client (Turso or a local SQLite file) that keeps the
 * familiar prepare(sql).get/all/run shape.
 */
export class Database {
  constructor(client, executor = client, inTransaction = false) {
    this.client = client;
    this.executor = executor;
    this.inTransaction = inTransaction;
  }

  prepare(sql) {
    return new Statement(this.executor, sql);
  }

  async exec(sql) {
    await this.executor.executeMultiple(sql);
  }

  async tableColumns(table) {
    const rows = await this.prepare(`PRAGMA table_info(${table})`).all();
    return new Set(rows.map((column) => column.name));
  }

  /** Runs fn(transactionDatabase) inside a write transaction; commits on success, rolls back on error. */
  async transaction(fn) {
    if (this.inTransaction) return fn(this);
    const transaction = await this.client.transaction('write');
    try {
      const result = await fn(new Database(this.client, transaction, true));
      await transaction.commit();
      return result;
    } catch (error) {
      await transaction.rollback().catch(() => {});
      throw error;
    } finally {
      transaction.close();
    }
  }

  close() {
    this.client.close();
  }
}

/** Reads the database location from the environment (Turso on Vercel, a local file otherwise). */
export function databaseConfig(env = process.env) {
  const url = env.TURSO_DATABASE_URL || env.LIBSQL_URL || env.DATABASE_URL || '';
  const authToken = env.TURSO_AUTH_TOKEN || env.LIBSQL_AUTH_TOKEN || env.DATABASE_AUTH_TOKEN || undefined;
  if (url) return { url: url.trim(), authToken: authToken?.trim() };
  if (env.VERCEL) {
    throw new Error('Database is not configured. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in the Vercel project environment variables.');
  }
  return { url: pathToFileURL(defaultDatabaseFile).href };
}

export function createDatabase({ url, authToken } = databaseConfig()) {
  if (url.startsWith('file:')) {
    mkdirSync(path.dirname(fileURLToPath(url)), { recursive: true });
  }
  return new Database(createClient({ url, authToken }));
}

export async function initializeDatabase(database) {
  await database.exec(schemaSql);

  const userColumns = await database.tableColumns('users');
  if (!userColumns.has('display_name')) {
    await database.exec("ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT ''");
  }
  if (!userColumns.has('role')) {
    await database.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'reviewer'))");
  }

  const securityColumns = await database.tableColumns('security_settings');
  if (!securityColumns.has('two_factor_enabled')) {
    await database.exec('ALTER TABLE security_settings ADD COLUMN two_factor_enabled INTEGER NOT NULL DEFAULT 1 CHECK (two_factor_enabled IN (0, 1))');
  }

  const transactionColumns = await database.tableColumns('transactions');
  if (!transactionColumns.has('status')) {
    await database.exec(
      "ALTER TABLE transactions ADD COLUMN status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed'))"
    );
  }

  const transferColumns = await database.tableColumns('transfers');
  const transferAdditions = [
    ['payee_id', 'ALTER TABLE transfers ADD COLUMN payee_id INTEGER REFERENCES payees(id)'],
    ['transaction_id', 'ALTER TABLE transfers ADD COLUMN transaction_id INTEGER REFERENCES transactions(id)'],
    ['destination_transaction_id', 'ALTER TABLE transfers ADD COLUMN destination_transaction_id INTEGER REFERENCES transactions(id)'],
    ['cancelled_at', 'ALTER TABLE transfers ADD COLUMN cancelled_at TEXT'],
    ['review_status', "ALTER TABLE transfers ADD COLUMN review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected'))"],
    ['reviewed_at', 'ALTER TABLE transfers ADD COLUMN reviewed_at TEXT'],
    ['reviewer_id', 'ALTER TABLE transfers ADD COLUMN reviewer_id INTEGER REFERENCES users(id)'],
    ['review_note', 'ALTER TABLE transfers ADD COLUMN review_note TEXT']
  ];
  for (const [column, statement] of transferAdditions) {
    if (!transferColumns.has(column)) await database.exec(statement);
  }

  await database.exec(`
    UPDATE transfers
    SET transaction_id = (
      SELECT transactions.id
      FROM transactions
      WHERE transactions.account_id = transfers.from_account_id
        AND transactions.amount = transfers.amount
        AND transactions.status = 'pending'
        AND transactions.date = date(transfers.created_at)
        AND (
          transactions.description LIKE 'Transfer request to account ending %'
          OR transactions.description LIKE 'External transfer request to %'
          OR transactions.description LIKE 'Bill payment to %'
        )
        AND NOT EXISTS (
          SELECT 1 FROM transfers AS linked
          WHERE linked.transaction_id = transactions.id
        )
      ORDER BY transactions.id DESC
      LIMIT 1
    )
    WHERE transaction_id IS NULL;

    UPDATE transfers
    SET destination_transaction_id = (
      SELECT transactions.id
      FROM transactions
      WHERE transactions.account_id = transfers.to_account_id
        AND transactions.amount = transfers.amount
        AND transactions.status = 'pending'
        AND transactions.date = date(transfers.created_at)
        AND transactions.description LIKE 'Pending transfer from account ending %'
        AND NOT EXISTS (
          SELECT 1 FROM transfers AS linked
          WHERE linked.destination_transaction_id = transactions.id
        )
      ORDER BY transactions.id DESC
      LIMIT 1
    )
    WHERE to_account_id IS NOT NULL
      AND destination_transaction_id IS NULL;

    INSERT INTO transfer_events (transfer_id, actor_user_id, event_type, note, created_at)
    SELECT transfers.id, accounts.user_id, 'submitted',
      'Request submitted for security review; no funds moved.', transfers.created_at
    FROM transfers
    JOIN accounts ON accounts.id = transfers.from_account_id
    WHERE NOT EXISTS (
      SELECT 1 FROM transfer_events
      WHERE transfer_events.transfer_id = transfers.id
        AND transfer_events.event_type = 'submitted'
    );
  `);

  const transferEventsSchema = (await database.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'transfer_events'"
  ).get())?.sql || '';
  if (!transferEventsSchema.includes("'approved'")) {
    await database.exec(`
      ALTER TABLE transfer_events RENAME TO transfer_events_legacy;
      CREATE TABLE transfer_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transfer_id INTEGER NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
        actor_user_id INTEGER NOT NULL REFERENCES users(id),
        event_type TEXT NOT NULL CHECK (event_type IN ('submitted', 'approved', 'cancelled', 'rejected')),
        note TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO transfer_events (id, transfer_id, actor_user_id, event_type, note, created_at)
        SELECT id, transfer_id, actor_user_id, event_type, note, created_at
        FROM transfer_events_legacy;
      DROP TABLE transfer_events_legacy;
      CREATE INDEX IF NOT EXISTS idx_transfer_events_transfer_date
        ON transfer_events(transfer_id, created_at, id);
    `);
  }

  return database;
}

/** Opens and migrates the configured database. */
export async function openDatabase(config) {
  const database = createDatabase(config);
  await initializeDatabase(database);
  return database;
}
