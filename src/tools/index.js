import { listCategories } from './listCategories.js';
import { listTopics } from './listTopics.js';
import { semanticSearch } from './semanticSearch.js';
import { getDocument } from './getDocument.js';
import { listDocuments } from './listDocuments.js';
import { listProjects } from './listProjects.js';

/**
 * Registry of read-only MCP tools (agent-facing).
 * Write operations are handled by the Admin REST API.
 */
export const tools = [
  listCategories,
  listTopics,
  semanticSearch,
  getDocument,
  listDocuments,
  listProjects,
];

/**
 * Get a tool by name
 */
export function getTool(name) {
  return tools.find(tool => tool.name === name);
}
