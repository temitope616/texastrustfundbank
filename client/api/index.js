// Vercel serverless function: serves every /api/* request with the Express API in ../../server.
// vercel.json rewrites /api/:path* here; Express still sees the original URL.
export { default } from '../../server/src/serverless.js';
