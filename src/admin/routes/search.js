import { searchSimilar } from '../../lib/embeddings.js';
import { getDoc } from '../../lib/db.js';
import { hasMeaningfulUpdateSince, parseMaxDaysSinceUpdated } from '../../lib/searchFilters.js';

export async function search({ params, query }) {
  const [projectId] = params;
  const q = query.q;
  if (!q) return { statusCode: 400, body: { error: 'q query parameter is required' } };

  const limit = parseInt(query.limit, 10) || 100;
  const { cutoffMs, error } = parseMaxDaysSinceUpdated(query.maxDaysSinceUpdated);
  if (error) return { statusCode: 400, body: { error } };

  const searchLimit = cutoffMs === null ? limit : Math.max(limit * 5, 100);
  const chunks = await searchSimilar(projectId, q, searchLimit);

  const docScores = {};
  const docIdsFromChunks = [...new Set(chunks.map(c => c.docId).filter(Boolean))];
  const docDetails = await Promise.all(docIdsFromChunks.map(id => getDoc(projectId, id)));
  const docsById = Object.fromEntries(docIdsFromChunks.map((id, i) => [id, docDetails[i]]));
  const filteredChunks = chunks.filter(chunk => hasMeaningfulUpdateSince(docsById[chunk.docId], cutoffMs));

  for (const chunk of filteredChunks) {
    if (!chunk.docId) continue;
    if (!docScores[chunk.docId]) docScores[chunk.docId] = { score: 0, count: 0 };
    docScores[chunk.docId].score += chunk.score;
    docScores[chunk.docId].count++;
  }

  const docIds = Object.keys(docScores);
  const documents = docIds
    .map(id => ({
      id,
      url: docsById[id]?.url || '',
      title: docsById[id]?.title || '',
      summary: docsById[id]?.summary || '',
      meaningfulUpdatedAt: docsById[id]?.meaningfulUpdatedAt || null,
      score: docScores[id].score,
      chunkCount: docScores[id].count,
    }))
    .sort((a, b) => b.score - a.score);

  return { statusCode: 200, body: { chunks: filteredChunks.slice(0, limit), documents } };
}
