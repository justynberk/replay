import { useMemo, useState } from 'react';
import { ArrowSquareOut, ChartBar, Check, FileText, LinkSimple, MagnifyingGlass, PencilSimple, Plus, Trash, X } from '@phosphor-icons/react';
import { time, uid, sourceToEditedTime } from '../lib.js';
import { reviewChapters, reviewTranscript, safeResourceUrl } from '../review.js';
import { useLocalActivity } from '../useLocalActivity.js';
import { Empty, IconButton, Modal } from './UI.jsx';

export default function ReviewPanel({ asset, owner, position, onSeek, onEdit, onUpdate, onAnalytics, onToast }) {
  const [tab, setTab] = useState('overview'), [search, setSearch] = useState('');
  const [editingSummary, setEditingSummary] = useState(false), [summary, setSummary] = useState('');
  const [resources, setResources] = useState(null), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const transcript = useMemo(() => reviewTranscript(asset), [asset]);
  const chapters = useMemo(() => reviewChapters(asset), [asset]);
  const visible = transcript.filter(cue => cue.text.toLowerCase().includes(search.trim().toLowerCase()));
  const editedPosition = sourceToEditedTime(asset, position);
  const activity = useLocalActivity(owner), stats = activity.rows?.find(row => row.assetId === asset.id);
  const links = (asset.resources || []).filter(link => safeResourceUrl(link.url));
  const activeChapter = chapters.findLast(chapter => editedPosition + .025 >= chapter.start);
  const startSummary = () => { setSummary(asset.summary || ''); setEditingSummary(true); };
  const startResources = () => { setResources(links.map(link => ({ ...link }))); setError(''); };

  async function saveSummary() {
    setSaving(true);
    try { await onUpdate(asset, { summary }); setEditingSummary(false); }
    catch { onToast('The summary could not be saved. Your text is still here.', 'error'); }
    finally { setSaving(false); }
  }
  async function saveResources(event) {
    event.preventDefault();
    if (resources.some(link => !link.title.trim() || !safeResourceUrl(link.url))) { setError('Give each resource a name and a full http or https link.'); return; }
    setSaving(true); setError('');
    try { await onUpdate(asset, { resources: resources.map(link => ({ ...link, title: link.title.trim(), url: safeResourceUrl(link.url) })) }); setResources(null); }
    catch { setError('Resources could not be saved. Try again.'); }
    finally { setSaving(false); }
  }

  return <aside className="review-panel" aria-label={owner ? 'Recording review' : 'Video information'}>
    <div className="review-tabs" role="tablist" aria-label="Recording information">{['overview', 'transcript'].map(value => <button key={value} id={`review-tab-${value}`} role="tab" aria-selected={tab === value} aria-controls={`review-${value}`} onClick={() => setTab(value)} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 'overview' : event.key === 'End' ? 'transcript' : value === 'overview' ? 'transcript' : 'overview'; setTab(next); document.getElementById(`review-tab-${next}`)?.focus(); } }} tabIndex={tab === value ? 0 : -1}>{value === 'overview' ? 'Overview' : 'Transcript'}{value === 'transcript' && transcript.length > 0 && <span>{transcript.length}</span>}</button>)}</div>
    <div className="review-panel-content" id={`review-${tab}`} role="tabpanel" aria-labelledby={`review-tab-${tab}`}>
      {tab === 'overview' ? <>
        <section className={`review-section ${!asset.summary && !editingSummary ? 'review-section-empty' : ''}`}><div className="review-section-heading"><h2>Summary</h2>{owner && !editingSummary && (asset.summary ? <IconButton icon={PencilSimple} label="Edit summary" onClick={startSummary} /> : <button className="review-add" onClick={startSummary}><Plus size={15} />Add summary</button>)}</div>
          {editingSummary ? <div className="review-summary-form"><textarea aria-label="Recording summary" value={summary} onChange={e => setSummary(e.target.value)} maxLength={30000} placeholder="What should someone take away from this video?" /><div className="row"><button className="button" disabled={saving} onClick={() => setEditingSummary(false)}>Cancel</button><button className="button primary" disabled={saving} onClick={saveSummary}>{saving ? 'Saving...' : 'Save summary'}</button></div></div> : <p className={asset.summary ? 'review-summary' : 'review-placeholder'}>{asset.summary || (owner ? 'Give viewers the key takeaway.' : 'No summary added.')}</p>}
        </section>
        <section className={`review-section ${!chapters.length ? 'review-section-empty' : ''}`}><div className="review-section-heading"><h2>Chapters</h2>{owner && (chapters.length ? <IconButton icon={PencilSimple} label="Edit chapters" onClick={() => onEdit('chapters')} /> : <button className="review-add" onClick={() => onEdit('chapters')}><Plus size={15} />Add chapters</button>)}</div>
          {chapters.length ? <div className="review-chapters">{chapters.map(chapter => <button key={chapter.id} onClick={() => onSeek(chapter.sourceStart)} className={activeChapter?.id === chapter.id ? 'active' : ''} aria-current={activeChapter?.id === chapter.id ? 'true' : undefined}><span>{time(chapter.start)}</span><strong>{chapter.title}</strong></button>)}</div> : <p className="review-placeholder">{owner ? 'Make key moments easy to find.' : 'No chapters added.'}</p>}
        </section>
        {(owner || links.length > 0) && <section className={`review-section ${!links.length ? 'review-section-empty' : ''}`}><div className="review-section-heading"><h2>Resources</h2>{owner && (links.length ? <IconButton icon={PencilSimple} label="Edit resource links" onClick={startResources} /> : <button className="review-add" onClick={startResources}><Plus size={15} />Add link</button>)}</div>{links.length ? <div className="review-resources">{links.map(link => <a key={link.id} href={safeResourceUrl(link.url)} target="_blank" rel="noopener noreferrer"><LinkSimple size={17} /><span>{link.title}</span><ArrowSquareOut size={16} /></a>)}</div> : <p className="review-placeholder">Share a useful link or next step.</p>}</section>}
        {owner && <section className="review-section review-activity"><div className="review-section-heading"><h2>Viewing activity</h2><span className="review-period">30 days · local</span></div>{stats ? <div className="review-stats"><div><strong>{stats.views}</strong><span>Views</span></div><div><strong className={!stats.views ? 'is-empty' : undefined}>{stats.views ? time(stats.averageWatchSeconds) : 'No views'}</strong><span>Avg. watch time</span></div><div><strong className={!stats.views ? 'is-empty' : undefined}>{stats.views ? `${Math.round(stats.completionRate * 100)}%` : 'No views'}</strong><span title="Views that watched at least 90% of the video">Completion</span></div></div> : <p className="review-placeholder">{activity.error ? 'Viewing activity could not be loaded.' : 'Loading viewing activity...'}</p>}<button className="review-text-button" onClick={onAnalytics}><ChartBar size={16} />Open analytics</button></section>}
      </> : <>
        <label className="review-search"><MagnifyingGlass size={18} /><input aria-label="Search this transcript" placeholder="Find a word or phrase" value={search} onChange={e => setSearch(e.target.value)} />{search && <IconButton icon={X} label="Clear transcript search" onClick={() => setSearch('')} />}</label>
        {transcript.length ? <><p className="review-transcript-hint" aria-live="polite">{search.trim() ? `${visible.length} matching passage${visible.length === 1 ? '' : 's'}` : 'Select any passage to jump to that moment.'}</p><div className="review-transcript">{visible.map(cue => <button key={cue.id} className={editedPosition + .025 >= cue.start && editedPosition + .025 < cue.end ? 'active' : ''} onClick={() => onSeek(cue.sourceStart)}><span>{time(cue.start)}</span><p>{cue.text}</p></button>)}</div>{!visible.length && <p className="review-placeholder review-no-results">No passages match. Try a different phrase.</p>}</> : <Empty icon={FileText} title="No transcript yet">{owner ? 'Import an SRT or VTT file in the editor to add searchable captions.' : 'A transcript has not been added to this recording.'}{owner && <button className="button" onClick={() => onEdit('captions')}>Add captions</button>}</Empty>}
      </>}
    </div>
    {owner && <footer className="review-panel-footer"><Check size={15} />Reviewing here does not add views.</footer>}
    {resources && <Modal title="Resource links" onClose={() => { if (!saving) setResources(null); }}><form className="modal-body" onSubmit={saveResources}><p className="small-copy">These links appear beside the video and in your project package.</p>{resources.map((link, index) => <div className="resource-fields" key={link.id}><div className="row between"><strong>Resource {index + 1}</strong><IconButton type="button" icon={Trash} label={`Remove resource ${index + 1}`} disabled={saving} onClick={() => setResources(resources.filter(item => item.id !== link.id))} /></div><label>Name<input required maxLength={120} value={link.title} disabled={saving} onChange={event => setResources(resources.map(item => item.id === link.id ? { ...item, title: event.target.value } : item))} placeholder="Download the worksheet" /></label><label>Link<input required type="url" maxLength={2048} value={link.url} disabled={saving} onChange={event => setResources(resources.map(item => item.id === link.id ? { ...item, url: event.target.value } : item))} placeholder="https://..." /></label></div>)}<button type="button" className="button" disabled={resources.length >= 10 || saving} onClick={() => setResources([...resources, { id: uid(), title: '', url: '' }])}><Plus size={17} />Add resource</button>{error && <p className="error-text" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button" disabled={saving} onClick={() => setResources(null)}>Cancel</button><button className="button primary" disabled={saving}>{saving ? 'Saving...' : 'Save resources'}</button></div></form></Modal>}
  </aside>;
}
