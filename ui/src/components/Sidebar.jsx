import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { api, getAdminEndpoint, setAdminEndpoint as saveAdminEndpoint, getMcpEndpoint, setMcpEndpoint as saveMcpEndpoint } from '../lib/api';
import { useApp } from '../lib/store';

export default function Sidebar() {
  const { projectId, projectName, setProject, showToast } = useApp();
  const [projects, setProjects] = useState([]);
  const [endpointOpen, setEndpointOpen] = useState(false);
  const [adminVal, setAdminVal] = useState(getAdminEndpoint());
  const [mcpVal, setMcpVal] = useState(getMcpEndpoint());
  const navigate = useNavigate();

  useEffect(() => {
    loadProjects();
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
      navigate('/search');
    }
  }

  function handleEndpointSave() {
    const admin = adminVal.trim();
    const mcp = mcpVal.trim();
    if (admin) saveAdminEndpoint(admin);
    if (mcp) saveMcpEndpoint(mcp);
    setEndpointOpen(false);
    showToast('Endpoints saved', 'success');
    loadProjects();
  }

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
        <NavLink to="/search" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <span className="nav-icon">&#8981;</span> Search
        </NavLink>
        <NavLink to="/bm25" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <span className="nav-icon">&#8984;</span> BM25 Search
        </NavLink>
        <NavLink to="/documents" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <span className="nav-icon">&#9776;</span> Documents
        </NavLink>
        <NavLink to="/chunks" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <span className="nav-icon">&#9783;</span> Chunks
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
        <button className="btn-ghost" onClick={() => setEndpointOpen(v => !v)}>
          <span className="nav-icon">&#9881;</span> Endpoint
        </button>
        {endpointOpen && (
          <div className="endpoint-form">
            <label className="endpoint-label">Admin API</label>
            <input
              type="url"
              value={adminVal}
              onChange={e => setAdminVal(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleEndpointSave()}
              placeholder="https://...lambda-url.../"
              autoFocus
            />
            <label className="endpoint-label">MCP Server</label>
            <input
              type="url"
              value={mcpVal}
              onChange={e => setMcpVal(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleEndpointSave()}
              placeholder="https://...lambda-url.../"
            />
            <button className="btn-sm" onClick={handleEndpointSave}>Save</button>
          </div>
        )}
      </div>
    </aside>
  );
}
