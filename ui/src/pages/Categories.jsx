import { useEffect, useState } from 'react';
import { callTool } from '../lib/mcp';
import { useApp } from '../lib/store';
import CategoryTree from '../components/CategoryTree';

export default function Categories() {
  const { projectId, setLoading, showToast } = useApp();
  const [categories, setCategories] = useState(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const data = await callTool('list_categories', {}, { projectId });
        if (!cancelled) setCategories(data.categories || []);
      } catch (err) {
        if (!cancelled) showToast(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [projectId]);

  return (
    <section className="view-section">
      <header className="view-header">
        <h1>Categories</h1>
      </header>
      {!projectId && (
        <div className="empty-state"><p>Select a project to get started.</p></div>
      )}
      {projectId && categories && categories.length === 0 && (
        <div className="empty-state"><p>No categories yet. Add a document to get started.</p></div>
      )}
      {categories && categories.length > 0 && (
        <CategoryTree categories={categories} />
      )}
    </section>
  );
}
