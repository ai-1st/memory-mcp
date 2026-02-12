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

// ── Docs ──

export async function putDoc(doc) {
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: 'DOC',
      SK: `DOC#${doc.id}`,
      id: doc.id,
      url: doc.url,
      contents: doc.contents,
      createdAt: new Date().toISOString(),
    },
  }));
}

export async function getDoc(id) {
  const { Item } = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: 'DOC', SK: `DOC#${id}` },
  }));
  return Item || null;
}

// ── Topics ──

export async function putTopic(topic) {
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: 'TOPIC',
      SK: `TOPIC#${topic.id}`,
      GSI1PK: `CAT#${topic.category}`,
      GSI1SK: `TOPIC#${topic.id}`,
      id: topic.id,
      category: topic.category,
      summary: topic.summary,
      doc_ids: topic.doc_ids,
      sha256: topic.sha256,
    },
  }));
}

export async function getTopic(id) {
  const { Item } = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: 'TOPIC', SK: `TOPIC#${id}` },
  }));
  return Item || null;
}

export async function queryTopicsByCategory(category) {
  const items = [];
  let lastKey;
  do {
    const { Items, LastEvaluatedKey } = await ddb.send(new QueryCommand({
      TableName: TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `CAT#${category}` },
      ExclusiveStartKey: lastKey,
    }));
    items.push(...(Items || []));
    lastKey = LastEvaluatedKey;
  } while (lastKey);
  return items;
}

export async function findTopicBySha256(sha256) {
  const { Items } = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk',
    FilterExpression: 'sha256 = :sha',
    ExpressionAttributeValues: {
      ':pk': 'TOPIC',
      ':sha': sha256,
    },
  }));
  return Items && Items.length > 0 ? Items[0] : null;
}

/** Move a topic to PK=REPLACED and delete original */
export async function replaceTopic(topicId, replacementTopicId) {
  const existing = await getTopic(topicId);
  if (!existing) return;

  await ddb.send(new TransactWriteCommand({
    TransactItems: [
      {
        Delete: {
          TableName: TABLE,
          Key: { PK: 'TOPIC', SK: `TOPIC#${topicId}` },
        },
      },
      {
        Put: {
          TableName: TABLE,
          Item: {
            ...existing,
            PK: 'REPLACED',
            replacement_topic_id: replacementTopicId,
          },
        },
      },
    ],
  }));
}

// ── Categories ──

export async function listCategories() {
  const items = [];
  let lastKey;
  do {
    const { Items, LastEvaluatedKey } = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': 'CAT' },
      ExclusiveStartKey: lastKey,
    }));
    items.push(...(Items || []));
    lastKey = LastEvaluatedKey;
  } while (lastKey);
  return items;
}

export async function incrementCategory(category, delta = 1) {
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: 'CAT', SK: `CAT#${category}` },
    UpdateExpression: 'SET topicCount = if_not_exists(topicCount, :zero) + :d, GSI1PK = :g1pk, GSI1SK = :g1sk, category = :cat',
    ExpressionAttributeValues: {
      ':zero': 0,
      ':d': delta,
      ':g1pk': 'CATS',
      ':g1sk': `CAT#${category}`,
      ':cat': category,
    },
  }));
}

// ── Embeddings cache ──

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
