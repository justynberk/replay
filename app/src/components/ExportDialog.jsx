import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Export, FilmStrip, MusicNotes, Subtitles, FileText, FileZip, Image, Code, Check, ArrowRight, WarningCircle, CircleNotch, FloppyDisk, Stack, Monitor, CheckCircle, DownloadSimple } from '@phosphor-icons/react';
import { durationLabel } from './recorder-storage';
import './export-dialog.css';
import { DELIVERY_PRESETS, deliveryPreset } from '../export-presets.js';
import CompositionThumbnail from './CompositionThumbnail.jsx';

const PRESET_KEY = 'replay-export-presets-v1';
const FORMAT_GROUPS = [
  { label: 'VIDEO & AUDIO', formats: [
    { id: 'mp4', label: 'MP4', detail: 'Most compatible', icon: FilmStrip, render: true },
    { id: 'webm', label: 'WebM', detail: 'For the web', icon: FilmStrip, render: true },
    { id: 'gif', label: 'GIF', detail: 'Animated preview', icon: Image, render: true },
    { id: 'mp3', label: 'MP3', detail: 'Compact audio', icon: MusicNotes, render: true },
    { id: 'wav', label: 'WAV', detail: 'Uncompressed audio', icon: MusicNotes, render: true },
    { id: 'png', label: 'PNG', detail: 'Still image', icon: Image, render: true },
  ] },
  { label: 'TRANSCRIPT & PROJECT', formats: [
    { id: 'srt', label: 'SRT', detail: 'Subtitle file', icon: Subtitles, transcript: true },
    { id: 'vtt', label: 'VTT', detail: 'Web captions', icon: Subtitles, transcript: true },
    { id: 'txt', label: 'Text', detail: 'Plain transcript', icon: FileText, transcript: true },
    { id: 'md', label: 'Markdown', detail: 'Notes & transcript', icon: FileText },
    { id: 'json', label: 'JSON', detail: 'Project data', icon: Code },
    { id: 'source', label: 'Original', detail: 'Untouched recording', icon: DownloadSimple },
  ] },
];
const BUILT_INS = [
  { id: 'default', name: 'Video with saved layout', formats: ['mp4'], preset: 'original', resolution: 1080, quality: 'high', burnCaptions: false, includeSources: false },
  { id: 'social', name: 'Vertical social clip', formats: ['mp4'], preset: 'portrait', resolution: 1080, quality: 'high', burnCaptions: true, includeSources: false },
  { id: 'web', name: 'Small web video', formats: ['mp4'], preset: 'landscape', resolution: 720, quality: 'small', burnCaptions: false, includeSources: false },
  { id: 'archive', name: 'Complete project package', formats: ['mp4', 'json', 'md', 'zip'], preset: 'original', resolution: 1080, quality: 'high', burnCaptions: false, includeSources: true },
  { id: 'audio', name: 'Audio only', formats: ['mp3'], preset: 'original', resolution: 1080, quality: 'balanced', burnCaptions: false, includeSources: false },
];
const FRAMINGS = [{ id: 'original', name: 'Original', ratio: null }, { id: 'landscape', name: '16:9', ratio: 16 / 9 }, { id: 'portrait', name: '9:16', ratio: 9 / 16 }, { id: 'square', name: '1:1', ratio: 1 }, { id: '4:5', name: '4:5', ratio: 4 / 5 }];

function editedDuration(asset) {
  const edits = asset.edits || {};
  const start = Math.max(0, edits.trimStart || 0);
  const end = Math.min(asset.duration || 0, edits.trimEnd ?? asset.duration ?? 0);
  const cuts = (edits.cuts || []).map(cut => [Math.max(start, cut.start), Math.min(end, cut.end)]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  let cutTime = 0; let previousEnd = start;
  for (const [a, b] of cuts) { cutTime += Math.max(0, b - Math.max(a, previousEnd)); previousEnd = Math.max(previousEnd, b); }
  return Math.max(0, end - start - cutTime) / (edits.speed || 1);
}
function bytesLabel(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Calculated during export';
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(.1, bytes / 1024 ** 2).toFixed(1)} MB`;
}

export default function ExportDialog({ initialPreset = 'default', asset, onClose, onQueued, onToast }) {
  const initial = deliveryPreset(initialPreset, asset);
  const [advanced, setAdvanced] = useState(initialPreset === 'custom');
  const [formats, setFormats] = useState(initial.formats);
  const [preset, setPreset] = useState(initial.preset);
  const [resolution, setResolution] = useState(1080);
  const [quality, setQuality] = useState(initial.quality);
  const [burnCaptions, setBurnCaptions] = useState(initial.burnCaptions);
  const [includeSources, setIncludeSources] = useState(initial.includeSources);
  const [savedPresets, setSavedPresets] = useState([]);
  const [selectedPreset, setSelectedPreset] = useState(initialPreset);
  const [showSave, setShowSave] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState(false);
  const [queuedJob, setQueuedJob] = useState(null);
  const panel = useRef(null);
  const settingsTouched = useRef(initialPreset !== 'default');
  const hasTranscript = Boolean(asset?.transcript?.length);
  const usesRender = formats.some(format => ['mp4', 'webm', 'gif', 'mp3', 'wav', 'png'].includes(format));
  const usesVideo = formats.some(format => ['mp4', 'webm', 'gif', 'png'].includes(format));
  const duration = useMemo(() => editedDuration(asset || {}), [asset]);
  const packaged = formats.includes('zip');
  const sourceRatio = asset?.width && asset?.height ? asset.width / asset.height : 16 / 9;
  const ratio = FRAMINGS.find(frame => frame.id === preset)?.ratio || sourceRatio;
  const sourceCount = 1 + ['cameraUrl', 'microphoneUrl', 'systemUrl'].filter(key => asset?.[key]).length;
  const renderedUnavailable = health?.capabilities?.ffmpeg === false;

  useEffect(() => {
    const previousFocus = document.activeElement;
    panel.current?.focus();
    try {
      const stored = JSON.parse(localStorage.getItem(PRESET_KEY) || '[]');
      if (Array.isArray(stored)) setSavedPresets(stored.filter(value => value && typeof value.name === 'string' && Array.isArray(value.formats)).slice(0, 20));
    } catch { /* Invalid browser preferences do not block exporting. */ }
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal }).then(response => { if (!response.ok) throw new Error(); return response.json(); }).then(setHealth).catch(error => { if (error.name !== 'AbortError') setHealthError(true); });
    fetch('/api/settings', { signal: controller.signal }).then(response => response.ok ? response.json() : null).then(settings => {
      if (!settings || settingsTouched.current) return;
      if ([720, 1080, 2160].includes(settings.defaultResolution)) setResolution(settings.defaultResolution);
      if (['high', 'balanced', 'small'].includes(settings.defaultQuality)) setQuality(settings.defaultQuality);
    }).catch(() => {});
    return () => { controller.abort(); previousFocus?.focus?.(); };
  }, []);

  const estimate = useMemo(() => {
    const bitsPerSecond = { high: 8000000, balanced: 4000000, small: 1600000 }[quality] * (resolution / 1080) ** 1.6;
    let bytes = 0;
    for (const format of formats) {
      if (format === 'mp4' || format === 'webm') bytes += duration * bitsPerSecond / 8;
      else if (format === 'mp3') bytes += duration * 192000 / 8;
      else if (format === 'wav') bytes += duration * 48000 * 2 * 2;
      else if (format === 'source') bytes += asset.size || 0;
      else if (format === 'gif') bytes += duration * 350000;
      else if (format === 'png') bytes += 1024 * 1024 * 1.5;
      else if (format !== 'zip') bytes += JSON.stringify(asset.transcript || []).length * 2 + 1024;
    }
    if (packaged && includeSources && !formats.includes('source')) bytes += asset.size || 0;
    return bytes;
  }, [formats, quality, resolution, duration, asset, packaged, includeSources]);

  function toggleFormat(id) {
    settingsTouched.current = true;
    setFormats(current => current.includes(id) ? current.filter(format => format !== id) : [...current, id]);
    setSelectedPreset('custom'); setError('');
  }
  function update(setter, value) { settingsTouched.current = true; setter(value); setSelectedPreset('custom'); }

  function applyPreset(id) {
    settingsTouched.current = true;
    setSelectedPreset(id); setError(''); setNotice('');
    const saved = DELIVERY_PRESETS.some(item => item.id === id) ? deliveryPreset(id, asset) : [...BUILT_INS, ...savedPresets].find(item => item.id === id);
    if (!saved) return;
    const allowed = new Set([...FORMAT_GROUPS.flatMap(group => group.formats.map(format => format.id)), 'zip']);
    setFormats(saved.formats.filter(format => allowed.has(format) && (hasTranscript || !['srt', 'vtt', 'txt'].includes(format))));
    setPreset(FRAMINGS.some(frame => frame.id === saved.preset) ? saved.preset : 'original');
    setResolution([720, 1080, 2160].includes(saved.resolution) ? saved.resolution : 1080);
    setQuality(['high', 'balanced', 'small'].includes(saved.quality) ? saved.quality : 'high');
    setBurnCaptions(Boolean(saved.burnCaptions && hasTranscript)); setIncludeSources(Boolean(saved.includeSources));
    if (saved.burnCaptions && !hasTranscript) setNotice('This recording has no transcript yet, so captions are off. You can generate or add a transcript in the editor.');
  }

  function savePreset() {
    const name = presetName.trim();
    if (!name) return;
    const entry = { id: `saved-${crypto.randomUUID()}`, name, formats, preset, resolution, quality, burnCaptions, includeSources };
    const next = [...savedPresets.filter(item => item.name !== name), entry].slice(-20);
    try {
      localStorage.setItem(PRESET_KEY, JSON.stringify(next)); setSavedPresets(next); setSelectedPreset(entry.id); setShowSave(false); setPresetName(''); setNotice(`“${name}” is saved in this browser.`);
    } catch { setError('This browser could not save the preset. You can still export with these settings.'); }
  }

  async function queueExport() {
    if (submitting || queuedJob) return;
    const deliverables = formats.filter(format => format !== 'zip');
    if (!deliverables.length && !(packaged && includeSources)) { setError('Choose at least one output format or include source files in your package.'); return; }
    if (usesRender && !duration) { setError('There is no footage left in this edit. Restore a section of the timeline before exporting.'); return; }
    if (usesRender && renderedUnavailable) { setError('Video rendering is unavailable on this computer. You can download originals, captions or project data.'); return; }
    setSubmitting(true); setError('');
    try {
      const requestedFormats = !deliverables.length && packaged && includeSources ? ['source', 'zip'] : formats;
      const response = await fetch('/api/exports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assetId: asset.id, formats: requestedFormats, preset, resolution, quality, burnCaptions: Boolean(burnCaptions && hasTranscript && usesVideo), includeSources: Boolean(includeSources && packaged) }) });
      const job = await response.json();
      if (!response.ok) throw new Error(job.error || 'The export could not be queued.');
      setQueuedJob(job); onQueued?.(job);
    } catch (caught) { setError(caught.message || 'Could not connect to the export service. Try again.'); }
    finally { setSubmitting(false); }
  }

  function requestClose() { if (!submitting) onClose?.(); }
  function handleKeys(event) {
    if (event.key === 'Escape') { event.preventDefault(); requestClose(); }
    if (event.key === 'Tab') {
      const nodes = [...panel.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter(node => node.offsetParent !== null);
      if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0]?.focus(); }
    }
  }

  if (!asset) return null;
  return <div className="export-scrim" onMouseDown={event => event.currentTarget === event.target && requestClose()}><section className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title" ref={panel} tabIndex={-1} onKeyDown={handleKeys}>
    <header className="export-heading"><div className="export-heading-icon"><Export size={23}/></div><div><span className="export-eyebrow">MADE TO GO PLACES</span><h2 id="export-title">Export your recording</h2></div><button className="icon-button" aria-label="Close export dialog" onClick={requestClose} disabled={submitting}><X size={21}/></button></header>
    {queuedJob ? <div className="export-success"><div><CheckCircle size={42} weight="light"/></div><h3>You're in the queue.</h3><p>Your files are being prepared on this computer.<br/>Follow progress and download them from Exports.</p><button className="button primary" onClick={requestClose}>Back to the editor<ArrowRight size={17}/></button></div> : <>
      <div className="export-body"><div className="export-main">
        {!advanced && <div className="delivery-choices">{DELIVERY_PRESETS.map(item => { const Icon = { video: FilmStrip, vertical: Monitor, audio: MusicNotes, package: FileZip }[item.icon]; return <button key={item.id} className={selectedPreset === item.id && !advanced ? 'selected' : ''} aria-pressed={selectedPreset === item.id && !advanced} disabled={submitting} onClick={() => { applyPreset(item.id); setAdvanced(false); }}><Icon size={25} /><strong>{item.name}</strong><span>{item.detail}</span></button>; })}</div>}
        <button className="delivery-custom" aria-expanded={advanced} disabled={submitting} onClick={() => { setAdvanced(!advanced); setShowSave(false); }}>{advanced ? 'Back to export choices' : 'Custom settings'}<ArrowRight size={16} /></button>
        {!advanced && <div className="delivery-explanation"><h3>{selectedPreset === 'social' ? 'Your edit, ready for vertical.' : selectedPreset === 'archive' ? 'Everything in one download.' : selectedPreset === 'audio' ? 'Take the conversation with you.' : 'Ready to use anywhere.'}</h3><p>{selectedPreset === 'social' ? 'Exports the full current edit in 9:16. Check the framing in the preview, or trim your clip in the editor first.' : selectedPreset === 'archive' ? 'An organized ZIP with your finished video, project data, notes, available captions and original source tracks.' : selectedPreset === 'audio' ? 'An MP3 with your cuts, saved speed and audio adjustments applied.' : 'A compatible MP4 with your saved layout, cuts, motion and overlays. Your original recording stays intact.'}</p></div>}
        {advanced && <><div className="export-presets"><label><span>Export preset</span><select value={selectedPreset} onChange={event => applyPreset(event.target.value)} disabled={submitting}><option value="custom">Custom settings</option><optgroup label="Replay presets">{BUILT_INS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>{savedPresets.length > 0 && <optgroup label="Your presets">{savedPresets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>}</select></label><button className="icon-button" aria-label="Save current export settings as a preset" title="Save preset" onClick={() => setShowSave(!showSave)} disabled={submitting}><FloppyDisk size={19}/></button></div>
        {showSave && <div className="export-save-preset"><input aria-label="Preset name" value={presetName} onChange={event => setPresetName(event.target.value)} maxLength={50} placeholder="Name this preset" onKeyDown={event => event.key === 'Enter' && savePreset()}/><button className="button subtle" onClick={savePreset} disabled={!presetName.trim()}>Save</button></div>}
        {FORMAT_GROUPS.map(group => <div className="export-format-group" key={group.label}><h3>{group.label}</h3><div className="export-format-grid">{group.formats.map(format => {
          const Icon = format.icon;
          const selected = formats.includes(format.id);
          const disabled = submitting || (!selected && ((format.transcript && !hasTranscript) || (format.render && renderedUnavailable)));
          return <button type="button" key={format.id} className={`export-format ${selected ? 'selected' : ''}`} aria-pressed={selected} disabled={disabled} onClick={() => toggleFormat(format.id)} title={format.transcript && !hasTranscript ? 'Add a transcript in the editor first' : format.render && renderedUnavailable ? 'Local video renderer is unavailable' : format.detail}><Icon size={18}/><span><strong>{format.label}</strong><small>{format.detail}</small></span><i>{selected && <Check size={10} weight="bold"/>}</i></button>;
        })}</div></div>)}
        {!hasTranscript && <p className="export-caption-help"><Subtitles size={14}/>Subtitle formats become available when this recording has a transcript.</p>}
        <label className={`export-package ${packaged ? 'selected' : ''}`}><FileZip size={23}/><span><strong>Bundle as a ZIP</strong><small>One organized download for all your selected files.</small></span><input type="checkbox" checked={packaged} onChange={() => toggleFormat('zip')} disabled={submitting}/></label>
        {packaged && <label className="export-sources-toggle"><input type="checkbox" checked={includeSources} onChange={event => update(setIncludeSources, event.target.checked)} disabled={submitting}/><span>Include original source tracks <small>{sourceCount} available · Preserve your unedited media</small></span></label>}
      </>} </div>
      <aside className="export-settings"><div className="export-asset-preview"><div className="export-framing-canvas" style={{ aspectRatio: '16 / 10' }}><div className="export-frame" style={{ position: 'relative', aspectRatio: ratio, width: ratio >= 1.3 ? '100%' : 'auto', height: ratio >= 1.3 ? 'auto' : '100%', maxWidth: '100%', maxHeight: '100%' }}>{asset.thumbnailUrl ? <CompositionThumbnail asset={asset} aspect={ratio} captions={burnCaptions} /> : <Monitor size={35}/>}</div><span className="export-duration">{durationLabel(duration)}</span></div><h3 title={asset.title}>{asset.title}</h3><p>{asset.width || '?'} × {asset.height || '?'} source · {durationLabel(duration)} edited</p></div>
        {advanced && <><div className={`export-setting-section ${!usesVideo ? 'inactive' : ''}`}><div className="export-setting-label"><span>Framing</span><small>{usesVideo ? 'Saved layout' : 'Video outputs only'}</small></div><div className="export-framings">{FRAMINGS.map(frame => <button key={frame.id} className={preset === frame.id ? 'selected' : ''} aria-pressed={preset === frame.id} disabled={!usesVideo || submitting} onClick={() => update(setPreset, frame.id)}><i style={{ width: frame.id === 'portrait' ? 9 : frame.id === 'square' ? 13 : frame.id === '4:5' ? 11 : 19, height: frame.id === 'portrait' ? 17 : 13 }}/><span>{frame.name}</span></button>)}</div><p className="export-frame-note">Layout preview. Cuts, captions, and overlays are applied during rendering.</p></div>
        <div className="export-setting-section"><label className="export-select-field"><span>Resolution</span><select value={resolution} onChange={event => update(setResolution, Number(event.target.value))} disabled={!usesVideo || submitting}><option value={720}>720p · HD</option><option value={1080}>1080p · Full HD</option><option value={2160}>2160p · 4K</option></select></label><small className="export-resolution-note">Higher output resolution cannot recover detail missing from the source.</small></div>
        <div className="export-setting-section"><label className="export-select-field"><span>Quality</span><select value={quality} onChange={event => update(setQuality, event.target.value)} disabled={!usesRender || submitting}><option value="high">High · best detail</option><option value="balanced">Balanced · everyday sharing</option><option value="small">Small · faster downloads</option></select></label></div>
        <div className="export-setting-section"><label className="export-toggle-row"><span><Subtitles size={18}/>Burn in captions</span><input role="switch" type="checkbox" checked={burnCaptions && hasTranscript} onChange={event => update(setBurnCaptions, event.target.checked)} disabled={!hasTranscript || !usesVideo || submitting}/></label><p className="export-frame-note">Captions become part of the picture. SRT and VTT stay separate and editable.</p></div>
        </>}
        {!advanced && <dl className="delivery-specs"><dt>Format</dt><dd>{formats.filter(f => f !== 'zip').map(f => f.toUpperCase()).join(', ')}</dd>{usesVideo && <><dt>Framing</dt><dd>{FRAMINGS.find(frame => frame.id === preset)?.name}</dd><dt>Resolution</dt><dd>{resolution}p</dd><dt>Captions</dt><dd>{burnCaptions && hasTranscript ? 'Burned into video' : 'Off'}</dd></>}{packaged && <><dt>Original tracks</dt><dd>{includeSources ? 'Included' : 'Not included'}</dd></>}</dl>}
        <div className="export-edit-note"><Stack size={16}/><span>Originals are preserved.<small>Exports use your current saved edit.</small></span></div>
      </aside></div>
      <div className="export-messages" aria-live="polite">{error && <div className="export-message error" role="alert"><WarningCircle size={18}/><span>{error}</span></div>}{notice && <div className="export-message"><CheckCircle size={17}/><span>{notice}</span></div>}{renderedUnavailable && <div className="export-message"><WarningCircle size={17}/><span>The local video renderer is unavailable. Originals and text outputs are still available.</span></div>}{healthError && <div className="export-message"><WarningCircle size={17}/><span>Could not check the export service. You can retry by exporting when the service is available.</span></div>}</div>
      <footer className="export-bottom"><div className="export-estimate"><strong>{formats.filter(format => format !== 'zip').length} output{formats.filter(format => format !== 'zip').length === 1 ? '' : 's'} {packaged ? '· ZIP package' : ''}</strong><span>Estimated {bytesLabel(estimate)} <small>Actual size varies</small></span></div><button className="button primary export-submit" onClick={queueExport} disabled={submitting || (!formats.filter(format => format !== 'zip').length && !(packaged && includeSources)) || (renderedUnavailable && usesRender)}>{submitting ? <CircleNotch size={18} className="export-spinner"/> : <Export size={18}/>} {submitting ? 'Adding to queue…' : advanced ? 'Export files' : selectedPreset === 'archive' ? 'Export package' : selectedPreset === 'audio' ? 'Export audio' : 'Export video'} {!submitting && <ArrowRight size={16}/>}</button></footer>
    </>}
  </section></div>;
}
