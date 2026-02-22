#!/usr/bin/env node

/**
 * Export topics and source documents from Memory MCP to Hugo-compatible markdown files.
 *
 * Usage:
 *   node scripts/export-hugo.mjs <project-id>
 *
 * Env vars:
 *   MCP_URL - Memory MCP endpoint (defaults to the deployed Lambda)
 *
 * Output:
 *   site/content/topics/<category-path>/_index.md      -- category index pages
 *   site/content/topics/<category-path>/<topic-id>.md  -- topic pages
 *   site/content/sources/<doc-id>.md                   -- source document pages
 */

import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE_CONTENT = join(__dirname, '..', 'site', 'content');

const MCP_URL = process.env.MCP_URL || 'https://u5atpeuk5f4aabdba6bvcp4jfm0bpepd.lambda-url.us-east-1.on.aws/';

const projectId = process.argv[2];
if (!projectId) {
  console.error('Usage: node scripts/export-hugo.mjs <project-id>');
  process.exit(1);
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

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function escapeFrontmatter(str) {
  if (/[:"'\n]/.test(str)) return JSON.stringify(str);
  return str;
}

function formatYaml(obj, indent = 0) {
  const pad = '  '.repeat(indent);
  return Object.entries(obj)
    .map(([k, v]) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        return `${pad}${k}:\n${formatYaml(v, indent + 1)}`;
      }
      if (Array.isArray(v)) {
        return `${pad}${k}:\n${v.map(i => `${pad}  - ${escapeFrontmatter(String(i))}`).join('\n')}`;
      }
      return `${pad}${k}: ${escapeFrontmatter(String(v))}`;
    })
    .join('\n');
}

function writeMd(filePath, frontmatter, body) {
  mkdirSync(dirname(filePath), { recursive: true });
  const fm = formatYaml(frontmatter);
  writeFileSync(filePath, `---\n${fm}\n---\n\n${body}\n`);
}

// Clean generated content (preserve _index.md at section roots)
function cleanGeneratedContent() {
  try { rmSync(join(SITE_CONTENT, 'topics'), { recursive: true, force: true }); } catch {}
  try { rmSync(join(SITE_CONTENT, 'sources'), { recursive: true, force: true }); } catch {}

  mkdirSync(join(SITE_CONTENT, 'topics'), { recursive: true });
  mkdirSync(join(SITE_CONTENT, 'sources'), { recursive: true });

  writeMd(join(SITE_CONTENT, 'topics', '_index.md'),
    { title: 'Topics', type: 'docs', sidebar: { open: true } },
    'How-to procedures organized by category.');

  writeMd(join(SITE_CONTENT, 'sources', '_index.md'),
    { title: 'Source Documents', type: 'docs', sidebar: { open: true } },
    'Original documents from which topics were extracted.');
}

// ── Main ──

console.log(`Exporting project ${projectId}...`);
cleanGeneratedContent();

// 1. Fetch categories
const { categories } = await mcpCall('list_categories', {}, { projectId });
console.log(`Found ${categories.length} categories`);

let topicCount = 0;

// 2. For each category, fetch topics and write markdown files
for (const cat of categories) {
  const categoryPath = cat.category;
  const segments = categoryPath.split('/');
  const categoryDir = join(SITE_CONTENT, 'topics', ...segments);

  // Create _index.md for each level of the category hierarchy
  for (let i = 1; i <= segments.length; i++) {
    const partialPath = segments.slice(0, i);
    const indexPath = join(SITE_CONTENT, 'topics', ...partialPath, '_index.md');
    const title = partialPath[partialPath.length - 1]
      .replace(/-/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
    writeMd(indexPath, { title, type: 'docs', sidebar: { open: true } }, '');
  }

  const { topics } = await mcpCall('list_topics', { category: categoryPath }, { projectId });

  for (const topic of topics) {
    const slug = slugify(topic.title);
    const filePath = join(categoryDir, `${slug}.md`);

    const fm = {
      title: topic.title,
      type: 'docs',
      doc_ids: topic.doc_ids || [],
    };

    writeMd(filePath, fm, topic.summary);
    topicCount++;
  }
}

console.log(`Exported ${topicCount} topics`);

// 3. Fetch documents and write source pages
let docCount = 0;
try {
  const { documents } = await mcpCall('list_documents', {}, { projectId });
  console.log(`Found ${documents.length} source documents`);

  for (const doc of documents) {
    const fullDoc = await mcpCall('get_document', { id: doc.id }, { projectId });
    let contents = fullDoc.contents || '';
    let docTitle = doc.title;

    // Extract title from leading markdown heading if no title field
    if (!docTitle) {
      const headingMatch = contents.match(/^#\s+(.+)/m);
      if (headingMatch) {
        docTitle = headingMatch[1].trim();
        contents = contents.replace(/^#\s+.+\n*/, '');
      }
    }

    const slug = slugify(docTitle || doc.id);
    const filePath = join(SITE_CONTENT, 'sources', `${slug}.md`);

    const fm = {
      title: docTitle || doc.id,
      type: 'docs',
      date: doc.createdAt || '',
      url_source: doc.url || '',
      topics_created: doc.topicsCreated ?? 0,
      topics_replaced: doc.topicsReplaced ?? 0,
    };

    if (doc.url) {
      contents += `\n\n---\n\n[Original source](${doc.url})`;
    }

    writeMd(filePath, fm, contents);
    docCount++;
  }
} catch (err) {
  console.warn(`Skipping source documents: ${err.message}`);
}

console.log(`Exported ${docCount} source documents`);
console.log(`\nDone! Run 'cd site && hugo server' to preview.`);
