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
  getProject: (projectId) => request('GET', `/projects/${projectId}`),
  createProject: (data) => request('POST', '/projects', data),
  updateProject: (projectId, data) => request('PUT', `/projects/${projectId}`, data),
  deleteProject: (projectId) => request('DELETE', `/projects/${projectId}`),
  search: (projectId, query, limit = 100) =>
    request('GET', `/projects/${projectId}/search?q=${encodeURIComponent(query)}&limit=${limit}`),
  listDocuments: (projectId, { limit, after } = {}) => {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    if (after) params.set('after', after);
    const qs = params.toString();
    return request('GET', `/projects/${projectId}/documents${qs ? '?' + qs : ''}`);
  },
  getDocument: (projectId, docId) => request('GET', `/projects/${projectId}/documents/${docId}`),
  addDocument: (projectId, data) => request('POST', `/projects/${projectId}/documents`, data),
  reprocessDocument: (projectId, docId) => request('POST', `/projects/${projectId}/documents/${docId}/reprocess`),
  listChunks: (projectId, { docId, limit, after } = {}) => {
    const params = new URLSearchParams();
    if (docId) params.set('docId', docId);
    if (limit) params.set('limit', String(limit));
    if (after) params.set('after', after);
    const qs = params.toString();
    return request('GET', `/projects/${projectId}/chunks${qs ? '?' + qs : ''}`);
  },
  enqueueScrape: (projectId, data) => request('POST', `/projects/${projectId}/scrape`, data),
  queueStatus: (projectId, { processStatus, scrapeStatus, limit, after } = {}) => {
    const params = new URLSearchParams();
    if (processStatus) params.set('processStatus', processStatus);
    if (scrapeStatus) params.set('scrapeStatus', scrapeStatus);
    if (limit) params.set('limit', String(limit));
    if (after) params.set('after', after);
    const qs = params.toString();
    return request('GET', `/projects/${projectId}/queues${qs ? '?' + qs : ''}`);
  },
  queueControl: (projectId, data) => request('POST', `/projects/${projectId}/queues/control`, data),
  queueRequeue: (projectId, data) => request('POST', `/projects/${projectId}/queues/requeue`, data),
  rerunScrape: (projectId, jobId) => request('POST', `/projects/${projectId}/scrape/${jobId}/rerun`),
};
