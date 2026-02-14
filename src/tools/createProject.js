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
    },
    required: ['name'],
  },

  async execute(args) {
    const { name } = args;
    const id = ulid();
    const createdAt = new Date().toISOString();

    await putProject({ id, name });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ id, name, createdAt }, null, 2),
      }],
      isError: false,
    };
  },
};
