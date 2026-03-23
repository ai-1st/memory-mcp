import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import Markdown from '../components/Markdown';

export default function Document() {
  const { docId } = useParams();
  const navigate = useNavigate();
  const { projectId, setLoading, showToast } = useApp();
  const [doc, setDoc] = useState(null);
  const [chunks, setChunks] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [reprocessing, setReprocessing] = useState(false);

  useEffect(() => {
    if (!docId || !projectId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const [docData, chunkData] = await Promise.all([
          api.getDocument(projectId, docId),
          api.listChunks(projectId, { docId }),
        ]);
        if (!cancelled) {
          setDoc(docData);
          setChunks(chunkData.chunks || []);
        }
      } catch (err) {
        if (!cancelled) showToast(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [docId, projectId]);

  async function handleReprocess() {
    if (!confirm('Reprocess this document? Old chunks will be replaced with new ones.')) return;
    setReprocessing(true);
    try {
      const result = await api.reprocessDocument(projectId, docId);
      showToast(`Reprocessed: ${result.chunksCreated} chunks created`, 'success');
      const chunkData = await api.listChunks(projectId, { docId });
      setChunks(chunkData.chunks || []);
    } catch (err) {
      showToast(err.message);
    } finally {
      setReprocessing(false);
    }
  }

  function toggleExpand(id) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <section className="view-section">
      <header className="view-header">
        <button className="btn-ghost" onClick={() => navigate(-1)}>&larr; Back</button>
        <h1>{doc?.title || 'Document'}</h1>
      </header>
      {doc ? (
        <>
          <div className="doc-detail">
            <div className="doc-url">
              <a href={doc.url} target="_blank" rel="noopener noreferrer">{doc.url}</a>
            </div>
            <div className="doc-meta-row">
              {doc.createdAt && (
                <span className="doc-date">{new Date(doc.createdAt).toLocaleString()}</span>
              )}
              <span className="doc-chunk-count">{chunks.length} chunks</span>
              <button
                className="btn-sm"
                onClick={handleReprocess}
                disabled={reprocessing}
              >
                {reprocessing ? 'Reprocessing...' : 'Reprocess'}
              </button>
            </div>
            <div className="doc-contents">
              <Markdown>{doc.contents}</Markdown>
            </div>
          </div>

          {chunks.length > 0 && (
            <div className="doc-chunks-section">
              <h2>Chunks ({chunks.length})</h2>
              <div className="chunk-results">
                {chunks.map(c => (
                  <div key={c.id} className="chunk-card" onClick={() => toggleExpand(c.id)}>
                    <div className="chunk-card-header">
                      <span className={`chunk-type-badge chunk-type-${c.type}`}>{c.type}</span>
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
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="empty-state"><p>Loading...</p></div>
      )}
    </section>
  );
}
