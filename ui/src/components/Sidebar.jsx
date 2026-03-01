import { useEffect, useState, useRef, useCallback } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { api, getAdminEndpoint, setAdminEndpoint as saveAdminEndpoint } from '../lib/api';
import { getEndpoint, setEndpoint as saveMcpEndpoint } from '../lib/mcp';
import { useApp } from '../lib/store';

export default function Sidebar() {
  const { projectId, projectName, setProject, showToast } = useApp();
  const [projects, setProjects] = useState([]);
  const [endpointOpen, setEndpointOpen] = useState(false);
  const [mcpVal, setMcpVal] = useState(getEndpoint());
  const [adminVal, setAdminVal] = useState(getAdminEndpoint());

  const [rebuild, setRebuild] = useState({ phase: 'idle' });
  const [siteUrl, setSiteUrl] = useState(null);
  const pollRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    loadProjects();
    api.siteInfo().then(info => setSiteUrl(info.siteUrl)).catch(() => {});
    return () => clearInterval(pollRef.current);
  }, []);

  async function loadProjects() {
    try {
      const data = await api.listProjects();
      const list = data.projects || [];
      setProjects(list);

      if (list.length === 0) {
        setProject('', '');
        navigate('/projects');
        return;
      }

      const saved = localStorage.getItem('memory-mcp-project-id');
      const match = list.find(p => p.id === saved);
      if (match) {
        setProject(match.id, match.name);
      } else {
        setProject(list[0].id, list[0].name);
      }
    } catch (err) {
      showToast(err.message);
    }
  }

  function handleProjectChange(e) {
    const id = e.target.value;
    const p = projects.find(pr => pr.id === id);
    if (p) {
      setProject(p.id, p.name);
      navigate('/categories');
    }
  }

  const pollStatus = useCallback((taskId) => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const s = await api.rebuildStatus(taskId);
        if (s.siteUrl) setSiteUrl(s.siteUrl);
        if (s.phase === 'succeeded') {
          clearInterval(pollRef.current);
          setRebuild({ phase: 'succeeded', taskId });
        } else if (s.phase === 'failed') {
          clearInterval(pollRef.current);
          setRebuild({ phase: 'failed', taskId, reason: s.reason });
        } else {
          setRebuild({ phase: 'running', taskId, lastStatus: s.lastStatus });
        }
      } catch {
        clearInterval(pollRef.current);
        setRebuild({ phase: 'failed', taskId, reason: 'Lost connection to task' });
      }
    }, 5000);
  }, []);

  async function handleRebuild() {
    setRebuild({ phase: 'starting' });
    try {
      const result = await api.rebuildSite();
      if (result.siteUrl) setSiteUrl(result.siteUrl);
      setRebuild({ phase: 'running', taskId: result.taskId, lastStatus: 'PROVISIONING' });
      pollStatus(result.taskId);
    } catch (err) {
      showToast(err.message);
      setRebuild({ phase: 'idle' });
    }
  }

  function handleEndpointSave() {
    const mcp = mcpVal.trim();
    const admin = adminVal.trim();
    if (mcp) saveMcpEndpoint(mcp);
    if (admin) saveAdminEndpoint(admin);
    setEndpointOpen(false);
    showToast('Endpoints saved', 'success');
    loadProjects();
  }

  const isBuilding = rebuild.phase === 'starting' || rebuild.phase === 'running';

  return (
    <aside className="sidebar">
      <div className="logo">
        <span className="logo-icon">&#9673;</span>
        <span className="logo-text">Memory</span>
      </div>

      <div className="project-switcher">
        <label className="project-label">Project</label>
        <select value={projectId} onChange={handleProjectChange} className="project-select">
          {projects.length === 0 && <option value="">No projects</option>}
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <button className="btn-xs" onClick={() => navigate('/projects')}>Manage</button>
      </div>

      <nav className="nav">
        <NavLink to="/categories" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <span className="nav-icon">&#9783;</span> Categories
        </NavLink>
        <NavLink to="/search" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <span className="nav-icon">&#8981;</span> Search
        </NavLink>
        <NavLink to="/add" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <span className="nav-icon">&#43;</span> Add Document
        </NavLink>
        <NavLink to="/scrape" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <span className="nav-icon">&#8631;</span> Scrape Queue
        </NavLink>
        <NavLink to="/process" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <span className="nav-icon">&#9881;</span> Process Queue
        </NavLink>
      </nav>

      <div className="sidebar-footer">
        <div className="rebuild-section">
          <button
            className="btn-rebuild"
            onClick={handleRebuild}
            disabled={isBuilding}
          >
            {isBuilding ? 'Rebuilding\u2026' : 'Rebuild Site'}
          </button>

          {rebuild.phase === 'running' && (
            <div className="rebuild-status rebuild-status--running">
              <span className="rebuild-spinner" />
              <span>{rebuild.lastStatus || 'Running'}</span>
            </div>
          )}
          {rebuild.phase === 'starting' && (
            <div className="rebuild-status rebuild-status--running">
              <span className="rebuild-spinner" />
              <span>Starting&hellip;</span>
            </div>
          )}
          {rebuild.phase === 'succeeded' && (
            <div className="rebuild-status rebuild-status--success">
              &#10003; Build complete
            </div>
          )}
          {rebuild.phase === 'failed' && (
            <div className="rebuild-status rebuild-status--error">
              &#10007; {rebuild.reason || 'Build failed'}
            </div>
          )}

          {siteUrl && projectId && (
            <a
              href={`${siteUrl.replace(/\/+$/, '')}/${projectId.toLowerCase()}/`}
              target="_blank"
              rel="noopener noreferrer"
              className="site-link"
            >
              &#8599; Open published site
            </a>
          )}
        </div>

        <button className="btn-ghost" onClick={() => setEndpointOpen(v => !v)}>
          <span className="nav-icon">&#9881;</span> Endpoints
        </button>
        {endpointOpen && (
          <div className="endpoint-form">
            <label className="endpoint-label">MCP (agents)</label>
            <input
              type="url"
              value={mcpVal}
              onChange={e => setMcpVal(e.target.value)}
              placeholder="https://...lambda-url.../"
            />
            <label className="endpoint-label">Admin API (UI)</label>
            <input
              type="url"
              value={adminVal}
              onChange={e => setAdminVal(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleEndpointSave()}
              placeholder="https://...lambda-url.../"
              autoFocus
            />
            <button className="btn-sm" onClick={handleEndpointSave}>Save</button>
          </div>
        )}
      </div>
    </aside>
  );
}
