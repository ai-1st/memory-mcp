import { ulid } from 'ulid';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { putScrapeJob } from '../../lib/queue.js';

const sqs = new SQSClient({});
const SCRAPE_QUEUE_URL = process.env.SCRAPE_QUEUE_URL;

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
  await putScrapeJob(projectId, { id: jobId, source, config, status: 'pending' });

  await sqs.send(new SendMessageCommand({
    QueueUrl: SCRAPE_QUEUE_URL,
    MessageBody: JSON.stringify({ projectId, jobId, source, config, credentials }),
  }));

  return { statusCode: 202, body: { jobId, status: 'pending' } };
}
