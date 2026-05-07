import { listDocs, getDoc, updateDoc, putChunk, deleteChunksByDoc, listChunksByDoc, getProject } from '../../lib/db.js';
import { processDocument } from '../../lib/processor.js';
import { generateChunks } from '../../lib/ai.js';
import { generateEmbedding, putVector, deleteVectorsByDoc } from '../../lib/embeddings.js';
import { putBm25Job } from '../../lib/queue.js';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import crypto from 'crypto';
import { ulid } from 'ulid';

const lambda = new LambdaClient({});
const BM25_WORKER_FN = process.env.BM25_WORKER_FN;

async function invokeBm25Worker(projectId) {
  if (!BM25_WORKER_FN) return;
  await lambda.send(new InvokeCommand({
    FunctionName: BM25_WORKER_FN,
    InvocationType: 'Event',
    Payload: JSON.stringify({ projectId }),
  }));
}

export async function list({ params, query }) {
  const [projectId] = params;
  const limit = parseInt(query.limit, 10) || undefined;
  const afterSK = query.after || undefined;

  const { items: docs, hasMore } = await listDocs(projectId, { limit, afterSK });
  return {
    statusCode: 200,
    body: {
      documents: docs.map(d => ({
        id: d.id,
        url: d.url,
        title: d.title,
        summary: d.summary || '',
        chunksCreated: d.chunksCreated,
        createdAt: d.createdAt,
        meaningfulUpdatedAt: d.meaningfulUpdatedAt || null,
      })),
      hasMore,
      lastSK: docs.length > 0 ? docs[docs.length - 1].SK : null,
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
      summary: doc.summary || '',
      contents: doc.contents,
      chunksCreated: doc.chunksCreated,
      createdAt: doc.createdAt,
      meaningfulUpdatedAt: doc.meaningfulUpdatedAt || null,
    },
  };
}

export async function create({ params, body }) {
  const [projectId] = params;
  const { url, contents, title, force } = body;
  if (!url || !contents) return { statusCode: 400, body: { error: 'url and contents are required' } };

  const result = await processDocument(projectId, { url, contents, title, force });
  if (!result.skipped) await invokeBm25Worker(projectId);
  return { statusCode: 201, body: result };
}

export async function reprocess({ params }) {
  const [projectId, docId] = params;
  const doc = await getDoc(projectId, docId);
  if (!doc) return { statusCode: 404, body: { error: 'Document not found' } };

  const project = await getProject(projectId);
  const chunkingPrompt = project?.prompts?.chunking || '';

  const oldChunks = await listChunksByDoc(projectId, docId);
  if (oldChunks.length > 0) {
    await deleteVectorsByDoc(projectId, oldChunks.map(c => c.id));
    await deleteChunksByDoc(projectId, docId);
  }

  const { chunks, meaningfulUpdatedAt = null } = await generateChunks(doc.contents, doc.url, chunkingPrompt);

  for (const chunk of chunks) {
    const chunkId = ulid();
    const hash = crypto.createHash('sha256').update(chunk.content).digest('hex');
    const embedding = await generateEmbedding(chunk.content, hash);

    await putChunk(projectId, {
      id: chunkId,
      type: chunk.type,
      content: chunk.content,
      docId,
      sha256: hash,
    });

    await putVector(projectId, chunkId, {
      type: chunk.type,
      docId,
      title: chunk.content.slice(0, 200),
      summary: chunk.content.slice(0, 500),
      embedding,
    });
  }

  const summaryChunk = chunks.find(c => c.type === 'summary');
  await updateDoc(projectId, docId, {
    chunksCreated: chunks.length,
    summary: summaryChunk?.content || '',
    meaningfulUpdatedAt,
  });
  await putBm25Job(projectId, { docId });
  await invokeBm25Worker(projectId);

  return {
    statusCode: 200,
    body: { docId, chunksCreated: chunks.length, meaningfulUpdatedAt },
  };
}
