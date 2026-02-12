import crypto from 'crypto';
import stringify from 'json-stable-stringify';

/**
 * Create a JSON-RPC 2.0 response
 */
export function createResponse(id, result) {
  return {
    jsonrpc: '2.0',
    id,
    result
  };
}

/**
 * Create a JSON-RPC 2.0 error response
 */
export function createErrorResponse(id, code, message, data = null) {
  const error = {
    code,
    message
  };
  if (data !== null) {
    error.data = data;
  }
  return {
    jsonrpc: '2.0',
    id,
    error
  };
}

/**
 * Generate SHA-256 hash of a stable JSON string representation
 */
export function generateVersionHash(obj) {
  const stableString = stringify(obj);
  return crypto.createHash('sha256').update(stableString).digest('hex');
}

/**
 * Validate JSON-RPC 2.0 request
 */
export function validateRequest(request) {
  if (!request || typeof request !== 'object') {
    return { valid: false, error: 'Invalid request: must be an object' };
  }
  
  if (request.jsonrpc !== '2.0') {
    return { valid: false, error: 'Invalid request: jsonrpc must be "2.0"' };
  }
  
  if (!request.method) {
    return { valid: false, error: 'Invalid request: method is required' };
  }
  
  // Notifications don't have an id, requests do
  if (request.id === undefined && !request.method.startsWith('notifications/')) {
    return { valid: false, error: 'Invalid request: id is required for requests' };
  }
  
  return { valid: true };
}

/**
 * Parse request body
 */
export function parseRequestBody(body) {
  try {
    if (typeof body === 'string') {
      return JSON.parse(body);
    }
    return body;
  } catch (error) {
    throw new Error(`Invalid JSON: ${error.message}`);
  }
}






