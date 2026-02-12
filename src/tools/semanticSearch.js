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

  async execute(args) {
    const { query, limit = 5 } = args;
    const results = await searchSimilar(query, limit);

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
