import { useEffect, useRef, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../lib/store';

const PAGE_SIZE = 100;

function StatusBadge({ status }) {
  return <span className={`status-badge status-${status}`}>{status}</span>;
}

export default function ProcessQueue() {
  const { projectId, showToast } = useApp();
  const [processData, setProcessData] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [lastSK, setLastSK] = useState(null);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef(null);
  const [filter, setFilter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [requeuing, setRequeueing] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const fetchData = useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await api.queueStatus(projectId, {
        processStatus: filter || 'none',
        limit: PAGE_SIZE,
      });
      setProcessData(data.process);
      setJobs(data.process.jobs || []);
      setHasMore(data.process.hasMore ?? false);
      setLastSK(data.process.lastSK ?? null);
    } catch { /* ignore */ }
  }, [projectId, filter]);

  async function loadMore() {
    if (!projectId || !lastSK) return;
    setLoadingMore(true);
    try {
      const data = await api.queueStatus(projectId, {
        processStatus: filter || 'none',
        limit: PAGE_SIZE,
        after: lastSK,
      });
      setJobs(prev => [...prev, ...(data.process.jobs || [])]);
      setHasMore(data.process.hasMore ?? false);
      setLastSK(data.process.lastSK ?? null);
      setProcessData(prev => ({ ...prev, ...data.process, jobs: undefined }));
    } catch { /* ignore */ }
    finally { setLoadingMore(false); }
  }

  useEffect(() => {
    setLoading(true);
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  useEffect(() => {
    if (polling && projectId) {
      pollRef.current = setInterval(async () => {
        if (!projectId) return;
        try {
          const data = await api.queueStatus(projectId, { processStatus: 'none' });
          setProcessData(prev => prev ? { ...prev, ...data.process, jobs: undefined } : data.process);
        } catch { /* ignore */ }
      }, 3000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [polling, projectId]);

  useEffect(() => {
    if (!processData) return;
    setPolling((processData.processing ?? 0) > 0 || (processData.pending ?? 0) > 0);
  }, [processData]);

  async function handleRefresh() {
    setLoading(true);
    await fetchData();
    setLoading(false);
  }

  async function handleControl(action) {
    try {
      await api.queueControl(projectId, { queue: 'process', action });
      showToast(`Process queue: ${action}`, 'success');
      await handleRefresh();
    } catch (err) {
      showToast(err.message);
    }
  }

  async function handleRequeueStuck() {
    const count = processData?.processing ?? 0;
    if (!count || requeuing) return;
    setRequeueing(true);
    try {
      const res = await api.queueRequeue(projectId, { status: 'processing' });
      showToast(`Requeued ${res.requeued} stuck jobs`, 'success');
      await handleRefresh();
    } catch (err) {
      showToast(err.message);
    } finally {
      setRequeueing(false);
    }
  }

  async function handleRetryFailed() {
    const count = processData?.failed ?? 0;
    if (!count || retrying) return;
    setRetrying(true);
    try {
      const res = await api.queueRequeue(projectId, { status: 'failed' });
      showToast(`Retrying ${res.requeued} failed jobs`, 'success');
      await handleRefresh();
    } catch (err) {
      showToast(err.message);
    } finally {
      setRetrying(false);
    }
  }

  function handleFilterClick(newFilter) {
    const next = filter === newFilter ? null : newFilter;
    setFilter(next);
    setJobs([]);
    setHasMore(false);
    setLastSK(null);
    setLoading(true);
  }

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
        <button className="btn-sm" onClick={handleRefresh} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </header>

      {processData && (
        <div className="queue-stats">
          <button className={`stat-item stat-all${!filter ? ' stat-active-filter' : ''}`}
            onClick={() => handleFilterClick(null)} disabled={loading}>{processData.total ?? 0} all</button>
          <button className={`stat-item stat-pending${filter === 'pending' ? ' stat-active-filter' : ''}`}
            onClick={() => handleFilterClick('pending')} disabled={loading}>{processData.pending ?? 0} pending</button>
          <button className={`stat-item stat-active${filter === 'processing' ? ' stat-active-filter' : ''}`}
            onClick={() => handleFilterClick('processing')} disabled={loading}>{processData.processing ?? 0} active</button>
          <button className={`stat-item stat-completed${filter === 'completed' ? ' stat-active-filter' : ''}`}
            onClick={() => handleFilterClick('completed')} disabled={loading}>{processData.completed ?? 0} done</button>
          <button className={`stat-item stat-failed${filter === 'failed' ? ' stat-active-filter' : ''}`}
            onClick={() => handleFilterClick('failed')} disabled={loading}>{processData.failed ?? 0} failed</button>
        </div>
      )}

      <div className="queue-controls">
        {processData?.stopped
          ? <button className="btn-sm btn-green" onClick={() => handleControl('start')}>Start</button>
          : <button className="btn-sm btn-orange" onClick={() => handleControl('stop')}>Stop</button>}
        <button className="btn-sm btn-red" onClick={() => handleControl('clear')}>Clear</button>
        {(processData?.processing ?? 0) > 0 && (
          <button className="btn-sm btn-amber" onClick={handleRequeueStuck} disabled={requeuing} title="Reset stuck jobs (timed out) back to pending">
            {requeuing ? 'Requeueing...' : `Requeue ${processData.processing} stuck`}
          </button>
        )}
        {(processData?.failed ?? 0) > 0 && (
          <button className="btn-sm btn-red" onClick={handleRetryFailed} disabled={retrying} title="Re-queue all failed jobs for processing">
            {retrying ? 'Retrying...' : `Retry ${processData.failed} failed`}
          </button>
        )}
      </div>

      {loading && jobs.length === 0 && (
        <div className="empty-state"><span className="queue-spinner" /> {filter ? `Loading ${filter} jobs...` : 'Loading...'}</div>
      )}

      {!loading && jobs.length > 0 && (
        <div className="queue-panel">
          <h2>Jobs {filter && <span className="filter-label">
            ({filter} &mdash; {jobs.length} of {processData[filter] ?? '?'})
          </span>}</h2>
          <div className="job-list">
            {jobs.map(j => (
              <div key={j.id} className="job-row">
                <StatusBadge status={j.status} />
                {j.docId ? (
                  <Link className="job-title" to={`/document/${j.docId}`} title={j.url}>{j.title || j.url || '(no title)'}</Link>
                ) : (
                  <span className="job-title">{j.title || j.url || '(no title)'}</span>
                )}
                {j.status === 'completed' && (
                  <span className="job-count">{j.chunksCreated} chunks</span>
                )}
                <span className="job-time">{timeAgo(j.updatedAt || j.createdAt)}</span>
                {j.error && <span className="job-error" title={j.error}>error</span>}
              </div>
            ))}
          </div>
          {hasMore && (
            <button className="btn-load-more" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? <><span className="queue-spinner" /> Loading...</> : `Load next ${PAGE_SIZE}`}
            </button>
          )}
        </div>
      )}

      {!loading && processData && !filter && (processData.total ?? 0) > 0 && (
        <div className="empty-state"><p>Click a status above to view jobs.</p></div>
      )}
      {!loading && processData && !filter && (processData.total ?? 0) === 0 && (
        <div className="empty-state"><p>No jobs in the process queue yet. Submit a scrape job first.</p></div>
      )}
      {!loading && processData && filter && jobs.length === 0 && (
        <div className="empty-state"><p>No {filter} jobs.</p></div>
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
