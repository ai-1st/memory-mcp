import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../lib/store';

const PAGE_SIZE = 100;

export default function Documents() {
  const { projectId, setLoading, showToast } = useApp();
  const [documents, setDocuments] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [lastSK, setLastSK] = useState(null);
  const [loading, setLocalLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (projectId) loadInitial();
  }, [projectId]);

  async function loadInitial() {
    setLocalLoading(true);
    setLoading(true);
    try {
      const data = await api.listDocuments(projectId, { limit: PAGE_SIZE });
      setDocuments(data.documents || []);
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
      const data = await api.listDocuments(projectId, { limit: PAGE_SIZE, after: lastSK });
      setDocuments(prev => [...prev, ...(data.documents || [])]);
      setHasMore(data.hasMore ?? false);
      setLastSK(data.lastSK ?? null);
    } catch (err) {
      showToast(err.message);
    } finally {
      setLoadingMore(false);
    }
  }

  if (!projectId) {
    return (
      <section className="view-section">
        <header className="view-header"><h1>Documents</h1></header>
        <div className="empty-state"><p>Select a project first.</p></div>
      </section>
    );
  }

  return (
    <section className="view-section">
      <header className="view-header">
        <h1>Documents</h1>
        <span className="chunk-count">{documents.length} loaded{hasMore ? '+' : ''}</span>
      </header>

      {loading && documents.length === 0 ? (
        <div className="empty-state"><p>Loading...</p></div>
      ) : documents.length === 0 ? (
        <div className="empty-state"><p>No documents yet. Add one or start a scrape job.</p></div>
      ) : (
        <div className="doc-list">
          {documents.map(d => (
            <Link key={d.id} to={`/document/${d.id}`} className="doc-list-row">
              <div className="doc-list-info">
                <span className="doc-list-title">{d.title || d.url}</span>
                <span className="doc-list-url">{d.url}</span>
              </div>
              <span className="doc-list-chunks">{d.chunksCreated ?? 0} chunks</span>
              <span className="doc-list-date">
                {d.createdAt ? new Date(d.createdAt).toLocaleDateString() : ''}
              </span>
            </Link>
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
