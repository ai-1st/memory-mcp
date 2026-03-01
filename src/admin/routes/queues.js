import { SQSClient, PurgeQueueCommand } from '@aws-sdk/client-sqs';
import {
  LambdaClient,
  ListEventSourceMappingsCommand,
  UpdateEventSourceMappingCommand,
} from '@aws-sdk/client-lambda';
import { getQueueCounts, listScrapeJobs, listProcessJobs, clearJobs } from '../../lib/queue.js';

const sqs = new SQSClient({});
const lambda = new LambdaClient({});

const SCRAPE_QUEUE_URL = process.env.SCRAPE_QUEUE_URL;
const PROCESS_QUEUE_URL = process.env.PROCESS_QUEUE_URL;
const SCRAPE_WORKER_FN = process.env.SCRAPE_WORKER_FN;
const PROCESS_WORKER_FN = process.env.PROCESS_WORKER_FN;

export async function status({ params, query }) {
  const [projectId] = params;
  const rawProcessStatus = query.processStatus || null;
  const processStatusFilter = rawProcessStatus === 'none' ? '__skip__' : rawProcessStatus;
  const rawScrapeStatus = query.scrapeStatus || null;
  const scrapeStatusFilter = rawScrapeStatus === 'none' ? null : rawScrapeStatus;

  const skipProcessJobs = processStatusFilter === '__skip__';
  const [counts, scrapeJobs, processJobs] = await Promise.all([
    getQueueCounts(projectId),
    listScrapeJobs(projectId),
    skipProcessJobs ? [] : listProcessJobs(projectId, { status: processStatusFilter }),
  ]);

  const filteredScrapeJobs = scrapeStatusFilter
    ? scrapeJobs.filter(j => j.status === scrapeStatusFilter)
    : scrapeJobs;

  return {
    statusCode: 200,
    body: {
      scrape: {
        ...counts.scrape,
        jobs: filteredScrapeJobs.map(j => ({
          id: j.id, source: j.source, status: j.status,
          docsFound: j.docsFound, docsEnqueued: j.docsEnqueued,
          error: j.error, createdAt: j.createdAt, updatedAt: j.updatedAt,
        })),
      },
      process: {
        ...counts.process,
        jobs: processJobs.map(j => ({
          id: j.id, url: j.url, title: j.title, status: j.status,
          topicsCreated: j.topicsCreated, topicsReplaced: j.topicsReplaced,
          error: j.error, createdAt: j.createdAt, updatedAt: j.updatedAt,
        })),
      },
    },
  };
}

async function findEventSourceMapping(functionName) {
  const { EventSourceMappings } = await lambda.send(
    new ListEventSourceMappingsCommand({ FunctionName: functionName })
  );
  return EventSourceMappings?.[0] || null;
}

export async function control({ params, body }) {
  const [projectId] = params;
  const { queue, action, value } = body;

  if (!queue || !['scrape', 'process'].includes(queue)) {
    return { statusCode: 400, body: { error: 'queue must be "scrape" or "process"' } };
  }
  if (!action || !['start', 'stop', 'clear', 'concurrency'].includes(action)) {
    return { statusCode: 400, body: { error: 'action must be start, stop, clear, or concurrency' } };
  }

  const functionName = queue === 'scrape' ? SCRAPE_WORKER_FN : PROCESS_WORKER_FN;
  const queueUrl = queue === 'scrape' ? SCRAPE_QUEUE_URL : PROCESS_QUEUE_URL;

  if (action === 'start' || action === 'stop') {
    const mapping = await findEventSourceMapping(functionName);
    if (!mapping) return { statusCode: 404, body: { error: `No event source mapping found for ${queue} worker` } };

    await lambda.send(new UpdateEventSourceMappingCommand({
      UUID: mapping.UUID,
      Enabled: action === 'start',
    }));
    return { statusCode: 200, body: { queue, action, enabled: action === 'start' } };
  }

  if (action === 'concurrency') {
    const concurrency = parseInt(value, 10);
    if (!concurrency || concurrency < 2 || concurrency > 10) {
      return { statusCode: 400, body: { error: 'value must be between 2 and 10' } };
    }
    const mapping = await findEventSourceMapping(functionName);
    if (!mapping) return { statusCode: 404, body: { error: `No event source mapping found for ${queue} worker` } };

    await lambda.send(new UpdateEventSourceMappingCommand({
      UUID: mapping.UUID,
      ScalingConfig: { MaximumConcurrency: concurrency },
    }));
    return { statusCode: 200, body: { queue, action, concurrency } };
  }

  if (action === 'clear') {
    await Promise.all([
      sqs.send(new PurgeQueueCommand({ QueueUrl: queueUrl })).catch(() => {}),
      clearJobs(projectId, queue),
    ]);
    return { statusCode: 200, body: { queue, action: 'cleared' } };
  }
}
