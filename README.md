# Texas Legal Trust Fund Bank · Concept Prototype

A local concept prototype for a fictional Texas legal trust-fund banking interface. It is not a bank or trust company and does not connect to real financial institutions or process real money.

## Requirements

- Node.js 20 or newer
- npm

## Setup

From the project root, install the workspace dependencies and create the demo database:

```bash
npm install
npm run seed
```

Start the API and client together:

```bash
npm run dev
```

Seeded login (not shown in the app UI): `ava.claire@texas-trust.test` / `Violet!Harbor84_Copper`

Reviewer test login: `reviewer@texas-trust.test` / `ReviewOnly!91_Marble`. The reviewer has no deposit accounts and can only approve or reject requests for simulation; decisions never move funds.

## Prototype Signup

Use **Open an account** on the login page. Signup accepts only fictional `@texas-trust.test` addresses, requires a name and a 12-character password containing uppercase, lowercase, a number, and a symbol, and stores the password as a bcrypt hash. Each new user gets one `$0` checking account marked view-only. Deposits, transfers, bill payments, and withdrawals are disabled for these accounts. Do not enter real personal or banking information.

Each new account starts with 2FA enabled. Users can change their display name and prototype contact number under **Profile & settings**, change their password after confirming the current password, and toggle 2FA under **Security**. Disabling 2FA skips the one-time code at future prototype sign-ins.

Demo profile: Ava Claire. Checking account ending `4821` is seeded at `$75,730.75` with 40 dated transactions showing deposits and spending across 18 months.

After submitting the password, enter the six-digit code. In this prototype no message is sent; the code is printed in the server terminal. The code is generated for each sign-in and expires after five minutes.

The SQLite database is created at `server/data/bank.sqlite`. Seed data is added only when the demo user is not already present; remove that local database file to start with a fresh demo dataset.

## Project layout

- `client/` - React, Vite, Tailwind CSS, and React Router application
- `server/` - Express API and SQLite data layer
- `server/src/db/schema.sql` - SQLite schema
- `server/src/seed.js` - Demo user and mock data seed

## Verification

Run the API integration checks and build the client:

```bash
npm test -w server
npm run build -w client
```

All activity is local mock data. Transfer and bill-payment requests stay pending or receive simulated review outcomes and never change balances. External recipient details are not verified; the app does not connect to financial institutions, send real payments, or upload check images. Do not enter real bank account or routing numbers.