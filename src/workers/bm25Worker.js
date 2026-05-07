import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { getDoc } from '../lib/db.js';
import { deleteBm25Jobs, listBm25Jobs } from '../lib/queue.js';
import { addDocument, loadIndex, removeDocument, saveIndex } from '../lib/bm25.js';

const lambda = new LambdaClient({});
const BATCH_SIZE = 500;
const MAX_RUNTIME_MS = 13 * 60 * 1000;

function debug(msg, extra = {}) {
  console.log(JSON.stringify({ ts: Date.now(), debug: msg, ...extra }));
}

async function invokeSelf(projectId) {
  await lambda.send(new InvokeCommand({
    FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
    InvocationType: 'Event',
    Payload: JSON.stringify({ projectId }),
  }));
}

async function processBatch(projectId) {
  const { items, hasMore } = await listBm25Jobs(projectId, { limit: BATCH_SIZE });
  if (items.length === 0) return { processed: 0, hasMore: false };

  const docIds = items.map(item => item.docId);
  const docs = await Promise.all(docIds.map(docId => getDoc(projectId, docId)));
  const { index, etag } = await loadIndex(projectId);
  const applied = [];

  for (let i = 0; i < docIds.length; i++) {
    const docId = docIds[i];
    const doc = docs[i];
    if (doc?.contents) {
      addDocument(index, docId, doc.contents);
    } else {
      removeDocument(index, docId);
    }
    applied.push(docId);
  }

  await saveIndex(projectId, index, etag);
  await deleteBm25Jobs(projectId, applied);

  return { processed: applied.length, hasMore };
}

export const handler = async (event) => {
  const { projectId } = event;
  const startTime = Date.now();
  let totalProcessed = 0;

  debug('bm25Worker.start', { projectId });

  while (Date.now() - startTime < MAX_RUNTIME_MS) {
    const result = await processBatch(projectId);
    totalProcessed += result.processed;

    if (result.processed === 0) {
      debug('bm25Worker.done', { projectId, totalProcessed, elapsedMs: Date.now() - startTime });
      return;
    }

    debug('bm25Worker.batch', {
      projectId,
      processed: result.processed,
      totalProcessed,
      hasMore: result.hasMore,
      elapsedMs: Date.now() - startTime,
    });

    if (!result.hasMore) {
      debug('bm25Worker.done', { projectId, totalProcessed, elapsedMs: Date.now() - startTime });
      return;
    }
  }

  debug('bm25Worker.timeout_relaunch', { projectId, totalProcessed, elapsedMs: Date.now() - startTime });
  await invokeSelf(projectId);
};
