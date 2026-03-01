import { searchSimilar } from '../../lib/embeddings.js';

export async function search({ params, query }) {
  const [projectId] = params;
  const q = query.q;
  if (!q) return { statusCode: 400, body: { error: 'q query parameter is required' } };

  const limit = parseInt(query.limit, 10) || 5;
  const results = await searchSimilar(projectId, q, limit);
  return { statusCode: 200, body: { results } };
}
