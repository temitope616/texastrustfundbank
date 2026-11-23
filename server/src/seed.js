import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { openDatabase } from './db.js';

const dataDirectory = fileURLToPath(new URL('../data/', import.meta.url));
mkdirSync(dataDirectory, { recursive: true });

const database = openDatabase();
const email = 'ava.claire@texas-trust.test';
const previousEmail = 'ava.claire@boa-prototype.test';
const olderEmail = 'ava.claire@northbank.test';
const legacyEmail = 'demo@northbank.test';
const password = 'Violet!Harbor84_Copper';
const reviewerEmail = 'reviewer@texas-trust.test';
const previousReviewerEmail = 'reviewer@boa-prototype.test';
const olderReviewerEmail = 'reviewer@northbank.test';
const reviewerPassword = 'ReviewOnly!91_Marble';
const existingUser = database.prepare(
  'SELECT id, email FROM users WHERE email IN (?, ?, ?, ?) ORDER BY CASE WHEN email = ? THEN 0 ELSE 1 END LIMIT 1'
).get(email, previousEmail, olderEmail, legacyEmail, email);
const existingReviewer = database.prepare(
  'SELECT id, email FROM users WHERE email IN (?, ?, ?) ORDER BY CASE WHEN email = ? THEN 0 ELSE 1 END LIMIT 1'
).get(reviewerEmail, previousReviewerEmail, olderReviewerEmail, reviewerEmail);
const seedVersion = database.prepare(
  'SELECT value FROM app_metadata WHERE key = ?'
).get('demo-seed-version')?.value;

if (existingUser && ['ava-claire-3', 'ava-claire-4'].includes(seedVersion)) {
  database.transaction(() => {
    database.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, existingUser.id);
    if (existingReviewer) {
      database.prepare(
        'UPDATE users SET email = ?, display_name = ?, role = ?, password_hash = ? WHERE id = ?'
      ).run(reviewerEmail, 'Prototype Reviewer', 'reviewer', bcrypt.hashSync(reviewerPassword, 10), existingReviewer.id);
    } else {
      database.prepare(
        'INSERT INTO users (email, display_name, role, password_hash, phone) VALUES (?, ?, ?, ?, ?)'
      ).run(reviewerEmail, 'Prototype Reviewer', 'reviewer', bcrypt.hashSync(reviewerPassword, 10), '555-010-0100');
    }
    database.prepare(
      'INSERT INTO app_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run('demo-seed-version', 'ava-claire-5');
  })();
  console.log('Texas trust prototype identities updated; account history preserved.');
  console.log(`Login: ${email} / ${password}`);
  console.log(`Reviewer login: ${reviewerEmail} / ${reviewerPassword}`);
  database.close();
  process.exit(0);
}

if (existingUser && seedVersion === 'ava-claire-5' && existingReviewer?.email === reviewerEmail) {
  console.log('Prototype data already exists; no changes made.');
  database.close();
  process.exit(0);
}

const transactionTemplates = Array.from({ length: 18 }, () => [
  ['Northstar Health payroll', 4500.00, 'credit', 'Income'],
  ['Monthly rent payment', 1100.00, 'debit', 'Housing']
]).flat();
transactionTemplates.push(
  ['Performance bonus', 4500.00, 'credit', 'Income'],
  ['Tax refund', 1000.00, 'credit', 'Income'],
  ['Utilities and household bills', 620.00, 'debit', 'Utilities'],
  ['Vehicle payment', 850.00, 'debit', 'Transportation']
);

const savingsTemplates = [
  ['Monthly savings contribution', 250.00, 'credit', 'Transfer'],
  ['Quarterly interest credit', 18.45, 'credit', 'Interest'],
  ['ATM cash withdrawal', 40.00, 'debit', 'Cash'],
  ['Monthly savings contribution', 200.00, 'credit', 'Transfer'],
  ['Quarterly interest credit', 16.90, 'credit', 'Interest'],
  ['Online transfer to checking', 75.00, 'debit', 'Transfer'],
  ['Monthly savings contribution', 250.00, 'credit', 'Transfer'],
  ['Quarterly interest credit', 19.12, 'credit', 'Interest'],
  ['Online transfer to checking', 60.00, 'debit', 'Transfer'],
  ['Monthly savings contribution', 200.00, 'credit', 'Transfer'],
  ['Quarterly interest credit', 17.68, 'credit', 'Interest'],
  ['ATM cash withdrawal', 30.00, 'debit', 'Cash'],
  ['Monthly savings contribution', 250.00, 'credit', 'Transfer'],
  ['Quarterly interest credit', 20.05, 'credit', 'Interest'],
  ['Online transfer to checking', 85.00, 'debit', 'Transfer'],
  ['Monthly savings contribution', 200.00, 'credit', 'Transfer'],
  ['Quarterly interest credit', 18.76, 'credit', 'Interest'],
  ['ATM cash withdrawal', 25.00, 'debit', 'Cash'],
  ['Monthly savings contribution', 250.00, 'credit', 'Transfer'],
  ['Quarterly interest credit', 21.22, 'credit', 'Interest']
];

const transaction = database.transaction(() => {
  const userId = existingUser
    ? existingUser.id
    : Number(database.prepare(
      'INSERT INTO users (email, display_name, password_hash, phone) VALUES (?, ?, ?, ?)'
    ).run(email, 'Ava Claire', bcrypt.hashSync(password, 10), '555-010-4821').lastInsertRowid);
  database.prepare(
    'UPDATE users SET email = ?, display_name = ?, password_hash = ? WHERE id = ?'
  ).run(email, 'Ava Claire', bcrypt.hashSync(password, 10), userId);
  if (existingReviewer) {
    database.prepare(
      'UPDATE users SET email = ?, display_name = ?, role = ?, password_hash = ? WHERE id = ?'
    ).run(reviewerEmail, 'Prototype Reviewer', 'reviewer', bcrypt.hashSync(reviewerPassword, 10), existingReviewer.id);
  } else {
    database.prepare(
      'INSERT INTO users (email, display_name, role, password_hash, phone) VALUES (?, ?, ?, ?, ?)'
    ).run(reviewerEmail, 'Prototype Reviewer', 'reviewer', bcrypt.hashSync(reviewerPassword, 10), '555-010-0100');
  }

  const insertAccount = database.prepare(
    'INSERT INTO accounts (user_id, type, last4, balance, available_balance) VALUES (?, ?, ?, ?, ?)'
  );
  const existingAccounts = database.prepare(
    'SELECT id, type FROM accounts WHERE user_id = ?'
  ).all(userId);
  const existingChecking = existingAccounts.find((account) => account.type === 'checking');
  const existingSavings = existingAccounts.find((account) => account.type === 'savings');
  const checkingId = existingChecking
    ? existingChecking.id
    : Number(insertAccount.run(userId, 'checking', '4821', 75730.75, 75730.75).lastInsertRowid);
  const savingsId = existingSavings
    ? existingSavings.id
    : Number(insertAccount.run(userId, 'savings', '9037', 12800.00, 12800.00).lastInsertRowid);
  database.prepare(
    'UPDATE accounts SET balance = ?, available_balance = ? WHERE id = ?'
  ).run(75730.75, 75730.75, checkingId);
  database.prepare(
    'DELETE FROM transfers WHERE from_account_id = ? OR to_account_id = ?'
  ).run(checkingId, checkingId);
  database.prepare('DELETE FROM transactions WHERE account_id = ?').run(checkingId);

  const insertTransaction = database.prepare(
    'INSERT INTO transactions (account_id, date, description, amount, type, balance_after, category) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  const seedAccountTransactions = (accountId, templates, endingBalance, offsetDays) => {
    const netChange = templates.reduce((total, [, amount, type]) => (
      total + (type === 'credit' ? amount : -amount)
    ), 0);
    let runningBalance = endingBalance - netChange;
    const today = new Date();

    templates.forEach(([description, amount, type, category], index) => {
      const date = new Date(today);
      const interval = templates.length > 1
        ? (templates.length - index - 1) * 18 * 30.4375 / (templates.length - 1)
        : 0;
      date.setDate(today.getDate() - Math.round(interval) - offsetDays);
      runningBalance += type === 'credit' ? amount : -amount;
      insertTransaction.run(
        accountId,
        date.toISOString().slice(0, 10),
        description,
        amount,
        type,
        Number(runningBalance.toFixed(2)),
        category
      );
    });
  };

  seedAccountTransactions(checkingId, transactionTemplates, 75730.75, 0);
  if (!existingSavings) seedAccountTransactions(savingsId, savingsTemplates, 12800.00, 7);

  if (!existingUser) {
    const insertCard = database.prepare(
      'INSERT INTO cards (account_id, last4, status, expiry_date) VALUES (?, ?, ?, ?)'
    );
    insertCard.run(checkingId, '1842', 'active', '2028-08-31');
    insertCard.run(checkingId, '7716', 'locked', '2027-11-30');

    const insertPayee = database.prepare(
      'INSERT INTO payees (user_id, name, account_last4, bank_name) VALUES (?, ?, ?, ?)'
    );
    insertPayee.run(userId, 'Jordan Lee', '2048', 'Northstar Credit Union');
    insertPayee.run(userId, 'Cedar Water & Power', '6612', 'Cedar Community Bank');
  }

  database.prepare(
    'INSERT INTO app_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run('demo-seed-version', 'ava-claire-5');
});

try {
  transaction();
  console.log('Demo data seeded successfully.');
  console.log(`Login: ${email} / ${password}`);
  console.log(`Reviewer login: ${reviewerEmail} / ${reviewerPassword}`);
  console.log('Demo profile: Ava Claire');
  console.log('Checking balance: $75,730.75');
  console.log('Created 2 accounts, 60 transactions, 2 cards, and 2 payees.');
} finally {
  database.close();
}