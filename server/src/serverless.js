import { createHash } from 'node:crypto';
import { createApp } from './app.js';
import { databaseConfig, openDatabase } from './db.js';

/**
 * JWT_SECRET is preferred. When it is missing on a hosted deployment, derive a stable,
 * server-only secret from the database token instead of falling back to a public default.
 */
export function resolveJwtSecret(env = process.env) {
  if (env.JWT_SECRET) return env.JWT_SECRET;
  const config = databaseConfig(env);
  if (config.authToken) {
    return createHash('sha256').update(`texas-trust-jwt:${config.authToken}`).digest('hex');
  }
  return undefined;
}

let appPromise;

function getApp() {
  appPromise ??= (async () => {
    const database = await openDatabase();
    return createApp(database, resolveJwtSecret());
  })().catch((error) => {
    appPromise = undefined; // retry on the next request instead of caching the failure
    throw error;
  });
  return appPromise;
}

/** Node.js request handler for serverless platforms such as Vercel. */
export default async function handler(request, response) {
  let app;
  try {
    app = await getApp();
  } catch (error) {
    console.error('API startup failed:', error);
    response.statusCode = 500;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ error: 'The service is not available right now. Please try again shortly.' }));
    return;
  }
  return app(request, response);
}
