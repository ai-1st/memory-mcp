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
    const { category } = args;
    const { projectId } = config;
    const topics = await queryTopicsByCategory(projectId, category);

    const result = topics.map(t => ({
      id: t.id,
      category: t.category,
      title: t.title,
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
