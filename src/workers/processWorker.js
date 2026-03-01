import { getProcessJob, updateProcessJob } from '../lib/queue.js';
import { getDoc } from '../lib/db.js';
import { processDocument } from '../lib/processor.js';

export const handler = async (event) => {
  for (const record of event.Records) {
    const { projectId, jobId } = JSON.parse(record.body);

    try {
      const job = await getProcessJob(projectId, jobId);
      if (!job) {
        console.error(`Process job ${jobId} not found`);
        continue;
      }

      await updateProcessJob(projectId, jobId, { status: 'processing' });

      const doc = await getDoc(projectId, job.docId);
      if (!doc) {
        await updateProcessJob(projectId, jobId, {
          status: 'failed', error: 'Document not found',
        });
        continue;
      }

      const result = await processDocument(projectId, {
        url: doc.url, contents: doc.contents,
        title: doc.title, force: true,
      });

      if (result.skipped) {
        await updateProcessJob(projectId, jobId, {
          status: 'completed',
          topicsCreated: result.topicsCreated ?? 0,
          topicsReplaced: result.topicsReplaced ?? 0,
        });
      } else {
        await updateProcessJob(projectId, jobId, {
          status: 'completed',
          topicsCreated: result.topicsCreated,
          topicsReplaced: result.topicsReplaced,
        });
      }
    } catch (err) {
      console.error(`Process job ${jobId} failed:`, err);
      await updateProcessJob(projectId, jobId, {
        status: 'failed', error: err.message,
      });
      throw err;
    }
  }
};
