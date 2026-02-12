import { createResponse, createErrorResponse } from '../utils.js';

// Example resources registry
// In a real implementation, this would be loaded from a database or configuration
const resources = [
  {
    uri: 'file:///project/src/main.rs',
    name: 'main.rs',
    description: 'Primary application entry point',
    mimeType: 'text/x-rust'
  }
];

const resourceTemplates = [
  {
    uriTemplate: 'file:///{path}',
    name: 'Project Files',
    description: 'Access files in the project directory',
    mimeType: 'application/octet-stream'
  }
];

/**
 * Handle resources/list request
 */
export async function handleList(params, id) {
  const cursor = params?.cursor;
  
  // Simple pagination - in production, implement proper cursor-based pagination
  const result = {
    resources: resources,
    nextCursor: null
  };
  
  return createResponse(id, result);
}

/**
 * Handle resources/read request
 */
export async function handleRead(params, id) {
  const { uri } = params || {};
  
  if (!uri) {
    return createErrorResponse(id, -32602, 'Invalid params: uri is required');
  }
  
  // Find the resource
  const resource = resources.find(r => r.uri === uri);
  if (!resource) {
    return createErrorResponse(id, -32601, `Resource not found: ${uri}`);
  }
  
  // In a real implementation, this would read the actual resource content
  // For now, return example content
  let text = '';
  if (uri.includes('main.rs')) {
    text = 'fn main() {\n    println!("Hello world!");\n}';
  }
  
  const result = {
    contents: [
      {
        uri: resource.uri,
        mimeType: resource.mimeType,
        text: text
      }
    ]
  };
  
  return createResponse(id, result);
}

/**
 * Handle resources/templates/list request
 */
export async function handleTemplatesList(params, id) {
  const result = {
    resourceTemplates: resourceTemplates
  };
  
  return createResponse(id, result);
}






