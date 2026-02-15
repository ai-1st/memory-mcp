#!/usr/bin/env node

/**
 * Create a project and ingest a Confluence parent page + all descendant pages (recursive).
 *
 * Usage:
 *   node scripts/ingest-confluence-project.mjs <project-name> <confluence-parent-url> [options]
 *
 * Options:
 *   --dry-run           Only discover pages, don't create a project or ingest anything
 *   --rules "text"      Categorization rules for the project (how categories should be assigned)
 *   --rules-file path   Read categorization rules from a file
 *
 * Example:
 *   node scripts/ingest-confluence-project.mjs "My Project" \
 *     https://myorg.atlassian.net/wiki/spaces/TEAM/pages/12345/Parent+Page
 *   node scripts/ingest-confluence-project.mjs "My Project" \
 *     https://myorg.atlassian.net/wiki/spaces/TEAM/pages/12345/Parent+Page --dry-run
 *   node scripts/ingest-confluence-project.mjs "My Project" \
 *     https://myorg.atlassian.net/wiki/spaces/TEAM/pages/12345/Parent+Page \
 *     --rules-file ./rules/my-project.txt
 *
 * Env vars:
 *   CONFLUENCE_EMAIL   - your Atlassian email
 *   CONFLUENCE_TOKEN   - API token from https://id.atlassian.com/manage-profile/security/api-tokens
 *   MCP_URL            - Memory MCP endpoint (defaults to the deployed Lambda)
 */

import { readFileSync } from 'fs';

// Parse CLI args: positional args vs flags/options
const positional = [];
const cliFlags = new Set();
const cliOptions = {};

{
  const raw = process.argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '--dry-run') {
      cliFlags.add('dry-run');
    } else if (raw[i] === '--rules' && i + 1 < raw.length) {
      cliOptions.rules = raw[++i];
    } else if (raw[i] === '--rules-file' && i + 1 < raw.length) {
      cliOptions.rulesFile = raw[++i];
    } else if (!raw[i].startsWith('--')) {
      positional.push(raw[i]);
    }
  }
}

const dryRun = cliFlags.has('dry-run');
const projectName = positional[0];
const parentUrl = positional[1];

if (!projectName || !parentUrl) {
  console.error('Usage: node scripts/ingest-confluence-project.mjs <project-name> <confluence-parent-url> [options]');
  console.error('Options: --dry-run  --rules "text"  --rules-file path');
  process.exit(1);
}

// Resolve categorization rules
let categorizationRules = '';
if (cliOptions.rulesFile) {
  categorizationRules = readFileSync(cliOptions.rulesFile, 'utf-8').trim();
  console.log(`Loaded categorization rules from ${cliOptions.rulesFile} (${categorizationRules.length} chars)`);
} else if (cliOptions.rules) {
  categorizationRules = cliOptions.rules.trim();
  console.log(`Using inline categorization rules (${categorizationRules.length} chars)`);
}

const MCP_URL = process.env.MCP_URL || 'https://u5atpeuk5f4aabdba6bvcp4jfm0bpepd.lambda-url.us-east-1.on.aws/';

const email = process.env.CONFLUENCE_EMAIL;
const token = process.env.CONFLUENCE_TOKEN;
if (!email || !token) {
  console.error('Set CONFLUENCE_EMAIL and CONFLUENCE_TOKEN env vars.');
  console.error('Get a token at: https://id.atlassian.com/manage-profile/security/api-tokens');
  process.exit(1);
}

// Extract base URL and page ID from the Confluence URL
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

/** Fetch paginated children of a given content id and type ("page" or "folder"). */
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

/**
 * Recursively discover and ingest pages as they are found.
 * Calls onPage(page, depth) for each page discovered.
 */
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

function htmlToText(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, ' | ')
    .replace(/<\/th>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function pageLink(pageId, title) {
  return `${baseUrl}/wiki/pages/${pageId}/${encodeURIComponent(title || '')}`;
}

// ── Main ──

let projectId;
let success = 0;
let skipped = 0;
let errors = 0;
let count = 0;

async function ingestPage(title, url, bodyHtml) {
  const text = htmlToText(bodyHtml);
  count++;
  console.log(`[${count}] ${title} (${text.length} chars)`);

  if (text.length < 50) {
    console.log(`  -> Skipped (too short)`);
    skipped++;
    return;
  }

  if (dryRun) return;

  try {
    const result = await mcpCall('add_doc', {
      url,
      contents: `# ${title}\n\n${text}`,
    }, { projectId });
    const n = result.howTosProcessed || result.topicsProcessed || 0;
    console.log(`  -> ${n} how-tos extracted`);
    success++;
  } catch (err) {
    console.error(`  -> Error: ${err.message}`);
    errors++;
  }
}

// 1. Create project (unless dry-run)
if (!dryRun) {
  console.log(`Creating project "${projectName}"...`);
  const createArgs = { name: projectName };
  if (categorizationRules) createArgs.rules = categorizationRules;
  const project = await mcpCall('create_project', createArgs);
  projectId = project.id;
  console.log(`Project created: ${projectId}`);
  if (categorizationRules) console.log(`  Categorization rules attached (${categorizationRules.length} chars)`);
  console.log('');
}

// 2. Ingest parent page
console.log(`Fetching parent page ${parentPageId}...`);
const parentPage = await confluenceGet(
  `/wiki/rest/api/content/${parentPageId}?expand=body.storage`
);
await ingestPage(parentPage.title, parentUrl, parentPage.body?.storage?.value || '');

// 3. Walk and ingest children as they are discovered
console.log(`\nCrawling child pages...`);
await walkPages(parentPageId, async (page, depth) => {
  const indent = '  '.repeat(depth);
  const url = pageLink(page.id, page.title);
  const bodyHtml = page.body?.storage?.value || '';
  await ingestPage(`${indent}${page.title}`, url, bodyHtml);
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Done!`);
if (!dryRun) {
  console.log(`  Project:  ${projectName} (${projectId})`);
}
console.log(`  Ingested: ${success} pages`);
console.log(`  Skipped:  ${skipped}`);
console.log(`  Errors:   ${errors}`);
