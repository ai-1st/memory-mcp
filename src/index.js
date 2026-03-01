import { route } from './mcp/router.js';
import { validateRequest, parseRequestBody, createErrorResponse } from './mcp/utils.js';
import { setSelfUrl } from './lib/selfUrl.js';

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
  // Capture own Function URL from the incoming request for use by tools
  const domain = event.requestContext?.domainName;
  if (domain) setSelfUrl(`https://${domain}/`);

  // Extract query string parameters (fallback config source)
  const queryConfig = event.queryStringParameters || {};

  // Parse request body
  let request;
  try {
    const body = event.body || '{}';
    request = parseRequestBody(body);
  } catch (error) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(createErrorResponse(
        null,
        -32700,
        'Parse error',
        error.message
      ))
    };
  }
  
  // Validate JSON-RPC request
  const validation = validateRequest(request);
  if (!validation.valid) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(createErrorResponse(
        request.id || null,
        -32600,
        'Invalid Request',
        validation.error
      ))
    };
  }

  // Merge query params into config (payload config wins over query params)
  if (Object.keys(queryConfig).length > 0 && request.params) {
    request.params.config = {
      ...queryConfig,
      ...(request.params.config || {}),
    };
  }
  
  // Route to appropriate handler
  const response = await route(request.method, request.params, request.id);
  
  // Handle notifications (no response)
  if (response === null) {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: ''
    };
  }
  
  // Return JSON-RPC response
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(response)
  };
};






