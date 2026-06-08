#!/usr/bin/env node

/**
 * Create a project and ingest a Confluence parent page + all descendant pages (recursive).
 *
 * Usage:
 *   node scripts/ingest-confluence-project.mjs <project-name> <confluence-parent-url> [options]
 *
 * Options:
 *   --dry-run           Only discover pages, don't create a project or ingest anything
 *   --force             Force reprocessing of already-ingested pages
 *
 * Env vars:
 *   CONFLUENCE_EMAIL   - your Atlassian email
 *   CONFLUENCE_TOKEN   - API token
 *   ADMIN_URL          - Admin API endpoint
 */

import { confluenceStorageToText } from '../src/lib/html.js';

const positional = [];
const cliFlags = new Set();

{
  const raw = process.argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '--dry-run') cliFlags.add('dry-run');
    else if (raw[i] === '--force') cliFlags.add('force');
    else if (!raw[i].startsWith('--')) positional.push(raw[i]);
  }
}

const dryRun = cliFlags.has('dry-run');
const forceReprocess = cliFlags.has('force');
const projectName = positional[0];
const parentUrl = positional[1];

if (!projectName || !parentUrl) {
  console.error('Usage: node scripts/ingest-confluence-project.mjs <project-name> <confluence-parent-url> [options]');
  console.error('Options: --dry-run  --force');
  process.exit(1);
}

const ADMIN_URL = process.env.ADMIN_URL;
const email = process.env.CONFLUENCE_EMAIL;
const token = process.env.CONFLUENCE_TOKEN;

if (!email || !token) {
  console.error('Set CONFLUENCE_EMAIL and CONFLUENCE_TOKEN env vars.');
  process.exit(1);
}
if (!ADMIN_URL && !dryRun) {
  console.error('Set ADMIN_URL env var.');
  process.exit(1);
}

const urlMatch = parentUrl.match(/^(https:\/\/[^/]+)\/wiki\/.*\/pages\/(\d+)/);
if (!urlMatch) {
  console.error('Could not parse Confluence URL. Expected format:');
  console.error('  https://domain.atlassian.net/wiki/spaces/SPACE/pages/PAGE_ID/Title');
  process.exit(1);
}

const [, baseUrl, parentPageId] = urlMatch;
const authHeader = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');

// ── Helpers ──

async function confluenceGet(path) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: authHeader, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Confluence API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function getChildren(parentId, childType, expand = '') {
  const children = [];
  let start = 0;
  const limit = 50;
  const expandParam = expand ? `&expand=${expand}` : '';
  while (true) {
    const data = await confluenceGet(
      `/wiki/rest/api/content/${parentId}/child/${childType}?start=${start}&limit=${limit}${expandParam}`
    );
    children.push(...data.results);
    if (data.size < limit) break;
    start += limit;
  }
  return children;
}

async function walkPages(parentId, onPage, depth = 0) {
  const [childPages, childFolders] = await Promise.all([
    getChildren(parentId, 'page', 'body.storage'),
    getChildren(parentId, 'folder'),
  ]);

  for (const folder of childFolders) {
    console.log(`${'  '.repeat(depth)}[folder] ${folder.title}`);
    await walkPages(folder.id, onPage, depth + 1);
  }

  for (const page of childPages) {
    await onPage(page, depth);
    await walkPages(page.id, onPage, depth + 1);
  }
}

async function adminRequest(method, path, body) {
  const base = ADMIN_URL.replace(/\/+$/, '');
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${base}${path}`, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Admin API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

function pageLink(pageId, title) {
  return `${baseUrl}/wiki/pages/${pageId}/${encodeURIComponent(title || '')}`;
}

// ── Main ──

let projectId;
let success = 0;
let skipped = 0;
let unchanged = 0;
let errors = 0;
let count = 0;

async function ingestPage(title, url, bodyHtml) {
  const text = confluenceStorageToText(bodyHtml);
  count++;
  console.log(`[${count}] ${title} (${text.length} chars)`);

  if (text.length < 50) {
    console.log(`  -> Skipped (too short)`);
    skipped++;
    return;
  }

  if (dryRun) return;

  try {
    const result = await adminRequest('POST', `/projects/${projectId}/documents`, {
      url,
      title,
      contents: `# ${title}\n\n${text}`,
      force: forceReprocess,
    });

    if (result.skipped) {
      console.log(`  -> Unchanged, skipped`);
      unchanged++;
      return;
    }

    console.log(`  -> ${result.chunksCreated} chunks created`);
    success++;
  } catch (err) {
    console.error(`  -> Error: ${err.message}`);
    errors++;
  }
}

if (!dryRun) {
  console.log(`Creating project "${projectName}"...`);
  const project = await adminRequest('POST', '/projects', { name: projectName });
  projectId = project.id;
  console.log(`Project created: ${projectId}\n`);
}

console.log(`Fetching parent page ${parentPageId}...`);
const parentPage = await confluenceGet(
  `/wiki/rest/api/content/${parentPageId}?expand=body.storage`
);
await ingestPage(parentPage.title, parentUrl, parentPage.body?.storage?.value || '');

console.log(`\nCrawling child pages...`);
await walkPages(parentPageId, async (page, depth) => {
  const url = pageLink(page.id, page.title);
  const bodyHtml = page.body?.storage?.value || '';
  await ingestPage(page.title, url, bodyHtml);
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Done!`);
if (!dryRun) {
  console.log(`  Project:  ${projectName} (${projectId})`);
}
console.log(`  Ingested:   ${success} pages`);
console.log(`  Unchanged:  ${unchanged}`);
console.log(`  Skipped:    ${skipped}`);
console.log(`  Errors:     ${errors}`);
