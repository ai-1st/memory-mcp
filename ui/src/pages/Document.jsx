import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { callTool } from '../lib/mcp';
import { useApp } from '../lib/store';
import Markdown from '../components/Markdown';

export default function Document() {
  const { docId } = useParams();
  const navigate = useNavigate();
  const { projectId, setLoading, showToast } = useApp();
  const [doc, setDoc] = useState(null);

  useEffect(() => {
    if (!docId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const data = await callTool('get_document', { id: docId }, { projectId });
        if (!cancelled) setDoc(data);
      } catch (err) {
        if (!cancelled) showToast(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [docId, projectId]);

  return (
    <section className="view-section">
      <header className="view-header">
        <button className="btn-ghost" onClick={() => navigate(-1)}>&larr; Back</button>
        <h1>Document</h1>
      </header>
      {doc ? (
        <div className="doc-detail">
          <div className="doc-url">
            <a href={doc.url} target="_blank" rel="noopener noreferrer">{doc.url}</a>
          </div>
          {doc.createdAt && (
            <div className="doc-date">{new Date(doc.createdAt).toLocaleString()}</div>
          )}
          <div className="doc-contents">
            <Markdown>{doc.contents}</Markdown>
          </div>
        </div>
      ) : (
        <div className="empty-state"><p>Loading...</p></div>
      )}
    </section>
  );
}
