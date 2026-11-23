import 'dotenv/config';
import { openDatabase } from './db.js';
import { createApp } from './app.js';

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('JWT_SECRET must be set in production.');
  process.exit(1);
}

const port = Number(process.env.PORT) || 3001;
const database = openDatabase();
const app = createApp(database);

app.listen(port, () => {
  console.log(`Mock banking API listening on http://localhost:${port}`);
});