import { randomInt, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import express from 'express';
import jwt from 'jsonwebtoken';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
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
  return value;
}

function requireInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new HttpError(400, `${label} is required.`);
  }
  return number;
}

function accountForUser(database, accountId, userId) {
  const account = database.prepare(
    'SELECT * FROM accounts WHERE id = ? AND user_id = ?'
  ).get(accountId, userId);
  if (!account) throw new HttpError(404, 'Account not found.');
  return account;
}

function ensureAvailable(database, account, cents) {
  if (account.status === 'view-only') {
    throw new HttpError(403, 'Transfers, withdrawals, and bill payments are disabled for view-only prototype accounts.');
  }
  if (account.status !== 'active') throw new HttpError(400, 'This account is not available for transfers.');
  if (Math.round(account.available_balance * 100) < cents) {
    throw new HttpError(400, 'The amount exceeds your available balance.');
  }
}

function recordTransferEvent(database, transferId, userId, eventType, note) {
  database.prepare(
    'INSERT INTO transfer_events (transfer_id, actor_user_id, event_type, note) VALUES (?, ?, ?, ?)'
  ).run(transferId, userId, eventType, note);
}

export function createApp(database, jwtSecret = process.env.JWT_SECRET || 'local-prototype-secret-change-me') {
  const app = express();
  const pendingChallenges = new Map();

  app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_request, response) => response.json({ status: 'ok' }));

  app.post('/api/auth/register', (request, response, next) => {
    try {
      const email = String(request.body.email || '').trim().toLowerCase();
      const displayName = String(request.body.displayName || '').trim();
      const password = String(request.body.password || '');
      if (!/^[a-z0-9._%+-]+@texas-trust\.test$/.test(email)) {
        throw new HttpError(400, 'Use an email address ending in @texas-trust.test.');
      }
      if (displayName.length < 2 || displayName.length > 80) {
        throw new HttpError(400, 'Name must be between 2 and 80 characters.');
      }
      if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
        throw new HttpError(400, 'Use at least 12 characters with uppercase, lowercase, a number, and a symbol.');
      }

      const account = database.transaction(() => {
        if (database.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
          throw new HttpError(409, 'An account already exists for that email.');
        }
        const user = database.prepare(
          'INSERT INTO users (email, display_name, password_hash, phone) VALUES (?, ?, ?, ?)'
        ).run(email, displayName, bcrypt.hashSync(password, 10), '');
        const userId = Number(user.lastInsertRowid);
        let last4;
        do {
          last4 = String(randomInt(10000)).padStart(4, '0');
        } while (database.prepare('SELECT id FROM accounts WHERE user_id = ? AND last4 = ?').get(userId, last4));
        database.prepare(
          'INSERT INTO accounts (user_id, type, last4, balance, available_balance, status) VALUES (?, ?, ?, 0, 0, ?)'
        ).run(userId, 'checking', last4, 'view-only');
        database.prepare('INSERT INTO security_settings (user_id) VALUES (?)').run(userId);
        return { displayName, accountLast4: last4 };
      })();

      response.status(201).json({
        message: 'Account created with a $0 balance. Sign in to view it; deposits, transfers, bill payments, and withdrawals are disabled.',
        user: { displayName: account.displayName, email },
        account: { type: 'checking', last4: account.accountLast4, balance: 0, status: 'view-only' }
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/login', (request, response, next) => {
    try {
      const email = String(request.body.email || '').trim().toLowerCase();
      const password = String(request.body.password || '');
      const user = database.prepare('SELECT id, email, role, display_name AS displayName, password_hash FROM users WHERE email = ?').get(email);

      if (!user || !bcrypt.compareSync(password, user.password_hash)) {
        throw new HttpError(401, 'Email or password is incorrect.');
      }

      database.prepare('INSERT OR IGNORE INTO security_settings (user_id) VALUES (?)').run(user.id);
      const security = database.prepare(
        'SELECT two_factor_enabled AS twoFactorEnabled FROM security_settings WHERE user_id = ?'
      ).get(user.id);
      if (!security.twoFactorEnabled) {
        const device = String(request.get('user-agent') || 'Unknown browser').slice(0, 180);
        database.prepare(
          'INSERT INTO login_history (user_id, device, location, status) VALUES (?, ?, ?, ?)'
        ).run(user.id, device, 'Local prototype', 'success');
        const token = jwt.sign({ sub: String(user.id), role: user.role }, jwtSecret, { expiresIn: '4h' });
        return response.json({
          requiresTwoFactor: false,
          token,
          user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role }
        });
      }

      const challengeId = randomUUID();
      const code = String(randomInt(100000, 1000000));
      pendingChallenges.set(challengeId, {
        userId: user.id,
        role: user.role,
        code,
        expiresAt: Date.now() + 5 * 60 * 1000,
        attempts: 0
      });
      console.info(`[mock-2fa] ${user.email}: ${code}`);
      response.json({ requiresTwoFactor: true, challengeId });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/verify-2fa', (request, response, next) => {
    try {
      const challengeId = String(request.body.challengeId || '');
      const code = String(request.body.code || '');
      const challenge = pendingChallenges.get(challengeId);

      if (!challenge || challenge.expiresAt < Date.now()) {
        pendingChallenges.delete(challengeId);
        throw new HttpError(401, 'That verification code has expired. Sign in again.');
      }
      if (!/^\d{6}$/.test(code) || challenge.code !== code) {
        challenge.attempts += 1;
        if (challenge.attempts >= 5) pendingChallenges.delete(challengeId);
        throw new HttpError(401, 'The verification code is incorrect.');
      }

      pendingChallenges.delete(challengeId);
      const user = database.prepare('SELECT id, email, role, display_name AS displayName FROM users WHERE id = ?').get(challenge.userId);
      const device = String(request.get('user-agent') || 'Unknown browser').slice(0, 180);
      database.prepare(
        'INSERT INTO login_history (user_id, device, location, status) VALUES (?, ?, ?, ?)'
      ).run(user.id, device, 'Local prototype', 'success');
      database.prepare(
        'INSERT OR IGNORE INTO security_settings (user_id) VALUES (?)'
      ).run(user.id);

      const token = jwt.sign({ sub: String(user.id), role: user.role }, jwtSecret, { expiresIn: '4h' });
      response.json({ token, user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role } });
    } catch (error) {
      next(error);
    }
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

  api.get('/accounts', (request, response) => {
    const accounts = database.prepare(
      'SELECT id, type, last4, balance, available_balance, status FROM accounts WHERE user_id = ? ORDER BY CASE type WHEN \'checking\' THEN 0 ELSE 1 END, id'
    ).all(request.userId);
    response.json({ accounts });
  });

  api.get('/profile', (request, response) => {
    const profile = database.prepare(
      'SELECT display_name AS displayName, email, phone FROM users WHERE id = ?'
    ).get(request.userId);
    response.json({ profile });
  });

  api.patch('/profile', (request, response, next) => {
    try {
      const displayName = String(request.body.displayName || '').trim();
      const phone = String(request.body.phone || '').trim();
      if (displayName.length < 2 || displayName.length > 80) {
        throw new HttpError(400, 'Name must be between 2 and 80 characters.');
      }
      if (phone.length > 32 || (phone && !/^[+()0-9 .-]+$/.test(phone))) {
        throw new HttpError(400, 'Enter a valid contact number.');
      }
      database.prepare('UPDATE users SET display_name = ?, phone = ? WHERE id = ?')
        .run(displayName, phone, request.userId);
      response.json({ profile: { displayName, phone } });
    } catch (error) {
      next(error);
    }
  });

  api.patch('/profile/password', (request, response, next) => {
    try {
      const currentPassword = String(request.body.currentPassword || '');
      const newPassword = String(request.body.newPassword || '');
      const user = database.prepare('SELECT password_hash FROM users WHERE id = ?').get(request.userId);
      if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
        throw new HttpError(400, 'Current password is incorrect.');
      }
      if (newPassword.length < 12 || !/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword) || !/\d/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
        throw new HttpError(400, 'Use at least 12 characters with uppercase, lowercase, a number, and a symbol.');
      }
      if (bcrypt.compareSync(newPassword, user.password_hash)) {
        throw new HttpError(400, 'Choose a password you have not used for this account.');
      }
      database.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
        .run(bcrypt.hashSync(newPassword, 10), request.userId);
      response.json({ message: 'Password updated.' });
    } catch (error) {
      next(error);
    }
  });

  api.get('/accounts/:id/transactions', (request, response, next) => {
    try {
      const accountId = requireInteger(request.params.id, 'Account');
      accountForUser(database, accountId, request.userId);
      const page = Math.max(1, Number.parseInt(request.query.page, 10) || 1);
      const pageSize = 10;
      const total = database.prepare(
        'SELECT COUNT(*) AS count FROM transactions WHERE account_id = ?'
      ).get(accountId).count;
      const transactions = database.prepare(
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
    } catch (error) {
      next(error);
    }
  });

  api.get('/transfers', (request, response) => {
    const transfers = database.prepare(`
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

  api.get('/review/transfers', requireReviewer, (request, response) => {
    const transfers = database.prepare(`
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

  api.patch('/review/transfers/:id', requireReviewer, (request, response, next) => {
    try {
      const transferId = requireInteger(request.params.id, 'Transfer');
      const decision = request.body.decision;
      if (!['approved', 'rejected'].includes(decision)) {
        throw new HttpError(400, 'Choose approve or reject.');
      }
      const note = String(request.body.note || '').trim();
      if (note.length > 240) throw new HttpError(400, 'Review note must be 240 characters or fewer.');

      const transfer = database.transaction(() => {
        const current = database.prepare(
          'SELECT * FROM transfers WHERE id = ?'
        ).get(transferId);
        if (!current) throw new HttpError(404, 'Transfer request not found.');
        if (current.status !== 'pending' || current.review_status !== 'pending' || current.cancelled_at) {
          throw new HttpError(409, 'This request has already been reviewed or cancelled.');
        }

        const reviewNote = note || (decision === 'approved'
          ? 'Approved for simulated processing; no funds moved.'
          : 'Rejected during review; no funds moved.');
        const status = decision === 'rejected' ? 'failed' : 'pending';
        database.prepare(`
          UPDATE transfers
          SET status = ?, review_status = ?, reviewed_at = CURRENT_TIMESTAMP,
            reviewer_id = ?, review_note = ?
          WHERE id = ?
        `).run(status, decision, request.userId, reviewNote, transferId);

        if (decision === 'rejected') {
          const transactionIds = [current.transaction_id, current.destination_transaction_id].filter(Boolean);
          const rejectTransaction = database.prepare(
            "UPDATE transactions SET status = 'failed', description = 'Rejected: ' || description WHERE id = ? AND status = 'pending'"
          );
          for (const transactionId of transactionIds) rejectTransaction.run(transactionId);
        }

        recordTransferEvent(database, transferId, request.userId, decision, reviewNote);
        return { id: transferId, status: decision, reviewNote };
      })();
      response.json({ transfer });
    } catch (error) {
      next(error);
    }
  });

  api.get('/transfers/:id/history', (request, response, next) => {
    try {
      const transferId = requireInteger(request.params.id, 'Transfer');
      const transfer = database.prepare(
        'SELECT transfers.id FROM transfers JOIN accounts ON accounts.id = transfers.from_account_id WHERE transfers.id = ? AND accounts.user_id = ?'
      ).get(transferId, request.userId);
      if (!transfer) throw new HttpError(404, 'Transfer request not found.');
      const events = database.prepare(
        'SELECT event_type AS eventType, note, created_at AS createdAt FROM transfer_events WHERE transfer_id = ? ORDER BY created_at, id'
      ).all(transferId);
      response.json({ events });
    } catch (error) {
      next(error);
    }
  });

  api.patch('/transfers/:id/cancel', (request, response, next) => {
    try {
      const transferId = requireInteger(request.params.id, 'Transfer');
      const result = database.transaction(() => {
        const transfer = database.prepare(`
          SELECT transfers.* FROM transfers
          JOIN accounts ON accounts.id = transfers.from_account_id
          WHERE transfers.id = ? AND accounts.user_id = ?
        `).get(transferId, request.userId);
        if (!transfer) throw new HttpError(404, 'Transfer request not found.');
        if (transfer.status !== 'pending' || transfer.review_status !== 'pending' || transfer.cancelled_at) {
          throw new HttpError(400, 'Only pending requests can be cancelled.');
        }

        const cancelledAt = new Date().toISOString();
        database.prepare(
          'UPDATE transfers SET cancelled_at = ? WHERE id = ? AND cancelled_at IS NULL'
        ).run(cancelledAt, transferId);
        const transactionIds = [transfer.transaction_id, transfer.destination_transaction_id].filter(Boolean);
        const updateTransaction = database.prepare(
          "UPDATE transactions SET status = 'failed', description = 'Cancelled: ' || description WHERE id = ? AND status = 'pending'"
        );
        for (const transactionId of transactionIds) updateTransaction.run(transactionId);
        recordTransferEvent(database, transferId, request.userId, 'cancelled', 'Request cancelled by account holder; no funds moved.');
        return { id: transferId, status: 'cancelled', cancelledAt };
      })();
      response.json({ transfer: result });
    } catch (error) {
      next(error);
    }
  });

  api.post('/transfers', (request, response, next) => {
    try {
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

      const transferResult = database.transaction(() => {
        const fromAccount = accountForUser(database, fromAccountId, request.userId);
        ensureAvailable(database, fromAccount, cents);
        const timestamp = new Date().toISOString().slice(0, 10);
        const insertTransaction = database.prepare(
          'INSERT INTO transactions (account_id, date, description, amount, type, balance_after, category, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );

        if (hasInternalDestination) {
          const toAccountId = requireInteger(request.body.toAccountId, 'To account');
          if (toAccountId === fromAccountId) throw new HttpError(400, 'Choose a different destination account.');
          const toAccount = accountForUser(database, toAccountId, request.userId);
          if (toAccount.status !== 'active') throw new HttpError(400, 'The destination account is not available.');

          const transfer = database.prepare(
            'INSERT INTO transfers (from_account_id, to_account_id, amount, scheduled_date, frequency, status) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(fromAccountId, toAccountId, amount, scheduledDate, frequency, 'pending');
          const transferId = Number(transfer.lastInsertRowid);
          const sourceTransaction = insertTransaction.run(fromAccountId, timestamp, 'Transfer request to account ending ' + toAccount.last4, amount, 'debit', fromAccount.balance, 'Transfer', 'pending');
          const destinationTransaction = insertTransaction.run(toAccountId, timestamp, 'Pending transfer from account ending ' + fromAccount.last4, amount, 'credit', toAccount.balance, 'Transfer', 'pending');
          database.prepare(
            'UPDATE transfers SET transaction_id = ?, destination_transaction_id = ? WHERE id = ?'
          ).run(Number(sourceTransaction.lastInsertRowid), Number(destinationTransaction.lastInsertRowid), transferId);
          recordTransferEvent(database, transferId, request.userId, 'submitted', 'Request submitted for security review; no funds moved.');
          return { id: transferId, status: 'pending', message: 'Transfer submitted for security review. No funds have moved.' };
        }

        const payeeId = requireInteger(request.body.payeeId, 'Payee');
        const payee = database.prepare(
          'SELECT id, name FROM payees WHERE id = ? AND user_id = ?'
        ).get(payeeId, request.userId);
        if (!payee) throw new HttpError(404, 'Payee not found.');
        const transfer = database.prepare(
          'INSERT INTO transfers (from_account_id, payee_id, amount, scheduled_date, frequency, status) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(fromAccountId, payeeId, amount, scheduledDate, frequency, 'pending');
        const transferId = Number(transfer.lastInsertRowid);
        const sourceTransaction = insertTransaction.run(fromAccountId, timestamp, 'External transfer request to ' + payee.name, amount, 'debit', fromAccount.balance, 'Transfer', 'pending');
        database.prepare('UPDATE transfers SET transaction_id = ? WHERE id = ?')
          .run(Number(sourceTransaction.lastInsertRowid), transferId);
        recordTransferEvent(database, transferId, request.userId, 'submitted', 'External recipient is unverified; request submitted for review and no funds moved.');
        return { id: transferId, status: 'pending', message: 'External transfer submitted for security review. No funds have moved.' };
      })();

      response.status(201).json({ transfer: transferResult });
    } catch (error) {
      next(error);
    }
  });

  api.post('/deposits', (request, response, next) => {
    try {
      const accountId = requireInteger(request.body.accountId, 'Account');
      const cents = amountInCents(request.body.amount);
      const account = accountForUser(database, accountId, request.userId);
      if (account.status === 'view-only') {
        throw new HttpError(403, 'Deposits are disabled for view-only prototype accounts. No funds were accepted.');
      }
      const frontImageName = String(request.body.frontImageName || '').trim();
      const backImageName = String(request.body.backImageName || '').trim();
      if (!frontImageName || !backImageName) throw new HttpError(400, 'Add images of both sides of the check.');
      const result = database.prepare(
        'INSERT INTO transactions (account_id, date, description, amount, type, balance_after, category, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(accountId, new Date().toISOString().slice(0, 10), 'Mobile check deposit', cents / 100, 'credit', account.balance, 'Deposit', 'pending');
      response.status(201).json({ deposit: { id: Number(result.lastInsertRowid), status: 'pending' } });
    } catch (error) {
      next(error);
    }
  });

  api.get('/cards', (request, response) => {
    const cards = database.prepare(
      'SELECT cards.id, cards.account_id AS accountId, cards.last4, cards.status, cards.expiry_date AS expiryDate, accounts.type AS accountType FROM cards JOIN accounts ON accounts.id = cards.account_id WHERE accounts.user_id = ? ORDER BY cards.id'
    ).all(request.userId);
    response.json({ cards });
  });

  api.patch('/cards/:id', (request, response, next) => {
    try {
      const cardId = requireInteger(request.params.id, 'Card');
      const status = request.body.status;
      if (!['active', 'locked', 'lost'].includes(status)) throw new HttpError(400, 'Choose a valid card status.');
      const result = database.prepare(
        'UPDATE cards SET status = ? WHERE id = ? AND account_id IN (SELECT id FROM accounts WHERE user_id = ?)'
      ).run(status, cardId, request.userId);
      if (result.changes !== 1) throw new HttpError(404, 'Card not found.');
      response.json({ card: database.prepare('SELECT id, last4, status FROM cards WHERE id = ?').get(cardId) });
    } catch (error) {
      next(error);
    }
  });

  api.get('/payees', (request, response) => {
    const payees = database.prepare(
      'SELECT id, name, account_last4 AS accountLast4, bank_name AS bankName FROM payees WHERE user_id = ? ORDER BY name'
    ).all(request.userId);
    response.json({ payees });
  });

  api.post('/payees', (request, response, next) => {
    try {
      const name = String(request.body.name || '').trim();
      const accountLast4 = String(request.body.accountLast4 || '').trim();
      const bankName = String(request.body.bankName || '').trim();
      if (name.length < 2 || name.length > 80) throw new HttpError(400, 'Enter a payee name between 2 and 80 characters.');
      if (!/^\d{4}$/.test(accountLast4)) throw new HttpError(400, 'Enter the last four digits of the account.');
      if (bankName.length < 2 || bankName.length > 80) throw new HttpError(400, 'Enter a bank name.');
      const result = database.prepare(
        'INSERT INTO payees (user_id, name, account_last4, bank_name) VALUES (?, ?, ?, ?)'
      ).run(request.userId, name, accountLast4, bankName);
      response.status(201).json({ payee: { id: Number(result.lastInsertRowid), name, accountLast4, bankName } });
    } catch (error) {
      next(error);
    }
  });

  api.post('/billpay', (request, response, next) => {
    try {
      const accountId = requireInteger(request.body.accountId, 'From account');
      const payeeId = requireInteger(request.body.payeeId, 'Payee');
      const cents = amountInCents(request.body.amount);
      const amount = cents / 100;
      const scheduledDate = parseDate(request.body.scheduledDate);
      const frequency = request.body.frequency;
      if (!['once', 'recurring'].includes(frequency)) throw new HttpError(400, 'Choose a payment frequency.');

      const payment = database.transaction(() => {
        const account = accountForUser(database, accountId, request.userId);
        ensureAvailable(database, account, cents);
        const payee = database.prepare(
          'SELECT id, name FROM payees WHERE id = ? AND user_id = ?'
        ).get(payeeId, request.userId);
        if (!payee) throw new HttpError(404, 'Payee not found.');
        const transaction = database.prepare(
          'INSERT INTO transactions (account_id, date, description, amount, type, balance_after, category, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(accountId, new Date().toISOString().slice(0, 10), 'Bill payment to ' + payee.name, amount, 'debit', account.balance, 'Bills', 'pending');
        const transfer = database.prepare(
          'INSERT INTO transfers (from_account_id, payee_id, amount, scheduled_date, frequency, status) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(accountId, payeeId, amount, scheduledDate, frequency, 'pending');
        const transferId = Number(transfer.lastInsertRowid);
        database.prepare('UPDATE transfers SET transaction_id = ? WHERE id = ?')
          .run(Number(transaction.lastInsertRowid), transferId);
        recordTransferEvent(database, transferId, request.userId, 'submitted', 'Bill payment submitted for review; no funds moved.');
        return { id: transferId, transactionId: Number(transaction.lastInsertRowid), status: 'pending' };
      })();

      response.status(201).json({ payment });
    } catch (error) {
      next(error);
    }
  });

  api.get('/security/login-history', (request, response) => {
    database.prepare('INSERT OR IGNORE INTO security_settings (user_id) VALUES (?)').run(request.userId);
    const loginHistory = database.prepare(
      'SELECT id, event_at AS eventAt, device, location, status FROM login_history WHERE user_id = ? ORDER BY event_at DESC, id DESC LIMIT 20'
    ).all(request.userId);
    const settings = database.prepare(
      'SELECT alert_unrecognized_device AS alertUnrecognizedDevice, two_factor_enabled AS twoFactorEnabled FROM security_settings WHERE user_id = ?'
    ).get(request.userId);
    response.json({ loginHistory, settings: { alertUnrecognizedDevice: Boolean(settings.alertUnrecognizedDevice), twoFactorEnabled: Boolean(settings.twoFactorEnabled) } });
  });

  api.patch('/security/two-factor', (request, response, next) => {
    try {
      if (typeof request.body.enabled !== 'boolean') {
        throw new HttpError(400, 'Choose whether two-step verification is enabled.');
      }
      database.prepare('INSERT OR IGNORE INTO security_settings (user_id) VALUES (?)').run(request.userId);
      database.prepare(
        'UPDATE security_settings SET two_factor_enabled = ? WHERE user_id = ?'
      ).run(Number(request.body.enabled), request.userId);
      response.json({ settings: { twoFactorEnabled: request.body.enabled } });
    } catch (error) {
      next(error);
    }
  });

  api.patch('/security/settings', (request, response, next) => {
    try {
      if (typeof request.body.alertUnrecognizedDevice !== 'boolean') {
        throw new HttpError(400, 'Choose whether to enable unrecognized-device alerts.');
      }
      database.prepare(
        'INSERT INTO security_settings (user_id, alert_unrecognized_device) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET alert_unrecognized_device = excluded.alert_unrecognized_device'
      ).run(request.userId, Number(request.body.alertUnrecognizedDevice));
      response.json({ settings: { alertUnrecognizedDevice: request.body.alertUnrecognizedDevice } });
    } catch (error) {
      next(error);
    }
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