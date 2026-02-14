#!/usr/bin/env node

/**
 * Ingest a Confluence page into Memory MCP.
 *
 * Usage:
 *   node scripts/ingest-confluence.mjs <confluence-url>
 *
 * Env vars:
 *   CONFLUENCE_EMAIL   - your Atlassian email
 *   CONFLUENCE_TOKEN   - API token from https://id.atlassian.com/manage-profile/security/api-tokens
 *   MCP_URL            - Memory MCP endpoint (defaults to the deployed Lambda)
 */

const MCP_URL = process.env.MCP_URL || 'https://u5atpeuk5f4aabdba6bvcp4jfm0bpepd.lambda-url.us-east-1.on.aws/';

const url = process.argv[2];
if (!url) {
  console.error('Usage: node scripts/ingest-confluence.mjs <confluence-url>');
  process.exit(1);
}

const email = process.env.CONFLUENCE_EMAIL;
const token = process.env.CONFLUENCE_TOKEN;
if (!email || !token) {
  console.error('Set CONFLUENCE_EMAIL and CONFLUENCE_TOKEN env vars.');
  console.error('Get a token at: https://id.atlassian.com/manage-profile/security/api-tokens');
  process.exit(1);
}

// Extract domain and page ID from URL
// Handles: https://xxx.atlassian.net/wiki/spaces/SPACE/pages/12345/Title
const match = url.match(/^(https:\/\/[^/]+)\/wiki\/.*\/pages\/(\d+)/);
if (!match) {
  console.error('Could not parse Confluence URL. Expected format:');
  console.error('  https://domain.atlassian.net/wiki/spaces/SPACE/pages/PAGE_ID/Title');
  process.exit(1);
}

const [, baseUrl, pageId] = match;

// Fetch page content
console.log(`Fetching page ${pageId} from ${baseUrl}...`);
const apiUrl = `${baseUrl}/wiki/rest/api/content/${pageId}?expand=body.storage,metadata.labels`;
const authHeader = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');

const res = await fetch(apiUrl, {
  headers: { Authorization: authHeader, Accept: 'application/json' },
});

if (!res.ok) {
  console.error(`Confluence API error: ${res.status} ${res.statusText}`);
  const body = await res.text();
  console.error(body);
  process.exit(1);
}

const page = await res.json();
const title = page.title;
const html = page.body.storage.value;

// Strip HTML to plain text
const text = html
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

console.log(`Title: ${title}`);
console.log(`Content: ${text.length} chars`);

// Send to Memory MCP
console.log(`Sending to Memory MCP...`);
const mcpRes = await fetch(MCP_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'add_doc',
      arguments: { url, contents: `# ${title}\n\n${text}` },
    },
  }),
});

const mcpJson = await mcpRes.json();
const raw = mcpJson.result?.content?.[0]?.text || '';

if (mcpJson.result?.isError || mcpJson.error) {
  console.error('MCP error:', raw || mcpJson.error?.message);
  process.exit(1);
}

let result;
try {
  result = JSON.parse(raw);
} catch {
  console.error('Unexpected response:', raw);
  process.exit(1);
}

console.log(`\nDoc ID: ${result.docId}`);
console.log(`Topics: ${result.topicsProcessed}`);
for (const t of result.topics) {
  console.log(`  [${t.action}] ${t.category} - ${t.summary.slice(0, 80)}...`);
}
