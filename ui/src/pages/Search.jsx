import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import Markdown from '../components/Markdown';

export default function Search() {
  const { projectId, setLoading, showToast } = useApp();
  const [query, setQuery] = useState('');
  const [documents, setDocuments] = useState(null);
  const [chunks, setChunks] = useState(null);
  const [expanded, setExpanded] = useState({});

  async function doSearch() {
    const q = query.trim();
    if (!q) return;

    setLoading(true);
    try {
      const data = await api.search(projectId, q);
      setDocuments(data.documents || []);
      setChunks(data.chunks || []);
      setExpanded({});
    } catch (err) {
      showToast(err.message);
    } finally {
      setLoading(false);
    }
  }

  function toggleExpand(id) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <section className="view-section">
      <header className="view-header">
        <h1>Semantic Search</h1>
      </header>
      <div className="search-bar">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && doSearch()}
          placeholder="Search chunks by meaning..."
          autoComplete="off"
        />
        <button className="btn-primary" onClick={doSearch}>Search</button>
      </div>

      {documents === null && (
        <div className="empty-state"><p>Enter a query to search across all chunks.</p></div>
      )}

      {documents && documents.length === 0 && (
        <div className="empty-state"><p>No results found.</p></div>
      )}

      {documents && documents.length > 0 && (
        <>
          <div className="queue-panel">
            <h2>Documents ({documents.length})</h2>
            <div className="search-doc-list">
              {documents.map(d => (
                <div key={d.id} className="search-doc-card">
                  <div className="search-doc-header">
                    <Link to={`/document/${d.id}`} className="search-doc-title">{d.title || d.id}</Link>
                    <span className="doc-list-chunks">{d.chunkCount} chunks</span>
                    <span className="chunk-score">{(d.score / d.chunkCount * 100).toFixed(1)}% avg</span>
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

          <div className="queue-panel" style={{ marginTop: 16 }}>
            <h2>Chunks ({chunks.length})</h2>
            <div className="chunk-results">
              {chunks.map(r => (
                <div key={r.id} className="chunk-card" onClick={() => toggleExpand(r.id)}>
                  <div className="chunk-card-header">
                    <span className={`chunk-type-badge chunk-type-${r.type}`}>{r.type}</span>
                    {r.docId && (
                      <Link
                        to={`/document/${r.docId}`}
                        className="chunk-doc-link"
                        onClick={e => e.stopPropagation()}
                      >
                        {r.title?.slice(0, 60) || r.docId.slice(0, 10)}
                      </Link>
                    )}
                    <span className="chunk-score">{(r.score * 100).toFixed(1)}%</span>
                  </div>
                  <div className="chunk-card-body">
                    {expanded[r.id] ? (
                      <Markdown text={r.summary || r.title} />
                    ) : (
                      <p className="chunk-preview">
                        {(r.summary || r.title || '').slice(0, 200)}{(r.summary || r.title || '').length > 200 ? '...' : ''}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
