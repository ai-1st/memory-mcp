import * as initializeHandler from './handlers/initialize.js';
import * as pingHandler from './handlers/ping.js';
import * as toolsHandler from './handlers/tools.js';
import * as resourcesHandler from './handlers/resources.js';
import * as promptsHandler from './handlers/prompts.js';
import { createErrorResponse } from './utils.js';

/**
 * Route JSON-RPC method to appropriate handler
 */
export async function route(method, params, id) {
  try {
    switch (method) {
      case 'initialize':
        return await initializeHandler.handle(params, id);
      
      case 'ping':
        return await pingHandler.handle(params, id);
      
      case 'tools/list':
        return await toolsHandler.handleList(params, id);
      
      case 'tools/call':
        return await toolsHandler.handleCall(params, id);
      
      case 'resources/list':
        return await resourcesHandler.handleList(params, id);
      
      case 'resources/read':
        return await resourcesHandler.handleRead(params, id);
      
      case 'resources/templates/list':
        return await resourcesHandler.handleTemplatesList(params, id);
      
      case 'prompts/list':
        return await promptsHandler.handleList(params, id);
      
      case 'prompts/get':
        return await promptsHandler.handleGet(params, id);
      
      case 'notifications/initialized':
        // Notifications don't return a response
        return null;
      
      default:
        return createErrorResponse(
          id,
          -32601,
          `Method not found: ${method}`
        );
    }
  } catch (error) {
    return createErrorResponse(
      id,
      -32603,
      'Internal error',
      error.message
    );
  }
}






