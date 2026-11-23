import 'dotenv/config';
import { openDatabase } from './db.js';
import { createApp } from './app.js';
import { resolveJwtSecret } from './serverless.js';

const jwtSecret = resolveJwtSecret();
if (process.env.NODE_ENV === 'production' && !jwtSecret) {
  console.error('JWT_SECRET must be set in production.');
  process.exit(1);
}

const port = Number(process.env.PORT) || 3001;
const database = await openDatabase();
const app = createApp(database, jwtSecret);

app.listen(port, () => {
  console.log(`Mock banking API listening on http://localhost:${port}`);
});
