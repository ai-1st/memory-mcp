import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import TopicList from '../components/TopicList';

export default function Topics() {
  const { category } = useParams();
  const decoded = decodeURIComponent(category);
  const navigate = useNavigate();
  const { projectId, setLoading, showToast } = useApp();
  const [topics, setTopics] = useState(null);

  useEffect(() => {
    if (!projectId || !decoded) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const data = await api.listTopics(projectId, decoded);
        if (!cancelled) setTopics(data.topics || []);
      } catch (err) {
        if (!cancelled) showToast(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [projectId, decoded]);

  return (
    <section className="view-section">
      <header className="view-header">
        <button className="btn-ghost" onClick={() => navigate(-1)}>&larr; Categories</button>
        <h1>{decoded}</h1>
      </header>
      {topics && <TopicList topics={topics} />}
    </section>
  );
}
