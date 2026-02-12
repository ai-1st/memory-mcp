import { addDoc } from './addDoc.js';
import { listCategories } from './listCategories.js';
import { listTopics } from './listTopics.js';
import { semanticSearch } from './semanticSearch.js';
import { getDocument } from './getDocument.js';

/**
 * Registry of all available tools
 */
export const tools = [
  addDoc,
  listCategories,
  listTopics,
  semanticSearch,
  getDocument,
];

/**
 * Get a tool by name
 */
export function getTool(name) {
  return tools.find(tool => tool.name === name);
}
