export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: options.body instanceof FormData ? options.headers : { 'Content-Type': 'application/json', ...options.headers },
    body: options.body && !(options.body instanceof FormData) && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

export function time(value = 0, precise = false) {
  const safe = Math.max(0, Number(value) || 0);
  const m = Math.floor(safe / 60), s = Math.floor(safe % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${precise ? `.${Math.floor((safe % 1) * 10)}` : ''}`;
}

export function bytes(value = 0) {
  const amount = Math.max(0, Number(value) || 0);
  if (amount >= 1024 ** 3) return `${(amount / 1024 ** 3).toFixed(1)} GB`;
  if (amount >= 1024 ** 2) return `${(amount / 1024 ** 2).toFixed(1)} MB`;
  if (amount >= 1024) return `${(amount / 1024).toFixed(1)} KB`;
  return `${Math.round(amount)} B`;
}

export function defaultEdits(duration = 0) {
  return { trimStart: 0, trimEnd: duration, cuts: [], aspect: 'original', screen: { frame: null, fit: 'contain' }, camera: { visible: true, size: .19, position: 'bottom-left', frame: null, shape: 'circle', fit: 'cover' }, captions: false, volume: 1, speed: 1, overlays: [], normalizeAudio: false };
}

export function keptRanges(asset) {
  const edits = { ...defaultEdits(asset?.duration), ...asset?.edits };
  const duration = Math.max(0, Number(asset?.duration) || 0);
  const start = Math.max(0, Math.min(duration, Number(edits.trimStart) || 0));
  const end = Math.max(start, Math.min(duration, Number.isFinite(Number(edits.trimEnd)) ? Number(edits.trimEnd) : duration));
  const cuts = (edits.cuts || []).map(c => ({ start: Math.max(start, Number(c.start)), end: Math.min(end, Number(c.end)) })).filter(c => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start).sort((a, b) => a.start - b.start);
  const result = []; let pos = start;
  cuts.forEach(c => { if (c.start > pos + .001) result.push({ start: pos, end: c.start }); pos = Math.max(pos, c.end); });
  if (end > pos + .001) result.push({ start: pos, end });
  return result;
}

export function editedDuration(asset) {
  return keptRanges(asset).reduce((total, r) => total + r.end - r.start, 0) / playbackSpeed(asset);
}

export function playbackSpeed(asset) { return Math.max(.25, Math.min(4, Number(asset?.edits?.speed) || 1)); }

export function sourceToEditedTime(asset, value) {
  let offset = 0;
  for (const range of keptRanges(asset)) {
    if (value < range.start) return offset / playbackSpeed(asset);
    if (value <= range.end) return (offset + value - range.start) / playbackSpeed(asset);
    offset += range.end - range.start;
  }
  return offset / playbackSpeed(asset);
}

export function editedToSourceTime(asset, value) {
  const ranges = keptRanges(asset);
  let remaining = Math.max(0, Number(value) || 0) * playbackSpeed(asset);
  for (const range of ranges) {
    if (remaining < range.end - range.start) return range.start + remaining;
    remaining -= range.end - range.start;
  }
  return ranges.at(-1)?.end ?? 0;
}

export function nextPlayableTime(asset, value) {
  for (const range of keptRanges(asset)) {
    if (value < range.start) return range.start;
    if (value < range.end) return value;
  }
  return null;
}

export function restoreSourceRange(asset, start, end) {
  const duration = Math.max(0, Number(asset?.duration) || 0);
  const from = Math.max(0, Math.min(duration, start)), to = Math.max(from, Math.min(duration, end));
  const retained = [...keptRanges(asset), { start: from, end: to }].filter(range => range.end > range.start).sort((a, b) => a.start - b.start);
  if (!retained.length) return asset.edits;
  const merged = [];
  for (const range of retained) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return { trimStart: merged[0].start, trimEnd: merged.at(-1).end, cuts: merged.slice(1).map((range, index) => ({ id: uid(), start: merged[index].end, end: range.start })) };
}

export function relativeDate(value) {
  const date = new Date(value); if (Number.isNaN(date.valueOf())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function uid() { return crypto.randomUUID(); }

export function subtitleCues(text) {
  const clean = String(text).replace(/^\uFEFF/, '').replace(/\r/g, '');
  const parse = s => {
    if (!/^(?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3}$/.test(s.trim())) return NaN;
    const p = s.trim().replace(',', '.').split(':').map(Number);
    if (p.at(-1) >= 60 || (p.length === 3 && p[1] >= 60)) return NaN;
    return p.reduce((a, b) => a * 60 + b, 0);
  };
  return clean.split(/\n\s*\n/).flatMap(block => {
    if (/^(?:NOTE|STYLE|REGION)(?:\s|$)/.test(block.trim())) return [];
    const lines = block.trim().split('\n'); const index = lines.findIndex(l => l.includes('-->'));
    if (index < 0) return [];
    const [from, to] = lines[index].split('-->'); const start = parse(from), end = parse(to.trim().split(/\s/)[0]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    const content = lines.slice(index + 1).join(' ').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim();
    return content ? [{ id: uid(), start, end, text: content }] : [];
  }).sort((a, b) => a.start - b.start);
}
