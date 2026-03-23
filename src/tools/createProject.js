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
      prompts: {
        type: 'object',
        description: 'Custom prompts for the project. Set prompts.chunking to override the default chunking prompt.',
        properties: {
          chunking: {
            type: 'string',
            description: 'Custom chunking prompt that controls how documents are broken into chunks.',
          },
        },
      },
    },
    required: ['name'],
  },

  async execute(args) {
    const { name, prompts } = args;
    const id = ulid();
    const createdAt = new Date().toISOString();

    await putProject({ id, name, prompts });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ id, name, prompts: prompts || {}, createdAt }, null, 2),
      }],
      isError: false,
    };
  },
};
