import { queryTopicsByCategory } from '../lib/db.js';

export const listTopics = {
  name: 'list_topics',
  description: 'List all topics in a given category',
  inputSchema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description: 'The category to list topics for (e.g. "programming", "devops")',
      },
    },
    required: ['category'],
  },

  async execute(args) {
    const { category } = args;
    const topics = await queryTopicsByCategory(category);

    const result = topics.map(t => ({
      id: t.id,
      category: t.category,
      summary: t.summary,
      doc_ids: t.doc_ids,
      sha256: t.sha256,
    }));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ category, topics: result }, null, 2),
      }],
      isError: false,
    };
  },
};
