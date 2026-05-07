import { loadIndex, search } from '../lib/bm25.js';
import { getDoc } from '../lib/db.js';
import { hasMeaningfulUpdateSince, parseMaxDaysSinceUpdated } from '../lib/searchFilters.js';

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
      maxDaysSinceUpdated: {
        type: 'number',
        description: 'Only return documents with meaningful activity within this many days',
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
    const { query, limit = 10, maxDaysSinceUpdated } = args;
    const { projectId } = config;
    const { cutoffMs, error } = parseMaxDaysSinceUpdated(maxDaysSinceUpdated);
    if (error) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error }) }],
        isError: true,
      };
    }

    const { index } = await loadIndex(projectId);
    const searchLimit = cutoffMs === null ? limit : Math.max(limit * 10, 100);
    const hits = search(index, query, searchLimit);

    const documents = (await Promise.all(hits.map(async (hit) => {
      const doc = await getDoc(projectId, hit.docId);
      if (!doc || !hasMeaningfulUpdateSince(doc, cutoffMs)) return null;
      return {
        id: hit.docId,
        title: doc.title || '',
        url: doc.url || '',
        summary: doc.summary || '',
        meaningfulUpdatedAt: doc.meaningfulUpdatedAt || null,
        score: Math.round(hit.score * 1000) / 1000,
      };
    }))).filter(Boolean).slice(0, limit);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ query, documents }, null, 2),
      }],
      isError: false,
    };
  },
};
