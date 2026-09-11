const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const finite = (n, fallback) => Number.isFinite(Number(n)) ? Number(n) : fallback;
export const MAX_ZOOMS = 40;

// Times belong to the original recording, so cuts and undo never rewrite motion.
export function normalizeZooms(input, duration) {
  if (!Array.isArray(input)) return [];
  let boundary = 0;
  return input.filter(r => r && typeof r === 'object').slice(0, MAX_ZOOMS)
    .map((r, i) => ({ id: typeof r.id === 'string' ? r.id.slice(0, 80) : `zoom-${i}`, start: clamp(finite(r.start, 0), 0, duration), end: clamp(finite(r.end, 0), 0, duration), zoom: clamp(finite(r.zoom, 1.75), 1, 3), x: clamp(finite(r.x, .5), 0, 1), y: clamp(finite(r.y, .5), 0, 1), ease: clamp(finite(r.ease, .6), .1, 2), cameraScale: clamp(finite(r.cameraScale, 1), .65, 1) }))
    .sort((a, b) => a.start - b.start)
    .flatMap(r => { const start = Math.max(boundary, r.start); if (r.end - start < .2 - 1e-9) return []; boundary = r.end; return [{ ...r, start }]; });
}

export function motionAt(zooms = [], time = 0) {
  const region = zooms.find(r => time >= r.start && time < r.end);
  if (!region) return { zoom: 1, x: .5, y: .5, cameraScale: 1, amount: 0 };
  const ramp = Math.min(region.ease, (region.end - region.start) / 2);
  const u = clamp(Math.min((time - region.start) / ramp, (region.end - time) / ramp), 0, 1);
  const amount = u * u * (3 - 2 * u);
  return { zoom: 1 + (region.zoom - 1) * amount, x: region.x, y: region.y, cameraScale: 1 + (region.cameraScale - 1) * amount, amount };
}

export function sourceCrop(motion) {
  const width = 1 / motion.zoom;
  return { x: clamp(motion.x - width / 2, 0, 1 - width), y: clamp(motion.y - width / 2, 0, 1 - width), width, height: width };
}

export function sourceMotionStyle(motion) {
  const crop = sourceCrop(motion);
  return { position: 'absolute', width: '100%', height: '100%', transformOrigin: '0 0', transform: `translate(${-crop.x * motion.zoom * 100}%, ${-crop.y * motion.zoom * 100}%) scale(${motion.zoom})` };
}

export const cameraCanAnimate = frame => frame.x >= 0 && frame.y >= 0 && frame.x + frame.width <= 1.000001 && frame.y + frame.height <= 1.000001;
export function cameraMotionFrame(frame, motion) {
  const scale = cameraCanAnimate(frame) ? motion.cameraScale : 1;
  return { x: frame.x + frame.width * (1 - scale) / 2, y: frame.y + frame.height * (1 - scale) / 2, width: frame.width * scale, height: frame.height * scale };
}

export function motionPrivacyFrame(overlay, layout, motion) {
  const crop = sourceCrop(motion), { source, screen } = layout;
  const clipLeft = Math.max(0, source.x, screen.x), clipTop = Math.max(0, source.y, screen.y);
  const clipRight = Math.min(1, source.x + source.width, screen.x + screen.width), clipBottom = Math.min(1, source.y + source.height, screen.y + screen.height);
  const left = source.x + (overlay.x - crop.x) * motion.zoom * source.width;
  const top = source.y + (overlay.y - crop.y) * motion.zoom * source.height;
  const x = Math.max(clipLeft, left), y = Math.max(clipTop, top);
  return { x, y, width: Math.max(0, Math.min(clipRight, left + overlay.width * motion.zoom * source.width) - x), height: Math.max(0, Math.min(clipBottom, top + overlay.height * motion.zoom * source.height) - y) };
}

// FFmpeg expressions use the same smoothstep envelope and normalized crop as preview.
// Only finite, normalized values enter expressions; never interpolate user text.
export function motionExpressions(input, duration, clock = 'in_time') {
  const zooms = normalizeZooms(input, duration), terms = key => zooms.map(r => {
    const ramp = Math.min(r.ease, (r.end - r.start) / 2);
    const u = `clip(min((${clock}-${r.start})/${ramp},(${r.end}-${clock})/${ramp}),0,1)`;
    return `(${r[key] - 1})*(${u})*(${u})*(3-2*(${u}))`;
  });
  const z = `1${terms('zoom').map(s => `+(${s})`).join('')}`;
  const camera = `1${terms('cameraScale').map(s => `+(${s})`).join('')}`;
  const focus = key => zooms.reduceRight((next, r) => `if(gte(${clock},${r.start})*lt(${clock},${r.end}),${r[key]},${next})`, '.5');
  return { zoom: z, camera, x: `clip(${focus('x')}-1/(2*(${z})),0,1-1/(${z}))`, y: `clip(${focus('y')}-1/(2*(${z})),0,1-1/(${z}))` };
}
