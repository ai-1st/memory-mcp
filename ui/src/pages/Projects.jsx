import { useEffect, useState } from 'react';
import { callTool } from '../lib/mcp';
import { useApp } from '../lib/store';

export default function Projects() {
  const { projectId, setProject, setLoading, showToast } = useApp();
  const [projects, setProjects] = useState([]);
  const [newName, setNewName] = useState('');

  useEffect(() => { loadList(); }, []);

  async function loadList() {
    setLoading(true);
    try {
      const data = await callTool('list_projects');
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
      const data = await callTool('create_project', { name });
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
              <span className="project-row-name">{p.name}</span>
              {p.id === projectId && <span className="project-row-active">Active</span>}
              <span className="project-row-id">{p.id.slice(0, 8)}...</span>
              <span className="project-row-date">
                {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
