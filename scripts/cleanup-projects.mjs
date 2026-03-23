#!/usr/bin/env node

/**
 * Delete all projects and their data (DynamoDB + S3 vectors).
 *
 * Usage:
 *   node scripts/cleanup-projects.mjs [--dry-run]
 *
 * Env vars:
 *   ADMIN_URL  - Admin API endpoint (defaults to deployed Lambda)
 */

const ADMIN_URL = process.env.ADMIN_URL || 'https://e475uomcg47vt3ysoccqcyfyce0ihaxr.lambda-url.us-east-1.on.aws';
const dryRun = process.argv.includes('--dry-run');

async function adminFetch(method, path, body = null, retries = 3) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const url = `${ADMIN_URL.replace(/\/+$/, '')}${path}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, opts);
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Admin API error (HTTP ${res.status}): ${text.slice(0, 300)}`);
    }
    if (!res.ok) {
      const isThrottle = text.includes('Throughput exceeds') || text.includes('ProvisionedThroughputExceeded');
      if (isThrottle && attempt < retries) {
        const delay = 3000 * (attempt + 1);
        console.warn(`  Throttled, retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw new Error(json.error || text.slice(0, 200) || res.statusText);
    }
    return json;
  }
}

async function main() {
  const { projects } = await adminFetch('GET', '/projects');
  if (!projects?.length) {
    console.log('No projects to clean up.');
    return;
  }

  console.log(`Found ${projects.length} project(s):`);
  for (const p of projects) {
    console.log(`  - ${p.name} (${p.id})`);
  }

  if (dryRun) {
    console.log('\n[--dry-run] Would delete all projects. Run without --dry-run to execute.');
    return;
  }

  console.log('\nDeleting...');
  for (const p of projects) {
    const result = await adminFetch('DELETE', `/projects/${p.id}`);
    console.log(`  Deleted ${p.name}: db=${JSON.stringify(result.deleted?.db)}, vectors=${result.deleted?.vectors ?? 'N/A'}`);
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
