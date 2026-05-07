import crypto from 'crypto';
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

// ── Projects ──

export async function putProject(project) {
  const item = {
    PK: 'PROJECT',
    SK: `PROJECT#${project.id}`,
    id: project.id,
    name: project.name,
    createdAt: new Date().toISOString(),
  };
  if (project.prompts) item.prompts = project.prompts;
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
}

export async function updateProject(id, updates) {
  const expressions = [];
  const names = {};
  const values = {};

  if (updates.name !== undefined) {
    expressions.push('#n = :name');
    names['#n'] = 'name';
    values[':name'] = updates.name;
  }
  if (updates.prompts !== undefined) {
    expressions.push('prompts = :prompts');
    values[':prompts'] = updates.prompts;
  }

  if (expressions.length === 0) return;

  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: 'PROJECT', SK: `PROJECT#${id}` },
    UpdateExpression: `SET ${expressions.join(', ')}`,
    ...(Object.keys(names).length > 0 && { ExpressionAttributeNames: names }),
    ExpressionAttributeValues: values,
  }));
}

export async function getProject(id) {
  const { Item } = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: 'PROJECT', SK: `PROJECT#${id}` },
  }));
  return Item || null;
}

export async function listProjects() {
  const items = [];
  let lastKey;
  do {
    const { Items, LastEvaluatedKey } = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': 'PROJECT' },
      ExclusiveStartKey: lastKey,
    }));
    items.push(...(Items || []));
    lastKey = LastEvaluatedKey;
  } while (lastKey);
  return items;
}

// ── Docs ──

export async function putDoc(projectId, doc) {
  const item = {
    PK: `P#${projectId}#DOC`,
    SK: `DOC#${doc.id}`,
    id: doc.id,
    url: doc.url,
    title: doc.title || '',
    contents: doc.contents,
    contentsSha256: doc.contentsSha256 || '',
    chunksCreated: 0,
    createdAt: new Date().toISOString(),
  };
  if (doc.url) {
    const urlHash = crypto.createHash('sha256').update(doc.url).digest('hex');
    item.GSI1PK = `P#${projectId}#DOCURL#${urlHash}`;
    item.GSI1SK = `DOC#${doc.id}`;
  }
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
}

export async function updateDoc(projectId, docId, updates) {
  const exprs = [];
  const names = {};
  const values = {};
  for (const [key, val] of Object.entries(updates)) {
    const attr = `#${key}`;
    const valKey = `:${key}`;
    exprs.push(`${attr} = ${valKey}`);
    names[attr] = key;
    values[valKey] = val;
  }
  if (exprs.length === 0) return;
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: `P#${projectId}#DOC`, SK: `DOC#${docId}` },
    UpdateExpression: `SET ${exprs.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
}

export async function getDoc(projectId, id) {
  const { Item } = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `P#${projectId}#DOC`, SK: `DOC#${id}` },
  }));
  return Item || null;
}

export async function getLatestDocByUrl(projectId, url) {
  const urlHash = crypto.createHash('sha256').update(url).digest('hex');
  const { Items } = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `P#${projectId}#DOCURL#${urlHash}` },
    ScanIndexForward: false,
    Limit: 1,
  }));
  return Items && Items.length > 0 ? Items[0] : null;
}

export async function listDocs(projectId, { limit, afterSK } = {}) {
  const pk = `P#${projectId}#DOC`;
  const items = [];
  let lastKey = afterSK ? { PK: pk, SK: afterSK } : undefined;
  do {
    const { Items, LastEvaluatedKey } = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': pk },
      ExclusiveStartKey: lastKey,
    }));
    items.push(...(Items || []));
    lastKey = LastEvaluatedKey;
    if (limit && items.length >= limit) break;
  } while (lastKey);
  if (!limit) return { items, hasMore: false };
  const result = items.slice(0, limit);
  const hasMore = items.length > limit || !!lastKey;
  return { items: result, hasMore };
}

// ── Chunks ──

export async function putChunk(projectId, chunk) {
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: `P#${projectId}#CHUNK`,
      SK: `CHUNK#${chunk.id}`,
      GSI1PK: `P#${projectId}#DOCCHUNKS#${chunk.docId}`,
      GSI1SK: `CHUNK#${chunk.id}`,
      id: chunk.id,
      type: chunk.type,
      content: chunk.content,
      docId: chunk.docId,
      sha256: chunk.sha256,
    },
  }));
}

export async function listChunks(projectId, { limit, afterSK } = {}) {
  const pk = `P#${projectId}#CHUNK`;
  const items = [];
  let lastKey = afterSK ? { PK: pk, SK: afterSK } : undefined;
  do {
    const { Items, LastEvaluatedKey } = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': pk },
      ExclusiveStartKey: lastKey,
    }));
    items.push(...(Items || []));
    lastKey = LastEvaluatedKey;
    if (limit && items.length >= limit) break;
  } while (lastKey);
  if (!limit) return { items, hasMore: false };
  const result = items.slice(0, limit);
  const hasMore = items.length > limit || !!lastKey;
  return { items: result, hasMore };
}

export async function listChunksByDoc(projectId, docId) {
  const items = [];
  let lastKey;
  do {
    const { Items, LastEvaluatedKey } = await ddb.send(new QueryCommand({
      TableName: TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `P#${projectId}#DOCCHUNKS#${docId}` },
      ExclusiveStartKey: lastKey,
    }));
    items.push(...(Items || []));
    lastKey = LastEvaluatedKey;
  } while (lastKey);
  return items;
}

export async function deleteChunksByDoc(projectId, docId) {
  const chunks = await listChunksByDoc(projectId, docId);
  let deleted = 0;
  for (let i = 0; i < chunks.length; i += 25) {
    const batch = chunks.slice(i, i + 25);
    await ddb.send(new BatchWriteCommand({
      RequestItems: {
        [TABLE]: batch.map(item => ({
          DeleteRequest: { Key: { PK: `P#${projectId}#CHUNK`, SK: `CHUNK#${item.id}` } },
        })),
      },
    }));
    deleted += batch.length;
  }
  return deleted;
}

// ── Project deletion ──

async function deleteAllByPartition(pk) {
  let lastKey;
  let deleted = 0;
  do {
    const { Items, LastEvaluatedKey } = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': pk },
      ProjectionExpression: 'PK, SK',
      ExclusiveStartKey: lastKey,
    }));
    if (Items && Items.length > 0) {
      for (let i = 0; i < Items.length; i += 25) {
        const batch = Items.slice(i, i + 25);
        await ddb.send(new BatchWriteCommand({
          RequestItems: {
            [TABLE]: batch.map(item => ({
              DeleteRequest: { Key: { PK: item.PK, SK: item.SK } },
            })),
          },
        }));
      }
      deleted += Items.length;
    }
    lastKey = LastEvaluatedKey;
  } while (lastKey);
  return deleted;
}

export async function deleteProject(projectId) {
  const partitions = [
    `P#${projectId}#DOC`,
    `P#${projectId}#CHUNK`,
    `P#${projectId}#SCRAPE`,
    `P#${projectId}#PQUEUE`,
    `P#${projectId}#BM25QUEUE`,
  ];

  const counts = {};
  for (const pk of partitions) {
    counts[pk] = await deleteAllByPartition(pk);
  }

  await ddb.send(new DeleteCommand({
    TableName: TABLE,
    Key: { PK: 'PROJECT', SK: `PROJECT#${projectId}` },
  }));

  return counts;
}

// ── Embeddings cache (global, not project-scoped) ──

export async function getCachedEmbedding(sha256) {
  const { Item } = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: 'EMBED', SK: `EMBED#${sha256}` },
  }));
  return Item ? Item.embedding : null;
}

export async function putCachedEmbedding(sha256, embedding) {
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: 'EMBED',
      SK: `EMBED#${sha256}`,
      embedding,
    },
  }));
}
