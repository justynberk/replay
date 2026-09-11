import React, { useEffect, useState } from 'react';
import { ArrowClockwise, CaretDown, CheckCircle, Clock, DownloadSimple, Package, WarningCircle, X } from '@phosphor-icons/react';
import { api, bytes } from '../lib.js';
import { Empty, Modal, Spinner } from './UI.jsx';
import './jobs.css';

export default function Jobs({ jobs = [], onJobs, onClose, onToast }) {
  const [error, setError] = useState(''), [working, setWorking] = useState(''), [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    let cancelled = false, timer;
    async function poll() { try { const next = await api('/jobs'); if (!cancelled) { onJobs?.(next); setError(''); } } catch (err) { if (!cancelled) setError(err.message); } finally { if (!cancelled) timer = setTimeout(poll, 1800); } }
    poll(); return () => { cancelled = true; clearTimeout(timer); };
  }, [onJobs]);
  async function refresh() { setRefreshing(true); try { onJobs?.(await api('/jobs')); setError(''); } catch (err) { setError(err.message); } finally { setRefreshing(false); } }
  async function act(job, action) {
    setWorking(job.id); setError('');
    try { await api(`/jobs/${job.id}/${action}`, { method: 'POST' }); onJobs?.(await api('/jobs')); onToast?.(action === 'cancel' ? 'Export cancelled' : 'Export queued again'); }
    catch (err) { setError(err.message); }
    finally { setWorking(''); }
  }
  const active = jobs.filter(job => ['queued', 'running'].includes(job.status));
  return <Modal title="Exports" onClose={onClose} className="jobs-modal"><div style={{ padding: '22px 25px', maxHeight: '70dvh', overflow: 'auto' }}>
    <div style={introStyle}><p style={{ margin: 0, color: 'var(--theme-ink-secondary,#9ba8b5)', fontSize: 12, lineHeight: 1.6 }}>{active.length ? `${active.length} export${active.length === 1 ? '' : 's'} in progress. You can keep working.` : 'Your finished files, ready to take anywhere.'}</p><button className="icon-button" onClick={refresh} disabled={refreshing} title="Refresh exports" aria-label="Refresh exports"><ArrowClockwise size={18} className={refreshing ? 'spin' : ''} /></button></div>
    {error && <p role="alert" style={errorStyle}>{error}</p>}
    {!jobs.length ? <Empty icon={Package} title="Your export queue is clear">Export a recording to create a video, audio file or portable bundle.</Empty> : <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{jobs.map(job => <ExportJob key={job.id} job={job} working={working} act={act} />)}</div>}
    <div style={{ display: 'flex', gap: 7, color: 'var(--theme-ink-muted,#758594)', fontSize: 10, lineHeight: 1.6, marginTop: 22 }}><Package size={16} style={{ flexShrink: 0 }} /><span>Exports are rendered on this computer. Download links work while Replay is running.</span></div>
  </div></Modal>;
}

function ExportJob({ job, working, act }) {
  const [expanded, setExpanded] = useState(() => ['queued', 'running', 'failed'].includes(job.status));
  const detailId = `export-details-${job.id}`;
  const status = ({ queued: 'Queued', running: 'Rendering', completed: 'Ready', failed: 'Failed', cancelled: 'Cancelled' })[job.status] || job.status;
  const fileCount = job.files?.length || 0;
  return <article className="export-job" style={cardStyle}>
    <h3 className="export-job-heading"><button className="export-job-toggle" type="button" aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpanded(value => !value)}>
      <span style={jobIconStyle} aria-hidden="true">{job.status === 'completed' ? <CheckCircle size={21} color="var(--theme-success-ink,#b0c2a0)" /> : job.status === 'failed' ? <WarningCircle size={21} color="var(--theme-danger-ink,#dfa086)" /> : job.status === 'running' ? <Spinner>{''}</Spinner> : <Clock size={20} color="var(--theme-accent-ink,#c1ac83)" />}</span>
      <span className="export-job-label"><strong title={job.title || 'Recording export'}>{job.title || 'Recording export'}</strong><span className="export-job-meta"><time dateTime={job.createdAt}>{new Date(job.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>{job.status === 'completed' && <span>· {fileCount} {fileCount === 1 ? 'file' : 'files'}</span>}</span></span>
      <span className={`export-job-status export-job-status-${job.status}`}>{status}{job.status === 'running' ? ` ${Math.round(job.progress || 0)}%` : ''}</span>
      <CaretDown className="export-job-chevron" size={17} aria-hidden="true" />
    </button></h3>
    <div className="export-job-details" id={detailId} hidden={!expanded}>
      {['queued', 'running'].includes(job.status) && <div style={{ marginTop: 18 }}><div style={progressTrackStyle} role="progressbar" aria-label={`Export progress for ${job.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, Math.min(100, Number(job.progress) || 0))}><span style={{ display: 'block', width: `${Math.max(0, Math.min(100, Number(job.progress) || 0))}%`, height: '100%', background: 'var(--theme-accent-fill,#f3bd60)', transition: 'width .25s' }} /></div><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 9 }}><span style={{ fontSize: 10, color: 'var(--theme-ink-secondary,#94a2af)' }}>{job.status === 'queued' ? 'Waiting for the previous export' : `${Math.round(job.progress || 0)}% complete`}</span><button className="subtle" onClick={() => act(job, 'cancel')} disabled={working === job.id} style={smallButtonStyle}><X size={13} />{working === job.id ? 'Cancelling...' : 'Cancel'}</button></div></div>}
      {job.status === 'failed' && <p role="alert" style={{ color: 'var(--theme-danger-ink,#d49a83)', fontSize: 11, lineHeight: 1.6, margin: '15px 0 0' }}>{job.error || 'The export could not finish. Open the recording to adjust its export settings and try again.'}</p>}
      {['failed', 'cancelled'].includes(job.status) && <button className="button subtle" style={{ fontSize: 10, marginTop: 14 }} disabled={working === job.id} onClick={() => act(job, 'retry')}><ArrowClockwise size={15} />{working === job.id ? 'Queuing...' : 'Retry export'}</button>}
      {job.status === 'completed' && <div style={{ marginTop: 15, borderTop: '1px solid var(--theme-edge-strong,#37424c)', paddingTop: 5 }}>{job.files?.length ? job.files.map(file => <a key={file.name} href={file.url} download={file.name} style={fileStyle}><DownloadSimple size={16} /><span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span><small style={{ fontSize: 9, color: 'var(--theme-ink-muted,#8494a1)' }}>{bytes(file.size)}</small></a>) : <p style={{ fontSize: 11, color: 'var(--theme-ink-secondary,#9aa7b2)' }}>This job has no downloadable files.</p>}</div>}
        </div>
  </article>;
}

const introStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 20 };
const cardStyle = { background: 'var(--theme-surface,#1b2128)', border: '1px solid var(--theme-edge-strong,#394550)', borderRadius: 10, padding: 0 };
const jobIconStyle = { display: 'grid', placeItems: 'center', width: 31, height: 31, borderRadius: 6, background: 'var(--theme-raised,#29313a)', flexShrink: 0 };
const progressTrackStyle = { overflow: 'hidden', height: 4, borderRadius: 3, background: 'var(--theme-raised,#38424d)' };
const fileStyle = { display: 'flex', alignItems: 'center', gap: 9, padding: '10px 1px 5px', fontSize: 11, color: 'var(--theme-accent-ink,#e1bd80)', textDecoration: 'none' };
const smallButtonStyle = { color: 'var(--theme-ink-secondary,#b3bec8)', fontSize: 10, display: 'flex', gap: 4, alignItems: 'center' };
const errorStyle = { fontSize: 11, color: 'var(--theme-danger-ink,#e2a18a)', padding: '11px 13px', background: 'var(--theme-danger-soft,#392a25)', border: '1px solid var(--theme-danger-edge,#704b3d)', borderRadius: 6, lineHeight: 1.6 };
