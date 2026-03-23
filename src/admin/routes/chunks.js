import { listChunks, listChunksByDoc } from '../../lib/db.js';

export async function list({ params, query }) {
  const [projectId] = params;
  const docId = query.docId || null;
  const limit = parseInt(query.limit, 10) || undefined;
  const afterSK = query.after || undefined;

  if (docId) {
    const chunks = await listChunksByDoc(projectId, docId);
    return {
      statusCode: 200,
      body: {
        chunks: chunks.map(c => ({
          id: c.id, type: c.type, content: c.content, docId: c.docId,
        })),
        hasMore: false,
      },
    };
  }

  const { items, hasMore } = await listChunks(projectId, { limit, afterSK });
  return {
    statusCode: 200,
    body: {
      chunks: items.map(c => ({
        id: c.id, type: c.type, content: c.content, docId: c.docId,
      })),
      hasMore,
      lastSK: items.length > 0 ? items[items.length - 1].SK : null,
    },
  };
}
