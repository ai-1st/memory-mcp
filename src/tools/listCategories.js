import { listCategories as queryCategories } from '../lib/db.js';

export const listCategories = {
  name: 'list_categories',
  description: 'List all topic categories with their topic counts',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  configSchema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'The project ID to scope this operation to',
      },
    },
    required: ['projectId'],
  },

  async execute(args, config) {
    const { projectId } = config;
    const categories = await queryCategories(projectId);

    const result = categories.map(c => ({
      category: c.category,
      topicCount: c.topicCount || 0,
    }));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ categories: result }, null, 2),
      }],
      isError: false,
    };
  },
};
