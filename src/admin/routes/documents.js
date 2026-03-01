import { listDocs, getDoc } from '../../lib/db.js';
import { processDocument } from '../../lib/processor.js';

export async function list({ params }) {
  const [projectId] = params;
  const docs = await listDocs(projectId);
  return {
    statusCode: 200,
    body: {
      documents: docs.map(d => ({
        id: d.id,
        url: d.url,
        title: d.title,
        topicsCreated: d.topicsCreated,
        topicsReplaced: d.topicsReplaced,
        createdAt: d.createdAt,
      })),
    },
  };
}

export async function get({ params }) {
  const [projectId, docId] = params;
  const doc = await getDoc(projectId, docId);
  if (!doc) return { statusCode: 404, body: { error: 'Document not found' } };

  return {
    statusCode: 200,
    body: {
      id: doc.id,
      url: doc.url,
      title: doc.title,
      contents: doc.contents,
      topicsCreated: doc.topicsCreated,
      topicsReplaced: doc.topicsReplaced,
      createdAt: doc.createdAt,
    },
  };
}

export async function create({ params, body }) {
  const [projectId] = params;
  const { url, contents, title, force } = body;
  if (!url || !contents) return { statusCode: 400, body: { error: 'url and contents are required' } };

  const result = await processDocument(projectId, { url, contents, title, force });
  return { statusCode: 201, body: result };
}
