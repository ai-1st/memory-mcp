import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);
const TABLE = process.env.TABLE_NAME;

// ── Scrape Jobs ──

export async function putScrapeJob(projectId, job) {
  const now = new Date().toISOString();
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: `P#${projectId}#SCRAPE`,
      SK: `JOB#${job.id}`,
      id: job.id,
      source: job.source,
      config: job.config,
      status: job.status || 'pending',
      docsFound: job.docsFound ?? 0,
      docsEnqueued: job.docsEnqueued ?? 0,
      error: job.error || null,
      createdAt: job.createdAt || now,
      updatedAt: now,
    },
  }));
}

export async function getScrapeJob(projectId, jobId) {
  const { Item } = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `P#${projectId}#SCRAPE`, SK: `JOB#${jobId}` },
  }));
  return Item || null;
}

export async function updateScrapeJob(projectId, jobId, updates) {
  const exprs = [];
  const names = {};
  const values = { ':now': new Date().toISOString() };

  for (const [key, val] of Object.entries(updates)) {
    const attr = `#${key}`;
    const valKey = `:${key}`;
    exprs.push(`${attr} = ${valKey}`);
    names[attr] = key;
    values[valKey] = val;
  }
  exprs.push('#updatedAt = :now');
  names['#updatedAt'] = 'updatedAt';

  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: `P#${projectId}#SCRAPE`, SK: `JOB#${jobId}` },
    UpdateExpression: `SET ${exprs.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
}

export async function listScrapeJobs(projectId) {
  const items = [];
  let lastKey;
  do {
    const { Items, LastEvaluatedKey } = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `P#${projectId}#SCRAPE` },
      ScanIndexForward: false,
      ExclusiveStartKey: lastKey,
    }));
    items.push(...(Items || []));
    lastKey = LastEvaluatedKey;
  } while (lastKey);
  return items;
}

// ── Process Jobs ──

export async function putProcessJob(projectId, job) {
  const now = new Date().toISOString();
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: `P#${projectId}#PQUEUE`,
      SK: `JOB#${job.id}`,
      id: job.id,
      url: job.url,
      title: job.title || '',
      docId: job.docId || null,
      status: job.status || 'pending',
      topicsCreated: job.topicsCreated ?? 0,
      topicsReplaced: job.topicsReplaced ?? 0,
      error: job.error || null,
      scrapeJobId: job.scrapeJobId || null,
      createdAt: job.createdAt || now,
      updatedAt: now,
    },
  }));
}

export async function getProcessJob(projectId, jobId) {
  const { Item } = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `P#${projectId}#PQUEUE`, SK: `JOB#${jobId}` },
  }));
  return Item || null;
}

export async function updateProcessJob(projectId, jobId, updates) {
  const exprs = [];
  const names = {};
  const values = { ':now': new Date().toISOString() };

  for (const [key, val] of Object.entries(updates)) {
    const attr = `#${key}`;
    const valKey = `:${key}`;
    exprs.push(`${attr} = ${valKey}`);
    names[attr] = key;
    values[valKey] = val;
  }
  exprs.push('#updatedAt = :now');
  names['#updatedAt'] = 'updatedAt';

  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: `P#${projectId}#PQUEUE`, SK: `JOB#${jobId}` },
    UpdateExpression: `SET ${exprs.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
}

export async function listProcessJobs(projectId, { status, limit } = {}) {
  const items = [];
  let lastKey;
  do {
    const params = {
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `P#${projectId}#PQUEUE` },
      ScanIndexForward: false,
      ExclusiveStartKey: lastKey,
    };
    if (status) {
      params.FilterExpression = '#s = :status';
      params.ExpressionAttributeNames = { '#s': 'status' };
      params.ExpressionAttributeValues[':status'] = status;
    }
    const { Items, LastEvaluatedKey } = await ddb.send(new QueryCommand(params));
    items.push(...(Items || []));
    lastKey = LastEvaluatedKey;
    if (limit && items.length >= limit) break;
  } while (lastKey);
  return limit ? items.slice(0, limit) : items;
}

// ── Aggregation ──

export async function getQueueCounts(projectId) {
  const [scrapeJobs, processJobs] = await Promise.all([
    listScrapeJobs(projectId),
    listProcessJobs(projectId),
  ]);

  const countByStatus = (jobs) => {
    const counts = { pending: 0, scraping: 0, processing: 0, completed: 0, failed: 0 };
    for (const j of jobs) counts[j.status] = (counts[j.status] || 0) + 1;
    return counts;
  };

  return {
    scrape: { ...countByStatus(scrapeJobs), total: scrapeJobs.length },
    process: { ...countByStatus(processJobs), total: processJobs.length },
  };
}

// ── Cleanup ──

export async function clearJobs(projectId, queueType, statusFilter) {
  const pk = queueType === 'scrape' ? `P#${projectId}#SCRAPE` : `P#${projectId}#PQUEUE`;
  const jobs = [];
  let lastKey;
  do {
    const params = {
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': pk },
      ExclusiveStartKey: lastKey,
    };
    if (statusFilter) {
      params.FilterExpression = '#s = :status';
      params.ExpressionAttributeNames = { '#s': 'status' };
      params.ExpressionAttributeValues[':status'] = statusFilter;
    }
    const { Items, LastEvaluatedKey } = await ddb.send(new QueryCommand(params));
    jobs.push(...(Items || []));
    lastKey = LastEvaluatedKey;
  } while (lastKey);

  // Batch delete (25 at a time)
  for (let i = 0; i < jobs.length; i += 25) {
    const batch = jobs.slice(i, i + 25);
    await ddb.send(new BatchWriteCommand({
      RequestItems: {
        [TABLE]: batch.map(j => ({
          DeleteRequest: { Key: { PK: pk, SK: j.SK } },
        })),
      },
    }));
  }

  return jobs.length;
}
