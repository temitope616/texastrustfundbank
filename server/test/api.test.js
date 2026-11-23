import assert from 'node:assert/strict';
import { once } from 'node:events';
import test, { after, before } from 'node:test';
import bcrypt from 'bcryptjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db.js';

let database;
let databaseDirectory;
let server;
let baseUrl;
let token;
let reviewerToken;
let twoFactorCode;
let payeeId;
const logs = [];
const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

async function request(path, { method = 'GET', body, authenticated = true, authToken = token } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (authenticated && authToken) headers.authorization = `Bearer ${authToken}`;
  const response = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json();
  return { response, payload };
}

before(async () => {
  // A temporary file: libSQL in-memory databases do not survive across transactions.
  databaseDirectory = mkdtempSync(path.join(tmpdir(), 'texas-trust-test-'));
  database = await openDatabase({ url: pathToFileURL(path.join(databaseDirectory, 'test.sqlite')).href });
  const user = (await database.prepare(
    'INSERT INTO users (email, display_name, password_hash, phone) VALUES (?, ?, ?, ?)'
  ).run('ava.claire@texas-trust.test', 'Ava Claire', bcrypt.hashSync('Violet!Harbor84_Copper', 4), '555-010-4821'));
  const userId = Number(user.lastInsertRowid);
  (await database.prepare(
    'INSERT INTO users (email, display_name, role, password_hash, phone) VALUES (?, ?, ?, ?, ?)'
  ).run('reviewer@texas-trust.test', 'Prototype Reviewer', 'reviewer', bcrypt.hashSync('ReviewOnly!91_Marble', 4), '555-010-0100'));
  const checking = (await database.prepare(
    'INSERT INTO accounts (user_id, type, last4, balance, available_balance) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, 'checking', '4821', 500, 500));
  (await database.prepare(
    'INSERT INTO accounts (user_id, type, last4, balance, available_balance) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, 'savings', '9037', 1000, 1000));
  (await database.prepare(
    'INSERT INTO cards (account_id, last4, status, expiry_date) VALUES (?, ?, ?, ?)'
  ).run(Number(checking.lastInsertRowid), '1842', 'active', '2028-08-31'));
  const payee = (await database.prepare(
    'INSERT INTO payees (user_id, name, account_last4, bank_name) VALUES (?, ?, ?, ?)'
  ).run(userId, 'Jordan Lee', '2048', 'Northstar Credit Union'));
  payeeId = Number(payee.lastInsertRowid);

  server = createApp(database, 'test-secret').listen(0);
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  database?.close();
  // Best effort: Windows may still hold the file handle briefly after close().
  try {
    if (databaseDirectory) rmSync(databaseDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {}
});

test('login, 2FA, account transfers, and supporting banking endpoints', async () => {
  const reviewerOriginalInfo = console.info;
  console.info = (message) => logs.push(String(message));
  const login = await request('/auth/login', {
    method: 'POST',
    body: { email: 'ava.claire@texas-trust.test', password: 'Violet!Harbor84_Copper' },
    authenticated: false
  });
  console.info = reviewerOriginalInfo;
  assert.equal(login.response.status, 200);
  assert.equal(login.payload.requiresTwoFactor, true);
  twoFactorCode = logs[0].match(/: (\d{6})$/)?.[1];
  assert.ok(twoFactorCode, 'the mock 2FA code should be printed to the server console');

  const verification = await request('/auth/verify-2fa', {
    method: 'POST',
    body: { challengeId: login.payload.challengeId, code: twoFactorCode },
    authenticated: false
  });
  assert.equal(verification.response.status, 200);
  token = verification.payload.token;
  assert.ok(token);
  assert.equal(verification.payload.user.displayName, 'Ava Claire');
  assert.equal(verification.payload.user.role, 'customer');

  const accounts = await request('/accounts');
  assert.equal(accounts.payload.accounts.length, 2);
  const customerReviewAccess = await request('/review/transfers');
  assert.equal(customerReviewAccess.response.status, 403);

  const transfer = await request('/transfers', {
    method: 'POST',
    body: { fromAccountId: 1, toAccountId: 2, amount: 125, frequency: 'once', scheduledDate: futureDate }
  });
  assert.equal(transfer.response.status, 201);
  assert.equal(transfer.payload.transfer.status, 'pending');
  assert.match(transfer.payload.transfer.message, /No funds have moved/);
  assert.equal((await database.prepare('SELECT balance FROM accounts WHERE id = 1').get()).balance, 500);
  assert.equal((await database.prepare('SELECT available_balance FROM accounts WHERE id = 1').get()).available_balance, 500);
  assert.equal((await database.prepare('SELECT balance FROM accounts WHERE id = 2').get()).balance, 1000);

  const sameAccount = await request('/transfers', {
    method: 'POST',
    body: { fromAccountId: 1, toAccountId: 1, amount: 10, frequency: 'once', scheduledDate: futureDate }
  });
  assert.equal(sameAccount.response.status, 400);
  const tooLarge = await request('/transfers', {
    method: 'POST',
    body: { fromAccountId: 1, toAccountId: 2, amount: 9999, frequency: 'once', scheduledDate: futureDate }
  });
  assert.equal(tooLarge.response.status, 400);
  const subCent = await request('/transfers', {
    method: 'POST',
    body: { fromAccountId: 1, toAccountId: 2, amount: 0.001, frequency: 'once', scheduledDate: futureDate }
  });
  assert.equal(subCent.response.status, 400);

  const externalTransfer = await request('/transfers', {
    method: 'POST',
    body: { fromAccountId: 1, payeeId, amount: 50, frequency: 'once', scheduledDate: futureDate }
  });
  assert.equal(externalTransfer.payload.transfer.status, 'pending');
  assert.equal((await database.prepare('SELECT balance FROM accounts WHERE id = 1').get()).balance, 500);
  assert.equal((await database.prepare('SELECT available_balance FROM accounts WHERE id = 1').get()).available_balance, 500);

  const deposit = await request('/deposits', {
    method: 'POST',
    body: { accountId: 1, amount: 85, frontImageName: 'front.jpg', backImageName: 'back.jpg' }
  });
  assert.equal(deposit.response.status, 201);
  assert.equal(deposit.payload.deposit.status, 'pending');
  assert.equal((await database.prepare('SELECT balance FROM accounts WHERE id = 1').get()).balance, 500);

  const cards = await request('/cards');
  assert.equal(cards.payload.cards.length, 1);
  const lockedCard = await request('/cards/1', { method: 'PATCH', body: { status: 'locked' } });
  assert.equal(lockedCard.payload.card.status, 'locked');

  const newPayee = await request('/payees', {
    method: 'POST',
    body: { name: 'Cedar Utilities', accountLast4: '6612', bankName: 'Cedar Community Bank' }
  });
  assert.equal(newPayee.response.status, 201);
  const billPayment = await request('/billpay', {
    method: 'POST',
    body: { accountId: 1, payeeId, amount: 15, frequency: 'once', scheduledDate: futureDate }
  });
  assert.equal(billPayment.response.status, 201);
  assert.equal(billPayment.payload.payment.status, 'pending');
  assert.equal((await database.prepare('SELECT balance FROM accounts WHERE id = 1').get()).balance, 500);
  assert.equal((await database.prepare('SELECT available_balance FROM accounts WHERE id = 1').get()).available_balance, 500);

  const requests = await request('/transfers');
  assert.equal(requests.payload.transfers.length, 3);
  assert.equal(requests.payload.transfers.find((item) => item.id === billPayment.payload.payment.id).requestType, 'Bill payment');
  const initialHistory = await request(`/transfers/${transfer.payload.transfer.id}/history`);
  assert.deepEqual(initialHistory.payload.events.map((event) => event.eventType), ['submitted']);

  const twoFactorOriginalInfo = console.info;
  console.info = (message) => logs.push(String(message));
  const reviewerLogin = await request('/auth/login', {
    method: 'POST',
    body: { email: 'reviewer@texas-trust.test', password: 'ReviewOnly!91_Marble' },
    authenticated: false
  });
  console.info = twoFactorOriginalInfo;
  assert.equal(reviewerLogin.response.status, 200);
  const reviewerCode = logs.at(-1).match(/: (\d{6})$/)?.[1];
  const reviewerVerification = await request('/auth/verify-2fa', {
    method: 'POST',
    body: { challengeId: reviewerLogin.payload.challengeId, code: reviewerCode },
    authenticated: false
  });
  assert.equal(reviewerVerification.response.status, 200);
  reviewerToken = reviewerVerification.payload.token;
  assert.equal(reviewerVerification.payload.user.role, 'reviewer');

  const reviewerAccounts = await request('/accounts', { authToken: reviewerToken });
  assert.equal(reviewerAccounts.payload.accounts.length, 0);
  const reviewQueue = await request('/review/transfers', { authToken: reviewerToken });
  assert.equal(reviewQueue.payload.transfers.length, 3);
  assert.equal(reviewQueue.payload.transfers.every((item) => item.customerEmail === 'ava.claire@texas-trust.test'), true);

  const approved = await request(`/review/transfers/${transfer.payload.transfer.id}`, {
    method: 'PATCH',
    body: { decision: 'approved', note: 'Verified in the mock review queue.' },
    authToken: reviewerToken
  });
  assert.equal(approved.response.status, 200);
  assert.equal(approved.payload.transfer.status, 'approved');
  assert.equal((await database.prepare('SELECT balance FROM accounts WHERE id = 1').get()).balance, 500);
  assert.equal((await database.prepare('SELECT balance FROM accounts WHERE id = 2').get()).balance, 1000);

  const rejected = await request(`/review/transfers/${externalTransfer.payload.transfer.id}`, {
    method: 'PATCH',
    body: { decision: 'rejected', note: 'Recipient could not be verified.' },
    authToken: reviewerToken
  });
  assert.equal(rejected.payload.transfer.status, 'rejected');
  const customerApprovalAttempt = await request(`/review/transfers/${billPayment.payload.payment.id}`, {
    method: 'PATCH',
    body: { decision: 'approved' }
  });
  assert.equal(customerApprovalAttempt.response.status, 403);

  const approvedHistory = await request(`/transfers/${transfer.payload.transfer.id}/history`);
  assert.deepEqual(approvedHistory.payload.events.map((event) => event.eventType), ['submitted', 'approved']);
  const rejectedHistory = await request(`/transfers/${externalTransfer.payload.transfer.id}/history`);
  assert.deepEqual(rejectedHistory.payload.events.map((event) => event.eventType), ['submitted', 'rejected']);

  const cancelCandidate = await request('/transfers', {
    method: 'POST',
    body: { fromAccountId: 1, toAccountId: 2, amount: 30, frequency: 'once', scheduledDate: futureDate }
  });
  const cancelled = await request(`/transfers/${cancelCandidate.payload.transfer.id}/cancel`, { method: 'PATCH', body: {} });
  assert.equal(cancelled.response.status, 200);
  assert.equal(cancelled.payload.transfer.status, 'cancelled');
  assert.equal((await database.prepare('SELECT balance FROM accounts WHERE id = 1').get()).balance, 500);
  assert.equal((await database.prepare('SELECT balance FROM accounts WHERE id = 2').get()).balance, 1000);
  assert.equal((await database.prepare(`
    SELECT status FROM transactions
    WHERE id = (SELECT transaction_id FROM transfers WHERE id = ?)
  `).get(cancelCandidate.payload.transfer.id)).status, 'failed');
  assert.equal((await database.prepare(`
    SELECT status FROM transactions
    WHERE id = (SELECT destination_transaction_id FROM transfers WHERE id = ?)
  `).get(cancelCandidate.payload.transfer.id)).status, 'failed');

  const cancelledHistory = await request(`/transfers/${cancelCandidate.payload.transfer.id}/history`);
  assert.deepEqual(cancelledHistory.payload.events.map((event) => event.eventType), ['submitted', 'cancelled']);
  const repeatedCancel = await request(`/transfers/${cancelCandidate.payload.transfer.id}/cancel`, { method: 'PATCH', body: {} });
  assert.equal(repeatedCancel.response.status, 400);
  const accountHistory = await request('/accounts/1/transactions?page=1');
  assert.equal(accountHistory.payload.transactions.find((item) => item.description.startsWith('Cancelled: Transfer request')).status, 'cancelled');
  assert.equal(accountHistory.payload.transactions.some((item) => item.description.startsWith('Rejected: External transfer request') && item.status === 'rejected'), true);

  const security = await request('/security/login-history');
  assert.equal(security.payload.loginHistory.length, 1);
  const settings = await request('/security/settings', {
    method: 'PATCH',
    body: { alertUnrecognizedDevice: false }
  });
  assert.equal(settings.payload.settings.alertUnrecognizedDevice, false);

  assert.equal(accountHistory.response.status, 200);
  assert.equal(accountHistory.payload.total, 5);
});

test('prototype signup creates a zero-balance view-only account', async () => {
  const externalEmail = await request('/auth/register', {
    method: 'POST',
    body: { displayName: 'Test User', email: 'user@example.com', password: 'Strong!TestUser42' },
    authenticated: false
  });
  assert.equal(externalEmail.response.status, 400);

  const weakPassword = await request('/auth/register', {
    method: 'POST',
    body: { displayName: 'Test User', email: 'new.user@texas-trust.test', password: 'short' },
    authenticated: false
  });
  assert.equal(weakPassword.response.status, 400);

  const signup = await request('/auth/register', {
    method: 'POST',
    body: { displayName: 'New Test User', email: 'new.user@texas-trust.test', password: 'Strong!TestUser42' },
    authenticated: false
  });
  assert.equal(signup.response.status, 201);
  assert.equal(signup.payload.account.balance, 0);
  assert.equal(signup.payload.account.status, 'view-only');

  const duplicate = await request('/auth/register', {
    method: 'POST',
    body: { displayName: 'New Test User', email: 'NEW.USER@TEXAS-TRUST.TEST', password: 'Strong!TestUser42' },
    authenticated: false
  });
  assert.equal(duplicate.response.status, 409);

  const user = (await database.prepare('SELECT id FROM users WHERE email = ?').get('new.user@texas-trust.test'));
  const account = (await database.prepare('SELECT id, balance, available_balance, status FROM accounts WHERE user_id = ?').get(user.id));
  assert.deepEqual(account, {
    id: account.id,
    balance: 0,
    available_balance: 0,
    status: 'view-only'
  });
  assert.equal((await database.prepare('SELECT COUNT(*) AS count FROM transactions WHERE account_id = ?').get(account.id)).count, 0);

  const capturedLogs = logs.length;
  const originalInfo = console.info;
  console.info = (message) => logs.push(String(message));
  const login = await request('/auth/login', {
    method: 'POST',
    body: { email: 'new.user@texas-trust.test', password: 'Strong!TestUser42' },
    authenticated: false
  });
  console.info = originalInfo;
  assert.equal(login.response.status, 200);
  const code = logs[capturedLogs].match(/: (\d{6})$/)?.[1];
  const verification = await request('/auth/verify-2fa', {
    method: 'POST',
    body: { challengeId: login.payload.challengeId, code },
    authenticated: false
  });
  assert.equal(verification.response.status, 200);
  token = verification.payload.token;
  const ownAccounts = await request('/accounts');
  assert.deepEqual(ownAccounts.payload.accounts.map(({ id, type, last4, balance, available_balance, status }) => ({ id, type, last4, balance, available_balance, status })), [
    { id: account.id, type: 'checking', last4: signup.payload.account.last4, balance: 0, available_balance: 0, status: 'view-only' }
  ]);

  const profileUpdate = await request('/profile', {
    method: 'PATCH',
    body: { displayName: 'Casey Example', phone: '555-010-9999' }
  });
  assert.equal(profileUpdate.response.status, 200);
  assert.deepEqual(profileUpdate.payload.profile, { displayName: 'Casey Example', phone: '555-010-9999' });
  const passwordUpdate = await request('/profile/password', {
    method: 'PATCH',
    body: { currentPassword: 'Strong!TestUser42', newPassword: 'EvenStronger!Prototype27' }
  });
  assert.equal(passwordUpdate.response.status, 200);
  const oldPasswordLogin = await request('/auth/login', {
    method: 'POST',
    body: { email: 'new.user@texas-trust.test', password: 'Strong!TestUser42' },
    authenticated: false
  });
  assert.equal(oldPasswordLogin.response.status, 401);

  const disableTwoFactor = await request('/security/two-factor', {
    method: 'PATCH',
    body: { enabled: false }
  });
  assert.equal(disableTwoFactor.payload.settings.twoFactorEnabled, false);
  const passwordOnlyLogin = await request('/auth/login', {
    method: 'POST',
    body: { email: 'new.user@texas-trust.test', password: 'EvenStronger!Prototype27' },
    authenticated: false
  });
  assert.equal(passwordOnlyLogin.response.status, 200);
  assert.equal(passwordOnlyLogin.payload.requiresTwoFactor, false);
  token = passwordOnlyLogin.payload.token;
  const updatedProfile = await request('/profile');
  assert.equal(updatedProfile.payload.profile.displayName, 'Casey Example');
  assert.equal(updatedProfile.payload.profile.phone, '555-010-9999');
  const disabledSecurity = await request('/security/login-history');
  assert.equal(disabledSecurity.payload.settings.twoFactorEnabled, false);

  const enableTwoFactor = await request('/security/two-factor', {
    method: 'PATCH',
    body: { enabled: true }
  });
  assert.equal(enableTwoFactor.payload.settings.twoFactorEnabled, true);
  const twoFactorOriginalInfo = console.info;
  console.info = (message) => logs.push(String(message));
  const twoFactorLogin = await request('/auth/login', {
    method: 'POST',
    body: { email: 'new.user@texas-trust.test', password: 'EvenStronger!Prototype27' },
    authenticated: false
  });
  console.info = twoFactorOriginalInfo;
  assert.equal(twoFactorLogin.payload.requiresTwoFactor, true);
  const refreshedCode = logs.at(-1).match(/: (\d{6})$/)?.[1];
  const refreshedVerification = await request('/auth/verify-2fa', {
    method: 'POST',
    body: { challengeId: twoFactorLogin.payload.challengeId, code: refreshedCode },
    authenticated: false
  });
  assert.equal(refreshedVerification.response.status, 200);
  token = refreshedVerification.payload.token;

  const deposit = await request('/deposits', {
    method: 'POST',
    body: { accountId: account.id, amount: 25, frontImageName: 'front.jpg', backImageName: 'back.jpg' }
  });
  assert.equal(deposit.response.status, 403);
  assert.match(deposit.payload.error, /Deposits are disabled/);

  const withdrawal = await request('/transfers', {
    method: 'POST',
    body: { fromAccountId: account.id, toAccountId: 1, amount: 1, frequency: 'once', scheduledDate: futureDate }
  });
  assert.equal(withdrawal.response.status, 403);
  assert.match(withdrawal.payload.error, /withdrawals.*disabled/i);
  assert.equal((await database.prepare('SELECT balance FROM accounts WHERE id = ?').get(account.id)).balance, 0);
  assert.equal((await database.prepare('SELECT COUNT(*) AS count FROM transactions WHERE account_id = ?').get(account.id)).count, 0);
});

async function signIn(email, password) {
  const originalInfo = console.info;
  const start = logs.length;
  console.info = (message) => logs.push(String(message));
  const login = await request('/auth/login', { method: 'POST', body: { email, password }, authenticated: false });
  console.info = originalInfo;
  if (!login.payload.requiresTwoFactor) return login.payload.token;
  const code = logs[start].match(/: (\d{6})$/)?.[1];
  const verified = await request('/auth/verify-2fa', {
    method: 'POST', body: { challengeId: login.payload.challengeId, code }, authenticated: false
  });
  return verified.payload.token;
}

test('rejected money movement on view-only accounts changes no balances or history', async () => {
  const snapshot = async () => ({
    accounts: (await database.prepare('SELECT id, balance, available_balance, status FROM accounts ORDER BY id').all()),
    transactions: (await database.prepare('SELECT COUNT(*) AS count FROM transactions').get()).count,
    transfers: (await database.prepare('SELECT COUNT(*) AS count FROM transfers').get()).count
  });

  const email = 'zero.balance@texas-trust.test';
  const password = 'Zero!Balance2026x';
  const signup = await request('/auth/register', {
    method: 'POST', body: { displayName: 'Zero Balance', email, password }, authenticated: false
  });
  assert.equal(signup.response.status, 201);
  const userId = (await database.prepare('SELECT id FROM users WHERE email = ?').get(email)).id;
  const viewOnly = (await database.prepare('SELECT id FROM accounts WHERE user_id = ?').get(userId)).id;
  const ava = (await database.prepare("SELECT id FROM users WHERE email = 'ava.claire@texas-trust.test'").get()).id;
  const avaChecking = (await database.prepare("SELECT id FROM accounts WHERE user_id = ? AND type = 'checking'").get(ava)).id;

  // Each 2FA sign-in gets a different code; a code from one challenge never works for another.
  const first = await signIn(email, password);
  assert.ok(first);
  const codesIssued = logs.filter((line) => line.includes(email)).map((line) => line.match(/(\d{6})$/)[1]);
  const second = await signIn(email, password);
  assert.ok(second);
  const allCodes = logs.filter((line) => line.includes(email)).map((line) => line.match(/(\d{6})$/)[1]);
  assert.equal(allCodes.length, codesIssued.length + 1);
  const staleCode = await request('/auth/login', { method: 'POST', body: { email, password }, authenticated: false });
  const stale = await request('/auth/verify-2fa', {
    method: 'POST', body: { challengeId: staleCode.payload.challengeId, code: '000000' }, authenticated: false
  });
  assert.equal(stale.response.status, 401);

  token = second;
  const before = await snapshot();
  const attempts = [
    ['/deposits', { accountId: viewOnly, amount: 50, frontImageName: 'f.jpg', backImageName: 'b.jpg' }],
    ['/transfers', { fromAccountId: viewOnly, payeeId, amount: 1, frequency: 'once', scheduledDate: futureDate }],
    ['/billpay', { accountId: viewOnly, payeeId, amount: 1, frequency: 'once', scheduledDate: futureDate }],
    // Cross-user attempts against Ava's seeded account must also be refused.
    ['/deposits', { accountId: avaChecking, amount: 50, frontImageName: 'f.jpg', backImageName: 'b.jpg' }],
    ['/transfers', { fromAccountId: avaChecking, toAccountId: viewOnly, amount: 1, frequency: 'once', scheduledDate: futureDate }],
    ['/billpay', { accountId: avaChecking, payeeId, amount: 1, frequency: 'once', scheduledDate: futureDate }]
  ];
  for (const [path, body] of attempts) {
    const result = await request(path, { method: 'POST', body });
    assert.ok([403, 404].includes(result.response.status), `${path} returned ${result.response.status}`);
    assert.deepEqual(await snapshot(), before, `${path} changed data`);
  }

  // Password change guards.
  const wrongCurrent = await request('/profile/password', { method: 'PATCH', body: { currentPassword: 'Wrong!Password99', newPassword: 'Another!Strong2026' } });
  assert.equal(wrongCurrent.response.status, 400);
  const weakNew = await request('/profile/password', { method: 'PATCH', body: { currentPassword: password, newPassword: 'weak' } });
  assert.equal(weakNew.response.status, 400);
  const reused = await request('/profile/password', { method: 'PATCH', body: { currentPassword: password, newPassword: password } });
  assert.equal(reused.response.status, 400);
  const hash = (await database.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId)).password_hash;
  assert.ok(hash.startsWith('$2') && !hash.includes(password));
  assert.equal(await signIn('ava.claire@texas-trust.test', 'Violet!Harbor84_Copper').then(Boolean), true);
});

test('requests without a JSON body return validation errors, not 500', async () => {
  const login = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST' });
  assert.equal(login.status, 401);
  const register = await fetch(`${baseUrl}/api/auth/register`, { method: 'POST' });
  assert.equal(register.status, 400);
  const cancel = await fetch(`${baseUrl}/api/transfers/1/cancel`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}` }
  });
  assert.notEqual(cancel.status, 500);
});

test('transfers scheduled in the past are rejected', async () => {
  const { response, payload } = await request('/transfers', {
    method: 'POST',
    body: { fromAccountId: 1, toAccountId: 2, amount: 1, frequency: 'once', scheduledDate: '2020-01-01' }
  });
  assert.equal(response.status, 400);
  assert.equal(payload.error, 'Choose today or a future date.');
});

test('2FA started on one server instance can be completed on another (serverless)', async () => {
  const instanceB = createApp(database, 'test-secret').listen(0);
  await once(instanceB, 'listening');
  try {
    const login = await request('/auth/login', {
      method: 'POST',
      body: { email: 'ava.claire@texas-trust.test', password: 'Violet!Harbor84_Copper' },
      authenticated: false
    });
    assert.equal(login.response.status, 200);
    assert.equal(login.payload.requiresTwoFactor, true);
    assert.match(login.payload.demoCode, /^\d{6}$/, 'hosted demo shows the code because no SMS is sent');

    const verifyOnB = await fetch(`http://127.0.0.1:${instanceB.address().port}/api/auth/verify-2fa`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challengeId: login.payload.challengeId, code: login.payload.demoCode })
    });
    assert.equal(verifyOnB.status, 200);
    assert.ok((await verifyOnB.json()).token);

    const replay = await request('/auth/verify-2fa', {
      method: 'POST', body: { challengeId: login.payload.challengeId, code: login.payload.demoCode }, authenticated: false
    });
    assert.equal(replay.response.status, 401, 'a used challenge cannot be replayed');
  } finally {
    await new Promise((resolve) => instanceB.close(resolve));
  }
});
