import { ulid } from 'ulid';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { putDoc } from '../lib/db.js';
import { updateScrapeJob, putProcessJob } from '../lib/queue.js';
import { scrapeJira, scrapeConfluence } from '../lib/scraper.js';
import crypto from 'crypto';

const sqs = new SQSClient({});
const PROCESS_QUEUE_URL = process.env.PROCESS_QUEUE_URL;

export const handler = async (event) => {
  for (const record of event.Records) {
    const { projectId, jobId, source, config, credentials } = JSON.parse(record.body);

    try {
      await updateScrapeJob(projectId, jobId, { status: 'scraping' });

      const scraper = source === 'jira'
        ? scrapeJira({ baseUrl: config.baseUrl, email: credentials.email, token: credentials.token, jql: config.jql })
        : scrapeConfluence({ baseUrl: config.baseUrl, email: credentials.email, token: credentials.token, parentUrl: config.parentUrl });

      let docsEnqueued = 0;

      for await (const doc of scraper) {
        const processJobId = ulid();
        const docId = ulid();
        const contentsSha256 = crypto.createHash('sha256').update(doc.contents).digest('hex');

        await putDoc(projectId, {
          id: docId, url: doc.url, title: doc.title,
          contents: doc.contents, contentsSha256,
        });

        await putProcessJob(projectId, {
          id: processJobId, url: doc.url, title: doc.title,
          docId, status: 'pending', scrapeJobId: jobId,
        });

        await sqs.send(new SendMessageCommand({
          QueueUrl: PROCESS_QUEUE_URL,
          MessageBody: JSON.stringify({ projectId, jobId: processJobId }),
        }));

        docsEnqueued++;

        if (docsEnqueued % 10 === 0) {
          await updateScrapeJob(projectId, jobId, { docsEnqueued });
        }
      }

      await updateScrapeJob(projectId, jobId, {
        status: 'completed', docsEnqueued, docsFound: docsEnqueued,
      });
    } catch (err) {
      console.error(`Scrape job ${jobId} failed:`, err);
      await updateScrapeJob(projectId, jobId, {
        status: 'failed', error: err.message,
      });
      throw err;
    }
  }
};
