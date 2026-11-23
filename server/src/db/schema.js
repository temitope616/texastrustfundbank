// SQLite schema. Kept as a JS module (not a .sql file) so serverless bundlers include it.
export const schemaSql = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'reviewer')),
  password_hash TEXT NOT NULL,
  phone TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('checking', 'savings')),
  last4 TEXT NOT NULL CHECK (length(last4) = 4),
  balance REAL NOT NULL DEFAULT 0,
  available_balance REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  UNIQUE (user_id, last4)
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount >= 0),
  type TEXT NOT NULL CHECK (type IN ('debit', 'credit')),
  balance_after REAL NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_transactions_account_date
  ON transactions(account_id, date DESC, id DESC);

CREATE TABLE IF NOT EXISTS transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_account_id INTEGER NOT NULL REFERENCES accounts(id),
  to_account_id INTEGER REFERENCES accounts(id),
  payee_id INTEGER REFERENCES payees(id),
  transaction_id INTEGER REFERENCES transactions(id),
  destination_transaction_id INTEGER REFERENCES transactions(id),
  amount REAL NOT NULL CHECK (amount > 0),
  scheduled_date TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('once', 'recurring')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  cancelled_at TEXT,
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected')),
  reviewed_at TEXT,
  reviewer_id INTEGER REFERENCES users(id),
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transfer_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id INTEGER NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
  actor_user_id INTEGER NOT NULL REFERENCES users(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('submitted', 'approved', 'cancelled', 'rejected')),
  note TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_transfer_events_transfer_date
  ON transfer_events(transfer_id, created_at, id);

CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  last4 TEXT NOT NULL CHECK (length(last4) = 4),
  status TEXT NOT NULL CHECK (status IN ('active', 'locked', 'lost')),
  expiry_date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  account_last4 TEXT NOT NULL CHECK (length(account_last4) = 4),
  bank_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  device TEXT NOT NULL,
  location TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_login_history_user_date
  ON login_history(user_id, event_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS security_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  alert_unrecognized_device INTEGER NOT NULL DEFAULT 1
    CHECK (alert_unrecognized_device IN (0, 1)),
  two_factor_enabled INTEGER NOT NULL DEFAULT 1
    CHECK (two_factor_enabled IN (0, 1))
);

CREATE TABLE IF NOT EXISTS app_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_challenges (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);
`;
