import React, { useEffect, useMemo, useState } from 'react';
import { Archive, ArrowCounterClockwise, ArrowDown, ArrowUp, Check, Copy, DotsThree, DownloadSimple, FilmStrip, FolderSimple, Gear, HardDrive, MagnifyingGlass, PencilSimple, Play, Plus, Rows, SquaresFour, Star, UploadSimple, VideoCamera, X } from '@phosphor-icons/react';
import { api, bytes, relativeDate, time, editedDuration } from '../lib';
import { Empty, IconButton, Modal, Spinner } from './UI';
import './library.css';
import { ChartBar, Eye } from '@phosphor-icons/react';
import { reviewTranscript } from '../review.js';
import { useLocalActivity } from '../useLocalActivity.js';
import Analytics from './Analytics.jsx';
import Brand from './Brand.jsx';
import CompositionThumbnail from './CompositionThumbnail.jsx';

const viewKey = 'replay.library.view';
function initialView() { try { return localStorage.getItem(viewKey) === 'list' ? 'list' : 'grid'; } catch { return 'grid'; } }
const plural = (n, word = 'recording') => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function Library({ initialSection = 'library', onNavigate, onWatch, onEdit, onExport, assets = [], onOpen, onRecord, onImport, onUpdate, onRefresh, onToast, jobs = [], onShowJobs, onShowSettings }) {
  const activity = useLocalActivity();
  const [section, setSection] = useState(initialSection);
  useEffect(() => { setSection(previous => initialSection === 'analytics' ? 'analytics' : previous === 'analytics' ? 'library' : previous); }, [initialSection]);
  const [view, setView] = useState(initialView);
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState('');
  const [sort, setSort] = useState('recent');
  const [selected, setSelected] = useState([]);
  const [menu, setMenu] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [name, setName] = useState('');
  const [folderSelection, setFolderSelection] = useState([]);
  const [busy, setBusy] = useState(false);
  const [exportType, setExportType] = useState('mp4');
  const [stitchIds, setStitchIds] = useState([]);
  const [exportProgress, setExportProgress] = useState('');
  const [error, setError] = useState('');
  const active = useMemo(() => assets.filter(a => !a.archived), [assets]);
  const folders = useMemo(() => [...new Set(active.map(a => a.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [active]);
  const activeJobs = jobs.filter(job => ['queued', 'running'].includes(job.status)).length;
  const visible = useMemo(() => {
    const search = query.trim().toLowerCase();
    const list = assets.filter(asset => {
      if (section === 'archive' ? !asset.archived : asset.archived) return false;
      if (section === 'favorites' && !asset.favorite) return false;
      if (folder && asset.folder !== folder) return false;
      const haystack = [asset.title, asset.folder, ...(asset.tags || []), ...reviewTranscript(asset).map(cue => cue.text)].join(' ').toLowerCase();
      return !search || haystack.includes(search);
    });
    return list.sort((a, b) => sort === 'title' ? (a.title || '').localeCompare(b.title || '') : sort === 'duration' ? (b.duration || 0) - (a.duration || 0) : sort === 'oldest' ? new Date(a.createdAt) - new Date(b.createdAt) : new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  }, [assets, section, folder, query, sort]);
  const selectedAssets = assets.filter(asset => selected.includes(asset.id));

  useEffect(() => { setSelected(ids => ids.filter(id => assets.some(asset => asset.id === id))); }, [assets]);
  useEffect(() => {
    if (!menu) return;
    const close = event => { if (!event.target.closest('.library-more-wrap')) setMenu(null); };
    const key = event => { if (event.key === 'Escape') setMenu(null); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key); };
  }, [menu]);

  function navigate(next, nextFolder = '') { onNavigate?.(next === 'analytics' ? 'analytics' : 'library'); setSection(next); setFolder(nextFolder); setSelected([]); setMenu(null); }
  function changeView(next) { setView(next); try { localStorage.setItem(viewKey, next); } catch {} }
  function toggle(id) { setSelected(ids => ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id]); }
  function openDialog(next) { setDialog(next); setError(''); setMenu(null); }
  function closeDialog() { if (!busy) { setDialog(null); setError(''); } }
  async function run(action, message) {
    setBusy(true); setError('');
    try { await action(); await onRefresh?.(); if (message) onToast?.(message); return true; }
    catch (err) { setError(err.message); onToast?.(err.message); return false; }
    finally { setBusy(false); }
  }
  async function update(asset, patch) {
    if (onUpdate) await onUpdate(asset, patch);
    else await api(`/assets/${asset.id}`, { method: 'PATCH', body: patch });
  }
  async function favorite(asset) { await run(() => update(asset, { favorite: !asset.favorite })); }
  async function duplicate(asset) { setMenu(null); await run(() => api(`/assets/${asset.id}/duplicate`, { method: 'POST' }), 'Recording duplicated'); }
  async function restore(items) {
    const ok = await run(async () => { for (const asset of items) await api(`/assets/${asset.id}/restore`, { method: 'POST' }); }, `${plural(items.length)} restored`);
    if (ok) setSelected([]);
  }
  function makeFolder(items = selected) { setName(''); setFolderSelection(items); openDialog({ type: 'folder' }); }
  async function saveFolder(event) {
    event.preventDefault(); if (!name.trim() || !folderSelection.length) return;
    const ok = await run(async () => { for (const asset of active.filter(a => folderSelection.includes(a.id))) await update(asset, { folder: name.trim() }); }, `Moved to ${name.trim()}`);
    if (ok) { setDialog(null); navigate('library', name.trim()); }
  }
  async function stitch(event) {
    event.preventDefault();
    if (stitchIds.length < 2 || stitchIds.length > 10 || !name.trim()) return;
    setBusy(true); setError('');
    try {
      await onRefresh?.();
      const result = await api('/assets/stitch', { method: 'POST', body: { assetIds: stitchIds, title: name.trim() } });
      await onRefresh?.(); setDialog(null); setSelected([]); onToast?.('Recordings stitched into a new video'); onOpen?.(result);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  function reorderStitch(index, direction) {
    setStitchIds(ids => { const next = [...ids], target = index + direction; if (target < 0 || target >= next.length) return ids; [next[index], next[target]] = [next[target], next[index]]; return next; });
  }
  async function archive() {
    const items = dialog.assets;
    const ok = await run(async () => { for (const asset of items) await api(`/assets/${asset.id}`, { method: 'DELETE' }); }, `${plural(items.length)} archived`);
    if (ok) { setSelected([]); setDialog(null); }
  }
  async function rename(event) {
    event.preventDefault(); if (!name.trim()) return;
    if (await run(() => update(dialog.asset, { title: name.trim() }), 'Recording renamed')) setDialog(null);
  }
  async function exportSelected() {
    const items = dialog.assets; let queued = 0; const failures = [];
    setBusy(true); setError('');
    for (const asset of items) {
      setExportProgress(`Preparing ${queued + failures.length + 1} of ${items.length}`);
      const formats = exportType === 'mp4' ? ['mp4'] : ['mp4', 'json', 'zip', ...(asset.transcript?.length ? ['txt', 'srt'] : [])];
      try { await api('/exports', { method: 'POST', body: { assetId: asset.id, formats, preset: asset.edits?.aspect || 'original', resolution: 1080, burnCaptions: Boolean(asset.edits?.captions && asset.transcript?.length), includeSources: false, quality: 'balanced' } }); queued++; }
      catch (err) { failures.push(`${asset.title}: ${err.message}`); }
    }
    setBusy(false); setExportProgress('');
    try { await onRefresh?.(); } catch (err) { failures.push(`Could not refresh the queue: ${err.message}`); }
    if (failures.length) { setError(`${queued} queued. ${failures.join(' ')}`); if (queued) onToast?.(`${queued} export${queued === 1 ? '' : 's'} queued`); }
    else { setDialog(null); setSelected([]); onToast?.(`${queued} export${queued === 1 ? '' : 's'} queued`); onShowJobs?.(); }
  }

  const heading = section === 'favorites' ? 'Your favorites' : section === 'archive' ? 'Archive' : folder || 'Your recordings';
  const description = section === 'archive' ? 'Archived recordings stay here until you restore them.' : section === 'favorites' ? 'The recordings you want close at hand.' : folder ? 'A little more organized. A lot easier to find.' : 'Everything you record, ready for what comes next.';

  return <div className="library-shell">
    <aside className="library-sidebar" aria-label="Library navigation">
      <Brand className="library-brand" onClick={() => navigate('library')} />
      <div className="library-workspace"><span className="library-workspace-avatar">R</span><div><strong>My workspace</strong><small><span /> Local workspace</small></div></div>
      <nav className="library-nav">
        {[[FilmStrip, 'library', 'Library', active.length], [Star, 'favorites', 'Favorites', active.filter(a => a.favorite).length], [Archive, 'archive', 'Archive', assets.length - active.length]].map(([Icon, id, label, count]) => <button key={id} className={section === id && !folder ? 'active' : ''} onClick={() => navigate(id)} aria-current={section === id && !folder ? 'page' : undefined}><Icon size={20} />{label}<span>{count}</span></button>)}
        <button className={section === 'analytics' ? 'active' : ''} aria-current={section === 'analytics' ? 'page' : undefined} onClick={() => navigate('analytics')}><ChartBar size={20} />Analytics</button>
        <button onClick={onShowJobs}><DownloadSimple size={20} />Exports{activeJobs > 0 && <span className="library-job-count">{activeJobs}</span>}</button>
      </nav>
      <div className="library-folder-heading"><span>FOLDERS</span><IconButton icon={Plus} label="Create a folder" onClick={() => makeFolder()} disabled={!active.length || busy} /></div>
      <nav className="library-folder-nav" aria-label="Folders">{folders.length ? folders.map(item => <button key={item} onClick={() => navigate('library', item)} className={folder === item ? 'active' : ''}><FolderSimple size={18} /><span>{item}</span><small>{active.filter(a => a.folder === item).length}</small></button>) : <p>Group recordings by project<br />or client.</p>}</nav>
      <div className="library-sidebar-bottom"><button className="library-settings-link" onClick={onShowSettings}><Gear size={20} />Settings</button><div className="library-storage"><HardDrive size={17} /><div><strong>Saved on this computer</strong><small>{assets.length ? `${bytes(assets.reduce((sum, a) => sum + (a.size || 0), 0))} in your library` : 'Your recordings stay local'}</small></div></div></div>
    </aside>

    {section === 'analytics' ? <Analytics assets={assets} onOpen={onEdit} onWatch={onWatch} /> : <main className="library-main">
      <div className="library-topline"><span>WORKSPACE / <strong>{section === 'archive' ? 'ARCHIVE' : 'LIBRARY'}</strong></span><div className="library-local-indicator"><span /> Local workspace</div></div>
      <header className="library-header"><div><h1>{heading}</h1><p>{description}</p></div><div className="library-header-actions"><button className="button subtle" onClick={onImport}><UploadSimple size={19} />Import video</button><button className="button primary" onClick={onRecord}><VideoCamera size={20} />Record</button></div></header>

      <div className="library-toolbar"><label className="library-search"><MagnifyingGlass size={19} /><input value={query} onChange={e => { setQuery(e.target.value); setSelected([]); }} placeholder="Search recordings, transcripts, tags..." aria-label="Search recordings, transcripts and tags" />{query && <IconButton icon={X} label="Clear search" onClick={() => setQuery('')} />}</label><div className="library-toolbar-right"><label className="library-sort"><span className="library-sr-only">Sort recordings</span><select value={sort} onChange={e => setSort(e.target.value)}><option value="recent">Recently edited</option><option value="oldest">Oldest first</option><option value="title">Title A to Z</option><option value="duration">Longest first</option></select></label><div className="library-view-switch" aria-label="Display mode"><button onClick={() => changeView('grid')} className={view === 'grid' ? 'active' : ''} aria-label="Grid view" aria-pressed={view === 'grid'}><SquaresFour size={19} /></button><button onClick={() => changeView('list')} className={view === 'list' ? 'active' : ''} aria-label="List view" aria-pressed={view === 'list'}><Rows size={19} /></button></div></div></div>

      <div className="library-results-heading"><div><label className="library-select-all"><input type="checkbox" aria-label="Select all visible recordings" checked={visible.length > 0 && visible.every(a => selected.includes(a.id))} disabled={!visible.length} onChange={e => setSelected(e.target.checked ? visible.map(a => a.id) : [])} /><span>{selected.length ? `${selected.length} selected` : plural(visible.length)}</span></label>{query && <span className="library-search-result">matching “{query}”</span>}</div>{folder && <button className="library-clear-filter" onClick={() => setFolder('')}><X size={13} />{folder}</button>}</div>

      {selected.length > 0 && <div className="library-bulk-bar"><span><Check size={16} />{selected.length} selected</span><div>{section === 'archive' ? <button onClick={() => restore(selectedAssets)} disabled={busy}><ArrowCounterClockwise size={17} />Restore</button> : <><button onClick={() => { setExportType('mp4'); openDialog({ type: 'export', assets: selectedAssets }); }} disabled={busy}><DownloadSimple size={17} />Export</button><button onClick={() => { setStitchIds(selected); setName("Combined recording"); openDialog({ type: "stitch" }); }} disabled={busy || selected.length < 2 || selected.length > 10} title="Combine 2 to 10 recordings into one video"><FilmStrip size={17} />Stitch</button><button onClick={() => makeFolder()} disabled={busy}><FolderSimple size={17} />Move to folder</button><button onClick={() => openDialog({ type: 'archive', assets: selectedAssets })} disabled={busy}><Archive size={17} />Archive</button></>}<IconButton icon={X} label="Clear selection" onClick={() => setSelected([])} disabled={busy} /></div></div>}

      {error && !dialog && <p className="library-inline-error" role="alert">{error}</p>}
      {visible.length ? <div className={`library-assets library-assets-${view}`}>
        {view === 'list' && <div className="library-list-head"><span>Recording</span><span>Folder</span><span>Updated</span><span>Duration</span><span /></div>}
        {visible.map(asset => { const matches = query.trim() ? reviewTranscript(asset).filter(cue => cue.text.toLowerCase().includes(query.trim().toLowerCase())) : []; const stats = activity.rows?.find(row => row.assetId === asset.id); return <article key={asset.id} className={`library-card ${selected.includes(asset.id) ? 'is-selected' : ''}`}>
          <div className="library-thumbnail-wrap"><button className="library-thumbnail" onClick={() => onOpen?.(asset)} aria-label={`Open ${asset.title}`}>{asset.thumbnailUrl ? <CompositionThumbnail asset={asset} contain /> : <FilmStrip size={36} weight="light" />}<span className="library-play"><Play size={25} weight="fill" /></span><span className="library-duration">{time(editedDuration(asset))}</span></button><label className="library-card-checkbox"><input type="checkbox" checked={selected.includes(asset.id)} onChange={() => toggle(asset.id)} aria-label={`Select ${asset.title}`} /></label>{asset.sample && <span className="library-sample-badge">SAMPLE</span>}</div>
          <div className="library-card-body"><button className="library-card-title" onClick={() => onOpen?.(asset)} title={asset.title}>{asset.title || 'Untitled recording'}</button><div className="library-card-meta"><span>{relativeDate(asset.updatedAt || asset.createdAt)}</span><span className="library-meta-dot">·</span><span>{asset.sample ? 'Synthetic sample' : 'Local recording'}</span></div>{stats && <span className="library-view-count" title="Local watch-page views in the last 30 days"><Eye size={13} />{stats.views} {stats.views === 1 ? 'view' : 'views'} · 30 days</span>}{matches.length > 0 && <button className="library-transcript-match" onClick={() => onOpen(asset, matches[0].start)}><span>{time(matches[0].start)}</span><span>{matches[0].text}</span>{matches.length > 1 && <small>+{matches.length - 1}</small>}</button>}{asset.tags?.length > 0 && <div className="library-card-tags">{asset.tags.slice(0, 3).map(tag => <button key={tag} onClick={() => { setQuery(tag); setSelected([]); }}>#{tag}</button>)}</div>}</div>
          <div className="library-list-folder">{asset.folder ? <><FolderSimple size={15} />{asset.folder}</> : <span>Unfiled</span>}</div><span className="library-list-date">{relativeDate(asset.updatedAt || asset.createdAt)}</span><span className="library-list-duration">{time(editedDuration(asset))}</span>
          <div className="library-card-actions">{!asset.archived && <div className="library-quick-actions"><IconButton icon={Eye} label={`Watch ${asset.title}`} onClick={() => onWatch(asset)} /><IconButton icon={PencilSimple} label={`Edit ${asset.title}`} onClick={() => onEdit(asset)} /><IconButton icon={DownloadSimple} label={`Download ${asset.title}`} onClick={() => onExport(asset)} /></div>}<button className={`library-favorite ${asset.favorite ? 'is-favorite' : ''}`} onClick={() => favorite(asset)} disabled={busy} aria-label={asset.favorite ? `Unfavorite ${asset.title}` : `Favorite ${asset.title}`} aria-pressed={!!asset.favorite}><Star size={19} weight={asset.favorite ? 'fill' : 'regular'} /></button><div className="library-more-wrap"><IconButton icon={DotsThree} label={`Actions for ${asset.title}`} aria-expanded={menu === asset.id} onClick={() => setMenu(menu === asset.id ? null : asset.id)} />{menu === asset.id && <div className="library-action-menu"><button onClick={() => { setMenu(null); onOpen?.(asset); }}><Play size={17} />Review recording</button><button onClick={() => { setMenu(null); onEdit(asset); }}><PencilSimple size={17} />Edit video</button><button onClick={() => { setMenu(null); onWatch?.(asset); }}><Eye size={17} />Watch page</button>{!asset.archived && <><button onClick={() => { setName(asset.title || ''); openDialog({ type: 'rename', asset }); }} disabled={busy}><PencilSimple size={17} />Rename</button><button onClick={() => makeFolder([asset.id])} disabled={busy}><FolderSimple size={17} />Move to folder</button>{asset.folder && <button onClick={async () => { setMenu(null); await run(() => update(asset, { folder: 'My library' }), 'Moved to My library'); }} disabled={busy}><X size={17} />Move to My library</button>}<button onClick={() => duplicate(asset)} disabled={busy}><Copy size={17} />Duplicate</button><button onClick={() => { setExportType('mp4'); openDialog({ type: 'export', assets: [asset] }); }} disabled={busy}><DownloadSimple size={17} />Export</button><button className="library-menu-separated" onClick={() => openDialog({ type: 'archive', assets: [asset] })} disabled={busy}><Archive size={17} />Archive</button></>}{asset.archived && <button onClick={() => { setMenu(null); restore([asset]); }} disabled={busy}><ArrowCounterClockwise size={17} />Restore recording</button>}</div>}</div></div>
        </article>; })}
      </div> : <div className="library-empty"><Empty icon={query ? MagnifyingGlass : section === 'archive' ? Archive : section === 'favorites' ? Star : FilmStrip} title={query ? 'No recordings found' : section === 'archive' ? 'Your archive is empty' : section === 'favorites' ? 'Keep your best work close' : folder ? 'This folder is empty' : 'Your next great explanation starts here'} action={query ? <button className="button subtle" onClick={() => { setQuery(''); setFolder(''); }}>Clear filters</button> : section === 'library' && <button className="button primary" onClick={onRecord}><VideoCamera size={20} />Record your first video</button>}>{query ? 'Try another title, tag or phrase from a transcript.' : section === 'archive' ? 'Recordings you archive can be restored from here.' : section === 'favorites' ? 'Star a recording to find it here whenever you need it.' : 'Capture a walkthrough or import a video to get started.'}</Empty></div>}
      <footer className="library-footer"><HardDrive size={15} /><span>Originals stay on your computer. Your edits are reversible.</span></footer>
    </main>}

    {dialog && <Modal title={dialog.type === 'folder' ? 'Move to a folder' : dialog.type === 'rename' ? 'Rename recording' : dialog.type === 'stitch' ? 'Stitch recordings' : dialog.type === 'archive' ? `Archive ${plural(dialog.assets.length)}?` : `Export ${plural(dialog.assets.length)}`} onClose={closeDialog} className="library-dialog">
      {dialog.type === 'folder' && <form onSubmit={saveFolder}><div className="library-dialog-body"><p>Choose a folder name and the recordings to include.</p><label className="library-field">Folder name<input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Client walkthroughs" maxLength={80} list="library-folder-options" required /><datalist id="library-folder-options">{folders.map(f => <option key={f} value={f} />)}</datalist></label><div className="library-folder-picker">{active.map(asset => <label key={asset.id}><input type="checkbox" checked={folderSelection.includes(asset.id)} onChange={e => setFolderSelection(ids => e.target.checked ? [...ids, asset.id] : ids.filter(id => id !== asset.id))} /><span>{asset.title}</span><small>{time(editedDuration(asset))}</small></label>)}</div></div><DialogError message={error} /><div className="library-dialog-footer"><button type="button" className="button subtle" onClick={closeDialog} disabled={busy}>Cancel</button><button className="button primary" disabled={busy || !name.trim() || !folderSelection.length}>{busy ? <Spinner>Moving</Spinner> : 'Move recordings'}</button></div></form>}
      {dialog.type === 'rename' && <form onSubmit={rename}><div className="library-dialog-body"><label className="library-field">Recording title<input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={180} required /></label></div><DialogError message={error} /><div className="library-dialog-footer"><button type="button" className="button subtle" onClick={closeDialog} disabled={busy}>Cancel</button><button className="button primary" disabled={busy || !name.trim()}>{busy ? <Spinner>Saving</Spinner> : 'Save title'}</button></div></form>}
      {dialog.type === 'stitch' && <form onSubmit={stitch}><div className="library-dialog-body"><p>Choose the order for your combined video. Your original recordings stay in the library.</p><label className="library-field">New recording title<input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={180} required /></label><div className="library-folder-picker">{stitchIds.map((id, index) => { const item = assets.find(a => a.id === id); return <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--theme-edge,#313943)', fontSize: 11 }}><span style={{ color: 'var(--theme-ink-muted,#8e9ba8)' }}>{index + 1}.</span><span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item?.title}</span><IconButton icon={ArrowUp} label={`Move ${item?.title} earlier`} disabled={busy || index === 0} onClick={() => reorderStitch(index, -1)} type="button" /><IconButton icon={ArrowDown} label={`Move ${item?.title} later`} disabled={busy || index === stitchIds.length - 1} onClick={() => reorderStitch(index, 1)} type="button" /></div>; })}</div>{busy && <p style={{ marginTop: 15 }} role="status">Rendering your combined video. This can take a little while.</p>}</div><DialogError message={error} /><div className="library-dialog-footer"><button type="button" className="button subtle" onClick={closeDialog} disabled={busy}>Cancel</button><button className="button primary" disabled={busy || !name.trim() || stitchIds.length < 2 || stitchIds.length > 10}>{busy ? <Spinner>Stitching recordings</Spinner> : 'Create combined video'}</button></div></form>}
      {dialog.type === 'archive' && <><div className="library-dialog-body"><p>{dialog.assets.length === 1 ? `“${dialog.assets[0].title}” will move to Archive.` : 'These recordings will move to Archive.'} Your original files and edits are kept. You can restore them at any time.</p></div><DialogError message={error} /><div className="library-dialog-footer"><button className="button subtle" onClick={closeDialog} disabled={busy}>Keep in library</button><button className="button primary" onClick={archive} disabled={busy}>{busy ? <Spinner>Archiving</Spinner> : 'Move to archive'}</button></div></>}
      {dialog.type === 'export' && <><div className="library-dialog-body"><p>Each recording gets its own export. Saved edits are applied.</p><div className="library-export-options"><label className={exportType === 'mp4' ? 'selected' : ''}><input type="radio" name="library-export" value="mp4" checked={exportType === 'mp4'} onChange={() => setExportType('mp4')} /><div><strong>MP4 video</strong><small>1080p · Saved layout · Balanced quality</small></div></label><label className={exportType === 'zip' ? 'selected' : ''}><input type="radio" name="library-export" value="zip" checked={exportType === 'zip'} onChange={() => setExportType('zip')} /><div><strong>Portable bundle</strong><small>MP4, metadata and available transcript/subtitles in a ZIP</small></div></label></div><p className="library-export-note">For more formats, framing and quality controls, open a recording and choose Export.</p></div><DialogError message={error} /><div className="library-dialog-footer"><button className="button subtle" onClick={closeDialog} disabled={busy}>Cancel</button><button className="button primary" onClick={exportSelected} disabled={busy}>{busy ? <Spinner>{exportProgress || 'Preparing'}</Spinner> : <><DownloadSimple size={18} />Queue exports</>}</button></div></>}
    </Modal>}
  </div>;
}

function DialogError({ message }) { return message ? <p className="library-dialog-error" role="alert">{message}</p> : null; }
