import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { getEndpoint } from '../lib/mcp';
import { useApp } from '../lib/store';

export default function Projects() {
  const { projectId, setProject, setLoading, showToast } = useApp();
  const [projects, setProjects] = useState([]);
  const [newName, setNewName] = useState('');

  useEffect(() => { loadList(); }, []);

  async function loadList() {
    setLoading(true);
    try {
      const data = await api.listProjects();
      setProjects(data.projects || []);
    } catch (err) {
      showToast(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;

    setLoading(true);
    try {
      const data = await api.createProject({ name });
      setProject(data.id, data.name);
      setNewName('');
      showToast(`Project "${name}" created`, 'success');
      await loadList();
    } catch (err) {
      showToast(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleSelect(p) {
    setProject(p.id, p.name);
    showToast(`Switched to "${p.name}"`, 'success');
  }

  function copyMcpConfig(e, p) {
    e.stopPropagation();
    const config = {
      mcpServers: {
        "memory-mcp": {
          url: getEndpoint(),
          config: { projectId: p.id },
        },
      },
    };
    navigator.clipboard.writeText(JSON.stringify(config, null, 2));
    showToast(`MCP config copied for "${p.name}"`, 'success');
  }

  return (
    <section className="view-section">
      <header className="view-header">
        <h1>Projects</h1>
      </header>

      <div className="create-project-form">
        <input
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleCreate()}
          placeholder="New project name..."
          autoComplete="off"
        />
        <button className="btn-primary" onClick={handleCreate}>Create</button>
      </div>

      {projects.length === 0 ? (
        <div className="empty-state"><p>No projects yet. Create one to get started.</p></div>
      ) : (
        <div className="projects-list">
          {projects.map(p => (
            <div
              key={p.id}
              className={`project-row${p.id === projectId ? ' selected' : ''}`}
              onClick={() => handleSelect(p)}
            >
              <div className="project-row-info">
                <div className="project-row-top">
                  <span className="project-row-name">{p.name}</span>
                  {p.id === projectId && <span className="project-row-active">Active</span>}
                  <span className="project-row-date">
                    {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : ''}
                  </span>
                </div>
                <span className="project-row-ulid">{p.id}</span>
              </div>
              <button
                className="btn-copy-config"
                title="Copy MCP config JSON"
                onClick={e => copyMcpConfig(e, p)}
              >
                Copy MCP Config
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
