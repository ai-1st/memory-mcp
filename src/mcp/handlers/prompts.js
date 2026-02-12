import { createResponse, createErrorResponse } from '../utils.js';

// Example prompts registry
// In a real implementation, this would be loaded from a database or configuration
const prompts = [
  {
    name: 'code_review',
    description: 'Asks the LLM to analyze code quality and suggest improvements',
    arguments: [
      {
        name: 'code',
        description: 'The code to review',
        required: true
      }
    ]
  }
];

/**
 * Handle prompts/list request
 */
export async function handleList(params, id) {
  const cursor = params?.cursor;
  
  // Simple pagination - in production, implement proper cursor-based pagination
  const result = {
    prompts: prompts,
    nextCursor: null
  };
  
  return createResponse(id, result);
}

/**
 * Handle prompts/get request
 */
export async function handleGet(params, id) {
  const { name, arguments: args } = params || {};
  
  if (!name) {
    return createErrorResponse(id, -32602, 'Invalid params: name is required');
  }
  
  // Find the prompt
  const prompt = prompts.find(p => p.name === name);
  if (!prompt) {
    return createErrorResponse(id, -32601, `Prompt not found: ${name}`);
  }
  
  // Validate required arguments
  const requiredArgs = prompt.arguments?.filter(a => a.required) || [];
  for (const arg of requiredArgs) {
    if (!args || !(arg.name in args)) {
      return createErrorResponse(
        id,
        -32602,
        `Invalid params: missing required argument: ${arg.name}`
      );
    }
  }
  
  // Generate prompt messages based on the prompt template
  // In a real implementation, this would use a template engine
  let promptText = '';
  if (name === 'code_review' && args?.code) {
    promptText = `Please review this Python code:\n${args.code}`;
  } else {
    promptText = `Prompt: ${name}`;
  }
  
  const result = {
    description: `${prompt.description}`,
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: promptText
        }
      }
    ]
  };
  
  return createResponse(id, result);
}






