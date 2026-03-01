#!/usr/bin/env node

/**
 * Create a project and ingest resolved Jira tickets as how-to documents.
 *
 * Usage:
 *   node scripts/ingest-jira.mjs <project-name> [options]
 *
 * Options:
 *   --dry-run           Only fetch tickets, don't create a project or ingest anything
 *   --force             Force reprocessing of already-ingested tickets
 *   --rules "text"      Categorization rules for the project
 *   --rules-file path   Read categorization rules from a file
 *   --max N             Maximum number of tickets to process (default: all)
 *
 * Env vars:
 *   JIRA_BASE_URL   - e.g. https://your-domain.atlassian.net
 *   JIRA_EMAIL      - your Atlassian email
 *   JIRA_TOKEN      - API token from https://id.atlassian.com/manage-profile/security/api-tokens
 *   MCP_URL         - Memory MCP endpoint (defaults to the deployed Lambda)
 */

import { readFileSync } from 'fs';
import { htmlToText } from '../src/lib/html.js';

const JQL = `resolution=Done AND summary !~ "ALARM" AND summary !~ "Alert" AND project in ("Khoros Care SMM", KHOROS, "Khoros Communities - Aurora", "Khoros Communities - Lia", "Khoros Flow", "Khoros SpredFast") ORDER BY resolved DESC`;

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
    } else if (raw[i] === '--rules' && i + 1 < raw.length) {
      cliOptions.rules = raw[++i];
    } else if (raw[i] === '--rules-file' && i + 1 < raw.length) {
      cliOptions.rulesFile = raw[++i];
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

if (!projectName) {
  console.error('Usage: node scripts/ingest-jira.mjs <project-name> [options]');
  console.error('Options: --dry-run  --force  --rules "text"  --rules-file path  --max N');
  process.exit(1);
}

let categorizationRules = '';
if (cliOptions.rulesFile) {
  categorizationRules = readFileSync(cliOptions.rulesFile, 'utf-8').trim();
  console.log(`Loaded categorization rules from ${cliOptions.rulesFile} (${categorizationRules.length} chars)`);
} else if (cliOptions.rules) {
  categorizationRules = cliOptions.rules.trim();
  console.log(`Using inline categorization rules (${categorizationRules.length} chars)`);
}

const MCP_URL = process.env.MCP_URL || 'https://u5atpeuk5f4aabdba6bvcp4jfm0bpepd.lambda-url.us-east-1.on.aws/';
const jiraBaseUrl = process.env.JIRA_BASE_URL;
const email = process.env.JIRA_EMAIL;
const token = process.env.JIRA_TOKEN;

if (!jiraBaseUrl || !email || !token) {
  console.error('Set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_TOKEN env vars.');
  console.error('Get a token at: https://id.atlassian.com/manage-profile/security/api-tokens');
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

// 2. Search and paginate through Jira tickets
console.log(`JQL: ${JQL}\n`);

const PAGE_SIZE = 50;
let nextPageToken = null;
let isLast = false;

while (!isLast) {
  if (count >= maxTickets) break;

  const batchSize = Math.min(PAGE_SIZE, maxTickets - count);
  let searchPath = `/rest/api/3/search/jql?jql=${encodeURIComponent(JQL)}&maxResults=${batchSize}`
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
      const result = await mcpCall('add_doc', {
        url: ticketUrl,
        title: `${key}: ${summary}`,
        contents: doc,
        force: forceReprocess,
      }, { projectId });

      if (result.skipped) {
        console.log(`  -> Unchanged, skipped`);
        unchanged++;
        continue;
      }

      const created = result.topicsCreated || 0;
      const replaced = result.topicsReplaced || 0;
      console.log(`  -> ${result.howTosProcessed} how-tos (${created} new, ${replaced} replaced)`);
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
