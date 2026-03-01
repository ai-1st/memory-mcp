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

function StatsBar({ counts }) {
  return (
    <div className="queue-stats">
      <span className="stat-item stat-pending">{counts.pending ?? 0} pending</span>
      <span className="stat-item stat-active">{(counts.scraping ?? 0) + (counts.processing ?? 0)} active</span>
      <span className="stat-item stat-completed">{counts.completed ?? 0} done</span>
      <span className="stat-item stat-failed">{counts.failed ?? 0} failed</span>
    </div>
  );
}

export default function Queues() {
  const { projectId, showToast } = useApp();
  const [searchParams] = useSearchParams();
  const [queueData, setQueueData] = useState(null);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef(null);

  // Scrape form state — query params override localStorage defaults
  const qpSource = searchParams.get('source');
  const [source, setSource] = useState(qpSource === 'confluence' ? 'confluence' : 'jira');
  const [jql, setJql] = useState(() => searchParams.get('jql') || '');
  const [parentUrl, setParentUrl] = useState(() => searchParams.get('parentUrl') || '');
  const [email, setEmail] = useState(() => searchParams.get('email') || loadCred(qpSource === 'confluence' ? 'confluenceEmail' : 'jiraEmail'));
  const [token, setToken] = useState(() => searchParams.get('token') || loadCred(qpSource === 'confluence' ? 'confluenceToken' : 'jiraToken'));
  const [baseUrl, setBaseUrl] = useState(() => searchParams.get('baseUrl') || loadCred(qpSource === 'confluence' ? 'confluenceBaseUrl' : 'jiraBaseUrl'));
  const [submitting, setSubmitting] = useState(false);

  // Concurrency
  const [scrapeConcurrency, setScrapeConcurrency] = useState(2);
  const [processConcurrency, setProcessConcurrency] = useState(5);

  const loadStatus = useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await api.queueStatus(projectId);
      setQueueData(data);
    } catch {
      // silently fail during polling
    }
  }, [projectId]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (polling && projectId) {
      pollRef.current = setInterval(loadStatus, 3000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [polling, projectId, loadStatus]);

  // Auto-start polling when there are active jobs
  useEffect(() => {
    if (!queueData) return;
    const hasActive =
      (queueData.scrape?.scraping ?? 0) > 0 ||
      (queueData.scrape?.pending ?? 0) > 0 ||
      (queueData.process?.processing ?? 0) > 0 ||
      (queueData.process?.pending ?? 0) > 0;
    setPolling(hasActive);
  }, [queueData]);

  // Swap credentials when source changes
  useEffect(() => {
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

  async function handleScrapeSubmit(e) {
    e.preventDefault();
    if (!projectId) return;

    const prefix = source === 'jira' ? 'jira' : 'confluence';
    saveCred(`${prefix}Email`, email);
    saveCred(`${prefix}Token`, token);
    saveCred(`${prefix}BaseUrl`, baseUrl);

    const config = source === 'jira'
      ? { jql, baseUrl }
      : { parentUrl, baseUrl };

    setSubmitting(true);
    try {
      await api.enqueueScrape(projectId, {
        source,
        config,
        credentials: { email, token },
      });
      showToast('Scrape job enqueued', 'success');
      setPolling(true);
      await loadStatus();
    } catch (err) {
      showToast(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleControl(queue, action, value) {
    try {
      await api.queueControl(projectId, { queue, action, value });
      showToast(`${queue} queue: ${action}`, 'success');
      await loadStatus();
    } catch (err) {
      showToast(err.message);
    }
  }

  if (!projectId) {
    return (
      <section className="view-section">
        <header className="view-header"><h1>Queues</h1></header>
        <div className="empty-state"><p>Select a project to manage queues.</p></div>
      </section>
    );
  }

  return (
    <section className="view-section">
      <header className="view-header">
        <h1>Queues</h1>
        <button className="btn-sm" onClick={loadStatus}>Refresh</button>
      </header>

      <div className="queue-panels">
        {/* ── Scrape Queue ── */}
        <div className="queue-panel">
          <h2>Scrape Queue</h2>
          {queueData && <StatsBar counts={queueData.scrape} />}

          <div className="queue-controls">
            <button className="btn-sm btn-green" onClick={() => handleControl('scrape', 'start')}>Start</button>
            <button className="btn-sm btn-orange" onClick={() => handleControl('scrape', 'stop')}>Stop</button>
            <button className="btn-sm btn-red" onClick={() => handleControl('scrape', 'clear')}>Clear</button>
            <label className="concurrency-label">
              Concurrency: {scrapeConcurrency}
              <input
                type="range" min="2" max="10" value={scrapeConcurrency}
                onChange={e => setScrapeConcurrency(+e.target.value)}
                onMouseUp={() => handleControl('scrape', 'concurrency', scrapeConcurrency)}
                onTouchEnd={() => handleControl('scrape', 'concurrency', scrapeConcurrency)}
              />
            </label>
          </div>

          <details className="scrape-form-details" open>
            <summary>New Scrape Job</summary>
            <form className="scrape-form" onSubmit={handleScrapeSubmit}>
              <div className="form-row">
                <label>Source</label>
                <select value={source} onChange={e => setSource(e.target.value)}>
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
          </details>

          {queueData?.scrape?.jobs?.length > 0 && (
            <div className="queue-jobs">
              <h3>Jobs</h3>
              <div className="job-list">
                {queueData.scrape.jobs.map(j => (
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
          )}
        </div>

        {/* ── Process Queue ── */}
        <div className="queue-panel">
          <h2>Process Queue</h2>
          {queueData && <StatsBar counts={queueData.process} />}

          <div className="queue-controls">
            <button className="btn-sm btn-green" onClick={() => handleControl('process', 'start')}>Start</button>
            <button className="btn-sm btn-orange" onClick={() => handleControl('process', 'stop')}>Stop</button>
            <button className="btn-sm btn-red" onClick={() => handleControl('process', 'clear')}>Clear</button>
            <label className="concurrency-label">
              Concurrency: {processConcurrency}
              <input
                type="range" min="2" max="10" value={processConcurrency}
                onChange={e => setProcessConcurrency(+e.target.value)}
                onMouseUp={() => handleControl('process', 'concurrency', processConcurrency)}
                onTouchEnd={() => handleControl('process', 'concurrency', processConcurrency)}
              />
            </label>
          </div>

          {queueData?.process?.jobs?.length > 0 && (
            <div className="queue-jobs">
              <h3>Recent Jobs</h3>
              <div className="job-list">
                {queueData.process.jobs.slice(0, 50).map(j => (
                  <div key={j.id} className="job-row">
                    <StatusBadge status={j.status} />
                    <span className="job-title" title={j.url}>{j.title || j.url}</span>
                    {j.status === 'completed' && (
                      <span className="job-count">+{j.topicsCreated} /{j.topicsReplaced}r</span>
                    )}
                    <span className="job-time">{timeAgo(j.updatedAt || j.createdAt)}</span>
                    {j.error && <span className="job-error" title={j.error}>error</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
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
