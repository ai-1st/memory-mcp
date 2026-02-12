import { embed, cosineSimilarity } from 'ai';
import { bedrock } from '@ai-sdk/amazon-bedrock';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getCachedEmbedding, putCachedEmbedding } from './db.js';

const s3 = new S3Client({});
const BUCKET = process.env.VECTOR_BUCKET;
const EMBED_MODEL = bedrock.textEmbeddingModel('amazon.titan-embed-text-v2:0');

/**
 * Generate an embedding for text, using DDB cache keyed by sha256.
 */
export async function generateEmbedding(text, sha256) {
  // Check cache first
  const cached = await getCachedEmbedding(sha256);
  if (cached) return cached;

  const { embedding } = await embed({
    model: EMBED_MODEL,
    value: text,
  });

  // Cache in DDB
  await putCachedEmbedding(sha256, embedding);
  return embedding;
}

/**
 * Store a topic's embedding vector in S3.
 */
export async function putVector(topicId, data) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: `vectors/${topicId}.json`,
    Body: JSON.stringify(data),
    ContentType: 'application/json',
  }));
}

/**
 * Delete a topic's embedding vector from S3.
 */
export async function deleteVector(topicId) {
  await s3.send(new DeleteObjectCommand({
    Bucket: BUCKET,
    Key: `vectors/${topicId}.json`,
  }));
}

/**
 * Load a single vector from S3.
 */
async function getVector(key) {
  try {
    const { Body } = await s3.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }));
    const text = await Body.transformToString();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Load all vectors from S3, returns array of {id, category, summary, embedding}.
 */
async function loadAllVectors() {
  const vectors = [];
  let continuationToken;

  do {
    const { Contents, NextContinuationToken } = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: 'vectors/',
        ContinuationToken: continuationToken,
      })
    );

    if (Contents) {
      const results = await Promise.all(
        Contents.map(({ Key }) => getVector(Key))
      );
      vectors.push(...results.filter(Boolean));
    }

    continuationToken = NextContinuationToken;
  } while (continuationToken);

  return vectors;
}

/**
 * Semantic search: embed query, load all vectors, return top-k by cosine similarity.
 */
export async function searchSimilar(queryText, topK = 5) {
  const { embedding: queryEmbedding } = await embed({
    model: EMBED_MODEL,
    value: queryText,
  });

  const allVectors = await loadAllVectors();
  if (allVectors.length === 0) return [];

  const scored = allVectors.map(v => ({
    id: v.id,
    category: v.category,
    summary: v.summary,
    score: cosineSimilarity(queryEmbedding, v.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/**
 * Find topics similar to a given embedding vector.
 */
export async function findSimilarByEmbedding(embedding, topK = 5) {
  const allVectors = await loadAllVectors();
  if (allVectors.length === 0) return [];

  const scored = allVectors.map(v => ({
    id: v.id,
    category: v.category,
    summary: v.summary,
    score: cosineSimilarity(embedding, v.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
