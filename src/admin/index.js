import { route } from './router.js';
import { checkAuth, UNAUTHORIZED } from './auth.js';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export const handler = async (event) => {
  const method = event.requestContext?.http?.method || 'GET';

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS };
  }

  if (process.env.ADMIN_SECRET_ARN) {
    const authorized = await checkAuth(event);
    if (!authorized) return UNAUTHORIZED;
  }

  const path = event.rawPath || '/';
  const query = event.queryStringParameters || {};

  let body = {};
  if (event.body) {
    try {
      body = JSON.parse(event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString()
        : event.body);
    } catch {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid JSON body' }) };
    }
  }

  try {
    const result = await route(method, path, body, query);
    return {
      statusCode: result.statusCode || 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result.body),
    };
  } catch (err) {
    console.error('Unhandled error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Internal server error' }),
    };
  }
};
