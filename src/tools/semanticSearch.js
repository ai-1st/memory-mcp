import { searchSimilar } from '../lib/embeddings.js';

export const semanticSearch = {
  name: 'semantic_search',
  description: 'Search topics by semantic similarity to a query',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query text',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 5)',
      },
    },
    required: ['query'],
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
    const { query, limit = 5 } = args;
    const { projectId } = config;
    const results = await searchSimilar(projectId, query, limit);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          query,
          results: results.map(r => ({
            id: r.id,
            category: r.category,
            summary: r.summary,
            score: Math.round(r.score * 1000) / 1000,
          })),
        }, null, 2),
      }],
      isError: false,
    };
  },
};
