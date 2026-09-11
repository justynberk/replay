export const DELIVERY_PRESETS = [
  { id: 'default', name: 'Video', detail: 'MP4 · your current layout', icon: 'video' },
  { id: 'social', name: 'Vertical clip', detail: '9:16 MP4 · captions if available', icon: 'vertical' },
  { id: 'audio', name: 'Audio', detail: 'MP3 · your finished edit', icon: 'audio' },
  { id: 'archive', name: 'Complete package', detail: 'Video, project, captions + originals', icon: 'package' },
];

export function deliveryPreset(id, asset) {
  const base = { preset: asset.edits?.aspect || 'original', resolution: 1080, quality: 'high', burnCaptions: Boolean(asset.transcript?.length && asset.edits?.captions), includeSources: false };
  if (id === 'social') return { ...base, formats: ['mp4'], preset: 'portrait', burnCaptions: Boolean(asset.transcript?.length) };
  if (id === 'audio') return { ...base, formats: ['mp3'], quality: 'balanced', burnCaptions: false };
  if (id === 'archive') return { ...base, formats: ['mp4', 'json', 'md', ...(asset.transcript?.length ? ['srt', 'vtt', 'txt'] : []), 'zip'], includeSources: true };
  return { ...base, formats: ['mp4'] };
}
