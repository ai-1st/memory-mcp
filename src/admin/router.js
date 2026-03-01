import * as projectRoutes from './routes/projects.js';
import * as documentRoutes from './routes/documents.js';
import * as categoryRoutes from './routes/categories.js';
import * as searchRoutes from './routes/search.js';
import * as scrapeRoutes from './routes/scrape.js';
import * as queueRoutes from './routes/queues.js';
import * as siteRoutes from './routes/site.js';

const routes = [
  { method: 'GET',  pattern: /^\/projects$/,                                          handler: projectRoutes.list },
  { method: 'POST', pattern: /^\/projects$/,                                          handler: projectRoutes.create },
  { method: 'GET',  pattern: /^\/projects\/([^/]+)\/categories$/,                     handler: categoryRoutes.list },
  { method: 'GET',  pattern: /^\/projects\/([^/]+)\/topics$/,                         handler: categoryRoutes.listTopics },
  { method: 'GET',  pattern: /^\/projects\/([^/]+)\/search$/,                         handler: searchRoutes.search },
  { method: 'GET',  pattern: /^\/projects\/([^/]+)\/documents$/,                      handler: documentRoutes.list },
  { method: 'GET',  pattern: /^\/projects\/([^/]+)\/documents\/([^/]+)$/,             handler: documentRoutes.get },
  { method: 'POST', pattern: /^\/projects\/([^/]+)\/documents$/,                      handler: documentRoutes.create },
  { method: 'POST', pattern: /^\/projects\/([^/]+)\/scrape$/,                         handler: scrapeRoutes.enqueue },
  { method: 'GET',  pattern: /^\/projects\/([^/]+)\/queues$/,                         handler: queueRoutes.status },
  { method: 'POST', pattern: /^\/projects\/([^/]+)\/queues\/control$/,                handler: queueRoutes.control },
  { method: 'POST', pattern: /^\/site\/rebuild$/,                                     handler: siteRoutes.rebuild },
  { method: 'GET',  pattern: /^\/site\/rebuild\/([^/]+)$/,                             handler: siteRoutes.status },
  { method: 'GET',  pattern: /^\/site\/info$/,                                         handler: siteRoutes.info },
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
