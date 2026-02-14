import { useState } from 'react';
import { callTool } from '../lib/mcp';
import { useApp } from '../lib/store';
import TopicList from '../components/TopicList';

export default function Search() {
  const { projectId, setLoading, showToast } = useApp();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);

  async function doSearch() {
    const q = query.trim();
    if (!q) return;

    setLoading(true);
    try {
      const data = await callTool('semantic_search', { query: q, limit: 10 }, { projectId });
      setResults(data.results || []);
    } catch (err) {
      showToast(err.message);
    } finally {
      setLoading(false);
    }
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
          placeholder="Search topics by meaning..."
          autoComplete="off"
        />
        <button className="btn-primary" onClick={doSearch}>Search</button>
      </div>
      {results === null && (
        <div className="empty-state"><p>Enter a query to search across all topics.</p></div>
      )}
      {results && results.length === 0 && (
        <div className="empty-state"><p>No results found.</p></div>
      )}
      {results && results.length > 0 && (
        <TopicList topics={results} showScore />
      )}
    </section>
  );
}
