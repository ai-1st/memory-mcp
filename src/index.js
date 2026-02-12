import { route } from './mcp/router.js';
import { validateRequest, parseRequestBody, createErrorResponse } from './mcp/utils.js';

/**
 * Lambda handler for MCP server
 */
export const handler = async (event) => {
  // Handle CORS preflight
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '300'
      },
      body: ''
    };
  }
  
  // Parse request body
  let request;
  try {
    const body = event.body || '{}';
    request = parseRequestBody(body);
  } catch (error) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
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
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(createErrorResponse(
        request.id || null,
        -32600,
        'Invalid Request',
        validation.error
      ))
    };
  }
  
  // Route to appropriate handler
  const response = await route(request.method, request.params, request.id);
  
  // Handle notifications (no response)
  if (response === null) {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: ''
    };
  }
  
  // Return JSON-RPC response
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(response)
  };
};






