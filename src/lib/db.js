import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);
const TABLE = process.env.TABLE_NAME;

// ── Projects ──

export async function putProject(project) {
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: 'PROJECT',
      SK: `PROJECT#${project.id}`,
      id: project.id,
      name: project.name,
      createdAt: new Date().toISOString(),
    },
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
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: `P#${projectId}#DOC`,
      SK: `DOC#${doc.id}`,
      id: doc.id,
      url: doc.url,
      contents: doc.contents,
      createdAt: new Date().toISOString(),
    },
  }));
}

export async function getDoc(projectId, id) {
  const { Item } = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `P#${projectId}#DOC`, SK: `DOC#${id}` },
  }));
  return Item || null;
}

// ── Topics ──

export async function putTopic(projectId, topic) {
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: `P#${projectId}#TOPIC`,
      SK: `TOPIC#${topic.id}`,
      GSI1PK: `P#${projectId}#CAT#${topic.category}`,
      GSI1SK: `TOPIC#${topic.id}`,
      id: topic.id,
      category: topic.category,
      title: topic.title,
      summary: topic.summary,
      doc_ids: topic.doc_ids,
      sha256: topic.sha256,
    },
  }));
}

export async function getTopic(projectId, id) {
  const { Item } = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `P#${projectId}#TOPIC`, SK: `TOPIC#${id}` },
  }));
  return Item || null;
}

export async function queryTopicsByCategory(projectId, category) {
  const items = [];
  let lastKey;
  do {
    const { Items, LastEvaluatedKey } = await ddb.send(new QueryCommand({
      TableName: TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `P#${projectId}#CAT#${category}` },
      ExclusiveStartKey: lastKey,
    }));
    items.push(...(Items || []));
    lastKey = LastEvaluatedKey;
  } while (lastKey);
  return items;
}

export async function findTopicBySha256(projectId, sha256) {
  const { Items } = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk',
    FilterExpression: 'sha256 = :sha',
    ExpressionAttributeValues: {
      ':pk': `P#${projectId}#TOPIC`,
      ':sha': sha256,
    },
  }));
  return Items && Items.length > 0 ? Items[0] : null;
}

/** Move a topic to PK=P#{projectId}#REPLACED and delete original */
export async function replaceTopic(projectId, topicId, replacementTopicId) {
  const existing = await getTopic(projectId, topicId);
  if (!existing) return;

  await ddb.send(new TransactWriteCommand({
    TransactItems: [
      {
        Delete: {
          TableName: TABLE,
          Key: { PK: `P#${projectId}#TOPIC`, SK: `TOPIC#${topicId}` },
        },
      },
      {
        Put: {
          TableName: TABLE,
          Item: {
            ...existing,
            PK: `P#${projectId}#REPLACED`,
            replacement_topic_id: replacementTopicId,
          },
        },
      },
    ],
  }));
}

// ── Categories ──

export async function listCategories(projectId) {
  const items = [];
  let lastKey;
  do {
    const { Items, LastEvaluatedKey } = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `P#${projectId}#CAT` },
      ExclusiveStartKey: lastKey,
    }));
    items.push(...(Items || []));
    lastKey = LastEvaluatedKey;
  } while (lastKey);
  return items;
}

export async function incrementCategory(projectId, category, delta = 1) {
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: `P#${projectId}#CAT`, SK: `CAT#${category}` },
    UpdateExpression: 'SET topicCount = if_not_exists(topicCount, :zero) + :d, GSI1PK = :g1pk, GSI1SK = :g1sk, category = :cat',
    ExpressionAttributeValues: {
      ':zero': 0,
      ':d': delta,
      ':g1pk': `P#${projectId}#CATS`,
      ':g1sk': `CAT#${category}`,
      ':cat': category,
    },
  }));
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
