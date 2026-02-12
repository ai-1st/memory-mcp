// ── MCP Client ──

const STORAGE_KEY = 'memory-mcp-endpoint';
let endpoint = localStorage.getItem(STORAGE_KEY) || 'https://u5atpeuk5f4aabdba6bvcp4jfm0bpepd.lambda-url.us-east-1.on.aws/';
let rpcId = 0;

async function rpc(method, params = {}) {
  if (!endpoint) throw new Error('No endpoint configured. Click "Endpoint" in the sidebar.');
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'RPC error');
  return json.result;
}

async function callTool(name, args = {}) {
  const result = await rpc('tools/call', { name, arguments: args });
  if (result.isError) {
    const msg = result.content?.[0]?.text || 'Tool error';
    throw new Error(msg);
  }
  const text = result.content?.[0]?.text;
  return text ? JSON.parse(text) : result;
}

// ── State ──

let currentView = 'categories';
let navHistory = [];

// ── DOM Refs ──

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const views = {
  categories: $('#view-categories'),
  topics: $('#view-topics'),
  search: $('#view-search'),
  add: $('#view-add'),
  document: $('#view-document'),
};

// ── Navigation ──

function showView(name, pushHistory = true) {
  if (pushHistory && currentView !== name) {
    navHistory.push(currentView);
  }
  currentView = name;

  Object.values(views).forEach(v => v.classList.remove('active'));
  views[name]?.classList.add('active');

  // Update nav active state
  $$('.nav-item').forEach(a => {
    a.classList.toggle('active', a.dataset.view === name);
  });
}

function goBack() {
  const prev = navHistory.pop();
  if (prev) showView(prev, false);
}

// ── Loading & Toast ──

function setLoading(on) {
  $('#loading').classList.toggle('hidden', !on);
}

function toast(message, type = 'error') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast ${type}`;
  requestAnimationFrame(() => el.classList.add('visible'));
  setTimeout(() => {
    el.classList.remove('visible');
    setTimeout(() => el.classList.add('hidden'), 300);
  }, 3500);
}

// ── Categories View ──

function buildCategoryTree(categories) {
  const root = { children: {}, count: 0 };
  for (const { category, topicCount } of categories) {
    const parts = category.split('/');
    let node = root;
    for (const part of parts) {
      if (!node.children[part]) {
        node.children[part] = { children: {}, count: 0, fullPath: '' };
      }
      node = node.children[part];
      node.count += topicCount;
    }
    node.fullPath = category;
    node.leafCount = topicCount;
  }
  return root;
}

function renderTree(node, depth = 0) {
  const entries = Object.entries(node.children).sort((a, b) => b[1].count - a[1].count);
  return entries.map(([name, child]) => {
    const hasChildren = Object.keys(child.children).length > 0;
    const isLeaf = child.fullPath && child.leafCount != null;
    const clickPath = child.fullPath || '';
    const childHtml = hasChildren ? renderTree(child, depth + 1) : '';

    return `
      <div class="tree-node" data-depth="${depth}">
        <div class="tree-row${isLeaf ? ' tree-leaf' : ''}" ${isLeaf ? `data-category="${esc(clickPath)}"` : ''}>
          ${hasChildren ? `<span class="tree-toggle open">&#9662;</span>` : `<span class="tree-toggle-spacer"></span>`}
          <span class="tree-label">${esc(name)}</span>
          <span class="tree-count">${child.count}</span>
        </div>
        ${hasChildren ? `<div class="tree-children">${childHtml}</div>` : ''}
      </div>
    `;
  }).join('');
}

async function loadCategories() {
  setLoading(true);
  try {
    const data = await callTool('list_categories');
    const list = $('#categories-list');
    const empty = $('#categories-empty');

    if (!data.categories || data.categories.length === 0) {
      list.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }

    empty.classList.add('hidden');
    const tree = buildCategoryTree(data.categories);
    list.innerHTML = `<div class="category-tree">${renderTree(tree)}</div>`;

    // Toggle expand/collapse
    list.querySelectorAll('.tree-toggle').forEach(toggle => {
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const node = toggle.closest('.tree-node');
        const children = node.querySelector('.tree-children');
        if (children) {
          children.classList.toggle('collapsed');
          toggle.classList.toggle('open');
        }
      });
    });

    // Click leaf to load topics
    list.querySelectorAll('.tree-leaf').forEach(row => {
      row.addEventListener('click', () => loadTopics(row.dataset.category));
    });
  } catch (err) {
    toast(err.message);
  } finally {
    setLoading(false);
  }
}

// ── Topics View ──

async function loadTopics(category) {
  showView('topics');
  $('#topics-title').textContent = category;
  setLoading(true);

  try {
    const data = await callTool('list_topics', { category });
    renderTopicList($('#topics-list'), data.topics || []);
  } catch (err) {
    toast(err.message);
  } finally {
    setLoading(false);
  }
}

function renderTopicList(container, topics, showScore = false) {
  if (topics.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No topics found.</p></div>';
    return;
  }

  container.innerHTML = topics.map(t => `
    <div class="topic-card">
      <div class="topic-header">
        <span class="topic-category">${esc(t.category)}</span>
        ${showScore && t.score != null ? `<span class="topic-score">${t.score.toFixed(3)}</span>` : ''}
      </div>
      <div class="topic-summary">${esc(t.summary)}</div>
      <div class="topic-meta">
        <span class="topic-id">${esc(t.id)}</span>
        ${(t.doc_ids || []).map(did =>
          `<a class="doc-link" data-doc-id="${esc(did)}">doc:${esc(did.slice(0, 8))}...</a>`
        ).join('')}
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.doc-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      loadDocument(link.dataset.docId);
    });
  });
}

// ── Search View ──

async function doSearch() {
  const query = $('#search-input').value.trim();
  if (!query) return;

  setLoading(true);
  $('#search-empty').classList.add('hidden');

  try {
    const data = await callTool('semantic_search', { query, limit: 10 });
    if (!data.results || data.results.length === 0) {
      $('#search-results').innerHTML = '';
      $('#search-empty').classList.remove('hidden');
      $('#search-empty').querySelector('p').textContent = 'No results found.';
    } else {
      renderTopicList($('#search-results'), data.results, true);
    }
  } catch (err) {
    toast(err.message);
  } finally {
    setLoading(false);
  }
}

// ── Add Document View ──

async function addDocument(e) {
  e.preventDefault();
  const url = $('#add-url').value.trim();
  const contents = $('#add-contents').value.trim();
  if (!url || !contents) return;

  const btn = $('#add-submit');
  btn.disabled = true;
  btn.querySelector('.btn-label').classList.add('hidden');
  btn.querySelector('.btn-loading').classList.remove('hidden');
  $('#add-result').classList.add('hidden');

  try {
    const data = await callTool('add_doc', { url, contents });

    // Show result
    const resultEl = $('#add-result');
    resultEl.classList.remove('hidden');
    resultEl.innerHTML = `
      <div class="add-result-header">
        &#10003; ${data.topicsProcessed} topic${data.topicsProcessed !== 1 ? 's' : ''} extracted
      </div>
      <div class="topic-meta" style="margin-bottom: 12px;">
        <span>Document ID: <span class="topic-id">${esc(data.docId)}</span></span>
      </div>
      <div class="topic-list" id="add-result-topics"></div>
    `;

    renderTopicList($('#add-result-topics'), data.topics.map(t => ({
      ...t,
      id: t.topicId,
      doc_ids: [],
    })));

    // Clear form
    $('#add-url').value = '';
    $('#add-contents').value = '';

    toast('Document added successfully', 'success');
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.querySelector('.btn-label').classList.remove('hidden');
    btn.querySelector('.btn-loading').classList.add('hidden');
  }
}

// ── Document View ──

async function loadDocument(docId) {
  showView('document');
  setLoading(true);

  try {
    const doc = await callTool('get_document', { id: docId });
    $('#doc-detail').innerHTML = `
      <div class="doc-url"><a href="${esc(doc.url)}" target="_blank">${esc(doc.url)}</a></div>
      <div class="doc-date">${doc.createdAt ? new Date(doc.createdAt).toLocaleString() : ''}</div>
      <div class="doc-contents">${esc(doc.contents)}</div>
    `;
  } catch (err) {
    toast(err.message);
    $('#doc-detail').innerHTML = `<div class="empty-state"><p>Document not found.</p></div>`;
  } finally {
    setLoading(false);
  }
}

// ── Endpoint Config ──

function initEndpoint() {
  const input = $('#endpoint-input');
  input.value = endpoint;

  $('#settings-btn').addEventListener('click', () => {
    $('#endpoint-form').classList.toggle('hidden');
    input.focus();
  });

  $('#endpoint-save').addEventListener('click', () => {
    const val = input.value.trim();
    if (val) {
      endpoint = val;
      localStorage.setItem(STORAGE_KEY, val);
      $('#endpoint-form').classList.add('hidden');
      toast('Endpoint saved', 'success');
      loadCategories();
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#endpoint-save').click();
  });
}

// ── Escaping ──

function esc(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Event Bindings ──

function init() {
  initEndpoint();

  // Nav links
  $$('.nav-item').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const view = a.dataset.view;
      showView(view);
      if (view === 'categories') loadCategories();
    });
  });

  // Back buttons
  $('#topics-back').addEventListener('click', () => {
    goBack();
    loadCategories();
  });
  $('#doc-back').addEventListener('click', () => goBack());

  // Search
  $('#search-btn').addEventListener('click', doSearch);
  $('#search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });

  // Add document
  $('#add-form').addEventListener('submit', addDocument);

  // Initial load
  if (endpoint) {
    loadCategories();
  } else {
    // Show endpoint form if not configured
    $('#endpoint-form').classList.remove('hidden');
  }
}

init();
