import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../lib/store';

export default function Projects() {
  const { projectId, setProject, setLoading, showToast } = useApp();
  const [projects, setProjects] = useState([]);
  const [newName, setNewName] = useState('');
  const [editingProject, setEditingProject] = useState(null);
  const [editPrompt, setEditPrompt] = useState('');
  const [defaultPrompt, setDefaultPrompt] = useState('');

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

  async function handleRemove(e, p) {
    e.stopPropagation();
    if (!confirm(`Delete "${p.name}" and all its data? This cannot be undone.`)) return;

    setLoading(true);
    try {
      await api.deleteProject(p.id);
      if (p.id === projectId) setProject(null, null);
      showToast(`Project "${p.name}" deleted`, 'success');
      await loadList();
    } catch (err) {
      showToast(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleEditPrompts(e, p) {
    e.stopPropagation();
    setLoading(true);
    try {
      const data = await api.getProject(p.id);
      setEditingProject(data);
      setEditPrompt(data.prompts?.chunking || '');
      setDefaultPrompt(data.defaultPrompts?.chunking || '');
    } catch (err) {
      showToast(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSavePrompt() {
    if (!editingProject) return;
    setLoading(true);
    try {
      const prompts = { chunking: editPrompt.trim() || undefined };
      await api.updateProject(editingProject.id, { prompts });
      showToast('Prompt saved', 'success');
      setEditingProject(null);
      await loadList();
    } catch (err) {
      showToast(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleResetPrompt() {
    setEditPrompt('');
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

      {editingProject && (
        <div className="prompt-editor">
          <h2>Chunking Prompt &mdash; {editingProject.name}</h2>
          <p className="prompt-hint">
            Leave empty to use the default prompt. Custom prompts control how documents
            are broken into chunks for retrieval.
          </p>
          <textarea
            className="prompt-textarea"
            value={editPrompt}
            onChange={e => setEditPrompt(e.target.value)}
            placeholder={defaultPrompt}
            rows={12}
          />
          <div className="prompt-actions">
            <button className="btn-primary" onClick={handleSavePrompt}>Save</button>
            <button className="btn-sm" onClick={handleResetPrompt}>Reset to Default</button>
            <button className="btn-sm" onClick={() => setEditingProject(null)}>Cancel</button>
          </div>
        </div>
      )}

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
                  {p.prompts?.chunking && <span className="project-row-badge">Custom Prompt</span>}
                  <span className="project-row-date">
                    {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : ''}
                  </span>
                </div>
                <span className="project-row-ulid">{p.id}</span>
              </div>
              <div className="project-row-actions">
                <button
                  className="btn-sm"
                  title="Edit chunking prompt"
                  onClick={e => handleEditPrompts(e, p)}
                >
                  Prompts
                </button>
                <button
                  className="btn-sm btn-red"
                  title="Delete project and all data"
                  onClick={e => handleRemove(e, p)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
