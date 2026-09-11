import { useEffect, useMemo, useRef, useState } from 'react';
import { ChatCircle, Play, Pause, SpeakerHigh, SpeakerSlash, CornersOut, ArrowSquareOut } from '@phosphor-icons/react';
import { api, defaultEdits, time } from '../lib.js';
import { useWatchAnalytics } from '../useWatchAnalytics.js';
import './watch.css';

export default function WatchPage() {
  const token = new URLSearchParams(location.search).get('watch') || '';
  const endpoint = `/watch/${encodeURIComponent(token)}`;
  const [data, setData] = useState(null), [loadError, setLoadError] = useState('');
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try { const value = await api(endpoint); if (!cancelled) { setData(value); setLoadError(''); } }
      catch (error) { if (!cancelled) setLoadError(error.message); }
    }
    refresh(); const timer = setInterval(refresh, 4000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [endpoint]);
  if (!token || loadError) return <main className="viewer-status"><WatchBrand /><h1>Watch link unavailable</h1><p role="alert">{loadError || 'Open the complete watch link shared with you.'}</p></main>;
  if (data?.status !== 'completed') return <main className="viewer-status"><WatchBrand /><h1>{['failed', 'cancelled'].includes(data?.status) ? 'This video could not be prepared' : 'Preparing your video'}</h1><p>{['failed', 'cancelled'].includes(data?.status) ? 'Ask the owner for a new watch link.' : `The finished edit will appear here automatically.${data ? ` ${data.progress || 0}%` : ''}`}</p></main>;
  return <WatchVideo data={data} endpoint={endpoint} onComment={comment => setData(current => ({ ...current, comments: [...current.comments.filter(item => item.id !== comment.id), comment] }))} />;
}

function WatchBrand() { return <div className="viewer-brand" aria-label="Replay"><span className="replay-brand-mark"><Play size={17} weight="fill" /></span><strong>Replay</strong></div>; }

function WatchVideo({ data, endpoint, onComment }) {
  const video = useRef(null), draftId = useRef(null);
  const [playing, setPlaying] = useState(false), [muted, setMuted] = useState(false), [speed, setSpeed] = useState(1);
  const [position, setPosition] = useState(0), [draftTime, setDraftTime] = useState(null);
  const [author, setAuthor] = useState(() => { try { return localStorage.getItem('replay.comment.name') || ''; } catch { return ''; } });
  const [text, setText] = useState(''), [saving, setSaving] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [selected, setSelected] = useState(null), [tab, setTab] = useState('comments'), [search, setSearch] = useState('');
  const analyticsAsset = useMemo(() => ({ id: data.id, duration: data.duration, edits: defaultEdits(data.duration) }), [data.id, data.duration]);
  useWatchAnalytics(video, analyticsAsset, true, undefined, `/api${endpoint}/activity`);
  const comments = [...data.comments].sort((a, b) => a.time - b.time || a.createdAt.localeCompare(b.createdAt));
  const toggle = () => { const el = video.current; if (!el) return; if (!el.paused) el.pause(); else el.play().catch(() => setError('Playback could not start. Try again.')); };
  const seek = value => { if (!video.current) return; video.current.currentTime = Math.max(0, Math.min(data.duration, value)); setPosition(video.current.currentTime); };
  const selectComment = comment => { video.current?.pause(); seek(comment.time); setSelected(comment.id); setTab('comments'); requestAnimationFrame(() => document.getElementById(`comment-${comment.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })); };
  function anchorDraft(force = false) {
    if (draftTime !== null && !force) return;
    video.current?.pause(); setDraftTime(video.current?.currentTime || 0); draftId.current ||= crypto.randomUUID();
  }
  async function submit(event) {
    event.preventDefault(); if (saving || !text.trim() || !author.trim()) return;
    const at = draftTime ?? video.current?.currentTime ?? 0;
    setDraftTime(at); draftId.current ||= crypto.randomUUID(); setSaving(true); setError(''); setNotice('');
    try {
      const comment = await api(`${endpoint}/comments`, { method: 'POST', body: { id: draftId.current, author: author.trim(), text: text.trim(), time: at } });
      onComment(comment); setSelected(comment.id); setText(''); setDraftTime(null); draftId.current = null; setNotice(`Comment added at ${time(comment.time, true)}.`);
      try { localStorage.setItem('replay.comment.name', author.trim()); } catch {}
    } catch (error) { setError(error.message); }
    finally { setSaving(false); }
  }
  const tabs = ['comments', 'overview', 'transcript'];
  return <div className="viewer-page">
    <header className="viewer-header"><WatchBrand /><span>Shared video</span></header>
    <main className="viewer-layout">
      <section className="viewer-player"><h1>{data.title}</h1><p className="viewer-subtitle">Watch, then leave feedback at any moment.</p>
        <video ref={video} src={data.mediaUrl} playsInline onClick={toggle} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} preload="metadata" aria-label="Shared video" onTimeUpdate={event => setPosition(event.currentTarget.currentTime)} onError={() => setError('The video could not be loaded. Refresh this page to try again.')} />
        <div className="viewer-timeline" aria-label="Video timeline with comments">
          <input type="range" min="0" max={data.duration} step=".01" value={Math.min(position, data.duration)} onChange={event => seek(Number(event.target.value))} aria-label="Playback position" />
          <div className="viewer-markers">{comments.map(comment => <button key={comment.id} aria-label={`Comment by ${comment.author} at ${time(comment.time, true)}: ${comment.text}`} title={`${time(comment.time, true)} · ${comment.author}: ${comment.text}`} aria-pressed={selected === comment.id} style={{ left: `${comment.time / data.duration * 100}%` }} onClick={() => selectComment(comment)}><span /></button>)}</div>
        </div>
        <div className="viewer-playback"><button className="viewer-play" aria-label={playing ? 'Pause video' : 'Play video'} onClick={toggle}>{playing ? <Pause size={22} /> : <Play size={22} />}</button><span>{time(position)} / {time(data.duration)}</span><div><button aria-label={muted ? 'Unmute video' : 'Mute video'} onClick={() => { video.current.muted = !muted; setMuted(!muted); }}>{muted ? <SpeakerSlash size={20} /> : <SpeakerHigh size={20} />}</button><select aria-label="Viewing speed" value={speed} onChange={event => { const rate = Number(event.target.value); video.current.playbackRate = rate; setSpeed(rate); }}>{[.5, .75, 1, 1.25, 1.5, 2].map(rate => <option key={rate} value={rate}>{rate}x</option>)}</select><button aria-label="Fullscreen video" onClick={() => video.current.closest('.viewer-player').requestFullscreen?.().catch(() => setError('Fullscreen is unavailable in this browser.'))}><CornersOut size={20} /></button></div></div>
        <div className="viewer-timeline-meta"><span>Video discussion</span><span><ChatCircle size={15} />{comments.length} {comments.length === 1 ? 'comment' : 'comments'} · Select a marker to jump</span></div>
      </section>
      <aside className="viewer-discussion" aria-label="Video discussion">
        <div className="viewer-tabs" role="tablist" aria-label="Video information">{tabs.map((value, index) => <button key={value} role="tab" id={`viewer-tab-${value}`} aria-controls={`viewer-panel-${value}`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const next = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3]; setTab(next); document.getElementById(`viewer-tab-${next}`)?.focus(); }}>{value === 'comments' ? `Comments (${comments.length})` : value === 'overview' ? 'Overview' : 'Transcript'}</button>)}</div>
        <div role="tabpanel" id={`viewer-panel-${tab}`} aria-labelledby={`viewer-tab-${tab}`} className="viewer-panel">
          {tab === 'comments' && <><form onSubmit={submit} className="viewer-comment-form"><label>Your name<input maxLength={80} autoComplete="name" required value={author} onChange={event => setAuthor(event.target.value)} placeholder="How should we call you?" disabled={saving} /></label><label>Comment<textarea required maxLength={2000} value={text} onFocus={() => anchorDraft()} onChange={event => setText(event.target.value)} placeholder="What do you think about this moment?" disabled={saving} /></label><div className="viewer-form-actions"><button type="button" className="viewer-text-button" disabled={saving} onClick={() => anchorDraft(true)}>Use current time</button><button className="button primary" disabled={saving || !text.trim() || !author.trim()}>{saving ? 'Posting...' : 'Post comment'}</button></div><p className="viewer-helper">Visible to anyone with this link. Your name is self-reported.</p>{error && <p role="alert" className="error-text">{error}</p>}<p role="status" className="viewer-helper">{notice}</p></form>
            <div className="viewer-comments">{comments.length ? comments.map(comment => <article key={comment.id} id={`comment-${comment.id}`} className={selected === comment.id ? 'selected' : ''}><div><strong>{comment.author}</strong><button onClick={() => selectComment(comment)} aria-label={`Jump to comment at ${time(comment.time, true)}`}>{time(comment.time, true)}</button></div><p>{comment.text}</p><time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</time></article>) : <div className="viewer-empty"><ChatCircle size={25} /><h2>Start the conversation</h2><p>Comments stay attached to their moment in the video.</p></div>}</div>
          </>}
          {tab === 'overview' && <div className="viewer-info"><h2>Summary</h2><p>{data.summary || 'No summary added.'}</p>{data.chapters.length > 0 && <><h2>Chapters</h2>{data.chapters.map(chapter => <button className="viewer-chapter" key={chapter.id} onClick={() => seek(chapter.start)}><span>{time(chapter.start)}</span>{chapter.title}</button>)}</>}{data.resources.length > 0 && <><h2>Resources</h2>{data.resources.map(link => <a key={link.id} href={link.url} target="_blank" rel="noopener noreferrer">{link.title}<ArrowSquareOut size={16} /></a>)}</>}</div>}
          {tab === 'transcript' && <div className="viewer-info"><label>Search transcript<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a word or phrase" /></label>{data.transcript.length ? data.transcript.filter(cue => cue.text.toLowerCase().includes(search.toLowerCase())).map(cue => <button className="viewer-chapter" key={cue.id} onClick={() => seek(cue.start)}><span>{time(cue.start)}</span>{cue.text}</button>) : <p>No transcript added.</p>}</div>}
        </div>
      </aside>
    </main>
    <footer className="viewer-footer">Shared with Replay · Viewing activity is recorded for the video owner.</footer>
  </div>;
}
