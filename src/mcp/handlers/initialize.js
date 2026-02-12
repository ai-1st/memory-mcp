import { createResponse } from '../utils.js';

/**
 * Handle initialize request
 */
export async function handle(params, id) {
  const result = {
    protocolVersion: params?.protocolVersion || '2025-03-26',
    capabilities: {
      logging: {},
      prompts: {
        listChanged: true
      },
      resources: {
        subscribe: true,
        listChanged: true
      },
      tools: {
        listChanged: true
      }
    },
    serverInfo: {
      name: 'AWS Lambda MCP Server',
      version: '1.0.0'
    },
    instructions: 'AWS Lambda-based MCP server with WebTools extensions'
  };
  
  return createResponse(id, result);
}






