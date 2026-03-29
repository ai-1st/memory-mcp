import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { promisify } from 'util';
import { gzip, gunzip } from 'zlib';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

const s3 = new S3Client({});
const BUCKET = () => process.env.BM25_BUCKET;

const K1 = 1.5;
const B = 0.75;

const STOPWORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','is','it',
  'that','this','was','are','be','has','had','have','with','as','by','from',
  'not','no','do','does','did','will','would','could','should','can','may',
  'might','shall','been','being','its','than','then','so','if','when','what',
  'which','who','whom','how','all','each','every','both','few','more','most',
  'other','some','such','only','own','same','also','just','about','above',
  'after','again','any','because','before','between','during','into','out',
  'over','through','under','until','up','very','we','they','he','she','i',
  'you','me','my','your','our','their','his','her','us','them','am','were',
]);

export function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOPWORDS.has(t));
}

export function createIndex() {
  return { docs: {}, df: {}, totalDocs: 0, totalLength: 0, avgDl: 0 };
}

export function addDocument(index, docId, text) {
  if (index.docs[docId]) {
    removeDocument(index, docId);
  }

  const tokens = tokenize(text);
  const tf = {};
  for (const t of tokens) {
    tf[t] = (tf[t] || 0) + 1;
  }

  for (const term of Object.keys(tf)) {
    index.df[term] = (index.df[term] || 0) + 1;
  }

  index.docs[docId] = { tf, dl: tokens.length };
  index.totalDocs++;
  index.totalLength += tokens.length;
  index.avgDl = index.totalLength / index.totalDocs;
}

export function removeDocument(index, docId) {
  const doc = index.docs[docId];
  if (!doc) return;

  for (const term of Object.keys(doc.tf)) {
    index.df[term]--;
    if (index.df[term] <= 0) delete index.df[term];
  }

  index.totalDocs--;
  index.totalLength -= doc.dl;
  index.avgDl = index.totalDocs > 0 ? index.totalLength / index.totalDocs : 0;
  delete index.docs[docId];
}

export function search(index, queryText, k = 10) {
  const queryTokens = tokenize(queryText);
  if (queryTokens.length === 0 || index.totalDocs === 0) return [];

  const N = index.totalDocs;
  const scores = {};

  for (const [docId, doc] of Object.entries(index.docs)) {
    let score = 0;
    for (const term of queryTokens) {
      const tf = doc.tf[term] || 0;
      if (tf === 0) continue;

      const df = index.df[term] || 0;
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
      const tfNorm = (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * doc.dl / index.avgDl));
      score += idf * tfNorm;
    }
    if (score > 0) scores[docId] = score;
  }

  return Object.entries(scores)
    .sort(([, a], [, b]) => b - a)
    .slice(0, k)
    .map(([docId, score]) => ({ docId, score }));
}

// ── S3 persistence ──

function s3Key(projectId) {
  return `bm25/${projectId}.json.gz`;
}

export async function loadIndex(projectId) {
  try {
    const res = await s3.send(new GetObjectCommand({
      Bucket: BUCKET(),
      Key: s3Key(projectId),
    }));
    const compressed = await res.Body.transformToByteArray();
    const json = (await gunzipAsync(Buffer.from(compressed))).toString();
    return { index: JSON.parse(json), etag: res.ETag, sizeBytes: compressed.length };
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      return { index: createIndex(), etag: null, sizeBytes: 0 };
    }
    throw err;
  }
}

export async function saveIndex(projectId, index, etag) {
  const compressed = await gzipAsync(JSON.stringify(index));
  const params = {
    Bucket: BUCKET(),
    Key: s3Key(projectId),
    Body: compressed,
    ContentType: 'application/gzip',
  };

  if (etag) {
    params.IfMatch = etag;
  } else {
    params.IfNoneMatch = '*';
  }

  await s3.send(new PutObjectCommand(params));
}

/**
 * Save with optimistic-locking retry. On ETag conflict, re-loads the index,
 * re-applies the mutation, and retries up to `maxRetries` times.
 *
 * @param {string} projectId
 * @param {function} mutate - (index) => void — applies the desired change to an index in place
 * @param {number} maxRetries
 */
export async function saveWithRetry(projectId, mutate, maxRetries = 3) {
  let { index, etag } = await loadIndex(projectId);
  mutate(index);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await saveIndex(projectId, index, etag);
      return;
    } catch (err) {
      const is412 = err.name === 'PreconditionFailed' || err.$metadata?.httpStatusCode === 412;
      if (!is412 || attempt === maxRetries) throw err;

      ({ index, etag } = await loadIndex(projectId));
      mutate(index);
    }
  }
}

export async function deleteIndex(projectId) {
  const deletes = [
    s3Key(projectId),
    `bm25/${projectId}.json`,
  ];
  for (const key of deletes) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET(), Key: key }));
    } catch (err) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) continue;
      throw err;
    }
  }
}
