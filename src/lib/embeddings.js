import crypto from 'crypto';
import { embed } from 'ai';
import { bedrock } from '@ai-sdk/amazon-bedrock';
import {
  S3VectorsClient,
  PutVectorsCommand,
  QueryVectorsCommand,
  DeleteVectorsCommand,
  ListVectorsCommand,
} from '@aws-sdk/client-s3vectors';
import { getCachedEmbedding, putCachedEmbedding } from './db.js';

const s3v = new S3VectorsClient({});
const INDEX_ARN = process.env.VECTOR_INDEX;
const EMBED_MODEL = bedrock.textEmbeddingModel('amazon.titan-embed-text-v2:0');

function debug(msg, extra = {}) {
  console.log(JSON.stringify({ ts: Date.now(), debug: msg, ...extra }));
}

function vecKey(projectId, chunkId) {
  return `${projectId}#${chunkId}`;
}

function parseKey(key) {
  const hash = key.indexOf('#');
  return hash >= 0 ? key.slice(hash + 1) : key;
}

/**
 * Generate an embedding for text, using DDB cache keyed by sha256.
 */
export async function generateEmbedding(text, sha256) {
  const t0 = Date.now();
  const cached = await getCachedEmbedding(sha256);
  if (cached) {
    debug('embedding.cached', { durationMs: Date.now() - t0 });
    return cached;
  }

  const { embedding } = await embed({
    model: EMBED_MODEL,
    value: text,
  });

  await putCachedEmbedding(sha256, embedding);
  debug('embedding.created', { durationMs: Date.now() - t0 });
  return embedding;
}

/**
 * Store a chunk's embedding vector in S3 Vectors.
 */
export async function putVector(projectId, chunkId, data) {
  const embedding = data.embedding;
  const float32 = Array.isArray(embedding) ? embedding : Array.from(embedding);

  await s3v.send(new PutVectorsCommand({
    indexArn: INDEX_ARN,
    vectors: [{
      key: vecKey(projectId, chunkId),
      data: { float32 },
      metadata: {
        projectId,
        type: data.type ?? '',
        docId: data.docId ?? '',
        title: data.title ?? '',
        summary: data.summary ?? '',
      },
    }],
  }));
}

/**
 * Delete a chunk's embedding vector from S3 Vectors.
 */
export async function deleteVector(projectId, chunkId) {
  await s3v.send(new DeleteVectorsCommand({
    indexArn: INDEX_ARN,
    keys: [vecKey(projectId, chunkId)],
  }));
}

/**
 * Delete vectors for all chunks belonging to a specific document.
 */
export async function deleteVectorsByDoc(projectId, chunkIds) {
  if (chunkIds.length === 0) return 0;
  const keys = chunkIds.map(id => vecKey(projectId, id));
  let deleted = 0;
  for (let i = 0; i < keys.length; i += 500) {
    const batch = keys.slice(i, i + 500);
    await s3v.send(new DeleteVectorsCommand({
      indexArn: INDEX_ARN,
      keys: batch,
    }));
    deleted += batch.length;
  }
  return deleted;
}

/**
 * Find chunks similar to a given embedding vector, scoped to project.
 */
export async function findSimilarByEmbedding(projectId, embedding, topK = 10) {
  const t0 = Date.now();
  const float32 = Array.isArray(embedding) ? embedding : Array.from(embedding);

  const { vectors: results, distanceMetric } = await s3v.send(new QueryVectorsCommand({
    indexArn: INDEX_ARN,
    queryVector: { float32 },
    topK,
    filter: { projectId: { $eq: projectId } },
    returnDistance: true,
    returnMetadata: true,
  }));

  const similar = (results || []).map((v) => {
    const meta = v.metadata || {};
    const distance = v.distance ?? 1;
    const score = distanceMetric === 'cosine' ? 1 - distance : 1 / (1 + distance);
    return {
      id: parseKey(v.key),
      type: meta.type ?? '',
      docId: meta.docId ?? '',
      title: meta.title ?? '',
      summary: meta.summary ?? '',
      score,
    };
  });

  debug('queryVectors', { projectId, resultCount: similar.length, durationMs: Date.now() - t0 });
  return similar;
}

/**
 * Semantic search: embed query, query S3 Vectors, return top-k by similarity.
 */
export async function searchSimilar(projectId, queryText, topK = 5) {
  const hash = crypto.createHash('sha256').update(queryText).digest('hex');
  const queryEmbedding = await generateEmbedding(queryText, hash);
  return findSimilarByEmbedding(projectId, queryEmbedding, topK);
}

/**
 * Delete all vectors for a project from S3 Vectors.
 */
export async function deleteAllVectors(projectId) {
  let deleted = 0;
  let nextToken;

  do {
    const { vectors = [], nextToken: nt } = await s3v.send(new ListVectorsCommand({
      indexArn: INDEX_ARN,
      maxResults: 1000,
      returnMetadata: true,
      nextToken,
    }));

    const keysToDelete = vectors
      .filter((v) => (v.metadata?.projectId) === projectId)
      .map((v) => v.key);

    if (keysToDelete.length > 0) {
      for (let i = 0; i < keysToDelete.length; i += 500) {
        const batch = keysToDelete.slice(i, i + 500);
        await s3v.send(new DeleteVectorsCommand({
          indexArn: INDEX_ARN,
          keys: batch,
        }));
        deleted += batch.length;
      }
    }

    nextToken = nt;
  } while (nextToken);

  return deleted;
}
