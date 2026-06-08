#!/usr/bin/env node

/**
 * Ingest a single Confluence page into Memory MCP via Admin API.
 *
 * Usage:
 *   node scripts/ingest-confluence.mjs <confluence-url>
 *
 * Env vars:
 *   CONFLUENCE_EMAIL   - your Atlassian email
 *   CONFLUENCE_TOKEN   - API token
 *   ADMIN_URL          - Admin API endpoint
 *   PROJECT_ID         - Project ID to ingest into (required)
 */

import { confluenceStorageToText } from '../src/lib/html.js';

const url = process.argv[2];
if (!url) {
  console.error('Usage: node scripts/ingest-confluence.mjs <confluence-url>');
  process.exit(1);
}

const email = process.env.CONFLUENCE_EMAIL;
const token = process.env.CONFLUENCE_TOKEN;
const projectId = process.env.PROJECT_ID;
const ADMIN_URL = process.env.ADMIN_URL;

if (!email || !token) {
  console.error('Set CONFLUENCE_EMAIL and CONFLUENCE_TOKEN env vars.');
  process.exit(1);
}
if (!projectId) {
  console.error('Set PROJECT_ID env var.');
  process.exit(1);
}
if (!ADMIN_URL) {
  console.error('Set ADMIN_URL env var.');
  process.exit(1);
}

const match = url.match(/^(https:\/\/[^/]+)\/wiki\/.*\/pages\/(\d+)/);
if (!match) {
  console.error('Could not parse Confluence URL. Expected format:');
  console.error('  https://domain.atlassian.net/wiki/spaces/SPACE/pages/PAGE_ID/Title');
  process.exit(1);
}

const [, baseUrl, pageId] = match;

console.log(`Fetching page ${pageId} from ${baseUrl}...`);
const apiUrl = `${baseUrl}/wiki/rest/api/content/${pageId}?expand=body.storage,metadata.labels`;
const authHeader = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');

const res = await fetch(apiUrl, {
  headers: { Authorization: authHeader, Accept: 'application/json' },
});

if (!res.ok) {
  console.error(`Confluence API error: ${res.status} ${res.statusText}`);
  process.exit(1);
}

const page = await res.json();
const title = page.title;
const html = page.body.storage.value;
const text = confluenceStorageToText(html);

console.log(`Title: ${title}`);
console.log(`Content: ${text.length} chars`);

console.log(`Sending to Admin API...`);
const adminBase = ADMIN_URL.replace(/\/+$/, '');
const docRes = await fetch(`${adminBase}/projects/${projectId}/documents`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url,
    title,
    contents: `# ${title}\n\n${text}`,
  }),
});

const result = await docRes.json();

if (!docRes.ok) {
  console.error('Error:', result.error || 'Unknown error');
  process.exit(1);
}

console.log(`\nDoc ID: ${result.docId}`);
console.log(`Chunks: ${result.chunksCreated || 0}`);
