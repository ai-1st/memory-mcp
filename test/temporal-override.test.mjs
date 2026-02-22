#!/usr/bin/env node

/**
 * Integration test: later documents override earlier facts.
 *
 * Ingests server-config-v1.txt, then server-config-v2.txt for the same URL.
 * Asserts that:
 *   - The v2 document triggers REPLACE actions (not just ADDs)
 *   - The resulting topics reflect the updated facts (port 9090, not 8080)
 *   - Re-ingesting v2 without --force is skipped (content unchanged)
 *
 * Requires:
 *   MCP_URL  - endpoint of a running MCP server (defaults to deployed Lambda)
 *
 * Usage:
 *   node --test test/temporal-override.test.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MCP_URL = process.env.MCP_URL || 'https://u5atpeuk5f4aabdba6bvcp4jfm0bpepd.lambda-url.us-east-1.on.aws/';
const TEST_URL = 'https://wiki.acme.internal/server-config';

async function mcpCall(name, args = {}, config = {}) {
  const params = { name, arguments: args };
  if (Object.keys(config).length > 0) params.config = config;

  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params }),
  });

  const raw = await res.text();
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`Non-JSON response (HTTP ${res.status}): ${raw.slice(0, 200)}`);
  }

  if (json.error) throw new Error(json.error.message);
  if (json.result?.isError) throw new Error(json.result.content?.[0]?.text || 'Tool error');
  const text = json.result?.content?.[0]?.text;
  return text ? JSON.parse(text) : json.result;
}

let projectId;

describe('temporal override', () => {
  before(async () => {
    const project = await mcpCall('create_project', {
      name: `test-temporal-${Date.now()}`,
    });
    projectId = project.id;
    console.log(`  Created test project: ${projectId}`);
  });

  it('should ingest v1 and create topics', async () => {
    const v1 = readFileSync(join(__dirname, 'fixtures/server-config-v1.txt'), 'utf-8');

    const result = await mcpCall('add_doc', {
      url: TEST_URL,
      title: 'Server Config v1',
      contents: v1,
    }, { projectId });

    console.log(`  v1: ${result.howTosProcessed} how-tos, ${result.topicsCreated} created, ${result.topicsReplaced} replaced`);

    assert.equal(result.skipped, false, 'v1 should not be skipped');
    assert.ok(result.topicsCreated > 0, 'v1 should create at least one topic');
    assert.equal(result.topicsReplaced, 0, 'v1 should not replace anything (first ingestion)');
  });

  it('should ingest v2 and replace topics with updated facts', async () => {
    const v2 = readFileSync(join(__dirname, 'fixtures/server-config-v2.txt'), 'utf-8');

    const result = await mcpCall('add_doc', {
      url: TEST_URL,
      title: 'Server Config v2',
      contents: v2,
    }, { projectId });

    console.log(`  v2: ${result.howTosProcessed} how-tos, ${result.topicsCreated} created, ${result.topicsReplaced} replaced`);

    assert.equal(result.skipped, false, 'v2 should not be skipped (different content)');
    assert.ok(result.topicsReplaced > 0, 'v2 should replace at least one topic from v1');
  });

  it('should skip re-ingestion of unchanged v2 content', async () => {
    const v2 = readFileSync(join(__dirname, 'fixtures/server-config-v2.txt'), 'utf-8');

    const result = await mcpCall('add_doc', {
      url: TEST_URL,
      title: 'Server Config v2',
      contents: v2,
    }, { projectId });

    assert.equal(result.skipped, true, 'Should skip unchanged content');
  });

  it('should reprocess v2 when force=true', async () => {
    const v2 = readFileSync(join(__dirname, 'fixtures/server-config-v2.txt'), 'utf-8');

    const result = await mcpCall('add_doc', {
      url: TEST_URL,
      title: 'Server Config v2',
      contents: v2,
      force: true,
    }, { projectId });

    assert.equal(result.skipped, false, 'Should process when force=true');
    assert.ok(result.howTosProcessed > 0, 'Should extract how-tos on forced reprocess');
  });

  it('should have topics reflecting v2 facts (port 9090, not 8080)', async () => {
    const categories = await mcpCall('list_categories', {}, { projectId });

    let allTopics = [];
    for (const cat of categories.categories) {
      const topicResult = await mcpCall('list_topics', {
        category: cat.category,
      }, { projectId });
      allTopics.push(...topicResult.topics);
    }

    const deploymentTopics = allTopics.filter(t =>
      t.title.toLowerCase().includes('deploy') ||
      t.title.toLowerCase().includes('start') ||
      t.title.toLowerCase().includes('server') ||
      t.summary.includes('9090') ||
      t.summary.includes('8080')
    );

    assert.ok(deploymentTopics.length > 0, 'Should have at least one deployment-related topic');

    const hasNewPort = deploymentTopics.some(t => t.summary.includes('9090'));
    assert.ok(hasNewPort, 'At least one topic should reference port 9090 (v2 fact)');

    const hasOldPort = deploymentTopics.some(t =>
      t.summary.includes('8080') && !t.summary.includes('changed from 8080')
    );
    assert.ok(!hasOldPort, 'No topic should reference port 8080 as current (v1 fact should be overridden)');
  });
});
