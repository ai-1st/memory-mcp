import * as projectRoutes from './routes/projects.js';
import * as documentRoutes from './routes/documents.js';
import * as chunkRoutes from './routes/chunks.js';
import * as searchRoutes from './routes/search.js';
import * as bm25SearchRoutes from './routes/bm25Search.js';
import * as scrapeRoutes from './routes/scrape.js';
import * as queueRoutes from './routes/queues.js';

const routes = [
  { method: 'GET',    pattern: /^\/projects$/,                                          handler: projectRoutes.list },
  { method: 'GET',    pattern: /^\/projects\/([^/]+)$/,                                 handler: projectRoutes.get },
  { method: 'POST',   pattern: /^\/projects$/,                                          handler: projectRoutes.create },
  { method: 'PUT',    pattern: /^\/projects\/([^/]+)$/,                                 handler: projectRoutes.update },
  { method: 'DELETE', pattern: /^\/projects\/([^/]+)$/,                                 handler: projectRoutes.remove },
  { method: 'GET',    pattern: /^\/projects\/([^/]+)\/documents$/,                      handler: documentRoutes.list },
  { method: 'GET',    pattern: /^\/projects\/([^/]+)\/documents\/([^/]+)$/,             handler: documentRoutes.get },
  { method: 'POST',   pattern: /^\/projects\/([^/]+)\/documents$/,                      handler: documentRoutes.create },
  { method: 'POST',   pattern: /^\/projects\/([^/]+)\/documents\/([^/]+)\/reprocess$/,  handler: documentRoutes.reprocess },
  { method: 'GET',    pattern: /^\/projects\/([^/]+)\/chunks$/,                         handler: chunkRoutes.list },
  { method: 'GET',    pattern: /^\/projects\/([^/]+)\/search$/,                         handler: searchRoutes.search },
  { method: 'GET',    pattern: /^\/projects\/([^/]+)\/bm25$/,                           handler: bm25SearchRoutes.bm25Search },
  { method: 'GET',    pattern: /^\/projects\/([^/]+)\/bm25\/stats$/,                    handler: bm25SearchRoutes.stats },
  { method: 'POST',   pattern: /^\/projects\/([^/]+)\/bm25\/reindex$/,                  handler: bm25SearchRoutes.reindex },
  { method: 'POST',   pattern: /^\/projects\/([^/]+)\/scrape$/,                         handler: scrapeRoutes.enqueue },
  { method: 'POST',   pattern: /^\/projects\/([^/]+)\/scrape\/([^/]+)\/rerun$/,        handler: scrapeRoutes.rerun },
  { method: 'GET',    pattern: /^\/projects\/([^/]+)\/queues$/,                         handler: queueRoutes.status },
  { method: 'POST',   pattern: /^\/projects\/([^/]+)\/queues\/control$/,                handler: queueRoutes.control },
  { method: 'POST',   pattern: /^\/projects\/([^/]+)\/queues\/requeue$/,               handler: queueRoutes.requeue },
];

export async function route(method, path, body, query) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const match = path.match(r.pattern);
    if (match) {
      const params = match.slice(1).map(decodeURIComponent);
      return r.handler({ params, body, query });
    }
  }
  return { statusCode: 404, body: { error: `Not found: ${method} ${path}` } };
}
