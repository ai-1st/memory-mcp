const ADMIN_STORAGE_KEY = 'memory-mcp-admin-endpoint';
const DEFAULT_ADMIN_ENDPOINT = 'https://e475uomcg47vt3ysoccqcyfyce0ihaxr.lambda-url.us-east-1.on.aws';

export function getAdminEndpoint() {
  return localStorage.getItem(ADMIN_STORAGE_KEY) || DEFAULT_ADMIN_ENDPOINT;
}

export function setAdminEndpoint(url) {
  localStorage.setItem(ADMIN_STORAGE_KEY, url);
}

async function request(method, path, body) {
  const base = getAdminEndpoint().replace(/\/+$/, '');
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const res = await fetch(`${base}${path}`, opts);
  if (!res.ok) {
    let msg;
    try {
      const json = await res.json();
      msg = json.error || res.statusText;
    } catch {
      msg = await res.text() || res.statusText;
    }
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  listProjects: () => request('GET', '/projects'),
  createProject: (data) => request('POST', '/projects', data),
  listCategories: (projectId) => request('GET', `/projects/${projectId}/categories`),
  listTopics: (projectId, category) =>
    request('GET', `/projects/${projectId}/topics?category=${encodeURIComponent(category)}`),
  search: (projectId, query, limit = 5) =>
    request('GET', `/projects/${projectId}/search?q=${encodeURIComponent(query)}&limit=${limit}`),
  listDocuments: (projectId) => request('GET', `/projects/${projectId}/documents`),
  getDocument: (projectId, docId) => request('GET', `/projects/${projectId}/documents/${docId}`),
  addDocument: (projectId, data) => request('POST', `/projects/${projectId}/documents`, data),
  enqueueScrape: (projectId, data) => request('POST', `/projects/${projectId}/scrape`, data),
  queueStatus: (projectId, { processStatus, scrapeStatus } = {}) => {
    const params = new URLSearchParams();
    if (processStatus) params.set('processStatus', processStatus);
    if (scrapeStatus) params.set('scrapeStatus', scrapeStatus);
    const qs = params.toString();
    return request('GET', `/projects/${projectId}/queues${qs ? '?' + qs : ''}`);
  },
  queueControl: (projectId, data) => request('POST', `/projects/${projectId}/queues/control`, data),
  rebuildSite: () => request('POST', '/site/rebuild'),
  rebuildStatus: (taskId) => request('GET', `/site/rebuild/${taskId}`),
  siteInfo: () => request('GET', '/site/info'),
};
