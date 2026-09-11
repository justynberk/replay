import { keptRanges, sourceToEditedTime, playbackSpeed } from './lib.js';

export function previewCaptionAt(asset, sourceTime) {
  // Media seeks can round down by a fraction of a microsecond at a cue boundary.
  const position = sourceTime + .000001;
  return (asset.transcript || []).filter(cue => position >= cue.start && position < cue.end).map(cue => cue.text).join(' ');
}

// Display edited time, but seek the original tracks at the first retained frame.
export function reviewTranscript(asset) {
  const ranges = keptRanges(asset);
  return (asset.transcript || []).flatMap(cue => {
    const parts = ranges.filter(r => r.start < cue.end && r.end > cue.start);
    if (!parts.length) return [];
    const sourceStart = Math.max(cue.start, parts[0].start);
    return [{ ...cue, sourceStart, start: sourceToEditedTime(asset, sourceStart), end: sourceToEditedTime(asset, Math.min(cue.end, parts.at(-1).end)) }];
  });
}

export function reviewChapters(asset) {
  const ranges = keptRanges(asset), chapters = [...(asset.chapters || [])].sort((a, b) => a.start - b.start);
  return chapters.flatMap((chapter, index) => {
    const end = chapters[index + 1]?.start ?? asset.duration;
    const first = ranges.find(r => r.start < end && r.end > chapter.start);
    if (!first || !chapter.title.trim()) return [];
    const sourceStart = Math.max(chapter.start, first.start);
    return [{ ...chapter, sourceStart, start: sourceToEditedTime(asset, sourceStart) }];
  });
}

export function safeResourceUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return '';
  try {
    const url = new URL(value.trim());
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

export function previewPlaybackRate(asset, viewerSpeed = 1) {
  const rate = [.5, .75, 1, 1.25, 1.5, 2].includes(viewerSpeed) ? viewerSpeed : 1;
  return playbackSpeed(asset) * rate;
}
