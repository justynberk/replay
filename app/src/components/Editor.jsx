import MotionControls from './MotionControls.jsx';
import { motionAt, cameraMotionFrame, motionPrivacyFrame, sourceMotionStyle } from '../motion.js';
import React, { useState, useRef, useEffect } from 'react';
import { Scissors, Record, FolderSimple, TextT, Shapes, ClosedCaptioning, SlidersHorizontal, Waveform, CaretLeft, PencilSimple, CheckCircle, ShareNetwork, Export, DotsThreeVertical, Play, Pause, SkipBack, SkipForward, ArrowCounterClockwise, SpeakerHigh, SpeakerSlash, CornersOut, MagnifyingGlass, X, MagicWand, ArrowUUpLeft, Plus, Trash, DownloadSimple, ChatCircle, ClockCounterClockwise, ListBullets, ArrowRight, FileText, UploadSimple, VideoCamera, Monitor, Check, ShieldCheck, SpinnerGap } from '@phosphor-icons/react';
import { ChartBar, Eye } from '@phosphor-icons/react';
import { useWatchAnalytics } from '../useWatchAnalytics.js';
import ReviewPanel from './ReviewPanel.jsx';
import Brand from './Brand.jsx';
import { OverlayPreview, CaptionPreview } from './MediaPreview.jsx';
import { previewPlaybackRate, previewCaptionAt } from '../review.js';
import './review.css';
import Timeline from './Timeline.jsx';
import CompositionLayer from './CompositionLayer.jsx';
import CompositionControls from './CompositionControls.jsx';
import { composition, fitFrame, frameAspect } from '../composition.js';
import { IconButton, Empty, Modal, Spinner } from './UI.jsx';
import { api, time, bytes, uid, editedDuration, keptRanges, subtitleCues, sourceToEditedTime, editedToSourceTime, nextPlayableTime, restoreSourceRange } from '../lib.js';

export default function Editor({ reviewMode = false, initialPane = 'transcript', initialTime = 0, onEdit, onDone, watchMode = false, onWatch, onShowAnalytics, onShowSettings, asset, onUpdate, onBack, onRecord, onExport, onShare, onToast, onRefresh, onFlush, health, saveStatus }) {
  const readOnly = watchMode || reviewMode;
  const [viewerSpeed, setViewerSpeed] = useState(1), [inspectorHidden, setInspectorHidden] = useState(false), [timelineHidden, setTimelineHidden] = useState(false);
  const [analyticsStatus, setAnalyticsStatus] = useState('ready');
  const [pane, setPane] = useState(initialPane), [position, setPosition] = useState(0), [playing, setPlaying] = useState(false), [selection, setSelection] = useState(null);
  const [search, setSearch] = useState(''), [showSearch, setShowSearch] = useState(false), [rename, setRename] = useState(false), [title, setTitle] = useState(asset.title);
  const [busy, setBusy] = useState(''), [cleanup, setCleanup] = useState(null), [comment, setComment] = useState(''), [editingCue, setEditingCue] = useState(null);
  const [showMenu, setShowMenu] = useState(false), [previewMuted, setPreviewMuted] = useState(false), [showCaptions, setShowCaptions] = useState(asset.edits?.captions || false);
  const [newChapter, setNewChapter] = useState(null);
  const [selectedLayer, setSelectedLayer] = useState('camera');
  const [selectedZoom, setSelectedZoom] = useState(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const inspectorScroll = useRef();
  useEffect(() => { if (inspectorScroll.current) inspectorScroll.current.scrollTop = 0; }, [pane, asset.id]);
  const video = useRef(), camera = useRef(), mic = useRef(), system = useRef(), stage = useRef(), captionsInput = useRef(), history = useRef([]), redo = useRef([]), [historyTick, setHistoryTick] = useState(0);
  useWatchAnalytics(video, asset, watchMode, setAnalyticsStatus);
  const assetRef = useRef(asset); assetRef.current = asset;
  const historyGroup = useRef(null), positionRef = useRef(0), playbackIntent = useRef(false), timeHandler = useRef(null), previewEnd = useRef(null);
  const edits = asset.edits;
  const ranges = keptRanges(asset), totalDuration = editedDuration(asset);
  const currentCue = (asset.transcript || []).find(c => position + .025 >= c.start && position + .025 < c.end);
  const currentCaption = previewCaptionAt(asset, position);

  useEffect(() => { pause(); const start = editedToSourceTime(asset, initialTime); positionRef.current = start; setPosition(start); setSelection(null); setSelectedZoom(null); history.current = []; redo.current = []; historyGroup.current = null; setTitle(asset.title); setShowCaptions(asset.edits?.captions || false); setEditingCue(null); setCleanup(null); setNewChapter(null); setSearch(''); setComment(''); }, [asset.id]);
  useEffect(() => {
    const volume = Math.max(0, Math.min(1, Number(edits.volume) || 0));
    [video.current, camera.current, mic.current, system.current].filter(Boolean).forEach(el => { el.playbackRate = previewPlaybackRate(asset, viewerSpeed); el.volume = volume; });
    if (video.current) video.current.muted = previewMuted || Boolean(asset.microphoneUrl || asset.systemUrl);
    if (camera.current) camera.current.muted = true;
    if (mic.current) { mic.current.muted = previewMuted; mic.current.volume = volume * (edits.audioMix?.microphone ?? 1); }
    if (system.current) { system.current.muted = previewMuted; system.current.volume = volume * (edits.audioMix?.system ?? 1); }
  }, [asset.id, edits.speed, edits.volume, edits.audioMix, previewMuted, viewerSpeed, asset.microphoneUrl, asset.systemUrl]);
  useEffect(() => {
    if (!playing) return undefined;
    let frame;
    const tick = () => { timeHandler.current?.(); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, asset.id]);
  useEffect(() => {
    const element = stage.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => setViewportSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const snapshot = () => structuredClone({ edits: assetRef.current.edits, transcript: assetRef.current.transcript });
  function commit(patch, recordHistory = true) {
    if (readOnly) return;
    const current = assetRef.current;
    if (Object.keys(patch).every(key => JSON.stringify(current[key]) === JSON.stringify(patch[key]))) return;
    if (recordHistory) {
      const focused = document.activeElement, group = focused?.tagName === 'INPUT' ? focused : null;
      if (!group || historyGroup.current?.element !== group || performance.now() - historyGroup.current.time > 650) {
        history.current.push(snapshot()); if (history.current.length > 60) history.current.shift();
      }
      historyGroup.current = { element: group, time: performance.now() }; redo.current = []; setHistoryTick(t => t + 1);
    }
    assetRef.current = { ...current, ...patch };
    onUpdate(current, patch);
  }
  function edit(patch, recordHistory = true) { commit({ edits: { ...assetRef.current.edits, ...patch } }, recordHistory); }
  function undo() { if (!history.current.length) return; redo.current.push(snapshot()); commit(history.current.pop(), false); historyGroup.current = null; setHistoryTick(t => t + 1); }
  function redoEdit() { if (!redo.current.length) return; history.current.push(snapshot()); commit(redo.current.pop(), false); historyGroup.current = null; setHistoryTick(t => t + 1); }
  function seek(t) {
    const current = assetRef.current;
    let value = Math.max(0, Math.min(current.duration || 0, Number(t) || 0));
    if (playbackIntent.current) {
      const next = nextPlayableTime(current, value);
      if (next === null) { pause(); value = keptRanges(current).at(-1)?.end || 0; } else value = next;
    }
    [video.current, camera.current, mic.current, system.current].filter(Boolean).forEach(el => {
      if (el.readyState) { try { el.currentTime = Number.isFinite(el.duration) ? Math.min(value, Math.max(0, el.duration - .001)) : value; } catch { /* A source still loading is synchronized on metadata. */ } }
    });
    positionRef.current = value; setPosition(value);
  }
  function pause() { playbackIntent.current = false; previewEnd.current = null; [video.current, camera.current, mic.current, system.current].filter(Boolean).forEach(el => el.pause()); setPlaying(false); }
  async function play(endAt = null) {
    const current = assetRef.current, retained = keptRanges(current);
    if (!retained.length) { onToast('The entire video is cut. Undo an edit to play.'); return; }
    playbackIntent.current = true;
    previewEnd.current = endAt;
    seek(nextPlayableTime(current, positionRef.current) ?? retained[0].start);
    try {
      await Promise.all([video.current, camera.current, mic.current, system.current].filter(Boolean).filter(el => !Number.isFinite(el.duration) || positionRef.current < el.duration - .01).map(el => el.play()));
      if (playbackIntent.current) setPlaying(true); else pause();
    } catch { pause(); onToast('A preview source could not play. Check that all recording files are available.', 'error'); }
  }
  function onTime() {
    const el = video.current; if (!el) return; const t = el.currentTime, current = assetRef.current;
    if (!el.paused) {
      if (previewEnd.current !== null && t >= previewEnd.current) { const end = previewEnd.current; pause(); seek(end); return; }
      const next = nextPlayableTime(current, t);
      if (next === null) { pause(); seek(keptRanges(current).at(-1)?.end || 0); return; }
      if (next > t + .0001) { seek(next); return; }
      [camera.current, mic.current, system.current].filter(Boolean).forEach(aux => {
        if (!aux.readyState) return;
        if (Number.isFinite(aux.duration) && t >= aux.duration - .01) { aux.pause(); return; }
        if (Math.abs(aux.currentTime - t) > .12) aux.currentTime = t;
        if (aux.paused && playbackIntent.current) aux.play().catch(() => {});
      });
    }
    positionRef.current = t; setPosition(t);
  }
  timeHandler.current = onTime;
  function syncAuxiliary(event) {
    const el = event.currentTarget;
    el.playbackRate = previewPlaybackRate(assetRef.current, viewerSpeed);
    el.volume = Math.max(0, Math.min(1, Number(assetRef.current.edits.volume) || 0)) * (el === mic.current ? assetRef.current.edits.audioMix?.microphone ?? 1 : el === system.current ? assetRef.current.edits.audioMix?.system ?? 1 : 1);
    if (Number.isFinite(el.duration)) el.currentTime = Math.min(positionRef.current, Math.max(0, el.duration - .001));
    if (playbackIntent.current && (!Number.isFinite(el.duration) || positionRef.current < el.duration - .01)) el.play().catch(() => {});
  }
  function cutSelection() {
    if (!selection) return;
    const start = Math.max(0, Math.min(selection.start, selection.end)), end = Math.min(assetRef.current.duration, Math.max(selection.start, selection.end));
    if (end - start < .05) return;
    if ((assetRef.current.edits.cuts || []).length >= 250) { onToast('This recording has reached 250 cut ranges. Restore or combine ranges before adding more.', 'error'); return; }
    edit({ cuts: [...(assetRef.current.edits.cuts || []), { id: uid(), start, end }] }); setSelection(null); onToast('Range removed. Your original is preserved.');
  }
  useEffect(() => {
    const handler = e => {
      if (e.defaultPrevented || e.target.closest?.('input,textarea,select,[contenteditable],dialog,[role="dialog"]') || document.querySelector('[aria-modal="true"]')) return;
      if (['Space', 'ArrowRight', 'ArrowLeft'].includes(e.code) && e.target.closest?.('button,a[href]')) return;
      if (e.code === 'Space') { e.preventDefault(); playing ? pause() : play(); }
      if (!readOnly && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redoEdit() : undo(); }
      if (!readOnly && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); cutSelection(); }
      if (!readOnly && e.key === 's' && !e.metaKey && !e.ctrlKey) setSelection({ start: position, end: Math.min(asset.duration, position + Math.max(1, asset.duration * .1)) });
      if (e.key === 'Escape') setSelection(null);
      if (e.key === 'ArrowRight') { e.preventDefault(); seek(editedToSourceTime(asset, sourceToEditedTime(asset, position) + 5)); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); seek(editedToSourceTime(asset, sourceToEditedTime(asset, position) - 5)); }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, [playing, position, selection, asset, historyTick]);

  async function action(name, fn) { if (busy) return; setBusy(name); try { await onFlush?.(); await fn(); } catch (error) { onToast(error.message, 'error'); } finally { setBusy(''); } }
  async function detectSilence() { pause(); await action('silence', async () => { const result = await api(`/assets/${asset.id}/detect-silence`, { method: 'POST', body: {} }); setCleanup(result.ranges || result.silences || result.cuts || []); }); }
  function applyCleanup() {
    const cuts = [...assetRef.current.edits.cuts, ...(cleanup || []).map(range => ({ ...range, id: uid() }))];
    if (cuts.length > 250) { onToast('This would exceed 250 cut ranges. Keep fewer suggested cuts or restore existing ranges first.', 'error'); return; }
    pause(); edit({ cuts }); setCleanup(null); onToast('Pause cuts applied. Undo at any time.');
  }
  async function importCaptions(file) {
    if (!file) return;
    let cues;
    try { cues = subtitleCues(await file.text()).filter(c => c.start < asset.duration).map(c => ({ ...c, end: Math.min(c.end, asset.duration) })); }
    catch { onToast('The caption file could not be read. Try another SRT or VTT file.', 'error'); return; }
    if (!cues.length) { onToast('No timed captions found. Choose an SRT or VTT file.', 'error'); return; }
    commit({ transcript: cues }); onToast('Captions imported. You can edit every line.');
  }
  function addOverlay(type) {
    if (asset.duration <= 0) return;
    if ((edits.overlays || []).length >= 60) { onToast('This recording already has 60 overlays. Remove one before adding another.', 'error'); return; }
    const start = Math.min(position, Math.max(0, asset.duration - .05));
    const overlay = { id: uid(), type, text: type === 'text' ? 'Your text here' : '', x: .28, y: .25, width: type === 'text' ? .45 : .28, height: type === 'text' ? .1 : .18, start, end: Math.min(asset.duration, start + Math.max(3, asset.duration / 4)), color: type === 'redact' ? '#000000' : '#f3bd60' };
    edit({ overlays: [...(edits.overlays || []), overlay] });
  }
  const setOverlay = (id, patch) => edit({ overlays: assetRef.current.edits.overlays.map(o => {
    if (o.id !== id) return o;
    const next = { ...o, ...patch }, gap = Math.min(.05, asset.duration);
    next.width = Math.max(.01, Math.min(1, next.width)); next.height = Math.max(.01, Math.min(1, next.height));
    next.x = Math.max(0, Math.min(1 - next.width, next.x)); next.y = Math.max(0, Math.min(1 - next.height, next.y));
    next.start = Math.max(0, Math.min(asset.duration - gap, next.start)); next.end = Math.min(asset.duration, Math.max(next.start + gap, next.end));
    if ('end' in patch && next.end <= next.start) next.start = Math.max(0, next.end - gap);
    return next;
  }) });
  function setTrim(edge, input) {
    if (input === '' || !Number.isFinite(Number(input))) return;
    const current = assetRef.current.edits, gap = Math.min(.05, asset.duration);
    if (edge === 'start') edit({ trimStart: Math.max(0, Math.min(current.trimEnd - gap, Number(input))) });
    else edit({ trimEnd: Math.min(asset.duration, Math.max(current.trimStart + gap, Number(input))) });
  }
  const addComment = () => { if (!comment.trim()) return; onUpdate(asset, { comments: [...(asset.comments || []), { id: uid(), time: position, text: comment.trim(), author: 'You', createdAt: new Date().toISOString(), resolved: false }] }); setComment(''); onToast('Review note saved.'); };
  const addChapter = () => { pause(); setNewChapter({ start: position, title: '' }); };
  const saveChapter = () => { if (!newChapter?.title.trim()) return; const current = assetRef.current; onUpdate(current, { chapters: [...(current.chapters || []), { id: uid(), start: newChapter.start, title: newChapter.title.trim() }].sort((a, b) => a.start - b.start) }); setNewChapter(null); };
  const cueRemoved = cue => !ranges.some(range => range.start < cue.end && range.end > cue.start);
  const toggleCueCut = cue => {
    const current = assetRef.current;
    if (!cueRemoved(cue) && current.edits.cuts.length >= 250) { onToast('Restore an existing cut before adding another. This recording has 250 cut ranges.', 'error'); return; }
    edit(cueRemoved(cue) ? restoreSourceRange(current, cue.start, cue.end) : { cuts: [...(current.edits.cuts || []), { id: uid(), start: cue.start, end: cue.end }] });
  };
  const sideTitle = { transcript: 'Transcript', media: 'Recording details', text: 'Text overlays', elements: 'Elements & privacy', captions: 'Captions', layout: 'Layout & framing', motion: 'Motion', audio: 'Audio', review: 'Review notes', chapters: 'Chapters', history: 'Version history' }[pane];
  const aspect = frameAspect(asset);
  const layout = composition(asset, aspect);
  const motion = motionAt(edits.zooms, position), cameraFrame = cameraMotionFrame(layout.camera, motion);
  const selectLayer = name => { pause(); setSelectedLayer(name); setPane('layout'); setInspectorHidden(false); };
  const changeLayer = (name, frame) => {
    const scale = name === 'camera' ? cameraFrame.width / layout.camera.width : 1;
    const base = scale === 1 ? frame : { x: frame.x - frame.width * (1 / scale - 1) / 2, y: frame.y - frame.height * (1 / scale - 1) / 2, width: frame.width / scale, height: frame.height / scale };
    edit({ [name]: { ...assetRef.current.edits[name], frame: base } });
  };
  const sourceAspect = asset.width / asset.height || 16 / 9;
  const frameHeight = Math.min(viewportSize.height, viewportSize.width / aspect), frameWidth = frameHeight * aspect;
  const editedPosition = sourceToEditedTime(asset, position);
  const nav = [{ key: 'transcript', label: 'Cutroom', icon: Scissors }, { key: 'record', label: 'Record', icon: Record }, { key: 'media', label: 'Media', icon: FolderSimple }, { key: 'text', label: 'Text', icon: TextT }, { key: 'elements', label: 'Elements', icon: Shapes }, { key: 'captions', label: 'Captions', icon: ClosedCaptioning }, { key: 'motion', label: 'Motion', icon: MagicWand }, { key: 'layout', label: 'Layout', icon: SlidersHorizontal }, { key: 'audio', label: 'Audio', icon: Waveform }];

  function overlayFields(o) {
    return <div className="overlay-item" key={o.id}><div className="row between"><strong>{o.type === 'redact' ? 'Privacy mask' : o.type === 'box' ? 'Highlight box' : o.type === 'arrow' ? 'Arrow' : 'Text overlay'}</strong><IconButton icon={Trash} label="Delete overlay" onClick={() => edit({ overlays: edits.overlays.filter(item => item.id !== o.id) })} /></div>{o.type === 'text' && <label>Text<input value={o.text} maxLength={400} onChange={e => setOverlay(o.id, { text: e.target.value })} /></label>}<div className="form-grid"><label>Start<input type="number" min="0" max={Math.max(0, o.end - .05)} step=".1" value={o.start} onChange={e => setOverlay(o.id, { start: Number(e.target.value) })} /></label><label>End<input type="number" min={Math.min(asset.duration, o.start + .05)} max={asset.duration} step=".1" value={o.end} onChange={e => setOverlay(o.id, { end: Number(e.target.value) })} /></label></div>{[['x', 'Horizontal'], ['y', 'Vertical'], ['width', 'Width'], ['height', 'Height']].map(([key, label]) => <label className="slider-field" key={key}>{label}<input type="range" min={key === 'x' || key === 'y' ? 0 : .01} max={key === 'x' ? 1 - o.width : key === 'y' ? 1 - o.height : 1} step=".01" value={o[key]} onChange={e => setOverlay(o.id, { [key]: Number(e.target.value) })} /></label>)}{o.type !== 'redact' && <label className="row between">Color<input type="color" value={o.color} onChange={e => setOverlay(o.id, { color: e.target.value })} /></label>}<button className="subtle" onClick={() => seek(o.start)}>Preview at {time(o.start)}<ArrowRight size={16} /></button></div>;
  }

  return <div className={`editor-app ${readOnly ? 'review-app' : ''} ${watchMode ? 'watch-app' : ''} ${inspectorHidden ? 'inspector-hidden' : ''}`}>
    {readOnly ? <header className="review-header"><Brand onClick={() => { pause(); onBack(); }} /><button className="review-back" onClick={() => { pause(); onBack(); }}><CaretLeft size={17} />Library</button><div className="review-heading"><p>{watchMode ? 'LOCAL WATCH PAGE' : 'RECORDING REVIEW'}{asset.sample ? ' · SAMPLE' : ''}</p>{rename ? <input autoFocus aria-label="Recording title" value={title} maxLength={200} onChange={e => setTitle(e.target.value)} onBlur={() => { if (title.trim()) onUpdate(asset, { title: title.trim() }); setRename(false); }} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} /> : <h1>{reviewMode ? <button onClick={() => { setTitle(asset.title); setRename(true); }}>{asset.title}<PencilSimple size={16} /></button> : asset.title}</h1>}</div>{reviewMode && <><span className={`review-save ${saveStatus === 'error' ? 'error-text' : ''}`} role="status">{saveStatus === 'saving' ? 'Saving...' : saveStatus === 'error' ? 'Save failed' : 'Saved locally'}</span><button className="button" onClick={() => { pause(); onEdit('transcript', editedPosition); }}><Scissors size={18} />Edit video</button><button className="button primary" onClick={() => { pause(); onExport('default'); }}><Export size={18} />Export</button></>}</header> : <header className="editor-header"><Brand onClick={() => { pause(); onBack(); }} /><button className="back-button" aria-label="Back to library" onClick={() => { pause(); onBack(); }}><CaretLeft size={21} /><span>Back to library</span></button><div className="project-title">{rename ? <input autoFocus aria-label="Recording title" value={title} onChange={e => setTitle(e.target.value)} onBlur={() => { if (title.trim()) onUpdate(asset, { title: title.trim() }); else setTitle(asset.title); setRename(false); }} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} /> : <button onClick={() => { setTitle(asset.title); setRename(true); }}>{asset.title}<PencilSimple size={16} /></button>}{asset.sample && <span className="sample-label">Sample</span>}</div><div className={`save-state ${saveStatus === 'error' ? 'error-text' : ''}`}>{saveStatus === 'saving' ? <SpinnerGap className="spin" size={17} /> : <CheckCircle size={17} />}<span>{saveStatus === 'saving' ? 'Saving changes' : saveStatus === 'error' ? 'Save failed' : 'All changes saved'}</span></div><button className="button header-share" onClick={() => { pause(); onShare(); }}><ShareNetwork size={18} />Share</button><button className="button primary" onClick={() => { pause(); onDone(editedPosition); }}><Check size={19} />Done editing</button><div className="menu-anchor"><IconButton icon={DotsThreeVertical} label="Recording menu" onClick={() => setShowMenu(!showMenu)} />{showMenu && <div className="popover"><button onClick={() => { pause(); setShowMenu(false); onExport(); }}><Export />Export files</button><button onClick={() => { pause(); setShowMenu(false); onWatch(); }}><Eye />Watch page</button><button onClick={() => { pause(); setShowMenu(false); onShowAnalytics(); }}><ChartBar />Analytics</button><button onClick={() => { pause(); setShowMenu(false); onShowSettings(); }}><SlidersHorizontal />Settings</button><button onClick={() => { setInspectorHidden(false); setPane('review'); setShowMenu(false); }}><ChatCircle />Review notes</button><button onClick={() => { setInspectorHidden(false); setPane('chapters'); setShowMenu(false); }}><ListBullets />Chapters</button><button onClick={() => { setInspectorHidden(false); setPane('history'); setShowMenu(false); }}><ClockCounterClockwise />Version history</button><button onClick={() => { edit({ trimStart: 0, trimEnd: asset.duration, cuts: [] }); setShowMenu(false); }}><ArrowCounterClockwise />Restore full timeline</button></div>}</div></header>}

    <div className="editor-workspace">{!readOnly && <nav className="tool-rail" aria-label="Editor tools">{nav.map(item => <button key={item.key} className={pane === item.key ? 'active' : ''} onClick={() => item.key === 'record' ? (pause(), onRecord()) : (setPane(item.key), setInspectorHidden(false))} aria-pressed={pane === item.key}><item.icon size={25} weight="regular" /><span>{item.label}</span></button>)}</nav>}
    <main className="preview-panel" style={readOnly ? { '--review-aspect': aspect } : undefined}>{!readOnly && <div className="editor-view-tools"><button aria-pressed={!inspectorHidden} onClick={() => setInspectorHidden(!inspectorHidden)}><ListBullets size={15} />{inspectorHidden ? 'Show panel' : 'Hide panel'}</button><button aria-pressed={!timelineHidden} onClick={() => setTimelineHidden(!timelineHidden)}><SlidersHorizontal size={15} />{timelineHidden ? 'Show timeline' : 'Hide timeline'}</button></div>}<div className="preview-viewport" ref={stage}>
      <div className="output-frame" style={{ aspectRatio: aspect, width: frameWidth || '100%', height: frameHeight || 'auto', background: '#101114' }}>
        <CompositionLayer key={`${asset.id}-screen`} name="Screen" frame={layout.screen} aspect={aspect} editable={!readOnly && pane === 'layout'} selected={pane === 'layout' && selectedLayer === 'screen'} onSelect={() => selectLayer('screen')} onChange={frame => changeLayer('screen', frame)}>
          {region => {
            const content = fitFrame(region, sourceAspect, aspect, edits.screen?.fit);
            return <div className="composition-content"><div className="composition-source" style={{ overflow: 'hidden', left: `${(content.x - region.x) / region.width * 100}%`, top: `${(content.y - region.y) / region.height * 100}%`, width: `${content.width / region.width * 100}%`, height: `${content.height / region.height * 100}%` }}>
              <div style={sourceMotionStyle(motion)} data-motion-zoom={motion.zoom.toFixed(3)}><video ref={video} src={asset.mediaUrl} poster={asset.thumbnailUrl} playsInline preload="auto" style={{ width: '100%', height: '100%', objectFit: 'fill' }} onTimeUpdate={onTime} onEnded={pause} onClick={() => playing ? pause() : play()} onLoadedMetadata={event => { event.currentTarget.playbackRate = previewPlaybackRate(assetRef.current, viewerSpeed); seek(positionRef.current || keptRanges(assetRef.current)[0]?.start || 0); }} onError={() => { pause(); onToast('The recording source could not be loaded.', 'error'); }} aria-label="Recording preview" />
              {(edits.overlays || []).filter(o => position >= o.start && position < o.end).map(o => <OverlayPreview key={o.id} overlay={o} width={asset.width} height={asset.height} />)}
            </div></div></div>;
          }}
        </CompositionLayer>
        {asset.cameraUrl && <CompositionLayer key={`${asset.id}-camera`} name="Camera" editable={!readOnly && pane === 'layout'} frame={cameraFrame} aspect={aspect} selected={pane === 'layout' && selectedLayer === 'camera'} square={['circle', 'square'].includes(layout.shape)} hidden={edits.camera?.visible === false} onSelect={() => selectLayer('camera')} onChange={frame => changeLayer('camera', frame)}>
          {region => <div className="composition-content" style={{ borderRadius: layout.shape === 'circle' ? '50%' : layout.shape === 'rounded' ? Math.min(region.width * frameWidth, region.height * frameHeight) * .08 : 0 }}><video ref={camera} src={asset.cameraUrl} muted playsInline preload="auto" style={{ objectFit: edits.camera?.fit || 'cover' }} onLoadedMetadata={syncAuxiliary} aria-label="Camera recording" /></div>}
        </CompositionLayer>}
        {(edits.overlays || []).filter(o => o.type === 'redact' && position >= o.start && position < o.end).map(o => {
          const mask = motionPrivacyFrame(o, layout, motion);
          return <div key={`privacy-${o.id}`} aria-label="Privacy mask" style={{ position: 'absolute', zIndex: 3, pointerEvents: 'none', background: '#000000', left: `${mask.x * 100}%`, top: `${mask.y * 100}%`, width: `${mask.width * 100}%`, height: `${mask.height * 100}%` }} />;
        })}
        {showCaptions && currentCaption && <CaptionPreview text={currentCaption} aspect={aspect} />}
      </div>
    </div>
    {asset.microphoneUrl && <audio ref={mic} src={asset.microphoneUrl} muted={previewMuted} preload="auto" onLoadedMetadata={syncAuxiliary} />}{asset.systemUrl && <audio ref={system} src={asset.systemUrl} muted={previewMuted} preload="auto" onLoadedMetadata={syncAuxiliary} />}
    <div className="scrub-wrap"><input aria-label="Playback position" className="playback-scrub" type="range" min="0" max={totalDuration || 1} step=".01" value={Math.min(editedPosition, totalDuration)} disabled={!totalDuration} onChange={e => seek(editedToSourceTime(asset, Number(e.target.value)))} style={{ '--played': `${editedPosition / (totalDuration || 1) * 100}%` }} /></div><div className="playback-controls"><span className="playback-time">{time(editedPosition)}<span> / {time(totalDuration)}</span></span><div className="playback-center"><IconButton icon={ArrowCounterClockwise} label="Back 10 seconds" onClick={() => seek(editedToSourceTime(asset, editedPosition - 10))} /><IconButton icon={SkipBack} label="Go to start" onClick={() => seek(ranges[0]?.start || 0)} /><IconButton icon={playing ? Pause : Play} label={playing ? 'Pause video' : 'Play video'} className="main-play" onClick={() => playing ? pause() : play()} /><IconButton icon={SkipForward} label="Go to end" onClick={() => seek(editedToSourceTime(asset, Math.max(0, totalDuration - .1)))} /><IconButton icon={ArrowRight} label="Forward 10 seconds" onClick={() => seek(editedToSourceTime(asset, editedPosition + 10))} /></div><div className="playback-right"><IconButton icon={previewMuted ? SpeakerSlash : SpeakerHigh} label={previewMuted ? 'Unmute preview' : 'Mute preview'} onClick={() => setPreviewMuted(!previewMuted)} /><select aria-label="Viewing speed" title="Viewing speed only. Export speed is set in Audio." value={viewerSpeed} onChange={e => setViewerSpeed(Number(e.target.value))}>{[.5, .75, 1, 1.25, 1.5, 2].map(n => <option key={n} value={n}>{n}x</option>)}</select><IconButton icon={ClosedCaptioning} label="Toggle preview captions" disabled={!asset.transcript?.length} className={showCaptions ? 'selected' : ''} onClick={() => setShowCaptions(!showCaptions)} /><IconButton icon={CornersOut} label="Fullscreen preview" onClick={() => stage.current?.requestFullscreen?.().catch(() => onToast('Fullscreen is not supported in this browser.'))} /></div></div></main>

    {readOnly && <ReviewPanel asset={asset} owner={reviewMode} position={position} onSeek={seek} onEdit={pane => { pause(); onEdit(pane, editedPosition); }} onUpdate={onUpdate} onAnalytics={() => { pause(); onShowAnalytics(); }} onToast={onToast} />}
    {!readOnly && !inspectorHidden && <aside className="inspector"><header className="inspector-header"><h2>{sideTitle}</h2><div className="row">{pane === 'transcript' && <IconButton icon={MagnifyingGlass} label="Find in transcript" onClick={() => setShowSearch(!showSearch)} />}<IconButton icon={ChatCircle} label="Open review notes" className={pane === 'review' ? 'selected' : ''} onClick={() => setPane(pane === 'review' ? 'transcript' : 'review')} /></div></header><div className="inspector-content" ref={inspectorScroll}>
    {pane === 'transcript' && <>{asset.transcript?.length > 0 ? <><div className="transcript-actions"><button className="button" onClick={detectSilence} disabled={busy === 'silence'}><MagicWand size={18} />{busy === 'silence' ? 'Listening...' : 'Tighten pauses'}</button><button className="button" onClick={() => setShowSearch(!showSearch)}><MagnifyingGlass size={17} />Find a word</button></div>{showSearch && <div className="input-icon"><MagnifyingGlass size={18} /><input autoFocus placeholder="Search transcript" value={search} onChange={e => setSearch(e.target.value)} /><IconButton icon={X} label="Close transcript search" onClick={() => { setSearch(''); setShowSearch(false); }} /></div>}<div className="transcript-list">{asset.transcript.filter(c => c.text.toLowerCase().includes(search.toLowerCase())).map(c => { const removed = cueRemoved(c); return <article className={`transcript-cue ${currentCue?.id === c.id ? 'active' : ''} ${removed ? 'removed' : ''}`} key={c.id}><button className="cue-time" onClick={() => seek(c.start)}>{time(c.start)}</button>{editingCue === c.id ? <textarea autoFocus defaultValue={c.text} onBlur={e => { commit({ transcript: assetRef.current.transcript.map(item => item.id === c.id ? { ...item, text: e.target.value.trim() } : item).filter(item => item.text) }); setEditingCue(null); }} /> : <button className="cue-text" onClick={() => { seek(c.start); setSelection({ start: c.start, end: c.end }); }}>{c.text}</button>}<div className="cue-actions"><IconButton icon={PencilSimple} label={`Edit caption at ${time(c.start)}`} onClick={() => setEditingCue(c.id)} /><IconButton icon={removed ? ArrowUUpLeft : Scissors} label={`${removed ? 'Restore' : 'Cut'} passage at ${time(c.start)}`} onClick={() => toggleCueCut(c)} /></div></article>; })}</div></> : <Empty icon={FileText} title="Your words, editable">Import captions or generate a transcript to edit your recording by text.<div className="empty-actions"><button className="button" onClick={() => captionsInput.current.click()}><UploadSimple size={17} />Import captions</button><button className="button primary" disabled={!health?.capabilities?.transcription || !!busy} onClick={() => action('transcribe', async () => { await api(`/assets/${asset.id}/transcribe`, { method: 'POST', body: {} }); await onRefresh(); })}>{busy === 'transcribe' ? 'Transcribing...' : 'Transcribe video'}</button>{!health?.capabilities?.transcription && <small>AI transcription needs a configured provider. Caption imports work locally.</small>}</div></Empty>}</>}

    {pane === 'media' && <div className="panel-form"><p className="eyebrow">SOURCE FILE</p><img className="detail-thumb" src={asset.thumbnailUrl} alt="Recording thumbnail" /><h3>{asset.title}</h3><dl className="details-list"><dt>Dimensions</dt><dd>{asset.width} × {asset.height}</dd><dt>Original duration</dt><dd>{time(asset.duration, true)}</dd><dt>Edited duration</dt><dd>{time(totalDuration, true)}</dd><dt>File size</dt><dd>{bytes(asset.size)}</dd><dt>Source</dt><dd>{asset.sample ? 'Illustrative sample' : 'Your recording'}</dd></dl><label>Folder<input value={asset.folder || ''} placeholder="e.g. Client walkthroughs" onChange={e => onUpdate(asset, { folder: e.target.value })} /></label><label>Tags<input value={(asset.tags || []).join(', ')} placeholder="client, tutorial" onChange={e => onUpdate(asset, { tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })} /></label><p className="small-copy">The original stays intact. Every edit can be undone or restored from version history.</p><button className="button" onClick={() => setPane('history')}><ClockCounterClockwise size={18} />Version history</button><a className="button" href={asset.mediaUrl} download><DownloadSimple size={18} />Download source</a></div>}

    {(pane === 'text' || pane === 'elements') && <div className="panel-form"><p className="small-copy">Place an overlay, set its timing, and preview it on the recording. These edits are included in video exports.</p><div className="row"><button className="button" onClick={() => addOverlay(pane === 'text' ? 'text' : 'box')}><Plus size={18} />{pane === 'text' ? 'Add text' : 'Add box'}</button>{pane === 'elements' && <button className="button" onClick={() => addOverlay('redact')}><ShieldCheck size={17} />Redact</button>}</div>{(edits.overlays || []).filter(o => pane === 'text' ? o.type === 'text' : o.type !== 'text').map(overlayFields)}{!edits.overlays?.filter(o => pane === 'text' ? o.type === 'text' : o.type !== 'text').length && <Empty icon={pane === 'text' ? TextT : Shapes} title={pane === 'text' ? 'Make your point' : 'Focus on what matters'}>{pane === 'text' ? 'Add a title or a helpful label to this recording.' : 'Highlight an area or cover private details with an opaque mask.'}</Empty>}</div>}

    {pane === 'captions' && <div className="panel-form"><label className="toggle-row"><div><strong>Show captions in preview</strong><small>Uses your transcript timing.</small></div><input type="checkbox" checked={showCaptions} disabled={!asset.transcript?.length} onChange={e => setShowCaptions(e.target.checked)} /></label><label className="toggle-row"><div><strong>Burn captions into exports</strong><small>Always visible in the finished video.</small></div><input type="checkbox" checked={edits.captions} disabled={!asset.transcript?.length} onChange={e => { edit({ captions: e.target.checked }); setShowCaptions(e.target.checked); }} /></label><div className="section-line" /><h3>Bring your own captions</h3><p className="small-copy">Import SRT or WebVTT. Caption files stay aligned when you trim or cut the video.</p><button className="button" onClick={() => captionsInput.current.click()}><UploadSimple size={18} />Import SRT or VTT</button><p className="small-copy">{asset.transcript.length} timed passages in this recording.</p><button className="button" onClick={() => setPane('transcript')}><PencilSimple size={18} />Edit transcript</button><div className="section-line" /><h3>Automatic transcription</h3><p className="small-copy">{health?.capabilities?.transcription ? 'Send this recording to the configured AI provider to generate a transcript.' : 'Add a transcription provider in the local server configuration to enable this.'}</p><button className="button" disabled={!health?.capabilities?.transcription || !!busy} onClick={() => action('transcribe', async () => { await api(`/assets/${asset.id}/transcribe`, { method: 'POST', body: {} }); await onRefresh(); onToast('Transcript ready.'); })}>{busy === 'transcribe' ? <Spinner /> : 'Generate transcript'}</button></div>}

    {pane === 'motion' && <MotionControls asset={asset} position={position} selection={selection} selectedId={selectedZoom} onSelect={setSelectedZoom} onEdit={edit} onSeek={t => { pause(); seek(t); }} onPreview={(start, end) => { pause(); if (!keptRanges(assetRef.current).some(r => r.start < end && r.end > start)) { onToast('This zoom is inside a removed section. Restore the section or move the zoom to preview it.'); return; } seek(start); play(end); }} onToast={onToast} />}

    {pane === 'layout' && <div className="panel-form"><h3>Output framing</h3><div className="aspect-options">{[['original', 'Original'], ['landscape', '16:9'], ['portrait', '9:16'], ['square', '1:1'], ['4:5', '4:5']].map(([key, name]) => <button key={key} className={edits.aspect === key ? 'active' : ''} aria-pressed={edits.aspect === key} onClick={() => edit({ aspect: key })}>{name}</button>)}</div><CompositionControls asset={asset} selected={selectedLayer} onSelect={setSelectedLayer} onEdit={edit} /><div className="section-line" /><h3>Trim</h3><div className="form-grid"><label>Start (seconds)<input type="number" step=".1" min="0" max={Math.max(0, edits.trimEnd - Math.min(.05, asset.duration))} value={edits.trimStart} onChange={e => setTrim('start', e.target.value)} /></label><label>End (seconds)<input type="number" step=".1" min={Math.min(asset.duration, edits.trimStart + Math.min(.05, asset.duration))} max={asset.duration} value={edits.trimEnd} onChange={e => setTrim('end', e.target.value)} /></label></div><p className="small-copy">Finished length: {time(totalDuration, true)}</p><div className="section-line" /><div className="row between"><h3>Removed ranges</h3><span className="count-badge">{edits.cuts.length}</span></div>{edits.cuts.map(c => <div className="simple-row" key={c.id}><button className="text-link" onClick={() => seek(c.start)}>{time(c.start)} to {time(c.end)}</button><IconButton icon={ArrowUUpLeft} label="Restore cut range" onClick={() => edit({ cuts: edits.cuts.filter(item => item.id !== c.id) })} /></div>)}</div>}

    {pane === 'audio' && <div className="panel-form"><h3>Sound</h3>{[['microphone', 'Microphone', asset.microphoneUrl], ['system', 'App audio', asset.systemUrl]].filter(([, , url]) => url).map(([key, label]) => <label className="slider-field" key={key}>{label}<span>{Math.round((edits.audioMix?.[key] ?? 1) * 100)}%</span><input aria-label={`${label} volume`} type="range" min="0" max="1" step=".01" value={edits.audioMix?.[key] ?? 1} onChange={e => edit({ audioMix: { ...edits.audioMix, [key]: Number(e.target.value) } })} /></label>)}<label className="slider-field">Volume <span>{Math.round(edits.volume * 100)}%</span><input type="range" min="0" max="1" step=".01" value={Math.max(0, Math.min(1, edits.volume))} onChange={e => edit({ volume: Number(e.target.value) })} /></label><label className="toggle-row"><div><strong>Normalize on export</strong><small>Balance loudness in the rendered file.</small></div><input type="checkbox" checked={edits.normalizeAudio} onChange={e => edit({ normalizeAudio: e.target.checked })} /></label><label>Export speed<select value={edits.speed} onChange={e => edit({ speed: Number(e.target.value) })}>{[.5, .75, 1, 1.25, 1.5, 2].map(n => <option key={n} value={n}>{n}x</option>)}</select></label><div className="section-line" /><h3>Make room for the message</h3><p className="small-copy">Find quiet gaps, review the proposed cuts, then keep the ones you want. Audio analysis runs on this computer.</p><button className="button" onClick={detectSilence} disabled={!!busy}><MagicWand size={18} />{busy === 'silence' ? 'Analyzing audio...' : 'Find pauses'}</button><p className="small-copy">Export audio separately as MP3 or WAV from the Export panel.</p></div>}

    {pane === 'review' && <div className="panel-form"><p className="small-copy">Private review notes saved with this recording. Include them in a project package when you hand it off.</p><label>Note at {time(position)}<textarea placeholder="Leave a note for your next edit..." value={comment} onChange={e => setComment(e.target.value)} /></label><button className="button primary" onClick={addComment} disabled={!comment.trim()}><Plus size={17} />Add note</button><div className="section-line" />{(asset.comments || []).map(c => <article className={`review-note ${c.resolved ? 'resolved' : ''}`} key={c.id}><div className="row between"><button className="time-link" onClick={() => seek(c.time)}>{time(c.time)}</button><span>{c.author || 'You'}</span></div><p>{c.text}</p><div className="row between"><button className="subtle" onClick={() => onUpdate(asset, { comments: asset.comments.map(item => item.id === c.id ? { ...item, resolved: !c.resolved } : item) })}><Check size={17} />{c.resolved ? 'Resolved' : 'Resolve'}</button><IconButton icon={Trash} label="Delete review note" onClick={() => onUpdate(asset, { comments: asset.comments.filter(item => item.id !== c.id) })} /></div></article>)}{!asset.comments?.length && <Empty icon={ChatCircle} title="A place for your feedback">Notes stay attached to their moment in the video.</Empty>}</div>}

    {pane === 'chapters' && <div className="panel-form"><button className="button" onClick={addChapter}><Plus size={18} />Chapter at {time(position)}</button>{(asset.chapters || []).map(c => <div className="chapter-row" key={c.id}><button className="time-link" onClick={() => seek(c.start)}>{time(c.start)}</button><input aria-label="Chapter title" value={c.title} onChange={e => onUpdate(asset, { chapters: asset.chapters.map(item => item.id === c.id ? { ...item, title: e.target.value } : item) })} /><IconButton icon={Trash} label="Delete chapter" onClick={() => onUpdate(asset, { chapters: asset.chapters.filter(item => item.id !== c.id) })} /></div>)}<div className="section-line" /><h3>Summary</h3><textarea className="summary-text" placeholder="Add a summary of this recording..." value={asset.summary || ''} onChange={e => onUpdate(asset, { summary: e.target.value })} /><button className="button" disabled={!health?.capabilities?.ai || !!busy} onClick={() => action('analyze', async () => { await api(`/assets/${asset.id}/analyze`, { method: 'POST', body: {} }); await onRefresh(); })}><MagicWand size={18} />{busy === 'analyze' ? 'Generating...' : 'Generate with AI'}</button>{!health?.capabilities?.ai && <small className="muted">AI is not configured. You can edit these fields directly.</small>}</div>}

    {pane === 'history' && <div className="panel-form"><p className="small-copy">Restore an earlier edit without changing your source file.</p>{(asset.versions || []).map((v, i) => <div className="version-row" key={v.id}><ClockCounterClockwise size={18} /><div><strong>{v.label || `Saved version ${asset.versions.length - i}`}</strong><small>{new Date(v.createdAt).toLocaleString()}</small></div><button className="subtle" disabled={!!busy} onClick={() => action(v.id, async () => { await api(`/assets/${asset.id}/versions/${v.id}/restore`, { method: 'POST', body: {} }); await onRefresh(); history.current = []; redo.current = []; historyGroup.current = null; setHistoryTick(t => t + 1); onToast('Version restored.'); })}>Restore</button></div>)}{!asset.versions?.length && <Empty icon={ClockCounterClockwise} title="Your original is safe">Saved edits will appear here as you work.</Empty>}</div>}
    </div><footer className="inspector-footer"><ArrowUUpLeft size={17} /><span>{pane === 'transcript' ? 'Edits in transcript are reversible.' : 'Changes save automatically on this device.'}</span></footer></aside>}</div>
    {!readOnly && !timelineHidden && <Timeline selectedZoom={selectedZoom} onZoomSelect={id => { pause(); setSelectedZoom(id); setPane('motion'); setInspectorHidden(false); }} asset={asset} currentTime={position} seek={seek} selection={selection} setSelection={setSelection} onEdits={edit} onUndo={undo} onRedo={redoEdit} canUndo={history.current.length > 0} canRedo={redo.current.length > 0} onCut={cutSelection} />}
    {reviewMode && <footer className="review-delivery"><div><span className="eyebrow">READY TO DELIVER</span><p>{time(totalDuration)} finished · Original preserved</p></div><div className="review-delivery-actions"><button className="button" onClick={() => { pause(); onWatch(); }}><Eye size={17} />Watch page</button><button className="button" onClick={() => { pause(); onShare(); }}><ShareNetwork size={17} />Share options</button><button className="button" onClick={() => { pause(); onExport('social'); }}>Vertical clip<ArrowRight size={16} /></button><button className="button" onClick={() => { pause(); onExport('archive'); }}>Complete package<DownloadSimple size={17} /></button></div></footer>}
    {watchMode && <footer className={`watch-note ${analyticsStatus === 'error' ? 'error' : ''}`} role="status">{analyticsStatus === 'error' ? 'Viewing activity could not be saved. Retrying while this page stays open.' : 'Views and active watch time are saved locally. Seeking, pauses and hidden tabs do not add watch time.'}</footer>}
    <input type="file" ref={captionsInput} hidden accept=".srt,.vtt" onChange={e => { importCaptions(e.target.files[0]); e.target.value = ''; }} />
    {newChapter && <Modal title={`Chapter at ${time(newChapter.start)}`} onClose={() => setNewChapter(null)}><form className="modal-body" onSubmit={event => { event.preventDefault(); saveChapter(); }}><label>Chapter title<input autoFocus value={newChapter.title} maxLength={200} onChange={event => setNewChapter({ ...newChapter, title: event.target.value })} placeholder="What starts at this moment?" /></label><div className="modal-actions"><button type="button" className="button" onClick={() => setNewChapter(null)}>Cancel</button><button className="button primary" type="submit" disabled={!newChapter.title.trim()}>Add chapter</button></div></form></Modal>}
    {cleanup && <Modal title="Review suggested pause cuts" onClose={() => setCleanup(null)}><div className="modal-body"><p className="small-copy">{cleanup.length ? 'Quiet gaps were found locally. Select a range to play it before applying these reversible cuts.' : 'No long pauses were found in this recording.'}</p><div className="cleanup-ranges">{cleanup.map((r, i) => <div className="simple-row" key={i}><button className="text-link" onClick={() => { pause(); seek(r.start); setSelection(r); play(r.end); }}>{time(r.start, true)} to {time(r.end, true)}</button><span>{(r.end - r.start).toFixed(1)}s</span><IconButton icon={X} label="Keep this pause" onClick={() => setCleanup(cleanup.filter((_, index) => index !== i))} /></div>)}</div><div className="modal-actions"><button className="button" onClick={() => setCleanup(null)}>Keep recording as is</button><button className="button primary" disabled={!cleanup.length} onClick={applyCleanup}>Apply {cleanup.length} cuts</button></div></div></Modal>}
  </div>;
}
