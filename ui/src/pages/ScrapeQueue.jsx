import { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../lib/store';

const CRED_KEYS = {
  jiraEmail: 'memory-mcp-jira-email',
  jiraToken: 'memory-mcp-jira-token',
  jiraBaseUrl: 'memory-mcp-jira-base-url',
  confluenceEmail: 'memory-mcp-confluence-email',
  confluenceToken: 'memory-mcp-confluence-token',
  confluenceBaseUrl: 'memory-mcp-confluence-base-url',
};

function loadCred(key) { return localStorage.getItem(CRED_KEYS[key]) || ''; }
function saveCred(key, val) { localStorage.setItem(CRED_KEYS[key], val); }

function StatusBadge({ status }) {
  return <span className={`status-badge status-${status}`}>{status}</span>;
}

export default function ScrapeQueue() {
  const { projectId, showToast } = useApp();
  const [searchParams] = useSearchParams();
  const [scrapeData, setScrapeData] = useState(null);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef(null);

  const [source, setSource] = useState('jira');
  const [jql, setJql] = useState('');
  const [parentUrl, setParentUrl] = useState('');
  const [email, setEmail] = useState(() => loadCred('jiraEmail'));
  const [token, setToken] = useState(() => loadCred('jiraToken'));
  const [baseUrl, setBaseUrl] = useState(() => loadCred('jiraBaseUrl'));
  const [submitting, setSubmitting] = useState(false);
  const [concurrency, setConcurrency] = useState(2);
  const [filter, setFilter] = useState(null);

  const qpApplied = useRef(false);
  const sourceChangedByUser = useRef(false);

  useEffect(() => {
    if (qpApplied.current) return;
    qpApplied.current = true;
    const qpSource = searchParams.get('source');
    if (qpSource) setSource(qpSource);
    const src = qpSource || 'jira';
    if (searchParams.get('jql')) setJql(searchParams.get('jql'));
    if (searchParams.get('parentUrl')) setParentUrl(searchParams.get('parentUrl'));
    if (searchParams.get('baseUrl')) setBaseUrl(searchParams.get('baseUrl'));
    else setBaseUrl(loadCred(src === 'confluence' ? 'confluenceBaseUrl' : 'jiraBaseUrl'));
    if (searchParams.get('email')) setEmail(searchParams.get('email'));
    else setEmail(loadCred(src === 'confluence' ? 'confluenceEmail' : 'jiraEmail'));
    if (searchParams.get('token')) setToken(searchParams.get('token'));
    else setToken(loadCred(src === 'confluence' ? 'confluenceToken' : 'jiraToken'));
  }, [searchParams]);

  useEffect(() => {
    if (!sourceChangedByUser.current) return;
    if (source === 'jira') {
      setEmail(loadCred('jiraEmail'));
      setToken(loadCred('jiraToken'));
      setBaseUrl(loadCred('jiraBaseUrl'));
    } else {
      setEmail(loadCred('confluenceEmail'));
      setToken(loadCred('confluenceToken'));
      setBaseUrl(loadCred('confluenceBaseUrl'));
    }
  }, [source]);

  const loadStatus = useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await api.queueStatus(projectId, {
        scrapeStatus: filter || undefined,
        processStatus: 'none',
      });
      setScrapeData(data.scrape);
    } catch { /* polling */ }
  }, [projectId, filter]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  useEffect(() => {
    if (polling && projectId) {
      pollRef.current = setInterval(loadStatus, 3000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [polling, projectId, loadStatus]);

  useEffect(() => {
    if (!scrapeData) return;
    setPolling((scrapeData.scraping ?? 0) > 0 || (scrapeData.pending ?? 0) > 0);
  }, [scrapeData]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!projectId) return;
    const prefix = source === 'jira' ? 'jira' : 'confluence';
    saveCred(`${prefix}Email`, email);
    saveCred(`${prefix}Token`, token);
    saveCred(`${prefix}BaseUrl`, baseUrl);
    const config = source === 'jira' ? { jql, baseUrl } : { parentUrl, baseUrl };
    setSubmitting(true);
    try {
      await api.enqueueScrape(projectId, { source, config, credentials: { email, token } });
      showToast('Scrape job enqueued', 'success');
      setPolling(true);
      await loadStatus();
    } catch (err) {
      showToast(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleControl(action, value) {
    try {
      await api.queueControl(projectId, { queue: 'scrape', action, value });
      showToast(`Scrape queue: ${action}`, 'success');
      await loadStatus();
    } catch (err) {
      showToast(err.message);
    }
  }

  if (!projectId) {
    return (
      <section className="view-section">
        <header className="view-header"><h1>Scrape Queue</h1></header>
        <div className="empty-state"><p>Select a project first.</p></div>
      </section>
    );
  }

  return (
    <section className="view-section">
      <header className="view-header">
        <h1>Scrape Queue</h1>
        <button className="btn-sm" onClick={loadStatus}>Refresh</button>
      </header>

      {scrapeData && (
        <div className="queue-stats">
          <button className={`stat-item stat-all${!filter ? ' stat-active-filter' : ''}`}
            onClick={() => setFilter(null)}>{scrapeData.total ?? 0} all</button>
          <button className={`stat-item stat-pending${filter === 'pending' ? ' stat-active-filter' : ''}`}
            onClick={() => setFilter(filter === 'pending' ? null : 'pending')}>{scrapeData.pending ?? 0} pending</button>
          <button className={`stat-item stat-active${filter === 'scraping' ? ' stat-active-filter' : ''}`}
            onClick={() => setFilter(filter === 'scraping' ? null : 'scraping')}>{scrapeData.scraping ?? 0} active</button>
          <button className={`stat-item stat-completed${filter === 'completed' ? ' stat-active-filter' : ''}`}
            onClick={() => setFilter(filter === 'completed' ? null : 'completed')}>{scrapeData.completed ?? 0} done</button>
          <button className={`stat-item stat-failed${filter === 'failed' ? ' stat-active-filter' : ''}`}
            onClick={() => setFilter(filter === 'failed' ? null : 'failed')}>{scrapeData.failed ?? 0} failed</button>
        </div>
      )}

      <div className="queue-controls">
        <button className="btn-sm btn-green" onClick={() => handleControl('start')}>Start</button>
        <button className="btn-sm btn-orange" onClick={() => handleControl('stop')}>Stop</button>
        <button className="btn-sm btn-red" onClick={() => handleControl('clear')}>Clear</button>
        <label className="concurrency-label">
          Concurrency: {concurrency}
          <input type="range" min="2" max="10" value={concurrency}
            onChange={e => setConcurrency(+e.target.value)}
            onMouseUp={() => handleControl('concurrency', concurrency)}
            onTouchEnd={() => handleControl('concurrency', concurrency)} />
        </label>
      </div>

      <div className="queue-panel">
        <h2>New Scrape Job</h2>
        <form className="scrape-form" onSubmit={handleSubmit}>
          <div className="form-row">
            <label>Source</label>
            <select value={source} onChange={e => { sourceChangedByUser.current = true; setSource(e.target.value); }}>
              <option value="jira">Jira</option>
              <option value="confluence">Confluence</option>
            </select>
          </div>

          {source === 'jira' ? (
            <div className="form-row">
              <label>JQL Query</label>
              <input type="text" value={jql} onChange={e => setJql(e.target.value)}
                placeholder='resolution=Done AND project="MyProject"' required />
            </div>
          ) : (
            <div className="form-row">
              <label>Parent Page URL</label>
              <input type="url" value={parentUrl} onChange={e => setParentUrl(e.target.value)}
                placeholder="https://org.atlassian.net/wiki/spaces/SPACE/pages/123/Title" required />
            </div>
          )}

          <div className="form-row">
            <label>Base URL</label>
            <input type="url" value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
              placeholder="https://your-domain.atlassian.net" required />
          </div>
          <div className="form-row">
            <label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com" required />
          </div>
          <div className="form-row">
            <label>API Token</label>
            <input type="password" value={token} onChange={e => setToken(e.target.value)}
              placeholder="Atlassian API token" required />
          </div>

          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Enqueuing...' : 'Start Scrape'}
          </button>
        </form>
      </div>

      {(() => {
        const filtered = scrapeData?.jobs?.filter(j => !filter || j.status === filter) || [];
        return filtered.length > 0 && (
          <div className="queue-panel" style={{ marginTop: 16 }}>
            <h2>Jobs {filter && <span className="filter-label">({filter})</span>}</h2>
            <div className="job-list">
              {filtered.map(j => (
                <div key={j.id} className="job-row">
                  <StatusBadge status={j.status} />
                  <span className="job-source">{j.source}</span>
                  <span className="job-count">{j.docsEnqueued} docs</span>
                  <span className="job-time">{timeAgo(j.updatedAt || j.createdAt)}</span>
                  {j.error && <span className="job-error" title={j.error}>error</span>}
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </section>
  );
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
