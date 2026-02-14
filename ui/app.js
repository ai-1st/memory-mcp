// ── MCP Client ──

const STORAGE_KEY = 'memory-mcp-endpoint';
const PROJECT_ID_KEY = 'memory-mcp-project-id';
const PROJECT_NAME_KEY = 'memory-mcp-project-name';

let endpoint = localStorage.getItem(STORAGE_KEY) || 'https://u5atpeuk5f4aabdba6bvcp4jfm0bpepd.lambda-url.us-east-1.on.aws/';
let currentProjectId = localStorage.getItem(PROJECT_ID_KEY) || '';
let currentProjectName = localStorage.getItem(PROJECT_NAME_KEY) || '';
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

async function callTool(name, args = {}, config = {}) {
  const params = { name, arguments: args };
  if (Object.keys(config).length > 0) {
    params.config = config;
  }
  const result = await rpc('tools/call', params);
  if (result.isError) {
    const msg = result.content?.[0]?.text || 'Tool error';
    throw new Error(msg);
  }
  const text = result.content?.[0]?.text;
  return text ? JSON.parse(text) : result;
}

/** Helper: returns config with current projectId */
function projectConfig() {
  return { projectId: currentProjectId };
}

// ── State ──

let currentView = 'categories';

// ── DOM Refs ──

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const views = {
  categories: $('#view-categories'),
  topics: $('#view-topics'),
  search: $('#view-search'),
  add: $('#view-add'),
  document: $('#view-document'),
  projects: $('#view-projects'),
};

// ── Navigation (History API) ──

function showView(name, { push = true, context = {} } = {}) {
  currentView = name;

  Object.values(views).forEach(v => v.classList.remove('active'));
  views[name]?.classList.add('active');

  $$('.nav-item').forEach(a => {
    a.classList.toggle('active', a.dataset.view === name);
  });

  if (push) {
    history.pushState({ view: name, ...context }, '', `#${name}${context.id ? '/' + context.id : ''}`);
  }
}

function goBack() {
  history.back();
}

// Restore view on browser back/forward
window.addEventListener('popstate', (e) => {
  const state = e.state;
  if (!state) {
    showView('categories', { push: false });
    loadCategories();
    return;
  }
  showView(state.view, { push: false });
  switch (state.view) {
    case 'categories': loadCategories(); break;
    case 'topics': if (state.category) loadTopics(state.category, false); break;
    case 'document': if (state.docId) loadDocument(state.docId, false); break;
    case 'projects': loadProjectsList(); break;
    case 'search': break; // keep existing results on screen
    case 'add': break;
  }
});

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

// ── Project Switcher ──

function setProject(id, name) {
  currentProjectId = id;
  currentProjectName = name;
  localStorage.setItem(PROJECT_ID_KEY, id);
  localStorage.setItem(PROJECT_NAME_KEY, name);

  // Update select if it exists
  const sel = $('#project-select');
  if (sel) sel.value = id;
}

async function loadProjects() {
  try {
    const data = await callTool('list_projects');
    const projects = data.projects || [];
    const sel = $('#project-select');

    if (projects.length === 0) {
      sel.innerHTML = '<option value="">No projects</option>';
      currentProjectId = '';
      currentProjectName = '';
      localStorage.removeItem(PROJECT_ID_KEY);
      localStorage.removeItem(PROJECT_NAME_KEY);
      return projects;
    }

    sel.innerHTML = projects.map(p =>
      `<option value="${esc(p.id)}">${esc(p.name)}</option>`
    ).join('');

    // Restore saved project or pick first
    const saved = localStorage.getItem(PROJECT_ID_KEY);
    const match = projects.find(p => p.id === saved);
    if (match) {
      setProject(match.id, match.name);
    } else {
      setProject(projects[0].id, projects[0].name);
    }

    return projects;
  } catch (err) {
    toast(err.message);
    return [];
  }
}

// ── Projects View ──

async function loadProjectsList() {
  setLoading(true);
  try {
    const data = await callTool('list_projects');
    const projects = data.projects || [];
    const list = $('#projects-list');
    const empty = $('#projects-empty');

    if (projects.length === 0) {
      list.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }

    empty.classList.add('hidden');
    list.innerHTML = projects.map(p => `
      <div class="project-row${p.id === currentProjectId ? ' selected' : ''}" data-id="${esc(p.id)}" data-name="${esc(p.name)}">
        <span class="project-row-name">${esc(p.name)}</span>
        ${p.id === currentProjectId ? '<span class="project-row-active">Active</span>' : ''}
        <span class="project-row-id">${esc(p.id.slice(0, 8))}...</span>
        <span class="project-row-date">${p.createdAt ? new Date(p.createdAt).toLocaleDateString() : ''}</span>
      </div>
    `).join('');

    list.querySelectorAll('.project-row').forEach(row => {
      row.addEventListener('click', () => {
        setProject(row.dataset.id, row.dataset.name);
        toast(`Switched to "${row.dataset.name}"`, 'success');
        loadProjectsList(); // re-render to show active state
        loadCategories();
      });
    });
  } catch (err) {
    toast(err.message);
  } finally {
    setLoading(false);
  }
}

async function createProject() {
  const input = $('#new-project-name');
  const name = input.value.trim();
  if (!name) return;

  setLoading(true);
  try {
    const data = await callTool('create_project', { name });
    input.value = '';

    // Switch to the new project
    setProject(data.id, data.name);

    // Refresh the dropdown
    await loadProjects();

    toast(`Project "${name}" created`, 'success');
    loadProjectsList();
  } catch (err) {
    toast(err.message);
  } finally {
    setLoading(false);
  }
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
  if (!currentProjectId) return;
  setLoading(true);
  try {
    const data = await callTool('list_categories', {}, projectConfig());
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

async function loadTopics(category, push = true) {
  showView('topics', { push, context: { category } });
  $('#topics-title').textContent = category;
  setLoading(true);

  try {
    const data = await callTool('list_topics', { category }, projectConfig());
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
    const data = await callTool('semantic_search', { query, limit: 10 }, projectConfig());
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
    const data = await callTool('add_doc', { url, contents }, projectConfig());

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

async function loadDocument(docId, push = true) {
  showView('document', { push, context: { docId } });
  setLoading(true);

  try {
    const doc = await callTool('get_document', { id: docId }, projectConfig());
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
      loadProjects().then(() => loadCategories());
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

async function init() {
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
  $('#topics-back').addEventListener('click', () => goBack());
  $('#doc-back').addEventListener('click', () => goBack());

  // Search
  $('#search-btn').addEventListener('click', doSearch);
  $('#search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });

  // Add document
  $('#add-form').addEventListener('submit', addDocument);

  // Project switcher
  $('#project-select').addEventListener('change', (e) => {
    const opt = e.target.selectedOptions[0];
    if (opt && opt.value) {
      setProject(opt.value, opt.textContent);
      showView('categories');
      loadCategories();
    }
  });

  // Manage projects button
  $('#manage-projects-btn').addEventListener('click', () => {
    showView('projects');
    loadProjectsList();
  });

  // Create project
  $('#create-project-btn').addEventListener('click', createProject);
  $('#new-project-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') createProject();
  });

  // Set initial history state
  history.replaceState({ view: 'categories' }, '', '#categories');

  // Initial load
  if (endpoint) {
    const projects = await loadProjects();
    if (projects.length > 0) {
      loadCategories();
    } else {
      // No projects — show projects view to prompt creation
      showView('projects');
      loadProjectsList();
    }
  } else {
    $('#endpoint-form').classList.remove('hidden');
  }
}

init();
