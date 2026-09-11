import React, { useEffect, useRef, useState } from 'react';
import { Monitor, VideoCamera, Waveform, Eye, EyeSlash, Scissors, Trash, ArrowUUpLeft, ArrowUUpRight, MagnifyingGlassMinus, MagnifyingGlassPlus, ArrowsOutSimple, MagicWand } from '@phosphor-icons/react';
import { IconButton } from './UI.jsx';
import { time } from '../lib.js';

function AudioWave({ values = [], muted }) {
  const ref = useRef();
  useEffect(() => {
    const canvas = ref.current;
    const draw = () => {
      const rect = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
      const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.strokeStyle = getComputedStyle(canvas).color; ctx.lineWidth = 1;
      if (!values.length) { ctx.beginPath(); ctx.moveTo(0, rect.height / 2); ctx.lineTo(rect.width, rect.height / 2); ctx.stroke(); return; }
      const count = Math.floor(rect.width / 3);
      for (let i = 0; i < count; i++) {
        const value = values[Math.floor(i / count * values.length)] || 0;
        const h = Math.min(1, Math.abs(value)) * rect.height * .8;
        ctx.beginPath(); ctx.moveTo(i * 3 + 1, rect.height / 2 - h / 2); ctx.lineTo(i * 3 + 1, rect.height / 2 + h / 2); ctx.stroke();
      }
    };
    draw(); const ro = new ResizeObserver(draw); ro.observe(canvas);
    const appearance = new MutationObserver(draw);
    appearance.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { ro.disconnect(); appearance.disconnect(); };
  }, [values, muted]);
  return <canvas className="audio-wave" ref={ref} aria-label={values.length ? 'Recorded audio waveform' : 'No waveform data'} />;
}

export default function Timeline({ asset, currentTime, seek, selection, setSelection, onEdits, onUndo, onRedo, canUndo, canRedo, onCut, selectedZoom, onZoomSelect }) {
  const [zoom, setZoom] = useState(1); const area = useRef(), dragging = useRef(null), dragCleanup = useRef(null), previousVolume = useRef(1);
  const duration = Math.max(.001, asset.duration || 0), edits = asset.edits;
  useEffect(() => { if (edits.volume > 0) previousVolume.current = edits.volume; }, [edits.volume]);
  useEffect(() => () => dragCleanup.current?.(), []);
  useEffect(() => { dragging.current = null; dragCleanup.current?.(); setZoom(1); }, [asset.id]);
  const toTime = e => {
    const rect = area.current?.getBoundingClientRect();
    return rect?.width ? Math.min(duration, Math.max(0, (e.clientX - rect.left) / rect.width * duration)) : 0;
  };
  const ticks = Array.from({ length: 8 }, (_, i) => i / 7 * duration);
  const normalizeSelection = () => setSelection(s => s && ({ start: Math.max(0, Math.min(s.start, s.end)), end: Math.min(duration, Math.max(s.start, s.end)) }));
  const begin = e => {
    if (e.button !== 0 || e.isPrimary === false || dragging.current || e.target.closest('button')) return;
    e.preventDefault();
    dragging.current = { pointerId: e.pointerId, selecting: e.shiftKey };
    e.currentTarget.setPointerCapture(e.pointerId);
    const t = toTime(e);
    seek(t);
    if (e.shiftKey) setSelection({ start: t, end: t });
  };
  const move = e => {
    const drag = dragging.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const t = toTime(e);
    if (drag.selecting) setSelection(s => s && ({ ...s, end: t }));
    else seek(t);
  };
  const finish = e => {
    const drag = dragging.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (e.type === 'pointerup') move(e);
    dragging.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (drag.selecting) normalizeSelection();
  };
  function dragHandle(e, edge) {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    dragCleanup.current?.();
    const moving = ev => { const value = toTime(ev); setSelection(s => s && ({ ...s, [edge]: edge === 'start' ? Math.min(value, s.end) : Math.max(value, s.start) })); };
    const cleanup = () => { window.removeEventListener('pointermove', moving); window.removeEventListener('pointerup', done); window.removeEventListener('pointercancel', done); dragCleanup.current = null; };
    const done = () => { cleanup(); normalizeSelection(); };
    dragCleanup.current = cleanup;
    window.addEventListener('pointermove', moving); window.addEventListener('pointerup', done); window.addEventListener('pointercancel', done);
  }
  function adjustHandle(e, edge) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    setSelection(s => {
      if (!s) return s;
      const value = e.key === 'Home' ? 0 : e.key === 'End' ? duration : s[edge] + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : .1);
      return { ...s, [edge]: edge === 'start' ? Math.max(0, Math.min(s.end, value)) : Math.min(duration, Math.max(s.start, value)) };
    });
  }
  function selectClip() { const next = (edits.cuts || []).filter(c => c.start > currentTime).sort((a,b) => a.start - b.start)[0]; const start = Math.max(0, Math.min(duration, currentTime)); setSelection({ start, end: Math.min(next?.start ?? duration, start + Math.max(1, duration * .12)) }); }
  const tracks = [
    { key: 'screen', name: 'Screen', icon: Monitor, muted: false },
    ...(asset.cameraUrl ? [{ key: 'camera', name: 'Camera', icon: VideoCamera, muted: edits.camera?.visible === false }] : []),
    { key: 'motion', name: 'Motion', icon: MagicWand, muted: false },
    { key: 'audio', name: 'Audio', icon: Waveform, muted: edits.volume === 0 },
  ];
  return <section className="timeline motion-timeline" aria-label="Video timeline"><div className="timeline-scroll"><div className="timeline-labels"><div className="timeline-ruler-space" />{tracks.map(t => <div className={`track-label ${t.key === 'motion' ? 'motion-track-label' : ''}`} key={t.key}><t.icon size={20} /><span>{t.name}</span>{!['screen', 'motion'].includes(t.key) && <IconButton icon={t.muted ? EyeSlash : Eye} label={`${t.muted ? 'Enable' : 'Disable'} ${t.name.toLowerCase()} track`} onClick={() => onEdits(t.key === 'camera' ? { camera: { ...edits.camera, visible: t.muted } } : { volume: t.muted ? previousVolume.current : 0 })} />}</div>)}</div><div className="timeline-lanes-scroll"><div className="timeline-lanes" ref={area} onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onDragStart={e => e.preventDefault()} style={{ width: `${zoom * 100}%`, touchAction: 'none' }}><div className="timeline-ruler">{ticks.map((t, i) => <span style={{ left: `${i / 7 * 100}%` }} key={i}>{time(t)}</span>)}</div>{tracks.map(t => <div className={`track-lane ${t.key === 'motion' ? 'motion-lane' : ''} ${t.muted ? 'track-muted' : ''}`} key={t.key}>{t.key === 'motion' ? (edits.zooms || []).map((r, i) => <button key={r.id} className="zoom-region" aria-label={`Edit zoom ${i + 1}`} aria-pressed={r.id === selectedZoom} style={{ left: `${r.start / duration * 100}%`, width: `${(r.end - r.start) / duration * 100}%` }} onClick={() => { onZoomSelect?.(r.id); seek(r.start + Math.min(r.ease, (r.end - r.start) / 2)); }}><span className="zoom-region-ramp" style={{ width: `${Math.min(.5, r.ease / (r.end - r.start)) * 100}%` }} /><span>{r.zoom.toFixed(2)}×</span><span className="zoom-region-ramp end" style={{ width: `${Math.min(.5, r.ease / (r.end - r.start)) * 100}%` }} /></button>) : t.key === 'audio' ? <AudioWave values={asset.waveform} muted={t.muted} /> : <div className="filmstrip">{Array.from({ length: 10 }, (_, i) => t.key === 'camera' ? <video key={i} draggable={false} src={asset.cameraUrl} poster={asset.cameraThumbnailUrl} muted preload="metadata" /> : <img key={i} draggable={false} src={asset.thumbnailUrl} alt="" />)}</div>}</div>)}<div className="timeline-trim-overlay" style={{ width: `${edits.trimStart / duration * 100}%` }} /><div className="timeline-trim-overlay end" style={{ width: `${(duration - edits.trimEnd) / duration * 100}%` }} />{edits.cuts?.map(c => <div key={c.id} className="cut-region" title={`Cut ${time(c.start)} to ${time(c.end)}`} style={{ left: `${c.start / duration * 100}%`, width: `${(c.end - c.start) / duration * 100}%` }} />)}{selection && <div className="timeline-selection" style={{ left: `${Math.min(selection.start, selection.end) / duration * 100}%`, width: `${Math.abs(selection.end - selection.start) / duration * 100}%` }}><button aria-label="Drag selection start" className="selection-handle start" style={{ touchAction: 'none' }} onPointerDown={e => dragHandle(e, 'start')} onKeyDown={e => adjustHandle(e, 'start')} /><button aria-label="Drag selection end" className="selection-handle end" style={{ touchAction: 'none' }} onPointerDown={e => dragHandle(e, 'end')} onKeyDown={e => adjustHandle(e, 'end')} /></div>}<div className="playhead" style={{ left: `${Math.max(0, Math.min(duration, currentTime)) / duration * 100}%` }}><span>{time(currentTime)}</span><i /></div></div></div></div><footer className="timeline-footer"><div className="timeline-hint">{selection ? `${time(Math.min(selection.start, selection.end), true)} to ${time(Math.max(selection.start, selection.end), true)}` : 'Drag to scrub · Shift + drag to select'}</div><div className="timeline-edit-actions"><button className="subtle" onClick={selectClip}><Scissors size={18} />Select <kbd>S</kbd></button><button className="subtle" disabled={!selection || Math.abs(selection.end - selection.start) < .05} onClick={onCut}><Trash size={18} />Cut <kbd>Del</kbd></button><span className="divider" /><button className="subtle" onClick={onUndo} disabled={!canUndo}><ArrowUUpLeft size={19} />Undo</button><IconButton icon={ArrowUUpRight} label="Redo edit" onClick={onRedo} disabled={!canRedo} /></div><div className="zoom-control"><IconButton icon={MagnifyingGlassMinus} label="Zoom out timeline" onClick={() => setZoom(z => Math.max(1, z - .5))} disabled={zoom === 1} /><input aria-label="Timeline zoom" type="range" min="1" max="5" step=".5" value={zoom} onChange={e => setZoom(Number(e.target.value))} /><IconButton icon={MagnifyingGlassPlus} label="Zoom in timeline" onClick={() => setZoom(z => Math.min(5, z + .5))} disabled={zoom === 5} /><IconButton icon={ArrowsOutSimple} label="Fit timeline" onClick={() => setZoom(1)} /></div></footer></section>;
}
