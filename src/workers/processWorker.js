import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { listProcessJobs, claimProcessJob, updateProcessJob, isQueueStopped } from '../lib/queue.js';
import { getDoc } from '../lib/db.js';
import { processDocument } from '../lib/processor.js';

const lambda = new LambdaClient({});
const PARALLELISM = 5;
const MAX_RUNTIME_MS = 10 * 60 * 1000;
const BM25_WORKER_FN = process.env.BM25_WORKER_FN;

function debug(msg, extra = {}) {
  console.log(JSON.stringify({ ts: Date.now(), debug: msg, ...extra }));
}

async function processOneJob(projectId, job) {
  const jobStart = Date.now();
  debug('processJob.start', { projectId, jobId: job.id });

  try {
    const doc = await getDoc(projectId, job.docId);
    if (!doc) {
      await updateProcessJob(projectId, job.id, {
        status: 'failed', error: 'Document not found',
      });
      return false;
    }

    const result = await processDocument(projectId, {
      url: doc.url, contents: doc.contents,
      title: doc.title, force: true,
    });

    await updateProcessJob(projectId, job.id, {
      status: 'completed',
      chunksCreated: result.chunksCreated ?? 0,
    });
    debug('processJob.complete', {
      projectId, jobId: job.id, durationMs: Date.now() - jobStart,
      chunksCreated: result.chunksCreated,
    });
    return true;
  } catch (err) {
    debug('processJob.failed', {
      projectId, jobId: job.id, durationMs: Date.now() - jobStart,
      error: err.message,
    });
    console.error(`Process job ${job.id} failed:`, err);
    await updateProcessJob(projectId, job.id, {
      status: 'failed', error: err.message,
    });
    return false;
  }
}

async function invokeBm25Worker(projectId) {
  if (!BM25_WORKER_FN) {
    debug('bm25Worker.notConfigured', { projectId });
    return;
  }
  await lambda.send(new InvokeCommand({
    FunctionName: BM25_WORKER_FN,
    InvocationType: 'Event',
    Payload: JSON.stringify({ projectId }),
  }));
}

export const handler = async (event) => {
  const { projectId } = event;
  const startTime = Date.now();

  debug('processWorker.start', { projectId });

  while (true) {
    if (await isQueueStopped(projectId, 'process')) {
      debug('processWorker.stopped', { projectId, elapsedMs: Date.now() - startTime });
      return;
    }

    if (Date.now() - startTime > MAX_RUNTIME_MS) {
      const { items } = await listProcessJobs(projectId, { status: 'pending', limit: 1 });
      if (items.length > 0) {
        debug('processWorker.timeout_relaunch', { projectId, elapsedMs: Date.now() - startTime });
        await lambda.send(new InvokeCommand({
          FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
          InvocationType: 'Event',
          Payload: JSON.stringify({ projectId }),
        }));
      }
      return;
    }

    const { items } = await listProcessJobs(projectId, { status: 'pending', limit: PARALLELISM });
    if (items.length === 0) {
      debug('processWorker.done', { projectId, elapsedMs: Date.now() - startTime });
      return;
    }

    const tasks = items.map(async (job) => {
      const claimed = await claimProcessJob(projectId, job.id);
      if (!claimed) return false;
      return processOneJob(projectId, job);
    });

    const results = await Promise.all(tasks);
    if (results.some(Boolean)) {
      await invokeBm25Worker(projectId);
    }
  }
};
