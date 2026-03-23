import { useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../lib/store';

export default function AddDocument() {
  const { projectId, setLoading, showToast } = useApp();
  const [url, setUrl] = useState('');
  const [contents, setContents] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!url.trim() || !contents.trim()) return;

    setSubmitting(true);
    setResult(null);
    try {
      const data = await api.addDocument(projectId, { url: url.trim(), contents: contents.trim() });
      setResult({ chunksCreated: data.chunksCreated || 0, docId: data.docId });
      setUrl('');
      setContents('');
      showToast('Document added successfully', 'success');
    } catch (err) {
      showToast(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="view-section">
      <header className="view-header">
        <h1>Add Document</h1>
      </header>
      <form className="add-form" onSubmit={handleSubmit}>
        <label htmlFor="add-url">Source URL</label>
        <input
          id="add-url"
          type="url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://example.com/article"
          required
        />
        <label htmlFor="add-contents">Contents</label>
        <textarea
          id="add-contents"
          value={contents}
          onChange={e => setContents(e.target.value)}
          placeholder="Paste document text here..."
          rows={12}
          required
        />
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'Processing...' : 'Add Document'}
        </button>
      </form>

      {result && (
        <div className="add-result">
          <div className="add-result-header">
            &#10003; {result.chunksCreated} chunk{result.chunksCreated !== 1 ? 's' : ''} created
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 8 }}>
            Document ID: <span style={{ fontFamily: 'var(--mono)' }}>{result.docId}</span>
          </div>
        </div>
      )}
    </section>
  );
}
