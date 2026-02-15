import { ulid } from 'ulid';
import { putProject } from '../lib/db.js';

export const createProject = {
  name: 'create_project',
  description: 'Create a new project',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'The name of the project',
      },
      rules: {
        type: 'string',
        description: 'Categorization rules that guide how documents are classified into categories. These rules are stored with the project and applied during how-to extraction.',
      },
    },
    required: ['name'],
  },

  async execute(args) {
    const { name, rules } = args;
    const id = ulid();
    const createdAt = new Date().toISOString();

    await putProject({ id, name, rules });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ id, name, rules: rules || null, createdAt }, null, 2),
      }],
      isError: false,
    };
  },
};
