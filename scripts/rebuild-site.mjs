#!/usr/bin/env node

/**
 * Fargate entrypoint: export all projects from Memory MCP → build Hugo site → sync to S3.
 *
 * Required env vars (injected by the ECS task definition):
 *   MCP_URL       – Memory MCP Lambda Function URL
 *   SITE_BUCKET   – destination S3 bucket for the built site
 *   CF_DISTRO_ID  – CloudFront distribution ID to invalidate after deploy
 */

import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readdirSync, statSync } from 'fs';
import { readFile } from 'fs/promises';
import { lookup } from 'mime-types';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SITE_DIR = join(ROOT, 'site');
const PUBLIC_DIR = join(SITE_DIR, 'public');

const { MCP_URL, SITE_BUCKET, CF_DISTRO_ID } = process.env;
if (!MCP_URL || !SITE_BUCKET) {
  console.error('Missing required env vars: MCP_URL, SITE_BUCKET');
  process.exit(1);
}

const s3 = new S3Client({});
const cf = CF_DISTRO_ID ? new CloudFrontClient({}) : null;

// ── 1. Export content from MCP ──────────────────────────────────────────

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

async function exportAllProjects() {
  const { projects } = await mcpCall('list_projects');
  console.log(`Found ${projects.length} project(s)`);

  for (const project of projects) {
    console.log(`\nExporting project: ${project.name} (${project.id})`);
    execSync(`node ${join(__dirname, 'export-hugo.mjs')} ${project.id}`, {
      stdio: 'inherit',
      env: { ...process.env, MCP_URL },
    });
  }
}

// ── 2. Build Hugo site ──────────────────────────────────────────────────

function buildHugo() {
  console.log('\nBuilding Hugo site...');
  execSync('hugo --minify', { cwd: SITE_DIR, stdio: 'inherit' });
  console.log('Hugo build complete.');
}

// ── 3. Sync to S3 ───────────────────────────────────────────────────────

function walkDir(dir, base = dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      entries.push(...walkDir(full, base));
    } else {
      entries.push(full);
    }
  }
  return entries;
}

async function syncToS3() {
  console.log(`\nSyncing to s3://${SITE_BUCKET}/ ...`);
  const files = walkDir(PUBLIC_DIR);
  let uploaded = 0;

  const BATCH = 20;
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    await Promise.all(batch.map(async (filePath) => {
      const key = filePath.slice(PUBLIC_DIR.length + 1);
      const contentType = lookup(key) || 'application/octet-stream';
      const body = await readFile(filePath);
      await s3.send(new PutObjectCommand({
        Bucket: SITE_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      }));
      uploaded++;
    }));
  }

  console.log(`Uploaded ${uploaded} files.`);
}

// ── 4. Invalidate CloudFront ────────────────────────────────────────────

async function invalidateCloudFront() {
  if (!cf || !CF_DISTRO_ID) {
    console.log('Skipping CloudFront invalidation (no distro ID).');
    return;
  }
  console.log(`Invalidating CloudFront distribution ${CF_DISTRO_ID}...`);
  await cf.send(new CreateInvalidationCommand({
    DistributionId: CF_DISTRO_ID,
    InvalidationBatch: {
      CallerReference: `rebuild-${Date.now()}`,
      Paths: { Quantity: 1, Items: ['/*'] },
    },
  }));
  console.log('Invalidation created.');
}

// ── Main ────────────────────────────────────────────────────────────────

try {
  await exportAllProjects();
  buildHugo();
  await syncToS3();
  await invalidateCloudFront();
  console.log('\nSite rebuild complete.');
} catch (err) {
  console.error('Rebuild failed:', err);
  process.exit(1);
}
