import { listCategories as queryCategories } from '../lib/db.js';

export const listCategories = {
  name: 'list_categories',
  description: 'List all topic categories with their topic counts',
  inputSchema: {
    type: 'object',
    properties: {},
  },

  async execute() {
    const categories = await queryCategories();

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
