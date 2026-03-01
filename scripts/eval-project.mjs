#!/usr/bin/env node

/**
 * Evaluate the quality of how-to extraction for a project.
 *
 * Two phases:
 *   1. LLM-as-judge: per-document evaluation of completeness, specificity, and search fitness
 *   2. Search self-retrieval: probe whether each topic can be found by a natural query
 *
 * Usage:
 *   node scripts/eval-project.mjs <project-id> [options]
 *
 * Options:
 *   --max N          Limit LLM judge to N documents (default: all)
 *   --search-only    Skip LLM judge, only run search self-retrieval probe
 *
 * Env vars:
 *   MCP_URL          - Memory MCP endpoint (defaults to the deployed Lambda)
 *   AWS credentials  - needed for Bedrock LLM judge calls
 */

import { judgeDocument } from '../src/lib/ai.js';

const positional = [];
const cliFlags = new Set();
const cliOptions = {};

{
  const raw = process.argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '--search-only') {
      cliFlags.add('search-only');
    } else if (raw[i] === '--max' && i + 1 < raw.length) {
      cliOptions.max = parseInt(raw[++i], 10);
    } else if (!raw[i].startsWith('--')) {
      positional.push(raw[i]);
    }
  }
}

const projectId = positional[0];
const searchOnly = cliFlags.has('search-only');
const maxDocs = cliOptions.max || Infinity;

if (!projectId) {
  console.error('Usage: node scripts/eval-project.mjs <project-id> [--max N] [--search-only]');
  process.exit(1);
}

const MCP_URL = process.env.MCP_URL || 'https://u5atpeuk5f4aabdba6bvcp4jfm0bpepd.lambda-url.us-east-1.on.aws/';

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

// ── Gather all topics (keyed by doc_id for Phase 1, flat for Phase 2) ──

async function loadAllTopics() {
  const { categories } = await mcpCall('list_categories', {}, { projectId });
  const allTopics = [];

  for (const cat of categories) {
    const { topics } = await mcpCall('list_topics', { category: cat.category }, { projectId });
    allTopics.push(...topics);
  }

  return allTopics;
}

function topicsByDocId(topics) {
  const map = new Map();
  for (const t of topics) {
    for (const docId of (t.doc_ids || [])) {
      if (!map.has(docId)) map.set(docId, []);
      map.get(docId).push(t);
    }
  }
  return map;
}

// ── Phase 1: LLM-as-judge ──

async function runJudge(allTopics) {
  const { documents } = await mcpCall('list_documents', {}, { projectId });
  const docTopicMap = topicsByDocId(allTopics);

  const docsToEval = documents.slice(0, maxDocs);
  console.log(`\nPhase 1: LLM Judge (${docsToEval.length} documents)\n${'─'.repeat(50)}`);

  const scores = { completeness: [], specificity: [], searchFitness: [] };
  let docIndex = 0;

  for (const doc of docsToEval) {
    docIndex++;
    const fullDoc = await mcpCall('get_document', { id: doc.id }, { projectId });
    const contents = fullDoc.contents || '';
    const docTopics = docTopicMap.get(doc.id) || [];
    const docTitle = doc.title || doc.url || doc.id;

    if (docTopics.length === 0) {
      console.log(`[${docIndex}/${docsToEval.length}] "${docTitle}" — no topics, skipping`);
      continue;
    }

    console.log(`[${docIndex}/${docsToEval.length}] "${docTitle}" (${docTopics.length} topics)...`);

    try {
      const result = await judgeDocument(contents, docTopics);

      scores.completeness.push(result.completeness.score);
      scores.specificity.push(result.specificity.score);
      scores.searchFitness.push(result.searchFitness.score);

      console.log(`  Completeness: ${result.completeness.score}/5${result.completeness.missing.length ? ` (missing: ${result.completeness.missing.join('; ')})` : ''}`);
      console.log(`  Specificity:  ${result.specificity.score}/5${result.specificity.generic.length ? ` (${result.specificity.generic.length} generic)` : ''}`);
      for (const g of result.specificity.generic) {
        const topicTitle = docTopics[g.index]?.title || `#${g.index}`;
        console.log(`    - "${topicTitle}": ${g.reason}`);
      }
      console.log(`  Search fit:   ${result.searchFitness.score}/5${result.searchFitness.issues.length ? ` (${result.searchFitness.issues.length} issues)` : ''}`);
      for (const issue of result.searchFitness.issues) {
        const topicTitle = docTopics[issue.index]?.title || `#${issue.index}`;
        console.log(`    - "${topicTitle}": ${issue.reason}`);
      }
    } catch (err) {
      console.error(`  Error: ${err.message}`);
    }

    console.log('');
  }

  return scores;
}

// ── Phase 2: Search self-retrieval ──

async function runSearchProbe(allTopics) {
  console.log(`\nPhase 2: Search Self-Retrieval (${allTopics.length} topics)\n${'─'.repeat(50)}`);

  let retrieved = 0;
  let total = 0;
  const failures = [];

  for (const topic of allTopics) {
    const query = topic.title.replace(/^How to\s+/i, '');
    total++;

    try {
      const results = await mcpCall('semantic_search', { query, limit: 5 }, { projectId });
      const topResults = results.results || results;
      const rank = topResults.findIndex(r => r.id === topic.id);
      const selfScore = rank >= 0 ? topResults[rank].score : null;

      if (rank >= 0 && rank < 3) {
        retrieved++;
      } else {
        const topMatch = topResults[0];
        failures.push({
          title: topic.title,
          query,
          rank: rank >= 0 ? rank + 1 : 'not found',
          selfScore,
          topMatchTitle: topMatch?.title || '(none)',
          topMatchScore: topMatch?.score,
        });
      }
    } catch (err) {
      failures.push({ title: topic.title, query, rank: 'error', selfScore: null, error: err.message });
    }

    if (total % 10 === 0) process.stdout.write(`  ${total}/${allTopics.length} probed...\r`);
  }

  console.log(`  ${total}/${allTopics.length} probed    `);

  return { retrieved, total, failures };
}

// ── Main ──

console.log(`Evaluating project: ${projectId}`);
const allTopics = await loadAllTopics();
console.log(`Loaded ${allTopics.length} topics`);

let judgeScores = null;
if (!searchOnly) {
  judgeScores = await runJudge(allTopics);
}

const searchResults = await runSearchProbe(allTopics);

// ── Summary ──

console.log(`\n${'═'.repeat(50)}`);
console.log('SUMMARY');
console.log(`${'═'.repeat(50)}`);

if (judgeScores) {
  const avg = arr => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : 'n/a';
  console.log(`  Avg completeness: ${avg(judgeScores.completeness)}/5  (${judgeScores.completeness.length} docs evaluated)`);
  console.log(`  Avg specificity:  ${avg(judgeScores.specificity)}/5`);
  console.log(`  Avg search fit:   ${avg(judgeScores.searchFitness)}/5`);
}

const pct = searchResults.total > 0
  ? ((searchResults.retrieved / searchResults.total) * 100).toFixed(1)
  : '0.0';
console.log(`  Self-retrieval:   ${searchResults.retrieved}/${searchResults.total} in top-3 (${pct}%)`);

if (searchResults.failures.length > 0) {
  console.log(`\n  Topics NOT retrieved in top-3:`);
  for (const f of searchResults.failures) {
    if (f.error) {
      console.log(`    - "${f.title}" — error: ${f.error}`);
    } else {
      const scoreStr = f.selfScore != null ? ` (self-score: ${f.selfScore.toFixed(3)})` : '';
      console.log(`    - "${f.title}" — rank: ${f.rank}${scoreStr}`);
      console.log(`      query: "${f.query}" → top match: "${f.topMatchTitle}" (${f.topMatchScore?.toFixed(3)})`);
    }
  }
}

console.log('');
