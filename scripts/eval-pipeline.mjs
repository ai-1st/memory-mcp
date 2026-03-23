#!/usr/bin/env node

/**
 * Automated eval pipeline for chunk extraction quality.
 *
 * Selects a diverse sample of unprocessed documents from a source project,
 * processes them in an isolated test project, evaluates search retrieval quality,
 * and reports results.
 *
 * Usage:
 *   node scripts/eval-pipeline.mjs <source-project-id> [options]
 *
 * Options:
 *   --sample N        Number of docs to sample (default: 20)
 *   --job-ids a,b,c   Specific process job IDs to test (comma-separated)
 *   --keep            Don't delete the test project when done
 *   --skip-search     Skip search self-retrieval phase
 *   --label NAME      Label for this run (used in results filename)
 *
 * Env vars:
 *   ADMIN_URL   Admin API endpoint
 *   MCP_URL     MCP server endpoint
 */

import fs from 'fs';
import path from 'path';

// ── CLI ──

const positional = [];
const cliFlags = new Set();
const cliOptions = {};

{
  const raw = process.argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '--skip-search') cliFlags.add('skip-search');
    else if (raw[i] === '--keep') cliFlags.add('keep');
    else if (raw[i] === '--sample' && i + 1 < raw.length) cliOptions.sample = parseInt(raw[++i], 10);
    else if (raw[i] === '--job-ids' && i + 1 < raw.length) cliOptions.jobIds = raw[++i].split(',');
    else if (raw[i] === '--label' && i + 1 < raw.length) cliOptions.label = raw[++i];
    else if (!raw[i].startsWith('--')) positional.push(raw[i]);
  }
}

const sourceProjectId = positional[0];
const sampleSize = cliOptions.sample || 20;
const skipSearch = cliFlags.has('skip-search');
const keepProject = cliFlags.has('keep');
const explicitJobIds = cliOptions.jobIds || null;
const runLabel = cliOptions.label || new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');

if (!sourceProjectId) {
  console.error('Usage: node scripts/eval-pipeline.mjs <source-project-id> [--sample N] [--job-ids a,b,c] [--keep] [--skip-search] [--label NAME]');
  process.exit(1);
}

// ── API clients ──

const ADMIN_URL = process.env.ADMIN_URL;
const MCP_URL = process.env.MCP_URL;

if (!ADMIN_URL) { console.error('Set ADMIN_URL env var'); process.exit(1); }
if (!MCP_URL && !skipSearch) { console.error('Set MCP_URL env var (or use --skip-search)'); process.exit(1); }

async function adminFetch(method, urlPath, body = null, { timeoutMs = 310_000, retries = 2 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const url = `${ADMIN_URL}${urlPath}`;
      const opts = {
        method,
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      };
      if (body) opts.body = JSON.stringify(body);
      const res = await fetch(url, opts);
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`Admin API error (HTTP ${res.status}): ${text.slice(0, 300)}`);
      }
    } catch (err) {
      if (attempt < retries && (err.name === 'TimeoutError' || err.message?.includes('terminated'))) {
        console.warn(`  Retry ${attempt + 1}/${retries}...`);
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      throw err;
    }
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

async function selectCandidates(projectId, count) {
  console.log('Fetching pending process jobs...');
  const data = await adminFetch('GET', `/projects/${projectId}/queues?processStatus=pending`);
  const jobs = data.process?.jobs || [];
  console.log(`  ${jobs.length} pending jobs found`);

  if (jobs.length === 0) {
    console.error('No pending jobs to select from');
    process.exit(1);
  }

  return jobs.slice(0, count);
}

// ── Step 2: Create test project ──

async function createTestProject() {
  const name = `eval-${runLabel}`;
  const result = await adminFetch('POST', '/projects', { name });
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
        const created = result.chunksCreated ?? 0;
        console.log(` OK (${elapsed}s) -> ${created} chunks`);
        results.push({
          sourceTitle: shortTitle,
          docId: result.docId,
          url: doc.url,
          chunksCreated: created,
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

// ── Step 4: Search self-retrieval ──

async function loadTestChunks(testProjectId) {
  const { chunks } = await adminFetch('GET', `/projects/${testProjectId}/chunks`);
  return chunks || [];
}

async function runSearchPhase(testProjectId, allChunks) {
  const searchable = allChunks.filter(c => c.type === 'qa' || c.type === 'summary');
  console.log(`\nSearch Self-Retrieval (${searchable.length} searchable chunks)\n${'─'.repeat(50)}`);

  let retrieved = 0;
  let total = 0;
  const failures = [];

  for (const chunk of searchable) {
    const query = chunk.content.slice(0, 200);
    total++;

    try {
      const results = await mcpCall('semantic_search', { query, limit: 5 }, { projectId: testProjectId });
      const topResults = results.results || results;
      const rank = topResults.findIndex(r => r.id === chunk.id);

      if (rank >= 0 && rank < 3) {
        retrieved++;
      } else {
        failures.push({
          chunkId: chunk.id,
          type: chunk.type,
          query: query.slice(0, 80),
          rank: rank >= 0 ? rank + 1 : 'not found',
        });
      }
    } catch (err) {
      failures.push({ chunkId: chunk.id, type: chunk.type, rank: 'error', error: err.message });
    }

    if (total % 5 === 0) process.stdout.write(`  ${total}/${searchable.length} probed...\r`);
  }
  console.log(`  ${total}/${searchable.length} probed    `);

  return { retrieved, total, failures };
}

// ── Step 5: Report ──

function buildReport(processResults, searchResults, testProjectId, elapsedMs) {
  const totalChunks = processResults.results.reduce((s, r) => s + (r.chunksCreated ?? 0), 0);

  const report = {
    label: runLabel,
    timestamp: new Date().toISOString(),
    sourceProjectId,
    testProjectId,
    elapsedMs,
    processing: {
      docsProcessed: processResults.results.length,
      docsFailed: processResults.errors.length,
      chunksCreated: totalChunks,
      avgProcessingTime: processResults.results.length > 0
        ? parseFloat((processResults.results.reduce((s, r) => s + (r.elapsed || 0), 0) / processResults.results.length).toFixed(1))
        : 0,
      docs: processResults.results,
      errors: processResults.errors,
    },
  };

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
  console.log(`\n${'='.repeat(60)}`);
  console.log(`EVAL PIPELINE REPORT - ${report.label}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Test project: ${report.testProjectId}`);
  console.log(`Total time:   ${(report.elapsedMs / 1000).toFixed(0)}s`);

  const p = report.processing;
  console.log(`\n-- Processing --`);
  console.log(`  Docs:     ${p.docsProcessed} OK, ${p.docsFailed} failed`);
  console.log(`  Chunks:   ${p.chunksCreated} created`);
  console.log(`  Avg time: ${p.avgProcessingTime}s per doc`);

  if (report.search) {
    const s = report.search;
    console.log(`\n-- Search Self-Retrieval --`);
    console.log(`  Top-3 retrieval: ${s.retrieved}/${s.total} (${s.retrievalRate}%)`);
    if (s.failures.length > 0) {
      console.log(`  Missed (${s.failures.length}):`);
      for (const f of s.failures.slice(0, 5)) {
        console.log(`    - [${f.type}] "${f.query}" -> ${f.rank}`);
      }
      if (s.failures.length > 5) console.log(`    ... +${s.failures.length - 5} more`);
    }
  }

  console.log(`\n${'='.repeat(60)}\n`);
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

  console.log(`\nEval Pipeline - ${runLabel}`);
  console.log(`Source project: ${sourceProjectId}`);
  console.log(`Sample size:    ${explicitJobIds ? explicitJobIds.length + ' (explicit)' : sampleSize}`);
  console.log('');

  let candidates;
  if (explicitJobIds) {
    console.log(`Using ${explicitJobIds.length} explicit job IDs`);
    const data = await adminFetch('GET', `/projects/${sourceProjectId}/queues?processStatus=pending`);
    const allJobs = data.process?.jobs || [];
    candidates = allJobs.filter(j => explicitJobIds.includes(j.id));
  } else {
    candidates = await selectCandidates(sourceProjectId, sampleSize);
  }

  console.log(`\nSelected ${candidates.length} candidates\n`);

  console.log('Creating test project...');
  const testProject = await createTestProject();
  console.log(`  Created: ${testProject.name} (${testProject.id})\n`);

  console.log(`Processing ${candidates.length} documents...\n`);
  const processResults = await processDocs(sourceProjectId, testProject.id, candidates);
  console.log(`\nProcessing complete: ${processResults.results.length} OK, ${processResults.errors.length} errors`);

  if (processResults.results.length === 0) {
    console.error('No documents were processed successfully. Aborting eval.');
    process.exit(1);
  }

  let searchResults = null;
  if (!skipSearch) {
    const allChunks = await loadTestChunks(testProject.id);
    console.log(`\nLoaded ${allChunks.length} chunks for evaluation`);
    searchResults = await runSearchPhase(testProject.id, allChunks);
  }

  const elapsedMs = Date.now() - pipelineStart;
  const report = buildReport(processResults, searchResults, testProject.id, elapsedMs);
  printReport(report);
  saveResults(report);

  if (keepProject) {
    console.log(`Test project retained: ${testProject.id}`);
  }
}

main().catch(err => {
  console.error('Pipeline failed:', err);
  process.exit(1);
});
