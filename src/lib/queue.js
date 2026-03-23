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
  const item = {
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
  };
  if (job.credentials) item.credentials = job.credentials;
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
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
      chunksCreated: job.chunksCreated ?? 0,
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

export async function listProcessJobs(projectId, { status, limit, afterSK } = {}) {
  const pk = `P#${projectId}#PQUEUE`;
  const items = [];
  let lastKey = afterSK ? { PK: pk, SK: afterSK } : undefined;
  do {
    const params = {
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': pk },
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
  const result = limit ? items.slice(0, limit) : items;
  const hasMore = limit ? items.length > limit || !!lastKey : false;
  return { items: result, hasMore };
}

// ── Aggregation ──

async function countByStatusProjection(pk) {
  const counts = { pending: 0, scraping: 0, processing: 0, completed: 0, failed: 0 };
  let total = 0;
  let lastKey;
  do {
    const { Items, LastEvaluatedKey } = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': pk },
      ProjectionExpression: '#s',
      ExpressionAttributeNames: { '#s': 'status' },
      ExclusiveStartKey: lastKey,
    }));
    for (const item of (Items || [])) {
      counts[item.status] = (counts[item.status] || 0) + 1;
      total++;
    }
    lastKey = LastEvaluatedKey;
  } while (lastKey);
  return { ...counts, total };
}

export async function getQueueCounts(projectId) {
  const [scrape, process] = await Promise.all([
    countByStatusProjection(`P#${projectId}#SCRAPE`),
    countByStatusProjection(`P#${projectId}#PQUEUE`),
  ]);
  return { scrape, process };
}

// ── Claim (conditional update to prevent race conditions) ──

export async function claimProcessJob(projectId, jobId) {
  try {
    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `P#${projectId}#PQUEUE`, SK: `JOB#${jobId}` },
      UpdateExpression: 'SET #s = :processing, #updatedAt = :now',
      ConditionExpression: '#s = :pending',
      ExpressionAttributeNames: { '#s': 'status', '#updatedAt': 'updatedAt' },
      ExpressionAttributeValues: {
        ':processing': 'processing',
        ':pending': 'pending',
        ':now': new Date().toISOString(),
      },
    }));
    return true;
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

export async function claimScrapeJob(projectId, jobId) {
  try {
    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `P#${projectId}#SCRAPE`, SK: `JOB#${jobId}` },
      UpdateExpression: 'SET #s = :scraping, #updatedAt = :now',
      ConditionExpression: '#s = :pending',
      ExpressionAttributeNames: { '#s': 'status', '#updatedAt': 'updatedAt' },
      ExpressionAttributeValues: {
        ':scraping': 'scraping',
        ':pending': 'pending',
        ':now': new Date().toISOString(),
      },
    }));
    return true;
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

// ── Queue stop flag ──

export async function setQueueStopped(projectId, queue, stopped) {
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: `P#${projectId}#QSTOP`,
      SK: queue,
      stopped,
      updatedAt: new Date().toISOString(),
    },
  }));
}

export async function isQueueStopped(projectId, queue) {
  const { Item } = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `P#${projectId}#QSTOP`, SK: queue },
  }));
  return Item?.stopped === true;
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
