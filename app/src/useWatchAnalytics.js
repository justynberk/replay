import { useEffect } from 'react';
import { editedDuration, sourceToEditedTime, playbackSpeed } from './lib.js';
import { createWatchMeter } from './watch-metrics.js';

function viewerId() {
  try {
    let id = localStorage.getItem('replay.analytics.viewer');
    if (!/^[a-f0-9-]{36}$/.test(id || '')) { id = crypto.randomUUID(); localStorage.setItem('replay.analytics.viewer', id); }
    return id;
  } catch { return crypto.randomUUID(); }
}

export function useWatchAnalytics(video, asset, enabled, onStatus, endpoint = '/api/analytics/sessions') {
  useEffect(() => {
    const el = video.current;
    if (!enabled || !el) return;
    const duration = editedDuration(asset), meter = createWatchMeter(duration);
    const identity = { sessionId: crypto.randomUUID(), viewerId: viewerId(), assetId: asset.id, duration };
    let sent = 0, inFlight = false, disposed = false;
    const sample = (finishing = false) => meter.sample({ position: sourceToEditedTime(asset, el.currentTime), rate: el.playbackRate / playbackSpeed(asset), now: performance.now(), active: (finishing || !el.paused) && !el.seeking && el.readyState >= 3 && document.visibilityState === 'visible' });
    async function flush(leaving = false) {
      const value = meter.snapshot();
      if (value.watchedSeconds < .25 || value.watchedSeconds <= sent || (inFlight && !leaving)) return;
      const body = JSON.stringify({ ...identity, ...value });
      if (leaving && navigator.sendBeacon?.(endpoint, new Blob([body], { type: 'application/json' }))) return;
      inFlight = true;
      try {
        const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
        if (!response.ok) throw new Error('Analytics could not be saved');
        sent = Math.max(sent, value.watchedSeconds);
        if (!disposed) onStatus?.('saved');
      } catch { if (!disposed) onStatus?.('error'); }
      finally { inFlight = false; }
    }
    const reset = () => meter.reset();
    const start = () => { reset(); sample(); };
    const stop = () => { sample(true); reset(); flush(); };
    const visibility = () => { reset(); if (document.visibilityState !== 'visible') flush(true); };
    const leave = () => { sample(); reset(); flush(true); };
    el.addEventListener('seeking', reset); el.addEventListener('seeked', start);
    el.addEventListener('ratechange', start);
    el.addEventListener('playing', start); el.addEventListener('waiting', stop);
    el.addEventListener('pause', stop); el.addEventListener('ended', stop);
    document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', leave);
    const sampling = setInterval(() => { sample(); if (!sent) flush(); }, 250);
    const reporting = setInterval(() => flush(), 5000);
    return () => {
      disposed = true; leave(); clearInterval(sampling); clearInterval(reporting);
      el.removeEventListener('seeking', reset); el.removeEventListener('seeked', start);
      el.removeEventListener('ratechange', start);
      el.removeEventListener('playing', start); el.removeEventListener('waiting', stop);
      el.removeEventListener('pause', stop); el.removeEventListener('ended', stop);
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', leave);
    };
  }, [asset.id, enabled, endpoint]);
}
