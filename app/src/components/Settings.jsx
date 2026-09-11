import React, { useEffect, useState } from 'react';
import { ArrowClockwise, CheckCircle, Copy, Cpu, Gear, HardDrive, Keyboard, Monitor, Moon, ShieldCheck, SlidersHorizontal, Sun, WarningCircle } from '@phosphor-icons/react';
import { api } from '../lib';
import { Modal, Spinner } from './UI';
import './settings.css';

const defaults = { defaultFolder: 'My library', defaultResolution: 1080, defaultQuality: 'balanced', recordingCountdown: 3, recordSystemAudio: true, cameraEnabled: true, microphoneEnabled: true };

export default function Settings({ health, onClose, onToast, appearance, onAppearanceChange }) {
  const [tab, setTab] = useState('general');
  const [saved, setSaved] = useState(null);
  const [values, setValues] = useState(defaults);
  const [status, setStatus] = useState(health || null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState(() => { try { return localStorage.getItem('replay.library.view') === 'list' ? 'list' : 'grid'; } catch { return 'grid'; } });
  const [savedView, setSavedView] = useState(view);
  const dirty = saved && (JSON.stringify(values) !== JSON.stringify(saved) || view !== savedView);

  useEffect(() => { if (health) setStatus(health); }, [health]);
  useEffect(() => {
    let cancelled = false;
    api('/settings').then(data => { if (!cancelled) { const next = { ...defaults, ...Object.fromEntries(Object.entries(data).filter(([key]) => key in defaults)) }; setValues(next); setSaved(next); } }).catch(err => { if (!cancelled) setError(err.message); }).finally(() => { if (!cancelled) setLoading(false); });
    if (!health) api('/health').then(data => { if (!cancelled) setStatus(data); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  function field(name, value) { setValues(current => ({ ...current, [name]: value })); }
  async function save(event) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const result = await api('/settings', { method: 'PATCH', body: { ...values, defaultFolder: values.defaultFolder.trim() || 'My library' } });
      const next = { ...defaults, ...Object.fromEntries(Object.entries(result).filter(([key]) => key in defaults)) };
      setValues(next); setSaved(next);
      try { localStorage.setItem('replay.library.view', view); setSavedView(view); } catch { throw new Error('Server preferences saved. Your browser could not save the library layout preference.'); }
      onToast?.('Preferences saved');
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }
  async function refresh() {
    setChecking(true); setError('');
    try { setStatus(await api('/health')); onToast?.('Local capabilities refreshed'); }
    catch (err) { setError(err.message); }
    finally { setChecking(false); }
  }
  async function copyPath() {
    try { await navigator.clipboard.writeText(status.storagePath); onToast?.('Storage path copied'); }
    catch { setError('Could not copy the path. You can select and copy it below.'); }
  }
  const capabilities = status?.capabilities;

  return <Modal title="Settings" onClose={onClose} className="settings-dialog"><div className="settings-layout">
    <aside className="settings-nav" aria-label="Settings sections">{[[SlidersHorizontal, 'general', 'Preferences'], [ShieldCheck, 'capabilities', 'Storage & services'], [Keyboard, 'shortcuts', 'Keyboard shortcuts']].map(([Icon, key, label]) => <button key={key} onClick={() => setTab(key)} className={tab === key ? 'active' : ''} aria-current={tab === key ? 'page' : undefined}><Icon size={19} /><span>{label}</span></button>)}<div className="settings-nav-foot"><span className="settings-local-dot" />Replay runs locally</div></aside>
    <div className="settings-content">
      {error && <p className="settings-error" role="alert"><WarningCircle size={18} /><span>{error}</span></p>}
      {tab === 'general' && <form onSubmit={save}><header className="settings-section-heading"><Gear size={24} weight="light" /><h3>Make it yours</h3><p>A few defaults to make the next recording feel familiar.</p></header>
        <section className="settings-group settings-appearance"><h4 id="appearance-heading">Appearance</h4><p id="appearance-description">Choose your workspace theme. System follows your device.</p>
          <div className="appearance-options" role="group" aria-labelledby="appearance-heading" aria-describedby="appearance-description">
            {[[Sun, 'light', 'Light'], [Monitor, 'system', 'System'], [Moon, 'dark', 'Dark']].map(([Icon, value, label]) => <button type="button" key={value} className={`appearance-option ${appearance === value ? 'selected' : ''}`} aria-pressed={appearance === value} onClick={() => {
              const persisted = onAppearanceChange(value);
              if (!persisted) onToast?.('Appearance changed for this session. Your browser could not save it.', 'error');
            }}><span className={`appearance-preview appearance-preview-${value}`} aria-hidden="true"><span /><i /><b /></span><span className="appearance-option-label"><Icon size={16} />{label}<CheckCircle size={15} weight="fill" className="appearance-check" /></span></button>)}
          </div><p className="appearance-hint">Applies instantly. Saved on this browser.</p>
        </section>
        {loading ? <div className="settings-loading"><Spinner>Loading preferences</Spinner></div> : !saved ? <div className="settings-unavailable"><p>Preferences could not be loaded from the local server.</p><button type="button" className="button subtle" onClick={() => { setError(''); setLoading(true); api('/settings').then(data => { const next = { ...defaults, ...Object.fromEntries(Object.entries(data).filter(([key]) => key in defaults)) }; setSaved(next); setValues(next); }).catch(err => setError(err.message)).finally(() => setLoading(false)); }}><ArrowClockwise size={17} />Try again</button></div> : <>
          <section className="settings-group"><h4>Library</h4><SettingRow title="Default folder" description="New recordings and imports are saved here."><input aria-label="Default folder" value={values.defaultFolder} maxLength={80} onChange={e => field('defaultFolder', e.target.value)} placeholder="My library" /></SettingRow><SettingRow title="Library layout" description="Used the next time you open the library."><select aria-label="Default library layout" value={view} onChange={e => setView(e.target.value)}><option value="grid">Grid</option><option value="list">List</option></select></SettingRow></section>
          <section className="settings-group"><h4>Recording</h4><SettingRow title="Countdown" description="A moment to get ready before capture begins."><select aria-label="Recording countdown" value={values.recordingCountdown} onChange={e => field('recordingCountdown', Number(e.target.value))}>{[0, 3, 5, 10, ...([0,3,5,10].includes(values.recordingCountdown) ? [] : [values.recordingCountdown])].sort((a,b) => a-b).map(value => <option key={value} value={value}>{value === 0 ? 'No countdown' : `${value} seconds`}</option>)}</select></SettingRow><ToggleRow title="Microphone" description="Start with your microphone enabled." checked={values.microphoneEnabled} onChange={value => field('microphoneEnabled', value)} /><ToggleRow title="Camera" description="Start with screen and camera capture." checked={values.cameraEnabled} onChange={value => field('cameraEnabled', value)} /><ToggleRow title="System audio" description="Request screen audio where your browser supports it." checked={values.recordSystemAudio} onChange={value => field('recordSystemAudio', value)} /></section>
          <section className="settings-group"><h4>Capture & export</h4><SettingRow title="Preferred resolution" description="Capture depends on your source and browser. Exports use this default."><select aria-label="Default resolution" value={values.defaultResolution} onChange={e => field('defaultResolution', Number(e.target.value))}><option value={720}>720p</option><option value={1080}>1080p</option><option value={2160}>4K · 2160p</option></select></SettingRow><SettingRow title="Export quality" description="You can change this for each export."><select aria-label="Default export quality" value={values.defaultQuality} onChange={e => field('defaultQuality', e.target.value)}><option value="high">High quality</option><option value="balanced">Balanced</option><option value="small">Smaller file</option></select></SettingRow></section>
          <div className="settings-save-row"><span>{dirty ? 'You have unsaved preferences' : 'Preferences are saved locally'}</span><button className="button primary" disabled={!dirty || saving}>{saving ? <Spinner>Saving</Spinner> : 'Save preferences'}</button></div>
        </>}
      </form>}
      {tab === 'capabilities' && <><header className="settings-section-heading"><HardDrive size={24} weight="light" /><h3>Your recordings, on your computer</h3><p>Replay stores original media, edits and exports on this computer.</p></header><section className="settings-storage-card"><div className="settings-storage-title"><HardDrive size={19} /><strong>Recording storage</strong>{status?.storagePath && <button type="button" className="icon-button" onClick={copyPath} title="Copy storage path" aria-label="Copy storage path"><Copy size={17} /></button>}</div><code>{status?.storagePath || 'Storage location unavailable'}</code><p>Archiving keeps the original files. Moving or deleting this folder outside Replay can make recordings unavailable.</p></section>
        <section className="settings-group settings-service-group"><div className="settings-group-header"><h4>Local tools</h4><button className="settings-refresh" onClick={refresh} disabled={checking}><ArrowClockwise size={14} className={checking ? 'spin' : ''} />Refresh status</button></div><Capability title="Media exports" description="Video, audio, thumbnails and portable bundles." enabled={capabilities?.ffmpeg} /><Capability title="Media inspection" description="Read video length, resolution and audio tracks." enabled={capabilities?.ffprobe} /></section>
        <section className="settings-group settings-service-group"><h4>Optional AI services</h4><Capability title="Transcription" description="Generate timed text from a recording." enabled={capabilities?.transcription} configured /><Capability title="Summaries & chapters" description="Draft a summary and chapters from your transcript." enabled={capabilities?.ai} configured /><div className="settings-ai-note"><Cpu size={19} /><p>AI runs only when you request it. Transcription sends audio to OpenAI; summaries send transcript text. A configured key does not verify your account balance or a successful request.</p></div><details className="settings-key-help"><summary>How to enable AI</summary><div><p>Set <code>OPENAI_API_KEY</code> in the local server environment, then restart Replay and refresh this status.</p><p>Keep the key in a private server environment or a private environment file that your server launcher loads. Do not use a <code>VITE_</code> variable, commit it to source control, or enter it in the browser.</p><p>Recording, editing, subtitle import and local exports do not require an AI key.</p></div></details></section>
        <div className="settings-local-note"><ShieldCheck size={17} /><span>Cloud hosting and team accounts are not connected in this local version.</span></div>
      </>}
      {tab === 'shortcuts' && <><header className="settings-section-heading"><Keyboard size={25} weight="light" /><h3>Keep your hands on the keys</h3><p>These shortcuts work in the editor while you are not typing.</p></header><div className="settings-shortcuts">{[['Play or pause', ['Space']], ['Select a range at the playhead', ['S']], ['Cut the selected range', ['Delete']], ['Undo edit', ['⌘ / Ctrl', 'Z']], ['Redo edit', ['⌘ / Ctrl', 'Shift', 'Z']], ['Back five seconds', ['←']], ['Forward five seconds', ['→']], ['Clear timeline selection', ['Esc']]].map(([label, keys]) => <div key={label}><span>{label}</span><div>{keys.map(key => <kbd key={key}>{key}</kbd>)}</div></div>)}</div><div className="settings-shortcut-tip"><span>Timeline tip</span><p>Hold <kbd>Shift</kbd> and drag across a track to select the exact range you want to remove.</p></div></>}
    </div>
  </div></Modal>;
}

function SettingRow({ title, description, children }) { return <div className="settings-row"><div><strong>{title}</strong><p>{description}</p></div>{children}</div>; }
function ToggleRow({ title, description, checked, onChange }) { return <SettingRow title={title} description={description}><button type="button" className={`settings-toggle ${checked ? 'enabled' : ''}`} role="switch" aria-checked={!!checked} aria-label={title} onClick={() => onChange(!checked)}><span /></button></SettingRow>; }
function Capability({ title, description, enabled, configured }) { const label = enabled === undefined ? 'Unknown' : enabled ? configured ? 'Key configured' : 'Available' : configured ? 'Not configured' : 'Unavailable'; return <div className="settings-capability"><div><strong>{title}</strong><p>{description}</p></div><span className={`settings-capability-status ${enabled ? 'available' : ''}`}>{enabled ? <CheckCircle size={14} /> : <span className="settings-status-dot" />}{label}</span></div>; }
