import { useRef, useState } from 'react';
import { transformFrame, clamp } from '../composition.js';
import './composition.css';

export default function CompositionLayer({ name, frame, aspect, selected, editable = true, square = false, hidden = false, onSelect, onChange, children }) {
  const [draft, setDraft] = useState(null);
  const gesture = useRef(null);
  const current = draft || frame;
  const visibleCorner = handle => ({
    left: `${clamp((handle.includes('w') ? Math.max(0, current.x) - current.x : Math.min(1, current.x + current.width) - current.x) / current.width, 0, 1) * 100}%`,
    top: `${clamp((handle.includes('n') ? Math.max(0, current.y) - current.y : Math.min(1, current.y + current.height) - current.y) / current.height, 0, 1) * 100}%`,
    right: 'auto', bottom: 'auto', transform: 'translate(-50%, -50%)',
  });
  function start(event, handle = 'move') {
    if (!editable || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); onSelect();
    const target = event.currentTarget;
    const bounds = target.closest('.output-frame').getBoundingClientRect();
    target.focus(); target.setPointerCapture(event.pointerId);
    gesture.current = { x: event.clientX, y: event.clientY, bounds, frame, handle, pointerId: event.pointerId, next: frame };
  }
  function move(event) {
    const g = gesture.current;
    if (!g || event.pointerId !== g.pointerId) return;
    const dx = (event.clientX - g.x) / g.bounds.width, dy = (event.clientY - g.y) / g.bounds.height;
    g.next = transformFrame(g.frame, dx, dy, g.handle, square ? aspect : null);
    setDraft(g.next);
  }
  function finish(event, cancel = false) {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null; setDraft(null);
    if (event.currentTarget.hasPointerCapture?.(g.pointerId)) event.currentTarget.releasePointerCapture(g.pointerId);
    if (!cancel && JSON.stringify(g.next) !== JSON.stringify(g.frame)) onChange(g.next);
  }
  function keyDown(event) {
    if (event.key === 'Escape') { event.stopPropagation(); finish(event, true); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const amount = event.shiftKey ? .05 : .005;
    onChange(transformFrame(frame, event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0, event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0, 'move', square ? aspect : null));
  }
  const events = { onPointerMove: move, onPointerUp: event => finish(event), onPointerCancel: event => finish(event, true), onLostPointerCapture: event => finish(event, true), onKeyDown: keyDown };
  const style = { left: `${current.x * 100}%`, top: `${current.y * 100}%`, width: `${current.width * 100}%`, height: `${current.height * 100}%`, display: hidden ? 'none' : undefined };
  return <><div className="composition-layer" data-layer={name.toLowerCase()} style={style}>
    {children(current)}
  </div>{editable && <div className={`composition-controls ${selected ? 'is-selected' : ''}`} data-controls={name.toLowerCase()} style={{ ...style, zIndex: selected ? 5 : name === 'Camera' ? 3 : 1 }}>
    <button className="layer-move" aria-label={`Move ${name.toLowerCase()} layer`} aria-describedby={selected ? 'layer-instructions' : undefined} onPointerDown={start} onFocus={onSelect} {...events} />
    {selected && <><span className="layer-name" style={{ left: `calc(${Math.max(0, -current.x) / current.width * 100}% + 3px)`, top: `calc(${Math.max(0, -current.y) / current.height * 100}% + 2px)` }}>{name}</span>{['nw', 'ne', 'sw', 'se'].map(handle => <button key={handle} className={`layer-handle handle-${handle}`} style={visibleCorner(handle)} aria-label={`Resize ${name.toLowerCase()} ${handle}`} onPointerDown={event => start(event, handle)} {...events} />)}</>}
  </div>}</>;
}
