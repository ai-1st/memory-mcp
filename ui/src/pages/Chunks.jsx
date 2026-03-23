import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import Markdown from '../components/Markdown';

const PAGE_SIZE = 100;

export default function Chunks() {
  const { projectId, setLoading, showToast } = useApp();
  const [chunks, setChunks] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [lastSK, setLastSK] = useState(null);
  const [loading, setLocalLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    if (projectId) loadInitial();
  }, [projectId]);

  async function loadInitial() {
    setLocalLoading(true);
    setLoading(true);
    try {
      const data = await api.listChunks(projectId, { limit: PAGE_SIZE });
      setChunks(data.chunks || []);
      setHasMore(data.hasMore ?? false);
      setLastSK(data.lastSK ?? null);
    } catch (err) {
      showToast(err.message);
    } finally {
      setLocalLoading(false);
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!lastSK) return;
    setLoadingMore(true);
    try {
      const data = await api.listChunks(projectId, { limit: PAGE_SIZE, after: lastSK });
      setChunks(prev => [...prev, ...(data.chunks || [])]);
      setHasMore(data.hasMore ?? false);
      setLastSK(data.lastSK ?? null);
    } catch (err) {
      showToast(err.message);
    } finally {
      setLoadingMore(false);
    }
  }

  function toggleExpand(id) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  }

  if (!projectId) {
    return (
      <section className="view-section">
        <header className="view-header"><h1>Chunks</h1></header>
        <div className="empty-state"><p>Select a project first.</p></div>
      </section>
    );
  }

  return (
    <section className="view-section">
      <header className="view-header">
        <h1>Chunks</h1>
        <span className="chunk-count">{chunks.length} loaded{hasMore ? '+' : ''}</span>
      </header>

      {loading && chunks.length === 0 ? (
        <div className="empty-state"><p>Loading...</p></div>
      ) : chunks.length === 0 ? (
        <div className="empty-state"><p>No chunks yet. Add a document to generate chunks.</p></div>
      ) : (
        <div className="chunk-results">
          {chunks.map(c => (
            <div key={c.id} className="chunk-card" onClick={() => toggleExpand(c.id)}>
              <div className="chunk-card-header">
                <span className={`chunk-type-badge chunk-type-${c.type}`}>{c.type}</span>
                {c.docId && (
                  <Link
                    to={`/document/${c.docId}`}
                    className="chunk-doc-link"
                    onClick={e => e.stopPropagation()}
                  >
                    {c.docId.slice(0, 10)}
                  </Link>
                )}
                <span className="chunk-id">{c.id.slice(0, 10)}</span>
              </div>
              <div className="chunk-card-body">
                {expanded[c.id] ? (
                  <Markdown text={c.content} />
                ) : (
                  <p className="chunk-preview">
                    {c.content.slice(0, 200)}{c.content.length > 200 ? '...' : ''}
                  </p>
                )}
              </div>
            </div>
          ))}
          {hasMore && (
            <button className="btn-load-more" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? <><span className="queue-spinner" /> Loading...</> : `Load next ${PAGE_SIZE}`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
