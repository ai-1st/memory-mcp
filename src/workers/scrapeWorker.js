import { ulid } from 'ulid';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { putDoc, updateDoc, getLatestDocByUrl } from '../lib/db.js';
import { getScrapeJob, claimScrapeJob, updateScrapeJob, putProcessJob } from '../lib/queue.js';
import { scrapeJira, scrapeConfluence } from '../lib/scraper.js';
import crypto from 'crypto';

const lambda = new LambdaClient({});
const PROCESS_WORKER_FN = process.env.PROCESS_WORKER_FN;

function debug(msg, extra = {}) {
  console.log(JSON.stringify({ ts: Date.now(), debug: msg, ...extra }));
}

export const handler = async (event) => {
  const { projectId, jobId } = event;
  const jobStart = Date.now();

  const claimed = await claimScrapeJob(projectId, jobId);
  if (!claimed) {
    debug('scrapeJob.alreadyClaimed', { projectId, jobId });
    return;
  }

  const job = await getScrapeJob(projectId, jobId);
  if (!job) {
    debug('scrapeJob.notFound', { projectId, jobId });
    return;
  }

  const { source, config, credentials } = job;
  debug('scrapeJob.start', { projectId, jobId, source });

  try {
    const scraper = source === 'jira'
      ? scrapeJira({ baseUrl: config.baseUrl, email: credentials.email, token: credentials.token, jql: config.jql })
      : scrapeConfluence({ baseUrl: config.baseUrl, email: credentials.email, token: credentials.token, parentUrl: config.parentUrl });

    let docsEnqueued = 0;

    for await (const doc of scraper) {
      const contentsSha256 = crypto.createHash('sha256').update(doc.contents).digest('hex');

      const existing = await getLatestDocByUrl(projectId, doc.url);
      let docId;
      if (existing) {
        if (existing.contentsSha256 === contentsSha256) {
          docsEnqueued++;
          continue;
        }
        docId = existing.id;
        await updateDoc(projectId, docId, { contents: doc.contents, contentsSha256, title: doc.title });
      } else {
        docId = ulid();
        await putDoc(projectId, {
          id: docId, url: doc.url, title: doc.title,
          contents: doc.contents, contentsSha256,
        });
      }

      await putProcessJob(projectId, {
        id: ulid(), url: doc.url, title: doc.title,
        docId, status: 'pending', scrapeJobId: jobId,
      });

      docsEnqueued++;

      if (docsEnqueued % 10 === 0) {
        await updateScrapeJob(projectId, jobId, { docsEnqueued });
      }
    }

    await updateScrapeJob(projectId, jobId, {
      status: 'completed', docsEnqueued, docsFound: docsEnqueued,
    });
    debug('scrapeJob.complete', { projectId, jobId, durationMs: Date.now() - jobStart, docsEnqueued });

    if (docsEnqueued > 0) {
      await lambda.send(new InvokeCommand({
        FunctionName: PROCESS_WORKER_FN,
        InvocationType: 'Event',
        Payload: JSON.stringify({ projectId }),
      }));
    }
  } catch (err) {
    debug('scrapeJob.failed', { projectId, jobId, durationMs: Date.now() - jobStart, error: err.message });
    console.error(`Scrape job ${jobId} failed:`, err);
    await updateScrapeJob(projectId, jobId, {
      status: 'failed', error: err.message,
    });
    throw err;
  }
};
