import fs from 'node:fs';
import path from 'node:path';
import { validId, httpError } from './store.mjs';
import { editedDuration } from '../src/lib.js';
import { mergeCoverage, coverageOf } from '../src/watch-metrics.js';

const round = n => Math.round(n * 1000) / 1000;
export function analyticsCsv(report, query = '', sort = 'views') {
  const key = ['views', 'watchSeconds', 'completionRate'].includes(sort) ? sort : 'views';
  const content = report.content.filter(row => row.title.toLowerCase().includes(String(query).toLowerCase())).sort((a, b) => b[key] - a[key] || a.title.localeCompare(b.title));
  const rows = [['Recording', 'Views', 'Unique browsers', 'Watch seconds', 'Average watch seconds', 'Average watched percent', 'Completions', 'Completion percent', 'Last viewed', 'From', 'To', 'Time zone', 'Scope'], ...content.map(r => [r.title, r.views, r.uniqueViewers, r.watchSeconds, r.averageWatchSeconds, (r.averageCoverage * 100).toFixed(1), r.completions, (r.completionRate * 100).toFixed(1), r.lastViewedAt || '', report.from, report.to, report.timeZone, 'Local watch pages'])];
  return '\ufeff' + rows.map(row => row.map(value => {
    const text = String(value ?? '');
    return `"${(/^[\s]*[=+\-@]|^[\t\r\n]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`;
  }).join(',')).join('\r\n');
}
function dayKey(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type).value).join('-');
}
function totals(sessions) {
  const views = sessions.length, watchSeconds = sessions.reduce((n, s) => n + s.watchedSeconds, 0);
  const completions = sessions.filter(s => coverageOf(s.ranges) >= .9).length;
  return { views, uniqueViewers: new Set(sessions.map(s => s.viewerId)).size, watchSeconds: round(watchSeconds), averageWatchSeconds: views ? round(watchSeconds / views) : 0, averageCoverage: views ? sessions.reduce((n, s) => n + coverageOf(s.ranges), 0) / views : 0, completions, completionRate: views ? completions / views : 0 };
}

export function createAnalytics(store, clock = () => Date.now()) {
  const file = path.join(store.directory, 'analytics.json');
  let state = { schema: 1, sessions: [] };
  if (fs.existsSync(file)) {
    try { state = JSON.parse(fs.readFileSync(file, 'utf8')); if (state.schema !== 1 || !Array.isArray(state.sessions)) throw new Error(); }
    catch { throw new Error('The analytics file could not be read. Preserve analytics.json and restore a backup.'); }
  }
  function save(sessions) {
    const next = { ...state, sessions };
    fs.writeFileSync(file + '.tmp', JSON.stringify(next)); fs.renameSync(file + '.tmp', file); state = next;
  }
  function record(body, sharedSnapshot) {
    if (!body || !validId(body.sessionId) || !validId(body.viewerId) || !validId(body.assetId)) throw httpError('Valid session, browser and recording IDs are required');
    const asset = sharedSnapshot || store.find(body.assetId);
    if (!Number.isFinite(body.watchedSeconds) || body.watchedSeconds < .25 || body.watchedSeconds > 43200) throw httpError('Invalid watch time');
    if (!Number.isFinite(body.duration) || body.duration <= 0 || body.duration > 172800) throw httpError('Invalid video duration');
    if (!Array.isArray(body.ranges) || body.ranges.length > 1000 || body.ranges.some(r => !Array.isArray(r) || r.length !== 2 || !r.every(Number.isFinite) || r[0] < 0 || r[1] > 1 || r[1] <= r[0])) throw httpError('Invalid watched ranges');
    const existing = state.sessions.find(s => s.id === body.sessionId), now = clock();
    if (existing && (existing.assetId !== body.assetId || existing.viewerId !== body.viewerId || Math.abs(existing.duration - body.duration) > .01)) throw httpError('This viewing session belongs to a different recording or browser', 409);
    if (!existing && Math.abs(editedDuration(asset) - body.duration) > .1) throw httpError('This recording has changed. Reload the watch page.', 409);
    // Cumulative snapshots make retries, beacons and out-of-order delivery idempotent.
    const start = existing ? Date.parse(existing.startedAt) : now - Math.min(body.watchedSeconds, 10) * 1000;
    const watchedSeconds = Math.max(existing?.watchedSeconds || 0, Math.min(body.watchedSeconds, (now - start) / 1000 + 1));
    const ranges = mergeCoverage([...(existing?.ranges || []), ...body.ranges]);
    // A full timeline cannot be watched by jumping straight to the last frame.
    if (coverageOf(ranges) * body.duration > watchedSeconds + 2) throw httpError('Watched coverage exceeds playback time');
    const session = { id: body.sessionId, assetId: body.assetId, viewerId: body.viewerId, duration: body.duration, startedAt: new Date(start).toISOString(), updatedAt: new Date(now).toISOString(), watchedSeconds, ranges };
    save(existing ? state.sessions.map(s => s.id === session.id ? session : s) : [...state.sessions, session]);
    return { ok: true };
  }
  function report({ days: input = '30', timeZone = 'UTC' } = {}) {
    const days = Number(input);
    if (![7, 30, 90].includes(days)) throw httpError('Choose 7, 30 or 90 days');
    try { dayKey(new Date(), timeZone); } catch { throw httpError('Invalid time zone'); }
    const today = dayKey(new Date(clock()), timeZone), end = new Date(today + 'T12:00:00Z');
    const daily = Array.from({ length: days }, (_, i) => { const date = new Date(end); date.setUTCDate(date.getUTCDate() - days + 1 + i); return { date: date.toISOString().slice(0, 10), views: 0, watchSeconds: 0 }; });
    const sessions = state.sessions.filter(s => { const day = dayKey(new Date(s.startedAt), timeZone); return day >= daily[0].date && day <= today; });
    for (const session of sessions) { const bucket = daily.find(d => d.date === dayKey(new Date(session.startedAt), timeZone)); bucket.views++; bucket.watchSeconds += session.watchedSeconds; }
    const content = store.state.assets.map(asset => {
      const viewed = sessions.filter(s => s.assetId === asset.id);
      const retention = Array.from({ length: 20 }, (_, i) => {
        const start = i / 20, end = (i + 1) / 20;
        const coverage = viewed.reduce((sum, s) => sum + s.ranges.reduce((n, [a, b]) => n + Math.max(0, Math.min(end, b) - Math.max(start, a)), 0) / (end - start), 0);
        return { start, end, value: viewed.length ? Math.min(1, coverage / viewed.length) : 0 };
      });
      return { assetId: asset.id, title: asset.title, thumbnailUrl: store.publicAsset(asset).thumbnailUrl, duration: editedDuration(asset), archived: !!asset.archived, sample: !!asset.sample, ...totals(viewed), lastViewedAt: viewed.length ? viewed.map(s => s.updatedAt).sort().at(-1) : null, retention, recent: [...viewed].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 10).map(s => ({ id: s.id, startedAt: s.startedAt, watchSeconds: round(s.watchedSeconds), coverage: coverageOf(s.ranges), completed: coverageOf(s.ranges) >= .9 })) };
    });
    return { scope: 'local', days, timeZone, from: daily[0].date, to: today, generatedAt: new Date(clock()).toISOString(), totals: totals(sessions), daily, content };
  }
  return { record, report };
}
