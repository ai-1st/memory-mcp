import { loadIndex, search } from '../lib/bm25.js';
import { getDoc } from '../lib/db.js';

export const bm25Search = {
  name: 'bm25_search',
  description: 'Search documents by keyword matching using BM25 ranking. Returns ranked documents with summaries.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query text',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of documents to return (default: 10)',
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
    const { query, limit = 10 } = args;
    const { projectId } = config;
    const { index } = await loadIndex(projectId);
    const hits = search(index, query, limit);

    const documents = await Promise.all(hits.map(async (hit) => {
      const doc = await getDoc(projectId, hit.docId);
      return {
        id: hit.docId,
        title: doc?.title || '',
        url: doc?.url || '',
        summary: doc?.summary || '',
        score: Math.round(hit.score * 1000) / 1000,
      };
    }));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ query, documents }, null, 2),
      }],
      isError: false,
    };
  },
};
