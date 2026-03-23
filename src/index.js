import { route } from './mcp/router.js';
import { validateRequest, parseRequestBody, createErrorResponse } from './mcp/utils.js';

/**
 * Lambda handler for MCP server
 *
 * Config can be provided in two ways:
 *   1. In the JSON-RPC payload: params.config (standard WebTools extension)
 *   2. As URL query parameters (fallback for clients that don't support the extension)
 *
 * Query parameters are merged into params.config, with payload config taking precedence.
 */
export const handler = async (event) => {
  const queryConfig = event.queryStringParameters || {};

  let request;
  try {
    const body = event.body || '{}';
    request = parseRequestBody(body);
  } catch (error) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createErrorResponse(null, -32700, 'Parse error', error.message)),
    };
  }

  const validation = validateRequest(request);
  if (!validation.valid) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createErrorResponse(request.id || null, -32600, 'Invalid Request', validation.error)),
    };
  }

  if (Object.keys(queryConfig).length > 0 && request.params) {
    request.params.config = {
      ...queryConfig,
      ...(request.params.config || {}),
    };
  }

  const response = await route(request.method, request.params, request.id);

  if (response === null) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: '',
    };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(response),
  };
};
