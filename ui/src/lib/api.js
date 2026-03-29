const ADMIN_STORAGE_KEY = 'memory-mcp-admin-endpoint';
const MCP_STORAGE_KEY = 'memory-mcp-mcp-endpoint';
const DEFAULT_ADMIN_ENDPOINT = 'https://e475uomcg47vt3ysoccqcyfyce0ihaxr.lambda-url.us-east-1.on.aws';
const DEFAULT_MCP_ENDPOINT = 'https://u5atpeuk5f4aabdba6bvcp4jfm0bpepd.lambda-url.us-east-1.on.aws';

export function getAdminEndpoint() {
  return localStorage.getItem(ADMIN_STORAGE_KEY) || DEFAULT_ADMIN_ENDPOINT;
}

export function setAdminEndpoint(url) {
  localStorage.setItem(ADMIN_STORAGE_KEY, url);
}

export function getMcpEndpoint() {
  return localStorage.getItem(MCP_STORAGE_KEY) || DEFAULT_MCP_ENDPOINT;
}

export function setMcpEndpoint(url) {
  localStorage.setItem(MCP_STORAGE_KEY, url);
}

export function getMcpConfig(projectId, projectName) {
  const base = getMcpEndpoint().replace(/\/+$/, '');
  const slug = (projectName || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return {
    mcpServers: {
      [`memory-${slug}`]: {
        url: `${base}/?projectId=${projectId}`,
      },
    },
  };
}

const AUTH_STORAGE_KEY = 'memory-mcp-auth';

export function getAuthCredentials() {
  return localStorage.getItem(AUTH_STORAGE_KEY) || '';
}

export function setAuthCredentials(username, password) {
  const encoded = btoa(`${username}:${password}`);
  localStorage.setItem(AUTH_STORAGE_KEY, encoded);
}

export function clearAuthCredentials() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

let onUnauthorized = null;
export function setOnUnauthorized(callback) {
  onUnauthorized = callback;
}

async function request(method, path, body) {
  const base = getAdminEndpoint().replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json' };
  const auth = getAuthCredentials();
  if (auth) headers['Authorization'] = `Basic ${auth}`;

  const opts = { method, headers };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const res = await fetch(`${base}${path}`, opts);
  if (res.status === 401) {
    if (onUnauthorized) onUnauthorized();
    throw new Error('Unauthorized');
  }
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
  bm25Search: (projectId, query, limit = 10) =>
    request('GET', `/projects/${projectId}/bm25?q=${encodeURIComponent(query)}&limit=${limit}`),
  bm25Stats: (projectId) => request('GET', `/projects/${projectId}/bm25/stats`),
  bm25Reindex: (projectId) => request('POST', `/projects/${projectId}/bm25/reindex`),
};
