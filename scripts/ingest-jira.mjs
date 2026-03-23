#!/usr/bin/env node

/**
 * Create a project and ingest resolved Jira tickets as documents.
 *
 * Usage:
 *   node scripts/ingest-jira.mjs <project-name> --jql "your JQL query" [options]
 *
 * Options:
 *   --jql "query"       JQL query to filter tickets (required)
 *   --dry-run           Only fetch tickets, don't create a project or ingest anything
 *   --force             Force reprocessing of already-ingested tickets
 *   --max N             Maximum number of tickets to process (default: all)
 *
 * Env vars:
 *   JIRA_BASE_URL   - e.g. https://your-domain.atlassian.net
 *   JIRA_EMAIL      - your Atlassian email
 *   JIRA_TOKEN      - API token from https://id.atlassian.com/manage-profile/security/api-tokens
 *   ADMIN_URL       - Admin API endpoint
 */

import { htmlToText } from '../src/lib/html.js';

// ── CLI parsing ──

const positional = [];
const cliFlags = new Set();
const cliOptions = {};

{
  const raw = process.argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '--dry-run') {
      cliFlags.add('dry-run');
    } else if (raw[i] === '--force') {
      cliFlags.add('force');
    } else if (raw[i] === '--jql' && i + 1 < raw.length) {
      cliOptions.jql = raw[++i];
    } else if (raw[i] === '--max' && i + 1 < raw.length) {
      cliOptions.max = parseInt(raw[++i], 10);
    } else if (!raw[i].startsWith('--')) {
      positional.push(raw[i]);
    }
  }
}

const dryRun = cliFlags.has('dry-run');
const forceReprocess = cliFlags.has('force');
const projectName = positional[0];
const maxTickets = cliOptions.max || Infinity;
const jql = cliOptions.jql;

if (!projectName || !jql) {
  console.error('Usage: node scripts/ingest-jira.mjs <project-name> --jql "JQL query" [options]');
  console.error('Options: --dry-run  --force  --max N');
  process.exit(1);
}

const ADMIN_URL = process.env.ADMIN_URL;
const jiraBaseUrl = process.env.JIRA_BASE_URL;
const email = process.env.JIRA_EMAIL;
const token = process.env.JIRA_TOKEN;

if (!jiraBaseUrl || !email || !token) {
  console.error('Set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_TOKEN env vars.');
  process.exit(1);
}
if (!ADMIN_URL && !dryRun) {
  console.error('Set ADMIN_URL env var (Admin API endpoint).');
  process.exit(1);
}

const authHeader = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');

// ── Helpers ──

async function jiraGet(path) {
  const res = await fetch(`${jiraBaseUrl}${path}`, {
    headers: { Authorization: authHeader, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Jira API ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
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

function buildTicketDocument(issue) {
  const fields = issue.fields;
  const renderedFields = issue.renderedFields || {};
  const key = issue.key;

  const parts = [`# ${key}: ${fields.summary}`];

  const meta = [
    `Project: ${fields.project?.name || fields.project?.key || ''}`,
    `Type: ${fields.issuetype?.name || ''}`,
    `Status: ${fields.status?.name || ''}`,
    `Resolution: ${fields.resolution?.name || ''}`,
  ];
  if (fields.labels?.length) meta.push(`Labels: ${fields.labels.join(', ')}`);
  if (fields.components?.length) meta.push(`Components: ${fields.components.map(c => c.name).join(', ')}`);
  parts.push(meta.join('\n'));

  const descHtml = renderedFields.description || '';
  const descText = descHtml ? htmlToText(descHtml) : (fields.description || '');
  if (descText) {
    parts.push(`## Description\n\n${descText}`);
  }

  const comments = renderedFields.comment?.comments || fields.comment?.comments || [];
  if (comments.length) {
    const commentTexts = comments.map(c => {
      const author = c.author?.displayName || 'Unknown';
      const body = c.renderedBody ? htmlToText(c.renderedBody) : (c.body || '');
      return `**${author}:**\n${body}`;
    });
    parts.push(`## Comments\n\n${commentTexts.join('\n\n---\n\n')}`);
  }

  return parts.join('\n\n');
}

// ── Main ──

let projectId;
let success = 0;
let skipped = 0;
let unchanged = 0;
let errors = 0;
let count = 0;

if (!dryRun) {
  console.log(`Creating project "${projectName}"...`);
  const project = await adminRequest('POST', '/projects', { name: projectName });
  projectId = project.id;
  console.log(`Project created: ${projectId}\n`);
}

console.log(`JQL: ${jql}\n`);

const PAGE_SIZE = 50;
let nextPageToken = null;
let isLast = false;

while (!isLast) {
  if (count >= maxTickets) break;

  const batchSize = Math.min(PAGE_SIZE, maxTickets - count);
  let searchPath = `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${batchSize}`
    + `&fields=summary,description,status,resolution,issuetype,project,labels,components,comment,created,resolutiondate`
    + `&expand=renderedFields`;
  if (nextPageToken) searchPath += `&nextPageToken=${encodeURIComponent(nextPageToken)}`;

  const data = await jiraGet(searchPath);
  if (count === 0) console.log(`Fetching tickets...\n`);

  for (const issue of data.issues) {
    if (count >= maxTickets) break;
    count++;

    const key = issue.key;
    const summary = issue.fields.summary;
    const ticketUrl = `${jiraBaseUrl}/browse/${key}`;
    const doc = buildTicketDocument(issue);

    console.log(`[${count}] ${key}: ${summary} (${doc.length} chars)`);

    if (doc.length < 100) {
      console.log(`  -> Skipped (too short)`);
      skipped++;
      continue;
    }

    if (dryRun) continue;

    try {
      const result = await adminRequest('POST', `/projects/${projectId}/documents`, {
        url: ticketUrl,
        title: `${key}: ${summary}`,
        contents: doc,
        force: forceReprocess,
      });

      if (result.skipped) {
        console.log(`  -> Unchanged, skipped`);
        unchanged++;
        continue;
      }

      console.log(`  -> ${result.chunksCreated} chunks created`);
      success++;
    } catch (err) {
      console.error(`  -> Error: ${err.message}`);
      errors++;
    }
  }

  nextPageToken = data.nextPageToken || null;
  isLast = data.isLast !== false;
  if (data.issues.length === 0) break;
}

console.log(`\n${'='.repeat(50)}`);
console.log(`Done!`);
if (!dryRun) {
  console.log(`  Project:    ${projectName} (${projectId})`);
}
console.log(`  Ingested:   ${success} tickets`);
console.log(`  Unchanged:  ${unchanged}`);
console.log(`  Skipped:    ${skipped}`);
console.log(`  Errors:     ${errors}`);
console.log(`  Total:      ${count}`);
