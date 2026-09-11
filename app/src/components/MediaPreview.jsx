import { useEffect, useRef } from 'react';

function wrapText(context, text, width) {
  const lines = []; let line = '';
  for (const word of String(text).replace(/\s+/g, ' ').trim().split(' ')) {
    if (context.measureText(word).width > width) {
      if (line) { lines.push(line); line = ''; }
      let fragment = '';
      for (const letter of word) { if (context.measureText(fragment + letter).width > width && fragment) { lines.push(fragment); fragment = letter; } else fragment += letter; }
      line = fragment; continue;
    }
    if (line && context.measureText(`${line} ${word}`).width > width) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

export function OverlayPreview({ overlay: o, width, height }) {
  const ref = useRef();
  useEffect(() => {
    const canvas = ref.current, w = Math.max(2, Math.round(o.width * width)), h = Math.max(2, Math.round(o.height * height));
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = o.color; ctx.strokeStyle = o.color;
    if (o.type === 'redact') { ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, w, h); }
    else if (o.type === 'box') { ctx.fillRect(0, 0, w, Math.min(4, h)); ctx.fillRect(0, Math.max(0, h - 4), w, 4); ctx.fillRect(0, 0, Math.min(4, w), h); ctx.fillRect(Math.max(0, w - 4), 0, 4, h); }
    else if (o.type === 'arrow') {
      const center = h / 2, head = Math.min(w * .35, h * .48);
      ctx.lineWidth = Math.max(3, h * .1); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(4, center); ctx.lineTo(w - 5, center); ctx.moveTo(w - 5 - head, center - head); ctx.lineTo(w - 5, center); ctx.lineTo(w - 5 - head, center + head); ctx.stroke();
    } else {
      let font = Math.max(12, Math.min(160, h * .7)), lines = [];
      do { ctx.font = `600 ${font}px Arial, sans-serif`; lines = wrapText(ctx, o.text, w - 4); if (lines.length * font * 1.18 <= h) break; font -= 1; } while (font > 10);
      ctx.textBaseline = 'top'; ctx.textAlign = 'center'; const top = Math.max(0, (h - lines.length * font * 1.18) / 2);
      lines.forEach((line, index) => ctx.fillText(line, w / 2, top + index * font * 1.18));
    }
  }, [o, width, height]);
  return <canvas ref={ref} className={`video-overlay overlay-${o.type}`} aria-label={o.type === 'text' ? o.text : `${o.type} overlay`} style={{ position: 'absolute', left: `${o.x * 100}%`, top: `${o.y * 100}%`, width: `${o.width * 100}%`, height: `${o.height * 100}%`, padding: 0, border: 0, background: 'transparent', pointerEvents: 'none' }} />;
}

export function CaptionPreview({ text, aspect }) {
  const ref = useRef();
  const frameHeight = aspect < 1 ? 1080 / aspect : 1080;
  const frameWidth = frameHeight * aspect;
  const width = Math.max(2, Math.round(frameWidth * .9 / 2) * 2), font = Math.max(14, Math.round(frameHeight * .037)), height = Math.round(font * 4.6 / 2) * 2;
  useEffect(() => {
    const canvas = ref.current; canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'); let fontSize = font, wrapped = [];
    do { ctx.font = `600 ${fontSize}px Arial, sans-serif`; wrapped = wrapText(ctx, text, width - 32); if (wrapped.length <= 3) break; fontSize--; } while (fontSize > 10);
    const contentHeight = Math.min(height - 8, wrapped.length * fontSize * 1.23 + 16), y = height - contentHeight;
    ctx.fillStyle = 'rgba(12,13,15,0.9)'; ctx.beginPath(); ctx.roundRect(0, y, width, contentHeight, Math.min(10, fontSize * .4)); ctx.fill(); ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    wrapped.forEach((line, index) => ctx.fillText(line, width / 2, y + 8 + index * fontSize * 1.23));
  }, [text, width, height, font]);
  return <canvas ref={ref} className="video-caption" aria-label={text} style={{ position: 'absolute', zIndex: 4, left: '5%', right: 'auto', bottom: '2.5%', width: '90%', height: `${height / frameHeight * 100}%`, transform: 'none', padding: 0, border: 0, background: 'transparent', pointerEvents: 'none' }} />;
}
