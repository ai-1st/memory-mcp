import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { useApp } from '../lib/store';

function StatusBadge({ status }) {
  return <span className={`status-badge status-${status}`}>{status}</span>;
}

export default function ProcessQueue() {
  const { projectId, showToast } = useApp();
  const [processData, setProcessData] = useState(null);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef(null);
  const [concurrency, setConcurrency] = useState(5);
  const [filter, setFilter] = useState(null);

  const loadStatus = useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await api.queueStatus(projectId, { processStatus: filter || 'none' });
      setProcessData(data.process);
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
    if (!processData) return;
    setPolling((processData.processing ?? 0) > 0 || (processData.pending ?? 0) > 0);
  }, [processData]);

  async function handleControl(action, value) {
    try {
      await api.queueControl(projectId, { queue: 'process', action, value });
      showToast(`Process queue: ${action}`, 'success');
      await loadStatus();
    } catch (err) {
      showToast(err.message);
    }
  }

  const filteredJobs = processData?.jobs || [];

  if (!projectId) {
    return (
      <section className="view-section">
        <header className="view-header"><h1>Process Queue</h1></header>
        <div className="empty-state"><p>Select a project first.</p></div>
      </section>
    );
  }

  return (
    <section className="view-section">
      <header className="view-header">
        <h1>Process Queue</h1>
        <button className="btn-sm" onClick={loadStatus}>Refresh</button>
      </header>

      {processData && (
        <div className="queue-stats">
          <button className={`stat-item stat-all${!filter ? ' stat-active-filter' : ''}`}
            onClick={() => setFilter(null)}>{processData.total ?? 0} all</button>
          <button className={`stat-item stat-pending${filter === 'pending' ? ' stat-active-filter' : ''}`}
            onClick={() => setFilter(filter === 'pending' ? null : 'pending')}>{processData.pending ?? 0} pending</button>
          <button className={`stat-item stat-active${filter === 'processing' ? ' stat-active-filter' : ''}`}
            onClick={() => setFilter(filter === 'processing' ? null : 'processing')}>{processData.processing ?? 0} active</button>
          <button className={`stat-item stat-completed${filter === 'completed' ? ' stat-active-filter' : ''}`}
            onClick={() => setFilter(filter === 'completed' ? null : 'completed')}>{processData.completed ?? 0} done</button>
          <button className={`stat-item stat-failed${filter === 'failed' ? ' stat-active-filter' : ''}`}
            onClick={() => setFilter(filter === 'failed' ? null : 'failed')}>{processData.failed ?? 0} failed</button>
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

      {filteredJobs.length > 0 && (
        <div className="queue-panel">
          <h2>Jobs {filter && <span className="filter-label">({filter})</span>}</h2>
          <div className="job-list">
            {filteredJobs.map(j => (
              <div key={j.id} className="job-row">
                <StatusBadge status={j.status} />
                {j.url ? (
                  <a className="job-title" href={j.url} target="_blank" rel="noopener noreferrer" title={j.url}>{j.title || j.url}</a>
                ) : (
                  <span className="job-title">{j.title || '(no url)'}</span>
                )}
                {j.status === 'completed' && (
                  <span className="job-count">+{j.topicsCreated} / {j.topicsReplaced}r</span>
                )}
                <span className="job-time">{timeAgo(j.updatedAt || j.createdAt)}</span>
                {j.error && <span className="job-error" title={j.error}>error</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {processData && filteredJobs.length === 0 && (
        <div className="empty-state"><p>{filter ? `No ${filter} jobs.` : 'No jobs in the process queue yet. Submit a scrape job first.'}</p></div>
      )}
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
