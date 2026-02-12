import { createResponse, createErrorResponse, generateVersionHash } from '../utils.js';
import { tools, getTool } from '../../tools/index.js';

// Cache for tool version hash
let cachedVersionHash = null;
let cachedToolsDefinition = null;

/**
 * Get tools definition (without version hash)
 */
function getToolsDefinition() {
  if (cachedToolsDefinition) {
    return cachedToolsDefinition;
  }
  
  cachedToolsDefinition = tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    configSchema: tool.configSchema
  }));
  
  return cachedToolsDefinition;
}

/**
 * Get version hash for tools
 */
function getVersionHash() {
  if (cachedVersionHash) {
    return cachedVersionHash;
  }
  
  const toolsDef = getToolsDefinition();
  cachedVersionHash = generateVersionHash({ tools: toolsDef });
  return cachedVersionHash;
}

/**
 * Handle tools/list request
 */
export async function handleList(params, id) {
  const requestedVersion = params?.version;
  const currentVersion = getVersionHash();
  
  // If version is specified and matches, return cached version
  // Otherwise return current tools with new version
  const toolsDef = getToolsDefinition();
  
  const result = {
    version: currentVersion,
    tools: toolsDef
  };
  
  // If version was requested and doesn't match, client should update
  if (requestedVersion && requestedVersion !== currentVersion) {
    // Still return current tools, but version mismatch indicates update needed
  }
  
  return createResponse(id, result);
}

/**
 * Handle tools/call request
 */
export async function handleCall(params, id) {
  const { name, version, config, arguments: args } = params || {};
  
  if (!name) {
    return createErrorResponse(id, -32602, 'Invalid params: name is required');
  }
  
  if (!args) {
    return createErrorResponse(id, -32602, 'Invalid params: arguments is required');
  }
  
  // Get the tool
  const tool = getTool(name);
  if (!tool) {
    return createErrorResponse(id, -32601, `Tool not found: ${name}`);
  }
  
  // Validate version if provided
  if (version) {
    const currentVersion = getVersionHash();
    if (version !== currentVersion) {
      return createErrorResponse(
        id,
        -32602,
        `Version mismatch: requested ${version}, current ${currentVersion}`
      );
    }
  }
  
  // Validate arguments against inputSchema (basic validation)
  // In a production system, you'd use a proper JSON Schema validator
  const required = tool.inputSchema?.required || [];
  for (const field of required) {
    if (!(field in args)) {
      return createErrorResponse(
        id,
        -32602,
        `Invalid params: missing required argument: ${field}`
      );
    }
  }
  
  try {
    // Execute the tool
    const result = await tool.execute(args, config || {});
    
    // Ensure result has required fields
    if (!result.content) {
      result.content = [];
    }
    if (result.isError === undefined) {
      result.isError = false;
    }
    
    return createResponse(id, result);
  } catch (error) {
    return createResponse(id, {
      content: [
        {
          type: 'text',
          text: `Error executing tool: ${error.message}`
        }
      ],
      isError: true,
      extra: null
    });
  }
}






