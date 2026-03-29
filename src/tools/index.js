import { semanticSearch } from './semanticSearch.js';
import { bm25Search } from './bm25Search.js';
import { getDocument } from './getDocument.js';

/**
 * Registry of read-only MCP tools (agent-facing).
 * Write operations are handled by the Admin REST API.
 */
export const tools = [
  semanticSearch,
  bm25Search,
  getDocument,
];

export function getTool(name) {
  return tools.find(tool => tool.name === name);
}
