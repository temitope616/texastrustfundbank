import { randomInt, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import express from 'express';
import jwt from 'jsonwebtoken';

// Express 5 forwards errors thrown (or rejected) from async handlers to the error middleware.

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
// Prototype accounts use fictional addresses only, so no real personal email is collected.
const EMAIL_PATTERN = /^[a-z0-9._%+-]+@texas-trust\.test$/;
const EMAIL_RULE = 'Use an email address ending in @texas-trust.test.';
const PASSWORD_RULE ='Use at least 12 characters with uppercase, lowercase, a number, and a symbol.';

function isStrongPassword(password) {
  return password.length >= 12 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
}

function amountInCents(value) {
  const amount = Number(value);
  const cents = Math.round(amount * 100);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(cents) || cents < 1) {
    throw new HttpError(400, 'Enter an amount greater than zero.');
  }
  return cents;
}

function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, 'Choose a valid date.');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, 'Choose a valid date.');
  }
  // Allow one day of slack so a client's local "today" behind UTC is accepted.
  const earliest = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (value < earliest) throw new HttpError(400, 'Choose today or a future date.');
  return value;
}

function requireInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new HttpError(400, `${label} is required.`);
  }
  return number;
}

async function accountForUser(database, accountId, userId) {
  const account = await database.prepare(
    'SELECT * FROM accounts WHERE id = ? AND user_id = ?'
  ).get(accountId, userId);
  if (!account) throw new HttpError(404, 'Account not found.');
  return account;
}

function ensureAvailable(account, cents) {
  if (account.status === 'view-only') {
    throw new HttpError(403, 'Transfers, withdrawals, and bill payments are disabled for view-only prototype accounts.');
  }
  if (account.status !== 'active') throw new HttpError(400, 'This account is not available for transfers.');
  if (Math.round(account.available_balance * 100) < cents) {
    throw new HttpError(400, 'The amount exceeds your available balance.');
  }
}

async function recordTransferEvent(database, transferId, userId, eventType, note) {
  await database.prepare(
    'INSERT INTO transfer_events (transfer_id, actor_user_id, event_type, note) VALUES (?, ?, ?, ?)'
  ).run(transferId, userId, eventType, note);
}

function deviceLabel(request) {
  return String(request.get('user-agent') || 'Unknown browser').slice(0, 180);
}

/**
 * @param database  Database wrapper from db.js
 * @param jwtSecret secret used to sign session tokens
 * @param options.showDemoCode when true, the login response includes the one-time code, because
 *                             this prototype sends no SMS or email (needed on hosted deployments).
 */
export function createApp(
  database,
  jwtSecret = process.env.JWT_SECRET || 'local-prototype-secret-change-me',
  { showDemoCode = process.env.HIDE_DEMO_2FA_CODE !== 'true' } = {}
) {
  const app = express();

  app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
  app.use(express.json({ limit: '1mb' }));
  // Express 5 leaves req.body undefined when no JSON body is sent.
  app.use((request, _response, next) => {
    if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) request.body = {};
    next();
  });

  app.get('/api/health', async (_request, response) => {
    await database.prepare('SELECT 1 AS ok').get();
    response.json({ status: 'ok' });
  });

  async function issueSession(request, user) {
    await database.prepare(
      'INSERT INTO login_history (user_id, device, location, status) VALUES (?, ?, ?, ?)'
    ).run(user.id, deviceLabel(request), 'Online prototype', 'success');
    const token = jwt.sign({ sub: String(user.id), role: user.role }, jwtSecret, { expiresIn: '4h' });
    return { token, user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role } };
  }

  app.post('/api/auth/register', async (request, response) => {
    const email = String(request.body.email || '').trim().toLowerCase();
    const displayName = String(request.body.displayName || '').trim();
    const password = String(request.body.password || '');
    if (!EMAIL_PATTERN.test(email)) throw new HttpError(400, EMAIL_RULE);
    if (displayName.length < 2 || displayName.length > 80) {
      throw new HttpError(400, 'Name must be between 2 and 80 characters.');
    }
    if (!isStrongPassword(password)) throw new HttpError(400, PASSWORD_RULE);

    const passwordHash = bcrypt.hashSync(password, 10);
    const account = await database.transaction(async (tx) => {
      if (await tx.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
        throw new HttpError(409, 'An account already exists for that email.');
      }
      const user = await tx.prepare(
        'INSERT INTO users (email, display_name, password_hash, phone) VALUES (?, ?, ?, ?)'
      ).run(email, displayName, passwordHash, '');
      const userId = user.lastInsertRowid;
      // A brand-new user has no accounts, so any last four digits are unique.
      const last4 = String(randomInt(10000)).padStart(4, '0');
      await tx.prepare(
        'INSERT INTO accounts (user_id, type, last4, balance, available_balance, status) VALUES (?, ?, ?, 0, 0, ?)'
      ).run(userId, 'checking', last4, 'view-only');
      await tx.prepare('INSERT INTO security_settings (user_id) VALUES (?)').run(userId);
      return { displayName, accountLast4: last4 };
    }).catch((error) => {
      // Two simultaneous sign-ups with the same email: the second hits the UNIQUE constraint.
      if (/UNIQUE constraint failed: users\.email/.test(String(error?.message))) {
        throw new HttpError(409, 'An account already exists for that email.');
      }
      throw error;
    });

    response.status(201).json({
      message: 'Account created with a $0 balance. Sign in to view it; deposits, transfers, bill payments, and withdrawals are disabled.',
      user: { displayName: account.displayName, email },
      account: { type: 'checking', last4: account.accountLast4, balance: 0, status: 'view-only' }
    });
  });

  app.post('/api/auth/login', async (request, response) => {
    const email = String(request.body.email || '').trim().toLowerCase();
    const password = String(request.body.password || '');
    const user = await database.prepare(
      'SELECT id, email, role, display_name AS displayName, password_hash FROM users WHERE email = ?'
    ).get(email);

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      throw new HttpError(401, 'Email or password is incorrect.');
    }

    await database.prepare('INSERT OR IGNORE INTO security_settings (user_id) VALUES (?)').run(user.id);
    const security = await database.prepare(
      'SELECT two_factor_enabled AS twoFactorEnabled FROM security_settings WHERE user_id = ?'
    ).get(user.id);
    if (!security.twoFactorEnabled) {
      return response.json({ requiresTwoFactor: false, ...(await issueSession(request, user)) });
    }

    // Challenges live in the database so any serverless instance can verify them.
    const challengeId = randomUUID();
    const code = String(randomInt(100000, 1000000));
    const now = Date.now();
    await database.prepare('DELETE FROM auth_challenges WHERE expires_at < ?').run(now);
    await database.prepare(
      'INSERT INTO auth_challenges (id, user_id, code, expires_at) VALUES (?, ?, ?, ?)'
    ).run(challengeId, user.id, code, now + CHALLENGE_TTL_MS);
    console.info(`[mock-2fa] ${user.email}: ${code}`);
    response.json({ requiresTwoFactor: true, challengeId, ...(showDemoCode ? { demoCode: code } : {}) });
  });

  app.post('/api/auth/verify-2fa', async (request, response) => {
    const challengeId = String(request.body.challengeId || '');
    const code = String(request.body.code || '');
    const challenge = await database.prepare(
      'SELECT id, user_id AS userId, code, expires_at AS expiresAt, attempts FROM auth_challenges WHERE id = ?'
    ).get(challengeId);

    if (!challenge || challenge.expiresAt < Date.now()) {
      if (challenge) await database.prepare('DELETE FROM auth_challenges WHERE id = ?').run(challengeId);
      throw new HttpError(401, 'That verification code has expired. Sign in again.');
    }
    if (!/^\d{6}$/.test(code) || challenge.code !== code) {
      if (challenge.attempts + 1 >= 5) {
        await database.prepare('DELETE FROM auth_challenges WHERE id = ?').run(challengeId);
      } else {
        await database.prepare('UPDATE auth_challenges SET attempts = attempts + 1 WHERE id = ?').run(challengeId);
      }
      throw new HttpError(401, 'The verification code is incorrect.');
    }

    const deleted = await database.prepare('DELETE FROM auth_challenges WHERE id = ?').run(challengeId);
    if (deleted.changes !== 1) throw new HttpError(401, 'That verification code has expired. Sign in again.');
    const user = await database.prepare(
      'SELECT id, email, role, display_name AS displayName FROM users WHERE id = ?'
    ).get(challenge.userId);
    if (!user) throw new HttpError(401, 'That verification code has expired. Sign in again.');
    await database.prepare('INSERT OR IGNORE INTO security_settings (user_id) VALUES (?)').run(user.id);
    response.json(await issueSession(request, user));
  });

  const authenticate = (request, _response, next) => {
    try {
      const authorization = request.get('authorization') || '';
      const [scheme, token] = authorization.split(' ');
      if (scheme !== 'Bearer' || !token) throw new HttpError(401, 'Please sign in to continue.');
      const payload = jwt.verify(token, jwtSecret);
      request.userId = Number(payload.sub);
      request.userRole = payload.role;
      if (!Number.isSafeInteger(request.userId)) throw new HttpError(401, 'Your session is invalid.');
      next();
    } catch (error) {
      if (error instanceof HttpError) return next(error);
      next(new HttpError(401, 'Your session has expired. Sign in again.'));
    }
  };

  const api = express.Router();
  api.use(authenticate);

  const requireReviewer = (request, _response, next) => {
    if (request.userRole !== 'reviewer') return next(new HttpError(403, 'Reviewer access is required.'));
    next();
  };

  api.get('/accounts', async (request, response) => {
    const accounts = await database.prepare(
      'SELECT id, type, last4, balance, available_balance, status FROM accounts WHERE user_id = ? ORDER BY CASE type WHEN \'checking\' THEN 0 ELSE 1 END, id'
    ).all(request.userId);
    response.json({ accounts });
  });

  api.get('/profile', async (request, response) => {
    const profile = await database.prepare(
      'SELECT display_name AS displayName, email, phone FROM users WHERE id = ?'
    ).get(request.userId);
    response.json({ profile });
  });

  api.patch('/profile', async (request, response) => {
    const displayName = String(request.body.displayName || '').trim();
    const phone = String(request.body.phone || '').trim();
    if (displayName.length < 2 || displayName.length > 80) {
      throw new HttpError(400, 'Name must be between 2 and 80 characters.');
    }
    if (phone.length > 32 || (phone && !/^[+()0-9 .-]+$/.test(phone))) {
      throw new HttpError(400, 'Enter a valid contact number.');
    }
    await database.prepare('UPDATE users SET display_name = ?, phone = ? WHERE id = ?')
      .run(displayName, phone, request.userId);
    response.json({ profile: { displayName, phone } });
  });

  api.patch('/profile/password', async (request, response) => {
    const currentPassword = String(request.body.currentPassword || '');
    const newPassword = String(request.body.newPassword || '');
    const user = await database.prepare('SELECT password_hash FROM users WHERE id = ?').get(request.userId);
    if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
      throw new HttpError(400, 'Current password is incorrect.');
    }
    if (!isStrongPassword(newPassword)) throw new HttpError(400, PASSWORD_RULE);
    if (bcrypt.compareSync(newPassword, user.password_hash)) {
      throw new HttpError(400, 'Choose a password you have not used for this account.');
    }
    await database.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .run(bcrypt.hashSync(newPassword, 10), request.userId);
    response.json({ message: 'Password updated.' });
  });

  api.patch('/profile/email', async (request, response) => {
    const newEmail = String(request.body.newEmail || '').trim().toLowerCase();
    const currentPassword = String(request.body.currentPassword || '');
    const user = await database.prepare('SELECT email, password_hash FROM users WHERE id = ?').get(request.userId);
    if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
      throw new HttpError(400, 'Current password is incorrect.');
    }
    if (!EMAIL_PATTERN.test(newEmail)) throw new HttpError(400, EMAIL_RULE);
    if (newEmail === user.email) throw new HttpError(400, 'That is already your sign-in email.');
    if (await database.prepare('SELECT id FROM users WHERE email = ? AND id <> ?').get(newEmail, request.userId)) {
      throw new HttpError(409, 'Another account already uses that email.');
    }
    try {
      await database.prepare('UPDATE users SET email = ? WHERE id = ?').run(newEmail, request.userId);
    } catch (error) {
      if (/UNIQUE constraint failed: users\.email/.test(String(error?.message))) {
        throw new HttpError(409, 'Another account already uses that email.');
      }
      throw error;
    }
    response.json({ profile: { email: newEmail }, message: 'Sign-in email updated. Use it the next time you sign in.' });
  });

  api.get('/accounts/:id/transactions', async (request, response) => {
    const accountId = requireInteger(request.params.id, 'Account');
    await accountForUser(database, accountId, request.userId);
    const page = Math.max(1, Number.parseInt(request.query.page, 10) || 1);
    const pageSize = 10;
    const total = (await database.prepare(
      'SELECT COUNT(*) AS count FROM transactions WHERE account_id = ?'
    ).get(accountId)).count;
    const transactions = await database.prepare(
      `SELECT transactions.id, transactions.date, transactions.description, transactions.amount,
        transactions.type, transactions.balance_after AS balanceAfter, transactions.category,
        CASE
          WHEN transfers.cancelled_at IS NOT NULL THEN 'cancelled'
          WHEN transfers.review_status = 'rejected' THEN 'rejected'
          WHEN transfers.review_status = 'approved' THEN 'approved'
          ELSE transactions.status
        END AS status
      FROM transactions
      LEFT JOIN transfers ON transfers.transaction_id = transactions.id
        OR transfers.destination_transaction_id = transactions.id
      WHERE transactions.account_id = ?
      ORDER BY transactions.date DESC, transactions.id DESC LIMIT ? OFFSET ?`
    ).all(accountId, pageSize, (page - 1) * pageSize);
    response.json({
      transactions,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    });
  });

  api.get('/transfers', async (request, response) => {
    const transfers = await database.prepare(`
      SELECT transfers.id, transfers.amount, transfers.scheduled_date AS scheduledDate,
        transfers.frequency, transfers.created_at AS createdAt,
        CASE
          WHEN transfers.cancelled_at IS NOT NULL THEN 'cancelled'
          WHEN transfers.review_status = 'rejected' THEN 'rejected'
          WHEN transfers.review_status = 'approved' THEN 'approved'
          ELSE transfers.status
        END AS status,
        transfers.review_note AS reviewNote,
        CASE
          WHEN transactions.description LIKE '%Bill payment to %' THEN 'Bill payment'
          WHEN transfers.payee_id IS NOT NULL THEN 'External transfer'
          ELSE 'Account transfer'
        END AS requestType,
        accounts.type AS sourceType, accounts.last4 AS sourceLast4,
        COALESCE(payees.name, 'Account ending ' || destination.last4) AS destinationName,
        COALESCE(payees.bank_name, 'Your bank') AS destinationInstitution
      FROM transfers
      JOIN accounts ON accounts.id = transfers.from_account_id
      LEFT JOIN accounts AS destination ON destination.id = transfers.to_account_id
      LEFT JOIN payees ON payees.id = transfers.payee_id
      LEFT JOIN transactions ON transactions.id = transfers.transaction_id
      WHERE accounts.user_id = ?
      ORDER BY transfers.created_at DESC, transfers.id DESC
    `).all(request.userId);
    response.json({ transfers });
  });

  api.get('/review/transfers', requireReviewer, async (_request, response) => {
    const transfers = await database.prepare(`
      SELECT transfers.id, transfers.amount, transfers.scheduled_date AS scheduledDate,
        transfers.frequency, transfers.created_at AS createdAt,
        CASE
          WHEN transactions.description LIKE '%Bill payment to %' THEN 'Bill payment'
          WHEN transfers.payee_id IS NOT NULL THEN 'External transfer'
          ELSE 'Account transfer'
        END AS requestType,
        accounts.type AS sourceType, accounts.last4 AS sourceLast4,
        users.display_name AS customerName, users.email AS customerEmail,
        COALESCE(payees.name, 'Account ending ' || destination.last4) AS destinationName,
        COALESCE(payees.bank_name, 'Your bank') AS destinationInstitution
      FROM transfers
      JOIN accounts ON accounts.id = transfers.from_account_id
      JOIN users ON users.id = accounts.user_id
      LEFT JOIN accounts AS destination ON destination.id = transfers.to_account_id
      LEFT JOIN payees ON payees.id = transfers.payee_id
      LEFT JOIN transactions ON transactions.id = transfers.transaction_id
      WHERE transfers.status = 'pending'
        AND transfers.review_status = 'pending'
        AND transfers.cancelled_at IS NULL
      ORDER BY transfers.created_at, transfers.id
    `).all();
    response.json({ transfers });
  });

  api.patch('/review/transfers/:id', requireReviewer, async (request, response) => {
    const transferId = requireInteger(request.params.id, 'Transfer');
    const decision = request.body.decision;
    if (!['approved', 'rejected'].includes(decision)) {
      throw new HttpError(400, 'Choose approve or reject.');
    }
    const note = String(request.body.note || '').trim();
    if (note.length > 240) throw new HttpError(400, 'Review note must be 240 characters or fewer.');

    const transfer = await database.transaction(async (tx) => {
      const current = await tx.prepare('SELECT * FROM transfers WHERE id = ?').get(transferId);
      if (!current) throw new HttpError(404, 'Transfer request not found.');
      if (current.status !== 'pending' || current.review_status !== 'pending' || current.cancelled_at) {
        throw new HttpError(409, 'This request has already been reviewed or cancelled.');
      }

      const reviewNote = note || (decision === 'approved'
        ? 'Approved for transfer processing; no funds moved.'
        : 'Rejected during review; no funds moved.');
      const status = decision === 'rejected' ? 'failed' : 'pending';
      await tx.prepare(`
        UPDATE transfers
        SET status = ?, review_status = ?, reviewed_at = CURRENT_TIMESTAMP,
          reviewer_id = ?, review_note = ?
        WHERE id = ?
      `).run(status, decision, request.userId, reviewNote, transferId);

      if (decision === 'rejected') {
        const transactionIds = [current.transaction_id, current.destination_transaction_id].filter(Boolean);
        const rejectTransaction = tx.prepare(
          "UPDATE transactions SET status = 'failed', description = 'Rejected: ' || description WHERE id = ? AND status = 'pending'"
        );
        for (const transactionId of transactionIds) await rejectTransaction.run(transactionId);
      }

      await recordTransferEvent(tx, transferId, request.userId, decision, reviewNote);
      return { id: transferId, status: decision, reviewNote };
    });
    response.json({ transfer });
  });

  api.get('/transfers/:id/history', async (request, response) => {
    const transferId = requireInteger(request.params.id, 'Transfer');
    const transfer = await database.prepare(
      'SELECT transfers.id FROM transfers JOIN accounts ON accounts.id = transfers.from_account_id WHERE transfers.id = ? AND accounts.user_id = ?'
    ).get(transferId, request.userId);
    if (!transfer) throw new HttpError(404, 'Transfer request not found.');
    const events = await database.prepare(
      'SELECT event_type AS eventType, note, created_at AS createdAt FROM transfer_events WHERE transfer_id = ? ORDER BY created_at, id'
    ).all(transferId);
    response.json({ events });
  });

  api.patch('/transfers/:id/cancel', async (request, response) => {
    const transferId = requireInteger(request.params.id, 'Transfer');
    const result = await database.transaction(async (tx) => {
      const transfer = await tx.prepare(`
        SELECT transfers.* FROM transfers
        JOIN accounts ON accounts.id = transfers.from_account_id
        WHERE transfers.id = ? AND accounts.user_id = ?
      `).get(transferId, request.userId);
      if (!transfer) throw new HttpError(404, 'Transfer request not found.');
      if (transfer.status !== 'pending' || transfer.review_status !== 'pending' || transfer.cancelled_at) {
        throw new HttpError(400, 'Only pending requests can be cancelled.');
      }

      const cancelledAt = new Date().toISOString();
      await tx.prepare(
        'UPDATE transfers SET cancelled_at = ? WHERE id = ? AND cancelled_at IS NULL'
      ).run(cancelledAt, transferId);
      const transactionIds = [transfer.transaction_id, transfer.destination_transaction_id].filter(Boolean);
      const updateTransaction = tx.prepare(
        "UPDATE transactions SET status = 'failed', description = 'Cancelled: ' || description WHERE id = ? AND status = 'pending'"
      );
      for (const transactionId of transactionIds) await updateTransaction.run(transactionId);
      await recordTransferEvent(tx, transferId, request.userId, 'cancelled', 'Request cancelled by account holder; no funds moved.');
      return { id: transferId, status: 'cancelled', cancelledAt };
    });
    response.json({ transfer: result });
  });

  api.post('/transfers', async (request, response) => {
    const fromAccountId = requireInteger(request.body.fromAccountId, 'From account');
    const hasInternalDestination = request.body.toAccountId !== undefined && request.body.toAccountId !== '';
    const hasPayeeDestination = request.body.payeeId !== undefined && request.body.payeeId !== '';
    if (hasInternalDestination === hasPayeeDestination) {
      throw new HttpError(400, 'Choose one destination account or payee.');
    }
    const cents = amountInCents(request.body.amount);
    const amount = cents / 100;
    const scheduledDate = parseDate(request.body.scheduledDate);
    const frequency = request.body.frequency;
    if (!['once', 'recurring'].includes(frequency)) throw new HttpError(400, 'Choose a transfer frequency.');

    const transferResult = await database.transaction(async (tx) => {
      const fromAccount = await accountForUser(tx, fromAccountId, request.userId);
      ensureAvailable(fromAccount, cents);
      const timestamp = new Date().toISOString().slice(0, 10);
      const insertTransaction = tx.prepare(
        'INSERT INTO transactions (account_id, date, description, amount, type, balance_after, category, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      );

      if (hasInternalDestination) {
        const toAccountId = requireInteger(request.body.toAccountId, 'To account');
        if (toAccountId === fromAccountId) throw new HttpError(400, 'Choose a different destination account.');
        const toAccount = await accountForUser(tx, toAccountId, request.userId);
        if (toAccount.status !== 'active') throw new HttpError(400, 'The destination account is not available.');

        const transfer = await tx.prepare(
          'INSERT INTO transfers (from_account_id, to_account_id, amount, scheduled_date, frequency, status) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(fromAccountId, toAccountId, amount, scheduledDate, frequency, 'pending');
        const transferId = transfer.lastInsertRowid;
        const sourceTransaction = await insertTransaction.run(fromAccountId, timestamp, 'Transfer request to account ending ' + toAccount.last4, amount, 'debit', fromAccount.balance, 'Transfer', 'pending');
        const destinationTransaction = await insertTransaction.run(toAccountId, timestamp, 'Pending transfer from account ending ' + fromAccount.last4, amount, 'credit', toAccount.balance, 'Transfer', 'pending');
        await tx.prepare(
          'UPDATE transfers SET transaction_id = ?, destination_transaction_id = ? WHERE id = ?'
        ).run(sourceTransaction.lastInsertRowid, destinationTransaction.lastInsertRowid, transferId);
        await recordTransferEvent(tx, transferId, request.userId, 'submitted', 'Request submitted for security review; no funds moved.');
        return { id: transferId, status: 'pending', message: 'Transfer submitted for security review. No funds have moved.' };
      }

      const payeeId = requireInteger(request.body.payeeId, 'Payee');
      const payee = await tx.prepare(
        'SELECT id, name FROM payees WHERE id = ? AND user_id = ?'
      ).get(payeeId, request.userId);
      if (!payee) throw new HttpError(404, 'Payee not found.');
      const transfer = await tx.prepare(
        'INSERT INTO transfers (from_account_id, payee_id, amount, scheduled_date, frequency, status) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(fromAccountId, payeeId, amount, scheduledDate, frequency, 'pending');
      const transferId = transfer.lastInsertRowid;
      const sourceTransaction = await insertTransaction.run(fromAccountId, timestamp, 'External transfer request to ' + payee.name, amount, 'debit', fromAccount.balance, 'Transfer', 'pending');
      await tx.prepare('UPDATE transfers SET transaction_id = ? WHERE id = ?')
        .run(sourceTransaction.lastInsertRowid, transferId);
      await recordTransferEvent(tx, transferId, request.userId, 'submitted', 'External recipient is unverified; request submitted for review and no funds moved.');
      return { id: transferId, status: 'pending', message: 'External transfer submitted for security review. No funds have moved.' };
    });

    response.status(201).json({ transfer: transferResult });
  });

  api.post('/deposits', async (request, response) => {
    const accountId = requireInteger(request.body.accountId, 'Account');
    const cents = amountInCents(request.body.amount);
    const account = await accountForUser(database, accountId, request.userId);
    if (account.status === 'view-only') {
      throw new HttpError(403, 'Deposits are disabled for view-only prototype accounts. No funds were accepted.');
    }
    const frontImageName = String(request.body.frontImageName || '').trim();
    const backImageName = String(request.body.backImageName || '').trim();
    if (!frontImageName || !backImageName) throw new HttpError(400, 'Add images of both sides of the check.');
    const result = await database.prepare(
      'INSERT INTO transactions (account_id, date, description, amount, type, balance_after, category, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(accountId, new Date().toISOString().slice(0, 10), 'Mobile check deposit', cents / 100, 'credit', account.balance, 'Deposit', 'pending');
    response.status(201).json({ deposit: { id: result.lastInsertRowid, status: 'pending' } });
  });

  api.get('/cards', async (request, response) => {
    const cards = await database.prepare(
      'SELECT cards.id, cards.account_id AS accountId, cards.last4, cards.status, cards.expiry_date AS expiryDate, accounts.type AS accountType FROM cards JOIN accounts ON accounts.id = cards.account_id WHERE accounts.user_id = ? ORDER BY cards.id'
    ).all(request.userId);
    response.json({ cards });
  });

  api.patch('/cards/:id', async (request, response) => {
    const cardId = requireInteger(request.params.id, 'Card');
    const status = request.body.status;
    if (!['active', 'locked', 'lost'].includes(status)) throw new HttpError(400, 'Choose a valid card status.');
    const result = await database.prepare(
      'UPDATE cards SET status = ? WHERE id = ? AND account_id IN (SELECT id FROM accounts WHERE user_id = ?)'
    ).run(status, cardId, request.userId);
    if (result.changes !== 1) throw new HttpError(404, 'Card not found.');
    response.json({ card: await database.prepare('SELECT id, last4, status FROM cards WHERE id = ?').get(cardId) });
  });

  api.get('/payees', async (request, response) => {
    const payees = await database.prepare(
      'SELECT id, name, account_last4 AS accountLast4, bank_name AS bankName FROM payees WHERE user_id = ? ORDER BY name'
    ).all(request.userId);
    response.json({ payees });
  });

  api.post('/payees', async (request, response) => {
    const name = String(request.body.name || '').trim();
    const accountLast4 = String(request.body.accountLast4 || '').trim();
    const bankName = String(request.body.bankName || '').trim();
    if (name.length < 2 || name.length > 80) throw new HttpError(400, 'Enter a payee name between 2 and 80 characters.');
    if (!/^\d{4}$/.test(accountLast4)) throw new HttpError(400, 'Enter the last four digits of the account.');
    if (bankName.length < 2 || bankName.length > 80) throw new HttpError(400, 'Enter a bank name.');
    const result = await database.prepare(
      'INSERT INTO payees (user_id, name, account_last4, bank_name) VALUES (?, ?, ?, ?)'
    ).run(request.userId, name, accountLast4, bankName);
    response.status(201).json({ payee: { id: result.lastInsertRowid, name, accountLast4, bankName } });
  });

  api.post('/billpay', async (request, response) => {
    const accountId = requireInteger(request.body.accountId, 'From account');
    const payeeId = requireInteger(request.body.payeeId, 'Payee');
    const cents = amountInCents(request.body.amount);
    const amount = cents / 100;
    const scheduledDate = parseDate(request.body.scheduledDate);
    const frequency = request.body.frequency;
    if (!['once', 'recurring'].includes(frequency)) throw new HttpError(400, 'Choose a payment frequency.');

    const payment = await database.transaction(async (tx) => {
      const account = await accountForUser(tx, accountId, request.userId);
      ensureAvailable(account, cents);
      const payee = await tx.prepare(
        'SELECT id, name FROM payees WHERE id = ? AND user_id = ?'
      ).get(payeeId, request.userId);
      if (!payee) throw new HttpError(404, 'Payee not found.');
      const transaction = await tx.prepare(
        'INSERT INTO transactions (account_id, date, description, amount, type, balance_after, category, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(accountId, new Date().toISOString().slice(0, 10), 'Bill payment to ' + payee.name, amount, 'debit', account.balance, 'Bills', 'pending');
      const transfer = await tx.prepare(
        'INSERT INTO transfers (from_account_id, payee_id, amount, scheduled_date, frequency, status) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(accountId, payeeId, amount, scheduledDate, frequency, 'pending');
      const transferId = transfer.lastInsertRowid;
      await tx.prepare('UPDATE transfers SET transaction_id = ? WHERE id = ?')
        .run(transaction.lastInsertRowid, transferId);
      await recordTransferEvent(tx, transferId, request.userId, 'submitted', 'Bill payment submitted for review; no funds moved.');
      return { id: transferId, transactionId: transaction.lastInsertRowid, status: 'pending' };
    });

    response.status(201).json({ payment });
  });

  api.get('/security/login-history', async (request, response) => {
    await database.prepare('INSERT OR IGNORE INTO security_settings (user_id) VALUES (?)').run(request.userId);
    const loginHistory = await database.prepare(
      'SELECT id, event_at AS eventAt, device, location, status FROM login_history WHERE user_id = ? ORDER BY event_at DESC, id DESC LIMIT 20'
    ).all(request.userId);
    const settings = await database.prepare(
      'SELECT alert_unrecognized_device AS alertUnrecognizedDevice, two_factor_enabled AS twoFactorEnabled FROM security_settings WHERE user_id = ?'
    ).get(request.userId);
    response.json({ loginHistory, settings: { alertUnrecognizedDevice: Boolean(settings.alertUnrecognizedDevice), twoFactorEnabled: Boolean(settings.twoFactorEnabled) } });
  });

  api.patch('/security/two-factor', async (request, response) => {
    if (typeof request.body.enabled !== 'boolean') {
      throw new HttpError(400, 'Choose whether two-step verification is enabled.');
    }
    await database.prepare('INSERT OR IGNORE INTO security_settings (user_id) VALUES (?)').run(request.userId);
    await database.prepare(
      'UPDATE security_settings SET two_factor_enabled = ? WHERE user_id = ?'
    ).run(Number(request.body.enabled), request.userId);
    response.json({ settings: { twoFactorEnabled: request.body.enabled } });
  });

  api.patch('/security/settings', async (request, response) => {
    if (typeof request.body.alertUnrecognizedDevice !== 'boolean') {
      throw new HttpError(400, 'Choose whether to enable unrecognized-device alerts.');
    }
    await database.prepare(
      'INSERT INTO security_settings (user_id, alert_unrecognized_device) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET alert_unrecognized_device = excluded.alert_unrecognized_device'
    ).run(request.userId, Number(request.body.alertUnrecognizedDevice));
    response.json({ settings: { alertUnrecognizedDevice: request.body.alertUnrecognizedDevice } });
  });

  app.use('/api', api);
  app.use((error, _request, response, _next) => {
    if (error instanceof SyntaxError && 'body' in error) {
      return response.status(400).json({ error: 'Request body must be valid JSON.' });
    }
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status === 500) console.error(error);
    response.status(status).json({ error: status === 500 ? 'Something went wrong. Please try again.' : error.message });
  });

  return app;
}
