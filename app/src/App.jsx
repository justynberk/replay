import OpenWatch from './components/OpenWatch.jsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import '@fontsource-variable/inter';
import { ArrowClockwise, CheckCircle, DownloadSimple, FilmStrip, UploadSimple, WarningCircle, X } from '@phosphor-icons/react';
import Editor from './components/Editor.jsx';
import Library from './components/Library.jsx';
import Recorder from './components/Recorder.jsx';
import ExportDialog from './components/ExportDialog.jsx';
import Settings from './components/Settings.jsx';
import Jobs from './components/Jobs.jsx';
import Share from './components/Share.jsx';
import { Spinner } from './components/UI.jsx';
import { api, defaultEdits } from './lib.js';
import { useTheme } from './useTheme.js';

function normalize(asset) {
  const edits = defaultEdits(asset.duration);
  return { folder: '', tags: [], transcript: [], chapters: [], comments: [], versions: [], summary: '', resources: [], waveform: [], ...asset, edits: { ...edits, ...asset.edits, camera: { ...edits.camera, ...asset.edits?.camera } } };
}
function merge(base = {}, patch = {}) {
  const result = { ...base };
  for (const [key, value] of Object.entries(patch)) result[key] = value && typeof value === 'object' && !Array.isArray(value) ? merge(base?.[key], value) : value;
  return result;
}
function editDelta(before = {}, after = {}) {
  const changed = {};
  for (const [key, value] of Object.entries(after)) {
    if (JSON.stringify(value) === JSON.stringify(before?.[key])) continue;
    changed[key] = value && typeof value === 'object' && !Array.isArray(value) ? editDelta(before?.[key], value) : value;
  }
  return changed;
}
function route(view, assetId, replace = false) {
  const url = new URL(window.location.href); url.hash = ''; url.searchParams.delete('t');
  if (assetId) { url.searchParams.set('asset', assetId); url.searchParams.set('view', view); }
  else { url.searchParams.delete('asset'); url.searchParams.set('view', view); }
  window.history[replace ? 'replaceState' : 'pushState']({}, '', url);
}

export function App() {
  const [appearance, setAppearance] = useTheme();
  const [assets, setAssets] = useState([]), [health, setHealth] = useState(null), [jobs, setJobs] = useState([]);
  const [currentId, setCurrentId] = useState(null), [view, setView] = useState('library'), [modal, setModal] = useState(null);
  const [loading, setLoading] = useState(true), [connectionError, setConnectionError] = useState(''), [attempt, setAttempt] = useState(0);
  const [editorPane, setEditorPane] = useState('transcript'), [startTime, setStartTime] = useState(0), [exportPreset, setExportPreset] = useState('default');
  const [saveStatuses, setSaveStatuses] = useState({}), [toasts, setToasts] = useState([]), [importing, setImporting] = useState(''), [dragging, setDragging] = useState(false);
  const assetsRef = useRef([]), queues = useRef(new Map()), jobsRef = useRef([]), input = useRef(), dragCount = useRef(0), importingRef = useRef(false), toastTimers = useRef(new Set());
  const asset = assets.find(item => item.id === currentId);
  const activeJobs = jobs.filter(job => ['running', 'queued'].includes(job.status));
  const saveStatus = saveStatuses[currentId] || 'saved';

  const toast = useCallback((message, type = 'info') => {
    const id = crypto.randomUUID(); setToasts(items => [...items.slice(-3), { id, message, type }]);
    const timer = window.setTimeout(() => { setToasts(items => items.filter(item => item.id !== id)); toastTimers.current.delete(timer); }, type === 'error' ? 8000 : 4800);
    toastTimers.current.add(timer);
  }, []);
  function commit(next) { assetsRef.current = next; setAssets(next); }
  function upsert(next) { const value = normalize(next); const existing = assetsRef.current.some(item => item.id === value.id); commit(existing ? assetsRef.current.map(item => item.id === value.id ? value : item) : [value, ...assetsRef.current]); return value; }
  const updateJobs = useCallback(next => {
    for (const job of next) { const previous = jobsRef.current.find(item => item.id === job.id); if (previous && ['running', 'queued'].includes(previous.status)) { if (job.status === 'completed') toast(`Export ready: ${job.title}`); if (job.status === 'failed') toast(`Export failed: ${job.error || job.title}`, 'error'); } }
    jobsRef.current = next; setJobs(next);
  }, [toast]);
  function queueFor(id) { if (!queues.current.has(id)) queues.current.set(id, { pending: null, inFlight: null, inFlightPatch: null, waiters: [], timer: null, failed: false }); return queues.current.get(id); }

  function drain(id) {
    const queue = queueFor(id);
    if (queue.inFlight) return queue.inFlight;
    clearTimeout(queue.timer); queue.timer = null;
    if (!queue.pending) return Promise.resolve(assetsRef.current.find(item => item.id === id));
    const patch = queue.pending, waiters = queue.waiters; queue.pending = null; queue.waiters = []; queue.inFlightPatch = patch; queue.failed = false;
    setSaveStatuses(values => ({ ...values, [id]: 'saving' }));
    queue.inFlight = api(`/assets/${id}`, { method: 'PATCH', body: patch }).then(result => {
      const next = upsert(merge(normalize(result), queue.pending || {}));
      waiters.forEach(waiter => waiter.resolve(next));
      setSaveStatuses(values => ({ ...values, [id]: queue.pending ? 'saving' : 'saved' }));
      return next;
    }).catch(error => {
      queue.pending = merge(patch, queue.pending || {}); queue.failed = true;
      waiters.forEach(waiter => waiter.reject(error));
      setSaveStatuses(values => ({ ...values, [id]: 'error' }));
      toast(`Changes could not be saved: ${error.message}`, 'error');
      throw error;
    }).finally(() => {
      queue.inFlight = null; queue.inFlightPatch = null;
      if (queue.pending && !queue.failed) queue.timer = setTimeout(() => { drain(id).catch(() => {}); }, 120);
    });
    queue.inFlight.catch(() => {});
    return queue.inFlight;
  }
  async function flush(id) {
    const ids = id ? [id] : [...queues.current.keys()];
    for (const key of ids) {
      const queue = queueFor(key); clearTimeout(queue.timer); queue.timer = null;
      if (queue.inFlight) await queue.inFlight;
      while (queue.pending) await drain(key);
    }
    return id ? assetsRef.current.find(item => item.id === id) : undefined;
  }
  function update(snapshot, patch) {
    const current = assetsRef.current.find(item => item.id === snapshot.id);
    if (!current) return Promise.resolve();
    const delta = { ...patch };
    if (patch.edits) { delta.edits = editDelta(snapshot.edits, patch.edits); if (!Object.keys(delta.edits).length) delete delta.edits; }
    if (!Object.keys(delta).length) return flush(snapshot.id);
    upsert({ ...merge(current, delta), updatedAt: new Date().toISOString() });
    const queue = queueFor(snapshot.id); queue.pending = merge(queue.pending || {}, delta); queue.failed = false;
    clearTimeout(queue.timer); setSaveStatuses(values => ({ ...values, [snapshot.id]: 'saving' }));
    const promise = new Promise((resolve, reject) => queue.waiters.push({ resolve, reject })); promise.catch(() => {});
    queue.timer = setTimeout(() => { drain(snapshot.id).catch(() => {}); }, 420);
    return promise;
  }
  async function refresh() {
    await flush();
    const [nextAssets, nextJobs, nextHealth] = await Promise.all([api('/assets'), api('/jobs'), api('/health')]);
    commit(nextAssets.map(item => {
      const queue = queues.current.get(item.id), latest = assetsRef.current.find(value => value.id === item.id);
      const base = latest && new Date(latest.updatedAt) > new Date(item.updatedAt) ? latest : item;
      return normalize(merge(merge(base, queue?.inFlightPatch || {}), queue?.pending || {}));
    }));
    updateJobs(nextJobs); setHealth(nextHealth);
  }

  useEffect(() => {
    let cancelled = false; setLoading(true); setConnectionError('');
    Promise.all([api('/health'), api('/assets'), api('/jobs')]).then(([nextHealth, nextAssets, nextJobs]) => {
      if (cancelled) return;
      const values = nextAssets.map(normalize); commit(values); setHealth(nextHealth); jobsRef.current = nextJobs; setJobs(nextJobs);
      const params = new URLSearchParams(window.location.search), requested = params.get('asset');
      const next = requested ? values.find(item => item.id === requested) : values.find(item => item.sample && !item.archived) || values.find(item => !item.archived);
      const requestedView = params.get('view');
      const targetView = ['library', 'analytics'].includes(requestedView) ? requestedView : !next || !requested ? 'library' : ['watch', 'editor'].includes(requestedView) ? requestedView : 'review';
      setStartTime(Math.max(0, Number(params.get('t')) || 0));
      setCurrentId(next?.id || null); setView(targetView);
      if (requested && !next) toast('That recording is not available in this local library.', 'error');

    }).catch(error => { if (!cancelled) setConnectionError(error.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [attempt]);
  useEffect(() => {
    if (!activeJobs.length || modal === 'jobs') return;
    let cancelled = false, timer;
    async function poll() { try { const next = await api('/jobs'); if (!cancelled) updateJobs(next); } catch {} finally { if (!cancelled) timer = setTimeout(poll, 1800); } }
    timer = setTimeout(poll, 1800); return () => { cancelled = true; clearTimeout(timer); };
  }, [activeJobs.length, modal, updateJobs]);
  useEffect(() => {
    const pop = () => { const params = new URLSearchParams(location.search), id = params.get('asset'); const exists = assetsRef.current.some(item => item.id === id); setCurrentId(exists ? id : null); setView(['library', 'analytics'].includes(params.get('view')) ? params.get('view') : exists ? ['watch', 'editor'].includes(params.get('view')) ? params.get('view') : 'review' : 'library'); setStartTime(Math.max(0, Number(params.get('t')) || 0)); setEditorPane('transcript'); setModal(null); };
    const unload = event => { if ([...queues.current.values()].some(queue => queue.pending || queue.inFlight)) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('popstate', pop); window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('popstate', pop); window.removeEventListener('beforeunload', unload); };
  }, []);
  useEffect(() => () => { for (const timer of toastTimers.current) clearTimeout(timer); }, []);

  function open(next, time = 0) { setCurrentId(next.id); setStartTime(time); setView('review'); setModal(null); route('review', next.id); if (time > 0) { const url = new URL(location.href); url.searchParams.set('t', time); history.replaceState({}, '', url); } }
  async function editRecording(next, pane = 'transcript', time = 0) { try { await flush(next.id); setEditorPane(pane); setStartTime(time); setCurrentId(next.id); setView('editor'); setModal(null); route('editor', next.id); } catch {} }
  async function finishEditing(time = 0) { try { const saved = await flush(asset.id); open(saved, time); } catch {} }
  async function exportRecording(next, preset = 'default') { try { await flush(next.id); setCurrentId(next.id); setExportPreset(preset); setModal('export'); } catch { toast('Save your changes before exporting.', 'error'); } }
  function back() { setView('library'); route('library'); }
  function openAnalytics() { setView('analytics'); setModal(null); route('analytics'); }
  async function watch(next) { try { await flush(next.id); const share = await api(`/assets/${next.id}/watch`, { method: 'POST', body: {} }); location.assign(share.url); } catch (error) { toast(error.message || 'The watch link could not be opened.', 'error'); } }
  async function show(which) { try { await flush(currentId); setModal(which); } catch { toast('Save your changes successfully before continuing.', 'error'); } }
  function queued(job) { updateJobs([job, ...jobsRef.current.filter(item => item.id !== job.id)]); setModal('jobs'); }
  function recorded(next) { const value = upsert(next); setModal(null); open(value); toast('Recording saved to your library'); }
  async function importFiles(files) {
    if (importingRef.current || !files.length) return;
    importingRef.current = true; const added = [], failed = [];
    for (const [index, file] of files.entries()) {
      setImporting(`Importing ${index + 1} of ${files.length}: ${file.name}`);
      try { const form = new FormData(); form.append('video', file); form.append('title', file.name.replace(/\.[^.]+$/, '')); const value = upsert(await api('/assets/import', { method: 'POST', body: form })); added.push(value); }
      catch (error) { failed.push(`${file.name}: ${error.message}`); }
    }
    setImporting(''); importingRef.current = false;
    if (added.length) { open(added[0]); toast(`${added.length} video${added.length === 1 ? '' : 's'} imported`); }
    if (failed.length) toast(failed.join(' '), 'error');
  }
  const retry = async () => { try { await flush(currentId); toast('Changes saved'); } catch {} };

  if (view === 'watch') return <OpenWatch />;

  if (loading || connectionError) return <div style={screenStyle}><div style={{ width: 420, maxWidth: '90vw', textAlign: 'center' }}><FilmStrip size={40} weight="light" color="var(--theme-accent-ink,#f3bd60)" /><h1 style={{ fontSize: 30, letterSpacing: '-1px', margin: '20px 0 11px' }}>Replay</h1>{loading ? <Spinner>Opening your workspace</Spinner> : <><p style={{ color: 'var(--theme-ink-secondary,#a6b2bf)', fontSize: 14, lineHeight: 1.7 }}>The local workspace could not be reached.</p><p style={{ fontSize: 12, color: 'var(--theme-danger-ink,#d69a83)', lineHeight: 1.7 }}>{connectionError}</p><button className="button primary" onClick={() => setAttempt(value => value + 1)} style={{ margin: '22px auto 0' }}><ArrowClockwise size={18} />Try again</button></>}</div></div>;

  return <div onDragEnter={event => { if ([...event.dataTransfer.types].includes('Files')) { event.preventDefault(); dragCount.current++; setDragging(true); } }} onDragOver={event => { if ([...event.dataTransfer.types].includes('Files')) event.preventDefault(); }} onDragLeave={event => { if ([...event.dataTransfer.types].includes('Files')) { dragCount.current = Math.max(0, dragCount.current - 1); if (!dragCount.current) setDragging(false); } }} onDrop={event => { if (!event.dataTransfer.files.length) return; event.preventDefault(); dragCount.current = 0; setDragging(false); importFiles([...event.dataTransfer.files]); }}>
    <input ref={input} type="file" accept="video/*,.mkv,.mov,.webm,.mp4" multiple hidden onChange={event => { importFiles([...event.target.files]); event.target.value = ''; }} />
    {['editor', 'watch', 'review'].includes(view) && asset ? <Editor initialTime={startTime} initialPane={editorPane} reviewMode={view === 'review'} onEdit={(pane, time) => editRecording(asset, pane, time)} onDone={finishEditing} watchMode={view === 'watch'} onWatch={() => watch(asset)} onShowAnalytics={openAnalytics} onShowSettings={() => setModal('settings')} key={`${asset.id}-${view}`} asset={asset} onUpdate={update} onBack={back} onRecord={() => setModal('recorder')} onExport={preset => exportRecording(asset, preset)} onShare={() => show('share')} onToast={toast} onRefresh={refresh} health={health} saveStatus={saveStatus} onFlush={() => flush(asset.id)} /> : <Library initialSection={view} onNavigate={next => { setView(next); route(next); }} onEdit={next => editRecording(next)} onExport={next => exportRecording(next)} onWatch={watch} assets={assets} onOpen={open} onRecord={() => setModal('recorder')} onImport={() => input.current.click()} onUpdate={update} onRefresh={refresh} onToast={toast} jobs={jobs} onShowJobs={() => setModal('jobs')} onShowSettings={() => setModal('settings')} />}
    {saveStatus === 'error' && ['editor', 'review'].includes(view) && <div style={saveErrorStyle} role="alert"><WarningCircle size={16} /><span>Changes are still on screen but could not be saved.</span><button onClick={retry} style={textButtonStyle}>Retry save</button></div>}
    {activeJobs.length > 0 && modal !== 'jobs' && <button className="button" style={queuePillStyle} onClick={() => setModal('jobs')}><DownloadSimple size={17} />{activeJobs.length} export{activeJobs.length === 1 ? '' : 's'} in queue</button>}
    {modal === 'recorder' && <Recorder onClose={() => setModal(null)} onSaved={recorded} onToast={toast} />}
    {modal === 'export' && asset && <ExportDialog initialPreset={exportPreset} asset={asset} onClose={() => setModal(null)} onQueued={queued} onToast={toast} />}
    {modal === 'share' && asset && <Share onWatch={() => watch(asset)} asset={asset} onClose={() => setModal(null)} onQueued={queued} onToast={toast} onFlush={() => flush(asset.id)} />}
    {modal === 'jobs' && <Jobs jobs={jobs} onJobs={updateJobs} onClose={() => setModal(null)} onToast={toast} />}
    {modal === 'settings' && <Settings appearance={appearance} onAppearanceChange={setAppearance} health={health} onClose={() => { setModal(null); api('/health').then(setHealth).catch(() => {}); }} onToast={toast} />}
    {importing && <div style={importStyle} role="status"><Spinner>{importing}</Spinner></div>}
    {dragging && <div style={dropStyle}><UploadSimple size={45} weight="light" /><strong style={{ fontSize: 22, marginTop: 18 }}>Drop videos to import</strong><span style={{ color: 'var(--theme-ink-secondary,#b3bdc8)', fontSize: 13, marginTop: 9 }}>Original files are copied to your local library.</span></div>}
    <div style={toastStackStyle} aria-live="polite" aria-atomic="false">{toasts.map(item => <div key={item.id} style={{ ...toastStyle, borderColor: item.type === 'error' ? 'var(--theme-danger-edge,#82564a)' : 'var(--theme-success-edge,#435046)' }}>{item.type === 'error' ? <WarningCircle size={19} color="var(--theme-danger-ink,#e4a38c)" /> : <CheckCircle size={19} color="var(--theme-success-ink,#b2c1a0)" />}<span style={{ flex: 1, fontSize: 12, lineHeight: 1.6 }}>{item.message}</span><button style={toastCloseStyle} aria-label="Dismiss notification" onClick={() => setToasts(items => items.filter(value => value.id !== item.id))}><X size={15} /></button></div>)}</div>
  </div>;
}

const screenStyle = { display: 'grid', placeItems: 'center', minHeight: '100dvh', background: 'var(--theme-canvas,#171b20)', color: 'var(--theme-ink,#e7ebef)', fontFamily: 'Inter, sans-serif' };
const toastStackStyle = { position: 'fixed', bottom: 22, right: 24, zIndex: 150, display: 'flex', flexDirection: 'column', gap: 8, width: 'min(410px,calc(100vw - 32px))', pointerEvents: 'none' };
const toastStyle = { display: 'flex', alignItems: 'flex-start', gap: 10, padding: '13px 14px', border: '1px solid', borderRadius: 8, background: 'var(--theme-raised,#282f36)', color: 'var(--theme-ink,#e2e8ef)', boxShadow: '0 6px 24px var(--theme-shadow,#0005)', pointerEvents: 'auto' };
const toastCloseStyle = { border: 0, padding: 1, background: 'transparent', color: 'var(--theme-ink-secondary,#98a5b3)', cursor: 'pointer' };
const importStyle = { position: 'fixed', left: '50%', bottom: 28, transform: 'translateX(-50%)', zIndex: 140, color: 'var(--theme-accent-ink,#e8d0a2)', background: 'var(--theme-accent-soft,#302c25)', border: '1px solid var(--theme-accent-edge,#77603e)', borderRadius: 8, padding: '15px 20px', maxWidth: '90vw', fontSize: 12 };
const dropStyle = { position: 'fixed', inset: 15, zIndex: 160, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--theme-drop-surface,#1b2025f5)', color: 'var(--theme-accent-ink,#f3bd60)', border: '2px dashed var(--theme-accent-edge,#c9a060)', borderRadius: 12, pointerEvents: 'none' };
const queuePillStyle = { position: 'fixed', bottom: 19, left: 19, zIndex: 65, minHeight: 35, fontSize: 11, background: 'var(--theme-raised,#282d33)', borderColor: 'var(--theme-edge-strong,#4a4540)', color: 'var(--theme-accent-ink,#eac791)', boxShadow: '0 4px 20px var(--theme-shadow,#0004)' };
const saveErrorStyle = { position: 'fixed', top: 75, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 9, padding: '10px 15px', background: 'var(--theme-danger-soft,#402d25)', border: '1px solid var(--theme-danger-edge,#855445)', borderRadius: 6, fontSize: 11, zIndex: 70, color: 'var(--theme-danger-ink,#e9bdac)' };
const textButtonStyle = { border: 0, background: 'transparent', color: 'var(--theme-accent-ink,#f3bd60)', textDecoration: 'underline', font: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' };
