import { searchSimilar } from '../../lib/embeddings.js';
import { getDoc } from '../../lib/db.js';

export async function search({ params, query }) {
  const [projectId] = params;
  const q = query.q;
  if (!q) return { statusCode: 400, body: { error: 'q query parameter is required' } };

  const limit = parseInt(query.limit, 10) || 100;
  const chunks = await searchSimilar(projectId, q, limit);

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
      score: docScores[id].score,
      chunkCount: docScores[id].count,
    }))
    .sort((a, b) => b.score - a.score);

  return { statusCode: 200, body: { chunks, documents } };
}
