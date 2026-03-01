#!/usr/bin/env node

/**
 * Automated eval pipeline for how-to extraction quality.
 *
 * Selects a diverse sample of unprocessed documents from a source project,
 * processes them in an isolated test project, evaluates extraction quality,
 * and reports results. Saves results to scripts/eval-results/ for comparison.
 *
 * Usage:
 *   node scripts/eval-pipeline.mjs <source-project-id> [options]
 *
 * Options:
 *   --sample N        Number of docs to sample (default: 20)
 *   --job-ids a,b,c   Specific process job IDs to test (comma-separated)
 *   --keep            Don't delete the test project when done
 *   --skip-judge      Skip LLM judge phase (faster, search-only eval)
 *   --skip-search     Skip search self-retrieval phase
 *   --label NAME      Label for this run (used in results filename)
 *
 * Env vars:
 *   ADMIN_URL   Admin API endpoint
 *   MCP_URL     MCP server endpoint
 *   AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY  For LLM judge
 */

import fs from 'fs';
import path from 'path';
import { judgeDocument } from '../src/lib/ai.js';

// ── CLI ──

const positional = [];
const cliFlags = new Set();
const cliOptions = {};

{
  const raw = process.argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '--skip-judge') cliFlags.add('skip-judge');
    else if (raw[i] === '--skip-search') cliFlags.add('skip-search');
    else if (raw[i] === '--keep') cliFlags.add('keep');
    else if (raw[i] === '--sample' && i + 1 < raw.length) cliOptions.sample = parseInt(raw[++i], 10);
    else if (raw[i] === '--job-ids' && i + 1 < raw.length) cliOptions.jobIds = raw[++i].split(',');
    else if (raw[i] === '--label' && i + 1 < raw.length) cliOptions.label = raw[++i];
    else if (!raw[i].startsWith('--')) positional.push(raw[i]);
  }
}

const sourceProjectId = positional[0];
const sampleSize = cliOptions.sample || 20;
const skipJudge = cliFlags.has('skip-judge');
const skipSearch = cliFlags.has('skip-search');
const keepProject = cliFlags.has('keep');
const explicitJobIds = cliOptions.jobIds || null;
const runLabel = cliOptions.label || new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');

if (!sourceProjectId) {
  console.error('Usage: node scripts/eval-pipeline.mjs <source-project-id> [--sample N] [--job-ids a,b,c] [--keep] [--skip-judge] [--skip-search] [--label NAME]');
  process.exit(1);
}

// ── API clients ──

const ADMIN_URL = process.env.ADMIN_URL || 'https://e475uomcg47vt3ysoccqcyfyce0ihaxr.lambda-url.us-east-1.on.aws';
const MCP_URL = process.env.MCP_URL || 'https://u5atpeuk5f4aabdba6bvcp4jfm0bpepd.lambda-url.us-east-1.on.aws/';

async function adminFetch(method, path, body = null) {
  const url = `${ADMIN_URL}${path}`;
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Admin API error (HTTP ${res.status}): ${text.slice(0, 300)}`);
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

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch {
    throw new Error(`MCP error (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  if (json.error) throw new Error(json.error.message);
  if (json.result?.isError) throw new Error(json.result.content?.[0]?.text || 'Tool error');
  const t = json.result?.content?.[0]?.text;
  return t ? JSON.parse(t) : json.result;
}

// ── Step 1: Select candidates ──

const KEYWORD_WEIGHTS = {
  runbook: 5, mop: 5, migration: 4, troubleshoot: 4, rollback: 4,
  restore: 3, backup: 3, patch: 3, upgrade: 3, procedure: 3,
  deploy: 2, release: 2, cert: 2, ssl: 2, dns: 2,
  config: 1, provision: 1, setup: 1, install: 1,
};

function scoreJob(job) {
  const lower = (job.title || '').toLowerCase();
  let score = 0;
  const matched = [];
  for (const [kw, weight] of Object.entries(KEYWORD_WEIGHTS)) {
    if (lower.includes(kw)) {
      score += weight;
      matched.push(kw);
    }
  }
  return { score, matched };
}

async function selectCandidates(projectId, count) {
  console.log('Fetching pending process jobs...');
  const data = await adminFetch('GET', `/projects/${projectId}/queues?processStatus=pending`);
  const jobs = data.process?.jobs || [];
  console.log(`  ${jobs.length} pending jobs found`);

  if (jobs.length === 0) {
    console.error('No pending jobs to select from');
    process.exit(1);
  }

  const scored = jobs.map(j => {
    const { score, matched } = scoreJob(j);
    const prefix = (j.title || '').match(/^([A-Z]+)-/)?.[1] || 'OTHER';
    return { ...j, relevanceScore: score, keywords: matched, jiraProject: prefix };
  });

  scored.sort((a, b) => b.relevanceScore - a.relevanceScore);

  const byProject = {};
  for (const j of scored) {
    if (!byProject[j.jiraProject]) byProject[j.jiraProject] = [];
    byProject[j.jiraProject].push(j);
  }

  const selected = [];
  const projects = Object.keys(byProject).sort();
  let round = 0;
  while (selected.length < count) {
    let added = 0;
    for (const proj of projects) {
      if (selected.length >= count) break;
      if (round < byProject[proj].length) {
        selected.push(byProject[proj][round]);
        added++;
      }
    }
    if (added === 0) break;
    round++;
  }

  return selected;
}

// ── Step 2: Create test project ──

async function createTestProject(sourceProjectId) {
  const { projects } = await adminFetch('GET', '/projects');
  const source = projects.find(p => p.id === sourceProjectId);
  if (!source) {
    console.error(`Source project ${sourceProjectId} not found`);
    process.exit(1);
  }

  const name = `eval-${runLabel}`;
  const result = await adminFetch('POST', '/projects', {
    name,
    rules: source.rules || '',
  });

  return { id: result.id, name };
}

// ── Step 3: Process documents ──

async function buildDocIndex(projectId) {
  const { documents } = await adminFetch('GET', `/projects/${projectId}/documents`);
  const byUrl = new Map();
  const byId = new Map();
  for (const doc of documents) {
    byUrl.set(doc.url, doc.id);
    byId.set(doc.id, doc);
  }
  return { byUrl, byId };
}

async function processDocs(sourceProjectId, testProjectId, candidates) {
  console.log('Building document index...');
  const docIndex = await buildDocIndex(sourceProjectId);
  console.log(`  ${docIndex.byId.size} documents indexed\n`);

  const results = [];
  const errors = [];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const label = `[${i + 1}/${candidates.length}]`;
    const shortTitle = (candidate.title || candidate.url || '').slice(0, 80);

    process.stdout.write(`${label} "${shortTitle}"...`);

    try {
      const docId = candidate.docId || docIndex.byUrl.get(candidate.url);
      if (!docId) {
        console.log(' SKIP (doc not found)');
        errors.push({ title: shortTitle, error: 'Document not found in index' });
        continue;
      }

      const doc = await adminFetch('GET', `/projects/${sourceProjectId}/documents/${docId}`);
      if (!doc || !doc.contents) {
        console.log(' SKIP (no content)');
        errors.push({ title: shortTitle, error: 'No document content' });
        continue;
      }

      const start = Date.now();
      const result = await adminFetch('POST', `/projects/${testProjectId}/documents`, {
        url: doc.url,
        contents: doc.contents,
        title: doc.title,
        force: true,
      });

      const elapsed = ((Date.now() - start) / 1000).toFixed(1);

      if (result.error) {
        console.log(` ERROR (${elapsed}s): ${result.error}`);
        errors.push({ title: shortTitle, error: result.error, elapsed: parseFloat(elapsed) });
      } else {
        const created = result.topicsCreated ?? 0;
        const replaced = result.topicsReplaced ?? 0;
        console.log(` OK (${elapsed}s) → ${created} created, ${replaced} replaced`);
        results.push({
          sourceTitle: shortTitle,
          docId: result.docId,
          url: doc.url,
          topicsCreated: created,
          topicsReplaced: replaced,
          howTosProcessed: result.howTosProcessed ?? 0,
          elapsed: parseFloat(elapsed),
        });
      }
    } catch (err) {
      console.log(` FAIL: ${err.message.slice(0, 100)}`);
      errors.push({ title: shortTitle, error: err.message });
    }
  }

  return { results, errors };
}

// ── Step 4: Evaluate ──

async function loadTestTopics(testProjectId) {
  const { categories } = await mcpCall('list_categories', {}, { projectId: testProjectId });
  const allTopics = [];
  for (const cat of categories) {
    const { topics } = await mcpCall('list_topics', { category: cat.category }, { projectId: testProjectId });
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

async function runJudgePhase(testProjectId, allTopics) {
  const { documents } = await mcpCall('list_documents', {}, { projectId: testProjectId });
  const docTopicMap = topicsByDocId(allTopics);

  console.log(`\nPhase 1: LLM Judge (${documents.length} documents)\n${'─'.repeat(50)}`);

  const scores = { completeness: [], specificity: [], searchFitness: [] };
  const findings = [];

  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    const fullDoc = await mcpCall('get_document', { id: doc.id }, { projectId: testProjectId });
    const docTopics = docTopicMap.get(doc.id) || [];
    const docTitle = doc.title || doc.url || doc.id;

    if (docTopics.length === 0) {
      console.log(`[${i + 1}/${documents.length}] "${docTitle.slice(0, 70)}" — no topics, skipping`);
      continue;
    }

    process.stdout.write(`[${i + 1}/${documents.length}] "${docTitle.slice(0, 70)}" (${docTopics.length} topics)...`);

    try {
      const result = await judgeDocument(fullDoc.contents || '', docTopics);

      scores.completeness.push(result.completeness.score);
      scores.specificity.push(result.specificity.score);
      scores.searchFitness.push(result.searchFitness.score);

      console.log(` C:${result.completeness.score} S:${result.specificity.score} F:${result.searchFitness.score}`);

      findings.push({
        title: docTitle,
        completeness: result.completeness,
        specificity: result.specificity,
        searchFitness: result.searchFitness,
        topicCount: docTopics.length,
      });
    } catch (err) {
      console.log(` ERROR: ${err.message.slice(0, 80)}`);
    }
  }

  return { scores, findings };
}

async function runSearchPhase(testProjectId, allTopics) {
  console.log(`\nPhase 2: Search Self-Retrieval (${allTopics.length} topics)\n${'─'.repeat(50)}`);

  let retrieved = 0;
  let total = 0;
  const failures = [];

  for (const topic of allTopics) {
    const query = topic.title.replace(/^How to\s+/i, '');
    total++;

    try {
      const results = await mcpCall('semantic_search', { query, limit: 5 }, { projectId: testProjectId });
      const topResults = results.results || results;
      const rank = topResults.findIndex(r => r.id === topic.id);

      if (rank >= 0 && rank < 3) {
        retrieved++;
      } else {
        const topMatch = topResults[0];
        failures.push({
          title: topic.title,
          query,
          rank: rank >= 0 ? rank + 1 : 'not found',
          topMatch: topMatch?.title || '(none)',
          topMatchScore: topMatch?.score,
        });
      }
    } catch (err) {
      failures.push({ title: topic.title, query, rank: 'error', error: err.message });
    }

    if (total % 5 === 0) process.stdout.write(`  ${total}/${allTopics.length} probed...\r`);
  }
  console.log(`  ${total}/${allTopics.length} probed    `);

  return { retrieved, total, failures };
}

// ── Step 5: Report & Persist ──

function buildReport(processResults, judgeResults, searchResults, testProjectId, elapsedMs) {
  const totalCreated = processResults.results.reduce((s, r) => s + (r.topicsCreated ?? 0), 0);
  const totalReplaced = processResults.results.reduce((s, r) => s + (r.topicsReplaced ?? 0), 0);
  const dedupRate = totalCreated + totalReplaced > 0
    ? (totalReplaced / (totalCreated + totalReplaced)) * 100
    : 0;

  const report = {
    label: runLabel,
    timestamp: new Date().toISOString(),
    sourceProjectId,
    testProjectId,
    elapsedMs,
    processing: {
      docsProcessed: processResults.results.length,
      docsFailed: processResults.errors.length,
      topicsCreated: totalCreated,
      topicsReplaced: totalReplaced,
      dedupRate: parseFloat(dedupRate.toFixed(1)),
      avgProcessingTime: processResults.results.length > 0
        ? parseFloat((processResults.results.reduce((s, r) => s + (r.elapsed || 0), 0) / processResults.results.length).toFixed(1))
        : 0,
      docs: processResults.results,
      errors: processResults.errors,
    },
  };

  if (judgeResults) {
    const avg = arr => arr.length ? parseFloat((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2)) : null;
    report.judge = {
      docsEvaluated: judgeResults.scores.completeness.length,
      avgCompleteness: avg(judgeResults.scores.completeness),
      avgSpecificity: avg(judgeResults.scores.specificity),
      avgSearchFitness: avg(judgeResults.scores.searchFitness),
      genericTopics: judgeResults.findings.reduce((s, f) => s + f.specificity.generic.length, 0),
      fitnessIssues: judgeResults.findings.reduce((s, f) => s + f.searchFitness.issues.length, 0),
      missingProcedures: judgeResults.findings.reduce((s, f) => s + f.completeness.missing.length, 0),
      findings: judgeResults.findings,
    };
  }

  if (searchResults) {
    const pct = searchResults.total > 0
      ? parseFloat(((searchResults.retrieved / searchResults.total) * 100).toFixed(1))
      : 0;
    report.search = {
      retrieved: searchResults.retrieved,
      total: searchResults.total,
      retrievalRate: pct,
      failures: searchResults.failures,
    };
  }

  return report;
}

function printReport(report) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`EVAL PIPELINE REPORT — ${report.label}`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`Test project: ${report.testProjectId}`);
  console.log(`Total time:   ${(report.elapsedMs / 1000).toFixed(0)}s`);

  const p = report.processing;
  console.log(`\n── Processing ──`);
  console.log(`  Docs:     ${p.docsProcessed} OK, ${p.docsFailed} failed`);
  console.log(`  Topics:   ${p.topicsCreated} created, ${p.topicsReplaced} replaced (${p.dedupRate}% dedup)`);
  console.log(`  Avg time: ${p.avgProcessingTime}s per doc`);

  if (report.judge) {
    const j = report.judge;
    console.log(`\n── LLM Judge (${j.docsEvaluated} docs) ──`);
    console.log(`  Completeness:  ${j.avgCompleteness}/5  (${j.missingProcedures} missing)`);
    console.log(`  Specificity:   ${j.avgSpecificity}/5  (${j.genericTopics} generic)`);
    console.log(`  Search fit:    ${j.avgSearchFitness}/5  (${j.fitnessIssues} issues)`);
  }

  if (report.search) {
    const s = report.search;
    console.log(`\n── Search Self-Retrieval ──`);
    console.log(`  Top-3 retrieval: ${s.retrieved}/${s.total} (${s.retrievalRate}%)`);
    if (s.failures.length > 0) {
      console.log(`  Missed (${s.failures.length}):`);
      for (const f of s.failures.slice(0, 5)) {
        console.log(`    - "${f.title.slice(0, 55)}" → ${f.rank}`);
      }
      if (s.failures.length > 5) console.log(`    ... +${s.failures.length - 5} more`);
    }
  }

  console.log(`\n${'═'.repeat(60)}\n`);
}

function saveResults(report) {
  const dir = path.join(import.meta.dirname, 'eval-results');
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${report.label}.json`;
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
  console.log(`Results saved: scripts/eval-results/${filename}`);
}

// ── Main ──

async function main() {
  const pipelineStart = Date.now();

  console.log(`\nEval Pipeline — ${runLabel}`);
  console.log(`Source project: ${sourceProjectId}`);
  console.log(`Sample size:    ${explicitJobIds ? explicitJobIds.length + ' (explicit)' : sampleSize}`);
  console.log(`Phases:         ${[skipJudge ? null : 'judge', skipSearch ? null : 'search'].filter(Boolean).join(', ') || 'none'}`);
  console.log('');

  // Step 1: Select candidates
  let candidates;
  if (explicitJobIds) {
    console.log(`Using ${explicitJobIds.length} explicit job IDs`);
    const data = await adminFetch('GET', `/projects/${sourceProjectId}/queues?processStatus=pending`);
    const allJobs = data.process?.jobs || [];
    candidates = allJobs.filter(j => explicitJobIds.includes(j.id));
    if (candidates.length !== explicitJobIds.length) {
      const found = new Set(candidates.map(c => c.id));
      const missing = explicitJobIds.filter(id => !found.has(id));
      console.warn(`Warning: ${missing.length} job IDs not found: ${missing.slice(0, 5).join(', ')}`);
    }
  } else {
    candidates = await selectCandidates(sourceProjectId, sampleSize);
  }

  console.log(`\nSelected ${candidates.length} candidates:`);
  const byProject = {};
  for (const c of candidates) {
    const proj = c.jiraProject || (c.title || '').match(/^([A-Z]+)-/)?.[1] || '?';
    byProject[proj] = (byProject[proj] || 0) + 1;
  }
  console.log(`  By project: ${Object.entries(byProject).map(([k, v]) => `${k}:${v}`).join(' ')}`);
  console.log(`  Keywords:   ${[...new Set(candidates.flatMap(c => c.keywords || []))].join(', ') || '(none)'}`);
  for (const c of candidates) {
    console.log(`    - ${(c.title || c.url || c.id).slice(0, 90)}`);
  }
  console.log('');

  // Step 2: Create test project
  console.log('Creating test project...');
  const testProject = await createTestProject(sourceProjectId);
  console.log(`  Created: ${testProject.name} (${testProject.id})\n`);

  // Step 3: Process documents
  console.log(`Processing ${candidates.length} documents...\n`);
  const processResults = await processDocs(sourceProjectId, testProject.id, candidates);
  console.log(`\nProcessing complete: ${processResults.results.length} OK, ${processResults.errors.length} errors`);

  if (processResults.results.length === 0) {
    console.error('No documents were processed successfully. Aborting eval.');
    process.exit(1);
  }

  // Step 4: Evaluate
  const allTopics = await loadTestTopics(testProject.id);
  console.log(`\nLoaded ${allTopics.length} topics for evaluation`);

  let judgeResults = null;
  if (!skipJudge) {
    try {
      judgeResults = await runJudgePhase(testProject.id, allTopics);
    } catch (err) {
      console.error(`\nLLM judge failed: ${err.message}`);
      console.error('Set AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY for Bedrock access');
    }
  }

  let searchResults = null;
  if (!skipSearch) {
    searchResults = await runSearchPhase(testProject.id, allTopics);
  }

  const elapsedMs = Date.now() - pipelineStart;

  // Step 5: Report & save
  const report = buildReport(processResults, judgeResults, searchResults, testProject.id, elapsedMs);
  printReport(report);
  saveResults(report);

  // Step 6: Cleanup
  if (!keepProject) {
    console.log(`Test project ${testProject.id} retained (cleanup not yet implemented).`);
  } else {
    console.log(`Test project retained: ${testProject.id}`);
  }
}

main().catch(err => {
  console.error('Pipeline failed:', err);
  process.exit(1);
});
