import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Monitor, VideoCamera, Microphone, SpeakerHigh, Pause, Play, Stop, Record, WarningCircle, CheckCircle, ArrowCounterClockwise, FloppyDisk, Trash, NotePencil, DownloadSimple, CircleNotch, ShieldCheck } from '@phosphor-icons/react';
import { deleteRecordingSession, durationLabel, listRecordingSessions, recordingMimeType, recoverRecordingSession, saveRecordingChunk, saveRecordingSession } from './recorder-storage';
import './recorder.css';

const DEVICE_KEY = 'replay.recorder.devices.v1';
function savedDevices() { try { const value = JSON.parse(localStorage.getItem(DEVICE_KEY) || '{}'); return { camera: typeof value.camera === 'string' ? value.camera : '', microphone: typeof value.microphone === 'string' ? value.microphone : '' }; } catch { return {}; } }

const MODES = [
  { id: 'screen-camera', label: 'Screen + camera', icon: Monitor },
  { id: 'screen', label: 'Screen only', icon: Monitor },
  { id: 'camera', label: 'Camera only', icon: VideoCamera },
];
const permissionMessage = error => {
  if (error?.name === 'NotAllowedError') return 'Permission was not granted. Choose your screen and allow the selected camera or microphone, then try again.';
  if (error?.name === 'NotFoundError') return 'The selected camera or microphone could not be found. Connect it or choose a different device.';
  if (error?.name === 'NotReadableError') return 'A selected device is busy or unavailable. Close other apps using it, then try again.';
  return error?.message || 'Recording could not start. Check your browser permissions and try again.';
};

export default function Recorder({ onClose, onSaved, onToast }) {
  const [mode, setMode] = useState('screen-camera');
  const [resolution, setResolution] = useState(1080), [frameRate, setFrameRate] = useState(30), [captureSpec, setCaptureSpec] = useState(null);
  const [microphone, setMicrophone] = useState(true);
  const [systemAudio, setSystemAudio] = useState(true);
  const [micId, setMicId] = useState(() => savedDevices().microphone || '');
  const [cameraId, setCameraId] = useState(() => savedDevices().camera || '');
  const [devices, setDevices] = useState([]);
  const [status, setStatus] = useState('idle');
  const [streams, setStreams] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [countdown, setCountdown] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [drafts, setDrafts] = useState([]);
  const [result, setResult] = useState(null);
  const [reviewUrl, setReviewUrl] = useState('');
  const [discardPrompt, setDiscardPrompt] = useState(false);
  const [recoveryAvailable, setRecoveryAvailable] = useState(true);
  const [countdownSeconds, setCountdownSeconds] = useState(3);
  const mainPreview = useRef(null);
  const cameraPreview = useRef(null);
  const controller = useRef({ streams: [], recorders: [], startedAt: 0, accumulated: 0, phase: 'idle', cancelled: false, writes: [] });
  const mounted = useRef(true);
  const startRef = useRef(null);
  const panel = useRef(null);
  const settingsTouched = useRef(false);

  const stopTracks = useCallback(() => {
    const current = controller.current;
    for (const stream of current.streams) for (const track of stream.getTracks()) { track.onended = null; track.stop(); }
    current.streams = [];
    current.context?.close().catch(() => {});
    current.context = null;
    current.analyser = null;
    if (mounted.current) { setStreams(null); setAudioLevel(0); setCaptureSpec(null); }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const previousFocus = document.activeElement;
    panel.current?.focus();
    listRecordingSessions().then(items => mounted.current && setDrafts(items)).catch(() => mounted.current && setRecoveryAvailable(false));
    navigator.mediaDevices?.enumerateDevices?.().then(items => mounted.current && setDevices(items)).catch(() => {});
    fetch('/api/settings').then(response => response.ok ? response.json() : null).then(settings => {
      if (!settings || !mounted.current || settingsTouched.current) return;
      if (typeof settings.microphoneEnabled === 'boolean') setMicrophone(settings.microphoneEnabled);
      if (typeof settings.recordSystemAudio === 'boolean') setSystemAudio(settings.recordSystemAudio);
      if (settings.cameraEnabled === false) setMode('screen');
      if (Number.isInteger(settings.recordingCountdown)) setCountdownSeconds(Math.min(10, Math.max(0, settings.recordingCountdown)));
      if ([720, 1080, 2160].includes(settings.defaultResolution)) setResolution(settings.defaultResolution);
    }).catch(() => {});
    return () => {
      mounted.current = false;
      controller.current.cancelled = true;
      clearInterval(controller.current.countdownTimer);
      for (const recorder of controller.current.recorders) if (recorder.state !== 'inactive') recorder.stop();
      stopTracks();
      previousFocus?.focus?.();
    };
  }, [stopTracks]);

  useEffect(() => {
    if (mainPreview.current) mainPreview.current.srcObject = streams?.screen || streams?.camera || null;
    if (cameraPreview.current) cameraPreview.current.srcObject = streams?.screen ? streams?.camera || null : null;
  }, [streams]);

  useEffect(() => {
    if (!result?.blobs?.video) { setReviewUrl(''); return undefined; }
    const url = URL.createObjectURL(result.blobs.video);
    setReviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [result]);

  useEffect(() => {
    const timer = setInterval(() => {
      const current = controller.current;
      if (current.phase === 'recording') setElapsed(current.accumulated + (performance.now() - current.startedAt) / 1000);
      if (current.analyser) {
        const samples = new Uint8Array(current.analyser.fftSize);
        current.analyser.getByteTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length);
        setAudioLevel(Math.min(100, rms * 500));
      }
    }, 150);
    return () => clearInterval(timer);
  }, []);

  const refreshDrafts = () => listRecordingSessions().then(items => mounted.current && setDrafts(items)).catch(() => {});
  const phase = value => { controller.current.phase = value; if (mounted.current) setStatus(value); };
  const active = ['recording', 'paused', 'countdown', 'stopping'].includes(status);
  const locked = active || ['preparing', 'saving', 'review'].includes(status);
  const canScreen = Boolean(navigator.mediaDevices?.getDisplayMedia);
  const canRecord = Boolean(navigator.mediaDevices?.getUserMedia && globalThis.MediaRecorder);

  const resetSetup = () => { stopTracks(); phase('idle'); setError(''); setNotice(''); };
  const changeSetting = (setter, value) => { settingsTouched.current = true; resetSetup(); setter(value); };

  async function prepare() {
    if (!canRecord) { setError('Recording needs a supported browser on localhost or HTTPS. You can still import an existing video from the library.'); return; }
    if (mode !== 'camera' && !canScreen) { setError('Screen capture is unavailable here. Open Replay in a desktop browser that supports screen sharing, or select Camera only.'); return; }
    settingsTouched.current = true;
    stopTracks();
    setError(''); setNotice(''); setResult(null); setElapsed(0);
    controller.current.cancelled = false;
    phase('preparing');
    const acquired = [];
    try {
      let screen;
      let user;
      if (mode !== 'camera') {
        const preferredHeight = resolution;
        screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: frameRate }, width: { ideal: Math.round(preferredHeight * 16 / 9) }, height: { ideal: preferredHeight } }, audio: systemAudio, systemAudio: systemAudio ? 'include' : 'exclude', selfBrowserSurface: 'exclude', surfaceSwitching: 'include' });
        acquired.push(screen);
        if (controller.current.cancelled || !mounted.current) { screen.getTracks().forEach(track => track.stop()); return; }
      }
      if (mode !== 'screen' || microphone) {
        const constraints = useSaved => ({ video: mode !== 'screen' ? { ...(useSaved && cameraId ? { deviceId: { exact: cameraId } } : {}), width: { ideal: mode === 'camera' ? Math.round(resolution * 16 / 9) : 1920 }, height: { ideal: mode === 'camera' ? resolution : 1080 }, frameRate: { ideal: frameRate } } : false, audio: microphone ? { ...(useSaved && micId ? { deviceId: { exact: micId } } : {}), echoCancellation: true, noiseSuppression: true } : false });
        try { user = await navigator.mediaDevices.getUserMedia(constraints(true)); }
        catch (deviceError) {
          if (!(cameraId || micId) || !['NotFoundError', 'OverconstrainedError'].includes(deviceError.name)) throw deviceError;
          user = await navigator.mediaDevices.getUserMedia(constraints(false));
          setNotice('A saved device is no longer available. The preview is using your default devices. Check the picture and sound before recording.');
        }
        acquired.push(user);
      }
      if (controller.current.cancelled || !mounted.current) { acquired.forEach(stream => stream.getTracks().forEach(track => track.stop())); return; }
      const camera = user?.getVideoTracks().length ? new MediaStream(user.getVideoTracks()) : null;
      const mic = user?.getAudioTracks().length ? new MediaStream(user.getAudioTracks()) : null;
      const system = screen?.getAudioTracks().length ? new MediaStream(screen.getAudioTracks()) : null;
      const source = screen || camera;
      if (!source?.getVideoTracks().some(track => track.readyState === 'live')) throw new Error('Your screen or camera stopped before setup finished. Choose your source again.');
      const current = controller.current;
      current.streams = acquired;
      current.capture = { screen, camera, microphone: mic, system };
      const audioSources = [mic, system].filter(Boolean);
      let mixedAudio = [];
      if (audioSources.length) {
        const Context = window.AudioContext || window.webkitAudioContext;
        current.context = new Context();
        await current.context.resume();
        const destination = current.context.createMediaStreamDestination();
        const analyser = current.context.createAnalyser();
        analyser.fftSize = 256;
        for (const audio of audioSources) {
          const node = current.context.createMediaStreamSource(audio);
          node.connect(destination);
          if (audio === mic || !mic) node.connect(analyser);
        }
        current.analyser = analyser;
        mixedAudio = destination.stream.getAudioTracks();
        acquired.push(destination.stream);
      }
      current.base = new MediaStream([...source.getVideoTracks(), ...mixedAudio]);
      if (systemAudio && screen && !system) setNotice('This source did not provide system audio. Your recording will include the microphone if enabled. To capture app sound, choose a browser tab and enable Share audio when available.');
      for (const track of source.getVideoTracks()) track.onended = () => {
        if (['recording', 'paused'].includes(controller.current.phase)) { setNotice('Your shared source stopped. The captured portion has been preserved.'); finishRecording(); }
        else if (['ready', 'countdown'].includes(controller.current.phase)) { clearInterval(controller.current.countdownTimer); setCountdown(null); resetSetup(); setError('Your shared source ended. Choose it again to record.'); }
      };
      for (const track of [...(mic?.getTracks() || []), ...(system?.getTracks() || []), ...(screen ? camera?.getTracks() || [] : [])]) track.onended = () => {
        if (mounted.current && ['ready', 'countdown', 'recording', 'paused'].includes(controller.current.phase)) setNotice('An audio or camera source disconnected. The main video source is still available. Finish this take or set up the sources again.');
      };
      navigator.mediaDevices.enumerateDevices().then(items => mounted.current && setDevices(items)).catch(() => {});
      if (current.cancelled || !mounted.current) { stopTracks(); return; }
      const usedCamera = camera?.getVideoTracks()[0]?.getSettings().deviceId;
      const usedMic = mic?.getAudioTracks()[0]?.getSettings().deviceId;
      if (usedCamera) setCameraId(usedCamera);
      if (usedMic) setMicId(usedMic);
      try { localStorage.setItem(DEVICE_KEY, JSON.stringify({ ...savedDevices(), ...(usedCamera ? { camera: usedCamera } : {}), ...(usedMic ? { microphone: usedMic } : {}) })); } catch { /* Device preferences are optional. */ }
      setCaptureSpec(source.getVideoTracks()[0].getSettings());
      setStreams({ screen, camera });
      phase('ready');
    } catch (caught) {
      acquired.forEach(stream => stream.getTracks().forEach(track => track.stop()));
      stopTracks();
      if (mounted.current && !controller.current.cancelled) { phase('idle'); setError(permissionMessage(caught)); }
    }
  }

  function beginCountdown() {
    if (status !== 'ready') return;
    setError(''); setCountdown(countdownSeconds); phase('countdown');
    let remaining = countdownSeconds;
    if (!remaining) { setCountdown(null); startRef.current?.(); return; }
    controller.current.countdownTimer = setInterval(() => {
      remaining -= 1;
      if (remaining === 0) { clearInterval(controller.current.countdownTimer); setCountdown(null); startRef.current?.(); }
      else setCountdown(remaining);
    }, 1000);
  }

  async function beginRecording() {
    const current = controller.current;
    if (current.phase !== 'countdown') return;
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const sessionTitle = title.trim() || `Recording ${new Date(createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
    current.session = { id, title: sessionTitle, createdAt, duration: 0, mode };
    current.parts = {}; current.writes = []; current.recorders = []; current.stopping = false;
    try {
      await saveRecordingSession(current.session).catch(() => setRecoveryAvailable(false));
      if (current.cancelled || current.phase !== 'countdown') return;
      const targets = { video: current.base };
      if (current.capture.screen && current.capture.camera) targets.camera = current.capture.camera;
      if (current.capture.microphone) targets.microphone = current.capture.microphone;
      if (current.capture.system) targets.system = current.capture.system;
      for (const [kind, stream] of Object.entries(targets)) {
        const mimeType = recordingMimeType(kind === 'microphone' || kind === 'system');
        const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), ...(['video', 'camera'].includes(kind) ? { videoBitsPerSecond: Math.min(50000000, Math.round(8000000 * ((kind === 'camera' ? 1080 : resolution) / 1080) ** 2 * frameRate / 30)) } : {}) });
        recorder.replayStarted = false;
        recorder.replayStopped = new Promise(resolve => recorder.addEventListener('stop', resolve, { once: true }));
        current.parts[kind] = [];
        recorder.ondataavailable = event => {
          if (!event.data.size) return;
          const index = current.parts[kind].length;
          current.parts[kind].push(event.data);
          const write = saveRecordingChunk({ sessionId: id, kind, index, data: event.data }).catch(() => { if (mounted.current) setRecoveryAvailable(false); });
          current.writes.push(write);
          if (kind === 'video') {
            const captured = current.accumulated + (current.phase === 'recording' ? (performance.now() - current.startedAt) / 1000 : 0);
            current.writes.push(saveRecordingSession({ ...current.session, duration: captured }).catch(() => {}));
          }
        };
        recorder.onerror = event => { if (mounted.current) setError(event.error?.message || 'A recording stream failed. Save the captured portion or retry.'); finishRecording(); };
        current.recorders.push(recorder);
      }
      current.accumulated = 0;
      current.startedAt = performance.now();
      for (const recorder of current.recorders) { recorder.start(1000); recorder.replayStarted = true; }
      setTitle(sessionTitle); setElapsed(0); phase('recording');
    } catch (caught) {
      setError(permissionMessage(caught));
      if (current.recorders.some(recorder => recorder.state !== 'inactive')) await finishRecording();
      else { stopTracks(); phase('idle'); await deleteRecordingSession(id).catch(() => {}); }
    }
  }
  startRef.current = beginRecording;

  function togglePause() {
    const current = controller.current;
    if (current.phase === 'recording') {
      current.accumulated += (performance.now() - current.startedAt) / 1000;
      for (const recorder of current.recorders) if (recorder.state === 'recording') recorder.pause();
      setElapsed(current.accumulated); phase('paused');
    } else if (current.phase === 'paused') {
      current.startedAt = performance.now();
      for (const recorder of current.recorders) if (recorder.state === 'paused') recorder.resume();
      phase('recording');
    }
  }

  async function finishRecording() {
    const current = controller.current;
    if (current.stopping || !current.recorders.length) return;
    current.stopping = true;
    if (current.phase === 'recording') current.accumulated += (performance.now() - current.startedAt) / 1000;
    phase('stopping');
    await Promise.all(current.recorders.map(recorder => {
      if (!recorder.replayStarted) return Promise.resolve();
      if (recorder.state !== 'inactive') recorder.stop();
      return recorder.replayStopped;
    }));
    stopTracks();
    await Promise.all(current.writes);
    const blobs = Object.fromEntries(Object.entries(current.parts).filter(([, parts]) => parts.length).map(([kind, parts]) => [kind, new Blob(parts, { type: parts[0].type })]));
    const session = { ...current.session, duration: current.accumulated };
    await saveRecordingSession(session).catch(() => {});
    current.recorders = [];
    if (!mounted.current) return;
    setElapsed(session.duration);
    if (blobs.video?.size) { setResult({ ...session, blobs }); phase('review'); }
    else { setError('No usable video data was captured. Check the source and record again.'); phase('idle'); await deleteRecordingSession(session.id).catch(() => {}); }
    refreshDrafts();
  }

  async function saveResult() {
    if (!result?.blobs.video) return;
    setError(''); phase('saving');
    const form = new FormData();
    for (const [kind, blob] of Object.entries(result.blobs)) form.append(kind, blob, `${kind}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`);
    form.append('title', title.trim() || result.title || 'Untitled recording');
    try {
      const response = await fetch('/api/assets/import', { method: 'POST', body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'The recording could not be saved.');
      await deleteRecordingSession(result.id).catch(() => {});
      onSaved?.(body);
    } catch (caught) { if (mounted.current) { setError(`${caught.message} Your captured recording is still available here.`); phase('review'); } }
  }

  async function recover(draft) {
    setError(''); stopTracks();
    try {
      const blobs = await recoverRecordingSession(draft.id);
      if (!blobs.video?.size) throw new Error('This draft has no completed video chunks. You can remove it and start again.');
      setResult({ ...draft, blobs }); setTitle(draft.title); setElapsed(draft.duration); phase('review');
      setNotice('Recovered from this browser. If capture was interrupted, the last second may be missing. Preview before saving.');
    } catch (caught) { setError(caught.message); }
  }

  async function discard() {
    const current = controller.current;
    current.cancelled = true;
    clearInterval(current.countdownTimer);
    setCountdown(null);
    if (current.recorders.length) await finishRecording();
    stopTracks();
    const id = result?.id || current.session?.id;
    if (id) await deleteRecordingSession(id).catch(() => {});
    current.session = null; current.parts = {}; current.recorders = []; current.stopping = false;
    setResult(null); setTitle(''); setElapsed(0); setDiscardPrompt(false); setError(''); setNotice(''); phase('idle'); refreshDrafts();
  }

  function requestClose() {
    if (['saving', 'stopping'].includes(status)) return;
    if (active || result) { setDiscardPrompt(true); return; }
    controller.current.cancelled = true; stopTracks(); onClose?.();
  }

  function downloadDraft() {
    if (!result?.blobs.video) return;
    for (const [kind, blob] of Object.entries(result.blobs)) {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `${(title || 'Replay recording').replace(/[^a-zA-Z0-9 _-]/g, '')}-${kind}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`;
      anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    onToast?.('Original capture download started.');
  }

  function handleKeys(event) {
    if (event.key === 'Escape') { event.preventDefault(); requestClose(); }
    if (event.key === 'Tab') {
      const focusable = [...panel.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')].filter(element => element.offsetParent !== null);
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0]?.focus(); }
    }
  }

  const cameraDevices = devices.filter(device => device.kind === 'videoinput');
  const micDevices = devices.filter(device => device.kind === 'audioinput');
  const showCamera = Boolean(streams?.screen && streams?.camera);

  return <div className="recorder-scrim" onMouseDown={event => event.target === event.currentTarget && requestClose()}>
    <section className="recorder-dialog" role="dialog" aria-modal="true" aria-labelledby="recorder-title" ref={panel} tabIndex={-1} onKeyDown={handleKeys}>
      <header className="recorder-heading"><div><span className="recorder-eyebrow">REPLAY RECORDER</span><h2 id="recorder-title">Make something clear.</h2></div><button className="icon-button" aria-label="Close recorder" onClick={requestClose} disabled={status === 'saving' || status === 'stopping'}><X size={21}/></button></header>
      <div className="recorder-scroll"><div className="recorder-body">
        <div className="recorder-stage-column">
          <div className={`recorder-preview ${status === 'recording' ? 'is-recording' : ''}`}>
            {reviewUrl ? <video key={reviewUrl} src={reviewUrl} controls playsInline className="recorder-main-video"/> : streams ? <><video ref={mainPreview} autoPlay muted playsInline className={`recorder-main-video ${mode === 'camera' ? 'camera-only' : ''}`}/>{showCamera && <video ref={cameraPreview} autoPlay muted playsInline className="recorder-camera-bubble"/>}</> : <div className="recorder-empty"><div className="recorder-source-symbol"><Monitor size={37} weight="light"/><span><VideoCamera size={17}/></span></div><h3>Your next great explanation.</h3><p>Choose your sources, check your sound,<br/>and take it from the top.</p><span className="recorder-private"><ShieldCheck size={15}/> Saved on this computer</span></div>}
            {countdown !== null && <div className="recorder-countdown" aria-live="assertive"><strong>{countdown}</strong><span>Get ready</span></div>}
            {['recording', 'paused'].includes(status) && <div className={`recorder-live-badge ${status === 'paused' ? 'paused' : ''}`}><i/>{status === 'paused' ? 'PAUSED' : 'REC'} <b>{durationLabel(elapsed)}</b></div>}
            {status === 'preparing' && <div className="recorder-preparing"><CircleNotch size={27} className="recorder-spinner"/><span>Choose a source in your browser</span></div>}
          </div>
          <div className="recorder-preview-footer"><span><span className={`recorder-status-dot ${streams ? 'ready' : ''}`}/>{status === 'ready' ? 'Preview ready' : status === 'review' ? 'Ready to save' : active ? `${durationLabel(elapsed)} captured` : 'Sources stay off until you enable them'}</span><button className={`button subtle recorder-notes-toggle ${showNotes ? 'selected' : ''}`} onClick={() => setShowNotes(!showNotes)}><NotePencil size={16}/> Notes</button></div>
          {showNotes && <label className="recorder-notes"><span>Speaker notes <small>Only visible here</small></span><textarea value={notes} onChange={event => setNotes(event.target.value)} placeholder="Your opening line, key points, one clear next step…" rows={4}/><small>If you share this window or your entire display, these notes may appear in the recording. Keep Replay on another display or share a specific app.</small></label>}
          {drafts.length > 0 && !result && !locked && <div className="recorder-recovery"><div className="recorder-recovery-title"><ArrowCounterClockwise size={17}/><strong>Unfinished recordings</strong><span>{drafts.length}</span></div>{drafts.slice(0, 3).map(draft => <div className="recorder-draft" key={draft.id}><div><strong>{draft.title || 'Recovered recording'}</strong><small>{new Date(draft.createdAt).toLocaleDateString()} · Stored in this browser</small></div><button className="button subtle" onClick={() => recover(draft)}>Recover</button><button className="icon-button" aria-label={`Remove draft ${draft.title}`} onClick={async () => { await deleteRecordingSession(draft.id).catch(() => {}); refreshDrafts(); }}><Trash size={16}/></button></div>)}</div>}
        </div>
        <aside className="recorder-options">
          <div className="recorder-section-label">CAPTURE MODE</div>
          <div className="recorder-modes">{MODES.map(option => { const Icon = option.icon; return <button key={option.id} className={`recorder-mode ${mode === option.id ? 'selected' : ''}`} onClick={() => changeSetting(setMode, option.id)} disabled={locked} aria-pressed={mode === option.id}><Icon size={18}/><span>{option.label}</span>{mode === option.id && <CheckCircle size={17} weight="fill"/>}</button>; })}</div>
          <div className="recorder-section-label recorder-device-label">YOUR SOURCES</div>
          {mode !== 'screen' && <label className="recorder-field"><span><VideoCamera size={17}/>Camera</span><select value={cameraId} onChange={event => changeSetting(setCameraId, event.target.value)} disabled={locked} aria-label="Camera device"><option value="">Default camera</option>{cameraId && !cameraDevices.some(device => device.deviceId === cameraId) && <option value={cameraId}>Last used camera</option>}{cameraDevices.filter(device => device.deviceId).map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}</select></label>}
          <div className="recorder-field"><label className="recorder-toggle-row"><span><Microphone size={17}/>Microphone</span><input type="checkbox" role="switch" checked={microphone} onChange={event => changeSetting(setMicrophone, event.target.checked)} disabled={locked}/></label>{microphone && <><select value={micId} onChange={event => changeSetting(setMicId, event.target.value)} disabled={locked} aria-label="Microphone device"><option value="">Default microphone</option>{micId && !micDevices.some(device => device.deviceId === micId) && <option value={micId}>Last used microphone</option>}{micDevices.filter(device => device.deviceId).map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}</select><div className="recorder-meter" aria-label={`Audio input level ${Math.round(audioLevel)} percent`}><span style={{ width: `${audioLevel}%` }}/></div><small>{streams ? 'Speak to check your level' : 'Levels appear after setup'}</small></>}</div>
          {mode !== 'camera' && <div className="recorder-field"><label className="recorder-toggle-row"><span><SpeakerHigh size={17}/>System audio</span><input type="checkbox" role="switch" checked={systemAudio} onChange={event => changeSetting(setSystemAudio, event.target.checked)} disabled={locked}/></label><small>Availability depends on your browser and shared source.</small></div>}
          <div className="recorder-quality"><label className="recorder-field"><span>Capture quality</span><select aria-label="Capture quality" value={resolution} onChange={e => changeSetting(setResolution, Number(e.target.value))} disabled={locked}><option value="720">720p</option><option value="1080">1080p</option><option value="2160">4K</option></select></label><label className="recorder-field"><span>Frame rate</span><select aria-label="Capture frame rate" value={frameRate} onChange={e => changeSetting(setFrameRate, Number(e.target.value))} disabled={locked}><option value="30">30 fps</option><option value="60">60 fps</option></select></label></div><p className="capture-spec">{captureSpec ? `${captureSpec.width} × ${captureSpec.height}${captureSpec.frameRate ? ` · ${Math.round(captureSpec.frameRate)} fps` : ''} from your source` : 'Requested quality. Actual capture depends on your source and browser.'}</p><div className="recorder-source-note"><div><CheckCircle size={16}/><span>Independent source tracks</span></div><p>Screen, camera and available audio tracks stay editable after recording.</p></div>
          {['review', 'saving'].includes(status) && <label className="recorder-field recorder-title-field"><span>Recording title</span><input value={title} maxLength={200} onChange={event => setTitle(event.target.value)} placeholder="Give this recording a name" disabled={status === 'saving'}/></label>}
        </aside>
      </div>
      <div className="recorder-messages" aria-live="polite">{error && <div className="recorder-message error" role="alert"><WarningCircle size={18}/><span>{error}</span></div>}{notice && <div className="recorder-message"><WarningCircle size={17}/><span>{notice}</span></div>}{!recoveryAvailable && <div className="recorder-message"><WarningCircle size={17}/><span>Browser recovery storage is unavailable or full. Keep this window open until you save or download your recording.</span></div>}</div>
      {discardPrompt && <div className="recorder-discard"><div><strong>Keep this take?</strong><p>{active ? 'Stop recording to review and save it, or discard this take.' : 'Save this recording or discard it before closing.'}</p></div><button className="button subtle" onClick={() => setDiscardPrompt(false)}>Keep working</button><button className="button recorder-danger" onClick={discard}>Discard take</button></div>}
      </div><footer className="recorder-bottom"><div className="recorder-storage-label"><ShieldCheck size={17}/><span>{recoveryAvailable ? 'Local recovery is on' : 'Recording in this window'}<small>{status === 'review' ? `${Object.keys(result?.blobs || {}).length} source tracks captured` : 'Nothing is published automatically'}</small></span></div><div className="recorder-actions">{status === 'idle' && <button className="button primary" onClick={prepare}><Monitor size={18}/>Set up preview</button>}{status === 'preparing' && <button className="button" disabled><CircleNotch size={18} className="recorder-spinner"/>Waiting for source…</button>}{status === 'ready' && <><button className="button subtle" onClick={prepare}><ArrowCounterClockwise size={17}/>Change source</button><button className="button primary" onClick={beginCountdown}><Record size={19} weight="fill"/>Start recording</button></>}{status === 'countdown' && <button className="button" onClick={() => { clearInterval(controller.current.countdownTimer); setCountdown(null); phase('ready'); }}>Cancel countdown</button>}{['recording', 'paused'].includes(status) && <><button className="button" onClick={togglePause}>{status === 'paused' ? <Play size={18} weight="fill"/> : <Pause size={18} weight="fill"/>}{status === 'paused' ? 'Resume' : 'Pause'}</button><button className="button primary" onClick={finishRecording}><Stop size={18} weight="fill"/>Finish recording</button></>}{status === 'stopping' && <button className="button" disabled><CircleNotch size={18} className="recorder-spinner"/>Preserving your take…</button>}{['review', 'saving'].includes(status) && <><button className="icon-button" aria-label="Download original recording tracks" onClick={downloadDraft} disabled={status === 'saving'} title="Download original tracks"><DownloadSimple size={20}/></button><button className="button subtle" disabled={status === 'saving'} onClick={() => setDiscardPrompt(true)}><ArrowCounterClockwise size={17}/>Retake</button><button className="button primary" onClick={saveResult} disabled={status === 'saving'}>{status === 'saving' ? <CircleNotch size={18} className="recorder-spinner"/> : <FloppyDisk size={18}/>} {status === 'saving' ? 'Saving recording…' : 'Save & review'}</button></>}</div></footer>
    </section>
  </div>;
}
