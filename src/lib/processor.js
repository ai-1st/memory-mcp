import crypto from 'crypto';
import { ulid } from 'ulid';
import { putDoc, updateDoc, putChunk, deleteChunksByDoc, getProject, getLatestDocByUrl, listChunksByDoc } from './db.js';
import { generateEmbedding, putVector, deleteVectorsByDoc } from './embeddings.js';
import { generateChunks } from './ai.js';
import { putBm25Job } from './queue.js';

function debug(msg, extra = {}) {
  console.log(JSON.stringify({ ts: Date.now(), debug: msg, ...extra }));
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * Process a document end-to-end: dedup, store, chunk, embed.
 * Documents are unique by URL within a project. If a document with the same URL
 * already exists, it is updated in place rather than creating a duplicate.
 */
export async function processDocument(projectId, { url, contents, title = '', force = false }) {
  const docStart = Date.now();
  const contentsSha256 = sha256(contents);

  const existing = await getLatestDocByUrl(projectId, url);

  if (!force && existing && existing.contentsSha256 === contentsSha256) {
    return {
      docId: existing.id, url, skipped: true,
      reason: 'Content unchanged since last ingestion',
      chunksCreated: existing.chunksCreated ?? 0,
    };
  }

  let docId;
  if (existing) {
    docId = existing.id;
    await updateDoc(projectId, docId, { contents, contentsSha256, title });

    const oldChunks = await listChunksByDoc(projectId, docId);
    if (oldChunks.length > 0) {
      await deleteVectorsByDoc(projectId, oldChunks.map(c => c.id));
      await deleteChunksByDoc(projectId, docId);
      debug('processDocument.cleanedOldChunks', { docId, count: oldChunks.length });
    }
  } else {
    docId = ulid();
    await putDoc(projectId, { id: docId, url, title, contents, contentsSha256 });
  }

  const project = await getProject(projectId);
  const chunkingPrompt = project?.prompts?.chunking || '';

  const t0 = Date.now();
  const { chunks, meaningfulUpdatedAt = null } = await generateChunks(contents, url, chunkingPrompt);
  debug('processDocument.generateChunks', { chunksCount: chunks.length, durationMs: Date.now() - t0 });

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkId = ulid();
    const hash = sha256(chunk.content);

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

    debug('processDocument.chunk', { index: i, type: chunk.type, chunkId });
  }

  const summaryChunk = chunks.find(c => c.type === 'summary');
  await updateDoc(projectId, docId, {
    chunksCreated: chunks.length,
    summary: summaryChunk?.content || '',
    meaningfulUpdatedAt,
  });

  await putBm25Job(projectId, { docId });

  debug('processDocument.done', {
    projectId, url, durationMs: Date.now() - docStart,
    chunksCreated: chunks.length,
  });

  return {
    docId, url, skipped: false,
    chunksCreated: chunks.length,
    meaningfulUpdatedAt,
  };
}
