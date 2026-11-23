// Vercel serverless function: serves every /api/* request with the Express API in ../../server.
// vercel.json rewrites /api/:path* here; Express still sees the original URL.
let handlerPromise;

export default async function handler(request, response) {
  try {
    handlerPromise ??= import('../../server/src/serverless.js').then((module) => module.default);
    const serve = await handlerPromise;
    return await serve(request, response);
  } catch (error) {
    handlerPromise = undefined;
    console.error('API failed to load:', error);
    if (response.headersSent) return;
    response.statusCode = 500;
    response.setHeader('content-type', 'application/json');
    // Only a missing-module code and name are exposed, to make deployment problems diagnosable.
    const detail = error?.code === 'ERR_MODULE_NOT_FOUND' ? ` (${String(error.message).split('\n')[0]})` : '';
    response.end(JSON.stringify({ error: `The service is not available right now.${detail}` }));
  }
}
