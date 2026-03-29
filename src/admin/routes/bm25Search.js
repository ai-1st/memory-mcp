import { loadIndex, search, createIndex, addDocument, saveIndex } from '../../lib/bm25.js';
import { getDoc, listDocs } from '../../lib/db.js';

export async function bm25Search({ params, query }) {
  const [projectId] = params;
  const q = query.q;
  if (!q) return { statusCode: 400, body: { error: 'q query parameter is required' } };

  const limit = parseInt(query.limit, 10) || 10;
  const { index } = await loadIndex(projectId);
  const hits = search(index, q, limit);

  const documents = await Promise.all(hits.map(async (hit) => {
    const doc = await getDoc(projectId, hit.docId);
    return {
      id: hit.docId,
      title: doc?.title || '',
      url: doc?.url || '',
      summary: doc?.summary || '',
      score: hit.score,
    };
  }));

  return { statusCode: 200, body: { documents } };
}

export async function stats({ params }) {
  const [projectId] = params;
  const { index, sizeBytes } = await loadIndex(projectId);

  return {
    statusCode: 200,
    body: {
      totalDocs: index.totalDocs,
      totalWords: index.totalLength,
      vocabSize: Object.keys(index.df).length,
      sizeBytes,
    },
  };
}

export async function reindex({ params }) {
  const [projectId] = params;
  const index = createIndex();

  const PAGE_SIZE = 100;
  let afterSK;
  let hasMore = true;
  while (hasMore) {
    const page = await listDocs(projectId, { limit: PAGE_SIZE, afterSK });
    for (const doc of page.items) {
      if (!doc.contents) continue;
      addDocument(index, doc.id, doc.contents);
    }
    hasMore = page.hasMore;
    if (page.items.length > 0) {
      const last = page.items[page.items.length - 1];
      afterSK = `DOC#${last.id}`;
    }
  }

  await saveIndex(projectId, index, null);

  return { statusCode: 200, body: { indexed: index.totalDocs } };
}
