import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../lib/store';

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

export default function BM25Search() {
  const { projectId, setLoading, showToast } = useApp();
  const [query, setQuery] = useState('');
  const [documents, setDocuments] = useState(null);
  const [reindexing, setReindexing] = useState(false);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (projectId) loadStats();
  }, [projectId]);

  async function loadStats() {
    try {
      const data = await api.bm25Stats(projectId);
      setStats(data);
    } catch {
      setStats(null);
    }
  }

  async function doSearch() {
    const q = query.trim();
    if (!q) return;

    setLoading(true);
    try {
      const data = await api.bm25Search(projectId, q);
      setDocuments(data.documents || []);
    } catch (err) {
      showToast(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function doReindex() {
    setReindexing(true);
    try {
      const data = await api.bm25Reindex(projectId);
      showToast(`Indexed ${data.indexed} documents`, 'success');
      loadStats();
    } catch (err) {
      showToast(err.message);
    } finally {
      setReindexing(false);
    }
  }

  return (
    <section className="view-section">
      <header className="view-header">
        <h1>BM25 Search</h1>
        {stats && stats.totalDocs > 0 && (
          <div className="bm25-stats">
            <span className="bm25-stat">{stats.totalDocs} docs</span>
            <span className="bm25-stat">{stats.totalWords.toLocaleString()} words</span>
            <span className="bm25-stat">{formatBytes(stats.sizeBytes)}</span>
          </div>
        )}
        <button
          className="btn-sm btn-green"
          style={{ marginLeft: 'auto' }}
          onClick={doReindex}
          disabled={reindexing}
        >
          {reindexing ? 'Reindexing...' : 'Reindex'}
        </button>
      </header>
      <div className="search-bar">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && doSearch()}
          placeholder="Search documents by keywords..."
          autoComplete="off"
        />
        <button className="btn-primary" onClick={doSearch}>Search</button>
      </div>

      {documents === null && (
        <div className="empty-state">
          {stats && stats.totalDocs === 0
            ? <p>No BM25 index found. Click "Reindex" to build the index from existing documents.</p>
            : <p>Enter a query to search documents by keywords (BM25).</p>
          }
        </div>
      )}

      {documents && documents.length === 0 && (
        <div className="empty-state"><p>No results found.</p></div>
      )}

      {documents && documents.length > 0 && (
        <div className="queue-panel">
          <h2>Documents ({documents.length})</h2>
          <div className="search-doc-list">
            {documents.map(d => (
              <div key={d.id} className="search-doc-card">
                <div className="search-doc-header">
                  <Link to={`/document/${d.id}`} className="search-doc-title">{d.title || d.id}</Link>
                  <span className="chunk-score">{d.score.toFixed(2)}</span>
                </div>
                {d.url && (
                  <a className="search-doc-url" href={d.url} target="_blank" rel="noopener noreferrer">{d.url}</a>
                )}
                {d.summary && (
                  <p className="search-doc-summary">{d.summary}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
