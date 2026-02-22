import { addDoc } from './addDoc.js';
import { listCategories } from './listCategories.js';
import { listTopics } from './listTopics.js';
import { semanticSearch } from './semanticSearch.js';
import { getDocument } from './getDocument.js';
import { listDocuments } from './listDocuments.js';
import { listProjects } from './listProjects.js';
import { createProject } from './createProject.js';

/**
 * Registry of all available tools
 */
export const tools = [
  addDoc,
  listCategories,
  listTopics,
  semanticSearch,
  getDocument,
  listDocuments,
  listProjects,
  createProject,
];

/**
 * Get a tool by name
 */
export function getTool(name) {
  return tools.find(tool => tool.name === name);
}
