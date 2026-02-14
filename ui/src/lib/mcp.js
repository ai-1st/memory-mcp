const STORAGE_KEY = 'memory-mcp-endpoint';
const DEFAULT_ENDPOINT = 'https://u5atpeuk5f4aabdba6bvcp4jfm0bpepd.lambda-url.us-east-1.on.aws/';

let rpcId = 0;

export function getEndpoint() {
  return localStorage.getItem(STORAGE_KEY) || DEFAULT_ENDPOINT;
}

export function setEndpoint(url) {
  localStorage.setItem(STORAGE_KEY, url);
}

export async function rpc(method, params = {}) {
  const endpoint = getEndpoint();
  if (!endpoint) throw new Error('No endpoint configured.');
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'RPC error');
  return json.result;
}

export async function callTool(name, args = {}, config = {}) {
  const params = { name, arguments: args };
  if (Object.keys(config).length > 0) params.config = config;
  const result = await rpc('tools/call', params);
  if (result.isError) {
    const msg = result.content?.[0]?.text || 'Tool error';
    throw new Error(msg);
  }
  const text = result.content?.[0]?.text;
  return text ? JSON.parse(text) : result;
}
