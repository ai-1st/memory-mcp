import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { getQueueCounts, listScrapeJobs, listProcessJobs, clearJobs, updateProcessJob, setQueueStopped, isQueueStopped } from '../../lib/queue.js';

async function listProcessJobIdsByStatus(projectId, status) {
  const { items } = await listProcessJobs(projectId, { status, limit: undefined });
  return items.map(j => j.id);
}

const lambda = new LambdaClient({});

const SCRAPE_WORKER_FN = process.env.SCRAPE_WORKER_FN;
const PROCESS_WORKER_FN = process.env.PROCESS_WORKER_FN;

export async function status({ params, query }) {
  const [projectId] = params;
  const rawProcessStatus = query.processStatus || null;
  const processStatusFilter = rawProcessStatus === 'none' ? '__skip__' : rawProcessStatus;
  const rawScrapeStatus = query.scrapeStatus || null;
  const scrapeStatusFilter = rawScrapeStatus === 'none' ? null : rawScrapeStatus;

  const jobLimit = parseInt(query.limit, 10) || 100;
  const afterSK = query.after || undefined;
  const skipProcessJobs = processStatusFilter === '__skip__';
  const [counts, scrapeJobs, processResult, scrapeStopped, processStopped] = await Promise.all([
    getQueueCounts(projectId),
    listScrapeJobs(projectId),
    skipProcessJobs ? { items: [], hasMore: false } : listProcessJobs(projectId, { status: processStatusFilter, limit: jobLimit, afterSK }),
    isQueueStopped(projectId, 'scrape'),
    isQueueStopped(projectId, 'process'),
  ]);

  const filteredScrapeJobs = scrapeStatusFilter
    ? scrapeJobs.filter(j => j.status === scrapeStatusFilter)
    : scrapeJobs;

  return {
    statusCode: 200,
    body: {
      scrape: {
        ...counts.scrape,
        stopped: scrapeStopped,
        jobs: filteredScrapeJobs.map(j => ({
          id: j.id, source: j.source, config: j.config, status: j.status,
          docsFound: j.docsFound, docsEnqueued: j.docsEnqueued, docsSkipped: j.docsSkipped ?? 0,
          hasCredentials: !!(j.credentials?.email && j.credentials?.token),
          error: j.error, createdAt: j.createdAt, updatedAt: j.updatedAt,
        })),
      },
      process: {
        ...counts.process,
        stopped: processStopped,
        hasMore: processResult.hasMore,
        lastSK: processResult.items.length > 0 ? processResult.items[processResult.items.length - 1].SK : null,
        jobs: processResult.items.map(j => ({
          id: j.id, docId: j.docId, url: j.url, title: j.title, status: j.status,
          chunksCreated: j.chunksCreated,
          error: j.error, createdAt: j.createdAt, updatedAt: j.updatedAt,
        })),
      },
    },
  };
}

async function invokeWorker(functionName, payload) {
  await lambda.send(new InvokeCommand({
    FunctionName: functionName,
    InvocationType: 'Event',
    Payload: JSON.stringify(payload),
  }));
}

export async function control({ params, body }) {
  const [projectId] = params;
  const { queue, action } = body;

  if (!queue || !['scrape', 'process'].includes(queue)) {
    return { statusCode: 400, body: { error: 'queue must be "scrape" or "process"' } };
  }
  if (!action || !['start', 'stop', 'clear'].includes(action)) {
    return { statusCode: 400, body: { error: 'action must be start, stop, or clear' } };
  }

  if (action === 'start') {
    await setQueueStopped(projectId, queue, false);
    const fn = queue === 'scrape' ? SCRAPE_WORKER_FN : PROCESS_WORKER_FN;
    await invokeWorker(fn, { projectId });
    return { statusCode: 200, body: { queue, action: 'started' } };
  }

  if (action === 'stop') {
    await setQueueStopped(projectId, queue, true);
    return { statusCode: 200, body: { queue, action: 'stopped' } };
  }

  if (action === 'clear') {
    const deleted = await clearJobs(projectId, queue);
    return { statusCode: 200, body: { queue, action: 'cleared', deleted } };
  }
}

export async function requeue({ params, body }) {
  const [projectId] = params;
  const { jobIds, status } = body;

  let ids = Array.isArray(jobIds) ? jobIds : [];
  if (ids.length === 0 && status) {
    if (!['processing', 'failed'].includes(status)) {
      return { statusCode: 400, body: { error: 'status must be "processing" or "failed"' } };
    }
    ids = await listProcessJobIdsByStatus(projectId, status);
    if (ids.length === 0) {
      return { statusCode: 200, body: { requeued: 0, results: [], message: `No ${status} jobs to requeue` } };
    }
  }
  if (ids.length === 0) {
    return { statusCode: 400, body: { error: 'jobIds array or status is required' } };
  }

  const results = [];
  for (const jobId of ids) {
    try {
      await updateProcessJob(projectId, jobId, { status: 'pending', error: null });
      results.push({ jobId, status: 'requeued' });
    } catch (err) {
      results.push({ jobId, status: 'error', error: err.message });
    }
  }

  const requeuedCount = results.filter(r => r.status === 'requeued').length;
  if (requeuedCount > 0) {
    await invokeWorker(PROCESS_WORKER_FN, { projectId });
  }

  return { statusCode: 200, body: { requeued: requeuedCount, results } };
}
