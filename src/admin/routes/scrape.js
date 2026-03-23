import { ulid } from 'ulid';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { putScrapeJob, getScrapeJob } from '../../lib/queue.js';

const lambda = new LambdaClient({});
const SCRAPE_WORKER_FN = process.env.SCRAPE_WORKER_FN;

async function invokeScrapeWorker(projectId, jobId) {
  await lambda.send(new InvokeCommand({
    FunctionName: SCRAPE_WORKER_FN,
    InvocationType: 'Event',
    Payload: JSON.stringify({ projectId, jobId }),
  }));
}

export async function enqueue({ params, body }) {
  const [projectId] = params;
  const { source, config, credentials } = body;

  if (!source || !['jira', 'confluence'].includes(source)) {
    return { statusCode: 400, body: { error: 'source must be "jira" or "confluence"' } };
  }
  if (!config) return { statusCode: 400, body: { error: 'config is required' } };
  if (!credentials?.email || !credentials?.token) {
    return { statusCode: 400, body: { error: 'credentials.email and credentials.token are required' } };
  }

  if (source === 'jira' && !config.jql) {
    return { statusCode: 400, body: { error: 'config.jql is required for Jira scraping' } };
  }
  if (source === 'confluence' && !config.parentUrl) {
    return { statusCode: 400, body: { error: 'config.parentUrl is required for Confluence scraping' } };
  }
  if (!config.baseUrl) {
    return { statusCode: 400, body: { error: 'config.baseUrl is required' } };
  }

  const jobId = ulid();
  await putScrapeJob(projectId, { id: jobId, source, config, credentials, status: 'pending' });
  await invokeScrapeWorker(projectId, jobId);

  return { statusCode: 202, body: { jobId, status: 'pending' } };
}

export async function rerun({ params, body }) {
  const [projectId, jobId] = params;
  const oldJob = await getScrapeJob(projectId, jobId);
  if (!oldJob) return { statusCode: 404, body: { error: 'Scrape job not found' } };

  if (!oldJob.credentials?.email || !oldJob.credentials?.token) {
    return { statusCode: 400, body: { error: 'Original job has no saved credentials. Submit a new scrape with credentials instead.' } };
  }

  const credentials = body?.credentials || oldJob.credentials;
  const config = body?.config || oldJob.config;
  const source = oldJob.source;

  const newJobId = ulid();
  await putScrapeJob(projectId, { id: newJobId, source, config, credentials, status: 'pending' });
  await invokeScrapeWorker(projectId, newJobId);

  return { statusCode: 202, body: { jobId: newJobId, rerunOf: jobId, status: 'pending' } };
}
