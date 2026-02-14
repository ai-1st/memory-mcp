#!/usr/bin/env node

/**
 * Create a project and ingest a Confluence parent page + all descendant pages (recursive).
 *
 * Usage:
 *   node scripts/ingest-confluence-project.mjs <project-name> <confluence-parent-url> [--dry-run]
 *
 * Options:
 *   --dry-run   Only discover pages, don't create a project or ingest anything
 *
 * Example:
 *   node scripts/ingest-confluence-project.mjs "My Project" \
 *     https://myorg.atlassian.net/wiki/spaces/TEAM/pages/12345/Parent+Page
 *   node scripts/ingest-confluence-project.mjs "My Project" \
 *     https://myorg.atlassian.net/wiki/spaces/TEAM/pages/12345/Parent+Page --dry-run
 *
 * Env vars:
 *   CONFLUENCE_EMAIL   - your Atlassian email
 *   CONFLUENCE_TOKEN   - API token from https://id.atlassian.com/manage-profile/security/api-tokens
 *   MCP_URL            - Memory MCP endpoint (defaults to the deployed Lambda)
 */

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flags = process.argv.slice(2).filter(a => a.startsWith('--'));
const dryRun = flags.includes('--dry-run');

const projectName = args[0];
const parentUrl = args[1];

if (!projectName || !parentUrl) {
  console.error('Usage: node scripts/ingest-confluence-project.mjs <project-name> <confluence-parent-url> [--dry-run]');
  process.exit(1);
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
 * Recursively discover all descendant pages (and folders).
 * Folders are traversed but marked with isFolder=true so they can be skipped during ingestion.
 * Returns flat array with depth info.
 */
async function discoverAll(parentId, depth = 0) {
  // Fetch child pages (with body for ingestion) and child folders (no body, just for recursion)
  const [childPages, childFolders] = await Promise.all([
    getChildren(parentId, 'page', 'body.storage'),
    getChildren(parentId, 'folder'),
  ]);

  let all = [];

  for (const folder of childFolders) {
    all.push({ ...folder, depth, isFolder: true });
    const nested = await discoverAll(folder.id, depth + 1);
    all.push(...nested);
  }

  for (const page of childPages) {
    all.push({ ...page, depth });
    const nested = await discoverAll(page.id, depth + 1);
    all.push(...nested);
  }

  return all;
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

// 1. Discover all descendant pages and folders (recursive)
console.log(`Discovering all pages under ${parentPageId}...`);
const allItems = await discoverAll(parentPageId);
const allPages = allItems.filter(p => !p.isFolder);
const allFolders = allItems.filter(p => p.isFolder);
console.log(`Found ${allItems.length} items: ${allPages.length} pages + ${allFolders.length} folders`);
for (const p of allItems) {
  const tag = p.isFolder ? ' [folder]' : '';
  console.log(`  ${'  '.repeat(p.depth)}- ${p.title}${tag}`);
}

if (dryRun) {
  console.log(`\n--dry-run: stopping here (no project created, nothing ingested)`);
  process.exit(0);
}

// 2. Create the project
console.log(`\nCreating project "${projectName}"...`);
const project = await mcpCall('create_project', { name: projectName });
const projectId = project.id;
console.log(`Project created: ${projectId}\n`);

// 3. Ingest the parent page itself
console.log(`[0/${allPages.length + 1}] Ingesting parent page...`);
try {
  const parentPage = await confluenceGet(
    `/wiki/rest/api/content/${parentPageId}?expand=body.storage`
  );
  const parentText = htmlToText(parentPage.body.storage.value);

  if (parentText.length > 50) {
    const result = await mcpCall('add_doc', {
      url: parentUrl,
      contents: `# ${parentPage.title}\n\n${parentText}`,
    }, { projectId });
    const count = result.howTosProcessed || result.topicsProcessed || 0;
    console.log(`  -> ${count} how-tos extracted`);
  } else {
    console.log(`  -> Skipped (too short: ${parentText.length} chars)`);
  }
} catch (err) {
  console.error(`  -> Error: ${err.message}`);
}

// 4. Ingest each descendant page (folders are skipped)
let success = 0;
let skipped = 0;
let errors = 0;

for (let i = 0; i < allPages.length; i++) {
  const page = allPages[i];
  const title = page.title;
  const bodyHtml = page.body?.storage?.value || '';
  const text = htmlToText(bodyHtml);

  console.log(`[${i + 1}/${allPages.length}] ${title} (${text.length} chars)`);

  if (text.length < 50) {
    console.log(`  -> Skipped (too short)`);
    skipped++;
    continue;
  }

  try {
    const result = await mcpCall('add_doc', {
      url: pageLink(page.id, title),
      contents: `# ${title}\n\n${text}`,
    }, { projectId });
    const count = result.howTosProcessed || result.topicsProcessed || 0;
    console.log(`  -> ${count} how-tos extracted`);
    success++;
  } catch (err) {
    console.error(`  -> Error: ${err.message}`);
    errors++;
  }
}

console.log(`\n${'='.repeat(50)}`);
console.log(`Done!`);
console.log(`  Project:  ${projectName} (${projectId})`);
console.log(`  Ingested: ${success + 1} pages`);
console.log(`  Skipped:  ${skipped}`);
console.log(`  Errors:   ${errors}`);
