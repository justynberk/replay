import { alignFrame, composition, frameAspect, layoutPreset, normalizeFrame, scaleFrame, MAX_LAYER_SIZE, MIN_LAYER_SIZE } from '../composition.js';

export default function CompositionControls({ asset, selected, onSelect, onEdit }) {
  const aspect = frameAspect(asset), layout = composition(asset), kind = selected === 'screen' || !asset.cameraUrl ? 'screen' : 'camera';
  const layer = asset.edits[kind] || {}, frame = layout[kind];
  const square = kind === 'camera' && ['circle', 'square'].includes(layout.shape);
  const update = patch => onEdit({ [kind]: { ...layer, ...patch } });
  const setFrame = patch => update({ frame: normalizeFrame({ ...frame, ...patch }, square ? aspect : null) });
  return <>
    {asset.cameraUrl && <><h3>Quick layouts</h3><div className="layout-presets">{[['overlay', 'Floating camera'], ['camera-bottom', 'Camera below'], ['camera-top', 'Camera above'], ['side-by-side', 'Side by side']].map(([id, label]) => <button className="layout-preset" key={id} onClick={() => { onEdit(layoutPreset(id, asset)); onSelect('camera'); }}><span className={`preset-diagram preset-${id}`} aria-hidden="true"><i /><b /></span>{label}</button>)}</div></>}
    <div className="section-line" /><div className="layer-tabs" aria-label="Layer to edit"><button aria-pressed={kind === 'screen'} onClick={() => onSelect('screen')}>Screen</button>{asset.cameraUrl && <button aria-pressed={kind === 'camera'} onClick={() => onSelect('camera')}>Camera</button>}</div>
    <p className="small-copy" id="layer-instructions">Drag a layer in the preview. Pull a corner to resize. Arrow keys move it; Shift moves farther.</p>
    {kind === 'camera' && <><label className="toggle-row"><strong>Show camera</strong><input type="checkbox" checked={layer.visible !== false} onChange={e => update({ visible: e.target.checked })} /></label><label>Camera shape<select value={layout.shape} onChange={e => update({ shape: e.target.value, frame: normalizeFrame(frame, ['circle', 'square'].includes(e.target.value) ? aspect : null) })}><option value="circle">Circle</option><option value="square">Square</option><option value="rounded">Rounded rectangle</option><option value="rectangle">Rectangle</option></select></label></>}
    <label>{kind === 'camera' ? 'Camera' : 'Screen'} framing<select value={layer.fit || (kind === 'camera' ? 'cover' : 'contain')} onChange={e => update({ fit: e.target.value })}><option value="contain">Fit entire recording</option><option value="cover">Fill and crop</option></select></label>
    <div className="layer-dimensions">{[['x', 'Left'], ['y', 'Top'], ['width', 'Width'], ['height', 'Height']].map(([key, label]) => <label key={key}>{label} (%)<input aria-label={`${kind} ${label.toLowerCase()} percent`} type="number" min={key === 'x' ? (MIN_LAYER_SIZE - frame.width) * 100 : key === 'y' ? (MIN_LAYER_SIZE - frame.height) * 100 : MIN_LAYER_SIZE * 100} max={key === 'x' || key === 'y' ? (1 - MIN_LAYER_SIZE) * 100 : MAX_LAYER_SIZE * 100} step="1" value={Math.round(frame[key] * 1000) / 10} disabled={key === 'height' && square} onChange={e => setFrame({ [key]: Number(e.target.value) / 100 })} /></label>)}</div>
    {square && <p className="small-copy">Width and height stay linked for a {layout.shape}.</p>}
    <label className="slider-field">Size<span>{Math.round(frame.width * 100)}%</span><input aria-label={`${kind} size`} type="range" min={MIN_LAYER_SIZE} max={Math.min(MAX_LAYER_SIZE, frame.width * MAX_LAYER_SIZE / frame.height)} step=".01" value={frame.width} onChange={e => update({ frame: scaleFrame(frame, Number(e.target.value), square ? aspect : null) })} /></label>
    <p className="small-copy">Scale beyond 100% to zoom in. Anything outside the canvas is cropped in your export.</p>
    <div className="row between"><h3>Place in frame</h3><div className="layer-align">{[0, .5, 1].flatMap((y, row) => [0, .5, 1].map((x, col) => <button key={`${x}-${y}`} aria-label={`Align ${kind} ${['top', 'middle', 'bottom'][row]} ${['left', 'center', 'right'][col]}`} onClick={() => update({ frame: alignFrame(frame, x, y) })}><span /></button>))}</div></div>
    <button className="button" onClick={() => update(kind === 'camera' ? { frame: null, shape: 'circle', fit: 'cover', size: .19, position: 'bottom-left', visible: true } : { frame: null, fit: 'contain' })}>Reset {kind} layout</button>
    {!asset.cameraUrl && <p className="small-copy">This video has no separate camera track. Screen + camera recordings keep both sources.</p>}
  </>;
}
