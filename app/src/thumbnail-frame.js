// Cache small stills, never playing media or sending watch events.
const frames = new Map();

export function thumbnailFrame(url, position) {
  const key = `${url}:${position}`;
  if (frames.has(key)) return frames.get(key);
  const result = new Promise(resolve => {
    const video = document.createElement('video');
    let finished = false;
    const finish = value => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      video.onloadeddata = video.onseeked = video.onerror = null;
      video.removeAttribute('src');
      video.load();
      resolve(value);
    };
    const capture = () => {
      try {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL('image/jpeg', .85));
      } catch { finish(null); }
    };
    const timer = setTimeout(() => finish(null), 12000);
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.onerror = () => finish(null);
    video.onseeked = capture;
    video.onloadeddata = () => {
      const target = Math.min(position, Math.max(0, video.duration - .05));
      if (Math.abs(video.currentTime - target) < .001) capture();
      else video.currentTime = target;
    };
    video.src = url;
  });
  frames.set(key, result);
  if (frames.size > 48) frames.delete(frames.keys().next().value);
  result.then(value => { if (!value) frames.delete(key); });
  return result;
}
