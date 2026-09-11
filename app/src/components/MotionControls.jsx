import { useEffect, useState } from 'react';
import { Plus, Play, Trash, Crosshair, MagnifyingGlassPlus } from '@phosphor-icons/react';
import { cameraCanAnimate, MAX_ZOOMS, normalizeZooms } from '../motion.js';
import { composition } from '../composition.js';
import { keptRanges, time, uid } from '../lib.js';
import { thumbnailFrame } from '../thumbnail-frame.js';
import { IconButton } from './UI.jsx';
import './motion.css';

function FocusPicker({ asset, region, onChange }) {
  const [image, setImage] = useState(null);
  useEffect(() => {
    let cancelled = false;
    thumbnailFrame(asset.mediaUrl, (region.start + region.end) / 2).then(frame => { if (!cancelled) setImage(frame); });
    return () => { cancelled = true; };
  }, [asset.mediaUrl, region.start, region.end]);
  function point(event) {
    if (event.detail === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onChange({ x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) });
  }
  function key(event) {
    const delta = event.shiftKey ? .1 : .02;
    const offsets = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] };
    if (!offsets[event.key]) return;
    event.preventDefault(); event.stopPropagation();
    onChange({ x: Math.max(0, Math.min(1, region.x + offsets[event.key][0])), y: Math.max(0, Math.min(1, region.y + offsets[event.key][1])) });
  }
  return <div className="motion-focus-group"><div className="row between"><h3>Focus point</h3><button className="text-link" onClick={() => onChange({ x: .5, y: .5 })}>Center</button></div>
    <button className="motion-focus" style={{ aspectRatio: asset.width / asset.height, maxWidth: `${235 * asset.width / asset.height}px`, marginInline: 'auto' }} aria-label={`Zoom focus, ${Math.round(region.x * 100)} percent across, ${Math.round(region.y * 100)} percent down. Click or use arrow keys to move.`} onClick={point} onKeyDown={key}>
      <img src={image || asset.thumbnailUrl} alt="" draggable={false} />
      <span className="motion-focus-guide" style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%` }}><Crosshair size={25} /></span>
    </button><p className="small-copy">Click the detail you want to emphasize. Arrow keys fine-tune the focus.</p></div>;
}

export default function MotionControls({ asset, position, selection, selectedId, onSelect, onEdit, onSeek, onPreview, onToast }) {
  const zooms = asset.edits.zooms || [], selected = zooms.find(r => r.id === selectedId) || zooms[0];
  const index = zooms.findIndex(r => r.id === selected?.id);
  const bounds = { start: zooms[index - 1]?.end || 0, end: zooms[index + 1]?.start ?? asset.duration };
  function update(patch) {
    const next = { ...selected, ...patch };
    if ('start' in patch) next.start = Math.max(bounds.start, Math.min(next.end - .2, patch.start));
    if ('end' in patch) next.end = Math.min(bounds.end, Math.max(next.start + .2, patch.end));
    onEdit({ zooms: normalizeZooms(zooms.map(r => r.id === selected.id ? next : r), asset.duration) });
  }
  function add() {
    const ranges = keptRanges(asset);
    let start = selection ? Math.min(selection.start, selection.end) : position;
    const retained = ranges.find(r => r.end > start + .2);
    if (!retained) { onToast('Move the playhead earlier in a retained section to add a zoom.'); return; }
    start = Math.max(start, retained.start);
    let end = selection ? Math.max(selection.start, selection.end) : Math.min(start + 4, retained.end);
    end = Math.min(end, asset.edits.trimEnd);
    const next = zooms.find(r => r.start >= start);
    if (!selection && next) end = Math.min(end, next.start);
    if (end - start < .2 - 1e-9 || zooms.some(r => r.start < end && r.end > start)) { onToast('Choose at least 0.2 seconds that do not overlap another zoom.'); return; }
    const region = { id: uid(), start, end, zoom: 1.75, x: .5, y: .5, ease: .6, cameraScale: 1 };
    onEdit({ zooms: normalizeZooms([...zooms, region], asset.duration) }); onSelect(region.id); onSeek(start + Math.min(.6, (end - start) / 2));
  }
  return <div className={`panel-form motion-panel ${zooms.length ? 'has-zooms' : ''}`}>
    <div className="motion-intro"><span className="motion-eyebrow">DIRECT THE ATTENTION</span><h3>Make the detail clear.</h3><p>Ease into the important part, hold, then return to the full picture.</p></div>
    <button className="button primary motion-add" disabled={zooms.length >= MAX_ZOOMS} onClick={add}><Plus size={17} />{selection ? 'Zoom selected range' : 'Add zoom at playhead'}</button>
    {!zooms.length ? <div className="motion-empty"><MagnifyingGlassPlus size={30} /><strong>Your first close-up</strong><p>Add a zoom here, or Shift + drag on the timeline to choose its duration. Every change stays editable.</p></div> : <>
      <div className="motion-regions" aria-label="Zoom regions">{zooms.map((r, i) => <button key={r.id} aria-pressed={r.id === selected.id} onClick={() => { onSelect(r.id); onSeek(r.start + Math.min(r.ease, (r.end - r.start) / 2)); }}><span className="motion-number">{String(i + 1).padStart(2, '0')}</span><span><strong>Zoom {i + 1}</strong><small>{time(r.start, true)} to {time(r.end, true)}</small></span><b>{r.zoom.toFixed(2)}×</b></button>)}</div>
      <div className="row between"><h3>Zoom {index + 1}</h3><IconButton icon={Trash} label={`Delete zoom ${index + 1}`} onClick={() => { onEdit({ zooms: zooms.filter(r => r.id !== selected.id) }); onSelect(null); }} /></div>
      <FocusPicker asset={asset} region={selected} onChange={update} />
      <div className="motion-presets" aria-label="Zoom strength presets">{[[1.4, 'Subtle'], [1.75, 'Balanced'], [2.5, 'Close-up']].map(([zoom, label]) => <button key={zoom} aria-pressed={selected.zoom === zoom} onClick={() => update({ zoom })}>{label}</button>)}</div>
      <label className="slider-field">Magnification<span>{selected.zoom.toFixed(2)}×</span><input aria-label="Zoom magnification" type="range" min="1" max="3" step=".05" value={selected.zoom} onChange={e => update({ zoom: Number(e.target.value) })} /></label>
      <div className="form-grid"><label>Start (seconds)<input aria-label="Zoom start" type="number" min={bounds.start} max={selected.end - .2} step=".1" value={Number(selected.start.toFixed(2))} onChange={e => e.target.value !== '' && update({ start: Number(e.target.value) })} /></label><label>End (seconds)<input aria-label="Zoom end" type="number" min={selected.start + .2} max={bounds.end} step=".1" value={Number(selected.end.toFixed(2))} onChange={e => e.target.value !== '' && update({ end: Number(e.target.value) })} /></label></div>
      <label className="slider-field">Ease in and out<span>{Math.min(selected.ease, (selected.end - selected.start) / 2).toFixed(1)}s</span><input aria-label="Zoom easing duration" type="range" min=".1" max="2" step=".1" value={selected.ease} onChange={e => update({ ease: Number(e.target.value) })} /></label>
      {asset.cameraUrl && <><label className="toggle-row"><div><strong>Give the screen more room</strong><small>Shrink the camera gently during this zoom.</small></div><input type="checkbox" checked={selected.cameraScale < 1} disabled={!cameraCanAnimate(composition(asset).camera)} onChange={e => update({ cameraScale: e.target.checked ? .75 : 1 })} /></label>{!cameraCanAnimate(composition(asset).camera) && <p className="small-copy">Place the camera fully inside the output frame to animate its size.</p>}</>}
      <button className="button motion-preview" onClick={() => onPreview(selected.start, selected.end)}><Play size={17} />Preview this zoom</button>
      <p className="small-copy">Times refer to the original recording. Cuts remain removed in preview and export.</p>
    </>}
  </div>;
}
