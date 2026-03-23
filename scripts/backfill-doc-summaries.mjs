#!/usr/bin/env node

/**
 * Backfill document summary fields from existing summary chunks.
 *
 * For each document that has no summary field, finds its summary chunk
 * and writes the content back to the document record.
 *
 * Usage:
 *   node scripts/backfill-doc-summaries.mjs [--dry-run]
 *
 * Env vars:
 *   TABLE_NAME  - DynamoDB table name (default: memory-mcp-table)
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const TABLE = process.env.TABLE_NAME || 'memory-mcp-table';
const dryRun = process.argv.includes('--dry-run');

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);

async function queryAll(params) {
  const items = [];
  let lastKey;
  do {
    const { Items, LastEvaluatedKey } = await ddb.send(new QueryCommand({ ...params, ExclusiveStartKey: lastKey }));
    items.push(...(Items || []));
    lastKey = LastEvaluatedKey;
  } while (lastKey);
  return items;
}

async function run() {
  const projects = await queryAll({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': 'PROJECT' },
  });

  console.log(`Found ${projects.length} project(s)\n`);

  let updated = 0;
  let skipped = 0;

  for (const project of projects) {
    const projectId = project.id;
    console.log(`Project: ${project.name} (${projectId})`);

    const docs = await queryAll({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `P#${projectId}#DOC` },
      ProjectionExpression: 'id, title, summary',
    });

    const docsWithoutSummary = docs.filter(d => !d.summary);
    console.log(`  ${docs.length} docs total, ${docsWithoutSummary.length} missing summary`);

    for (const doc of docsWithoutSummary) {
      const chunks = await queryAll({
        TableName: TABLE,
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': `P#${projectId}#DOCCHUNKS#${doc.id}` },
        IndexName: 'GSI1',
        ProjectionExpression: '#t, content',
        ExpressionAttributeNames: { '#t': 'type' },
      });

      const summaryChunk = chunks.find(c => c.type === 'summary');
      if (!summaryChunk) {
        skipped++;
        continue;
      }

      if (dryRun) {
        console.log(`  [dry-run] Would set summary on ${doc.title || doc.id} (${summaryChunk.content.length} chars)`);
      } else {
        await ddb.send(new UpdateCommand({
          TableName: TABLE,
          Key: { PK: `P#${projectId}#DOC`, SK: `DOC#${doc.id}` },
          UpdateExpression: 'SET summary = :s',
          ExpressionAttributeValues: { ':s': summaryChunk.content },
        }));
        console.log(`  Updated: ${doc.title || doc.id}`);
      }
      updated++;
    }
  }

  console.log(`\nDone. Updated: ${updated}, Skipped (no summary chunk): ${skipped}`);
}

run().catch(err => { console.error(err); process.exit(1); });
