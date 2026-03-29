import { searchSimilar } from '../lib/embeddings.js';
import { getDoc } from '../lib/db.js';

export const semanticSearch = {
  name: 'semantic_search',
  description: 'Search documents by semantic similarity to a query. Returns ranked documents with summaries.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query text',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of documents to return (default: 5)',
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
    const chunks = await searchSimilar(projectId, query, limit * 10);

    const docScores = {};
    for (const chunk of chunks) {
      if (!chunk.docId) continue;
      if (!docScores[chunk.docId]) docScores[chunk.docId] = { score: 0, count: 0 };
      docScores[chunk.docId].score += chunk.score;
      docScores[chunk.docId].count++;
    }

    const docIds = Object.keys(docScores);
    const docDetails = await Promise.all(docIds.map(id => getDoc(projectId, id)));
    const documents = docIds
      .map((id, i) => ({
        id,
        url: docDetails[i]?.url || '',
        title: docDetails[i]?.title || '',
        summary: docDetails[i]?.summary || '',
        score: Math.round(docScores[id].score * 1000) / 1000,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ query, documents }, null, 2),
      }],
      isError: false,
    };
  },
};
