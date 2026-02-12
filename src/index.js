import { route } from './mcp/router.js';
import { validateRequest, parseRequestBody, createErrorResponse } from './mcp/utils.js';

/**
 * Lambda handler for MCP server
 */
export const handler = async (event) => {
  // Note: CORS is handled by Lambda Function URL configuration in template.yaml
  // No need to manually add CORS headers here
  
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






