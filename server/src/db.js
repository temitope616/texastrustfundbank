import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const databaseDirectory = fileURLToPath(new URL('../data/', import.meta.url));
const schemaPath = fileURLToPath(new URL('./db/schema.sql', import.meta.url));

export function initializeDatabase(database) {
  database.pragma('foreign_keys = ON');
  database.exec(readFileSync(schemaPath, 'utf8'));

  const userColumns = new Set(
    database.pragma('table_info(users)').map((column) => column.name)
  );
  if (!userColumns.has('display_name')) {
    database.exec("ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT ''");
  }
  if (!userColumns.has('role')) {
    database.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'reviewer'))");
  }

  const securityColumns = new Set(
    database.pragma('table_info(security_settings)').map((column) => column.name)
  );
  if (!securityColumns.has('two_factor_enabled')) {
    database.exec('ALTER TABLE security_settings ADD COLUMN two_factor_enabled INTEGER NOT NULL DEFAULT 1 CHECK (two_factor_enabled IN (0, 1))');
  }

  const transactionColumns = new Set(
    database.pragma('table_info(transactions)').map((column) => column.name)
  );
  if (!transactionColumns.has('status')) {
    database.exec(
      "ALTER TABLE transactions ADD COLUMN status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed'))"
    );
  }

  const transferColumns = new Set(
    database.pragma('table_info(transfers)').map((column) => column.name)
  );
  if (!transferColumns.has('payee_id')) {
    database.exec('ALTER TABLE transfers ADD COLUMN payee_id INTEGER REFERENCES payees(id)');
  }
  if (!transferColumns.has('transaction_id')) {
    database.exec('ALTER TABLE transfers ADD COLUMN transaction_id INTEGER REFERENCES transactions(id)');
  }
  if (!transferColumns.has('destination_transaction_id')) {
    database.exec('ALTER TABLE transfers ADD COLUMN destination_transaction_id INTEGER REFERENCES transactions(id)');
  }
  if (!transferColumns.has('cancelled_at')) {
    database.exec('ALTER TABLE transfers ADD COLUMN cancelled_at TEXT');
  }
  if (!transferColumns.has('review_status')) {
    database.exec("ALTER TABLE transfers ADD COLUMN review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected'))");
  }
  if (!transferColumns.has('reviewed_at')) {
    database.exec('ALTER TABLE transfers ADD COLUMN reviewed_at TEXT');
  }
  if (!transferColumns.has('reviewer_id')) {
    database.exec('ALTER TABLE transfers ADD COLUMN reviewer_id INTEGER REFERENCES users(id)');
  }
  if (!transferColumns.has('review_note')) {
    database.exec('ALTER TABLE transfers ADD COLUMN review_note TEXT');
  }

  database.exec(`
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
  `);

  database.exec(`
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

  const transferEventsSchema = database.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'transfer_events'"
  ).get()?.sql || '';
  if (!transferEventsSchema.includes("'approved'")) {
    database.exec(`
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

export function openDatabase(databasePath = path.join(databaseDirectory, 'bank.sqlite')) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);
  initializeDatabase(database);
  return database;
}