export const FULL_FRAME = { x: 0, y: 0, width: 1, height: 1 };
export const MAX_LAYER_SIZE = 5;
export const MIN_LAYER_SIZE = .04;
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
export const frameAspect = (asset, preset = asset.edits?.aspect) => ({ landscape: 16 / 9, portrait: 9 / 16, square: 1, '4:5': 4 / 5 }[preset] || asset.width / (asset.height || 1) || 16 / 9);

// All layer coordinates are fractions of the output canvas, shared by preview and export.
export function normalizeFrame(frame = FULL_FRAME, squareAspect = null) {
  let width = clamp(finite(frame.width, 1), MIN_LAYER_SIZE, MAX_LAYER_SIZE);
  let height = clamp(finite(frame.height, 1), MIN_LAYER_SIZE, MAX_LAYER_SIZE);
  if (squareAspect) { width = Math.min(width, MAX_LAYER_SIZE / squareAspect); height = width * squareAspect; }
  // Keep a small part reachable while allowing the layer to extend past every edge.
  return { x: clamp(finite(frame.x, 0), MIN_LAYER_SIZE - width, 1 - MIN_LAYER_SIZE), y: clamp(finite(frame.y, 0), MIN_LAYER_SIZE - height, 1 - MIN_LAYER_SIZE), width, height };
}

export function scaleFrame(frame, width, squareAspect = null) {
  const maxWidth = Math.min(MAX_LAYER_SIZE, frame.width * MAX_LAYER_SIZE / frame.height);
  const nextWidth = clamp(width, MIN_LAYER_SIZE, maxWidth), height = frame.height * nextWidth / frame.width;
  return normalizeFrame({ x: frame.x + (frame.width - nextWidth) / 2, y: frame.y + (frame.height - height) / 2, width: nextWidth, height }, squareAspect);
}

export function fitFrame(frame, sourceAspect, canvasAspect, fit = 'contain') {
  const regionAspect = frame.width * canvasAspect / frame.height;
  const width = frame.width * (fit === 'cover' ? Math.max(1, sourceAspect / regionAspect) : Math.min(1, sourceAspect / regionAspect));
  const height = frame.height * (fit === 'cover' ? Math.max(1, regionAspect / sourceAspect) : Math.min(1, regionAspect / sourceAspect));
  return { x: frame.x + (frame.width - width) / 2, y: frame.y + (frame.height - height) / 2, width, height };
}

export function composition(asset, aspect = frameAspect(asset)) {
  const camera = asset.edits?.camera || {};
  const screen = normalizeFrame(asset.edits?.screen?.frame || FULL_FRAME);
  const source = fitFrame(screen, asset.width / asset.height || 16 / 9, aspect, asset.edits?.screen?.fit);
  const shape = ['circle', 'square', 'rounded', 'rectangle'].includes(camera.shape) ? camera.shape : 'circle';
  let frame = camera.frame;
  if (!frame) {
    // Preserve the placement of existing projects until their camera is moved.
    const width = source.width * (camera.size || .19), height = width * aspect;
    const margin = source.width * .02, position = camera.position || 'bottom-left';
    frame = { width, height, x: position.endsWith('right') ? source.x + source.width - width - margin : source.x + margin, y: position.startsWith('top') ? source.y + margin * aspect : source.y + source.height - height - margin * aspect };
  }
  return { screen, source, camera: normalizeFrame(frame, ['circle', 'square'].includes(shape) ? aspect : null), shape };
}

export function layoutPreset(name, asset) {
  const aspect = frameAspect(asset), camera = { ...asset.edits.camera, visible: true, shape: 'rectangle', fit: 'cover' };
  let screen = FULL_FRAME, frame;
  if (name === 'camera-bottom') { screen = { x: 0, y: 0, width: 1, height: .58 }; frame = { x: 0, y: .58, width: 1, height: .42 }; }
  else if (name === 'camera-top') { screen = { x: 0, y: .42, width: 1, height: .58 }; frame = { x: 0, y: 0, width: 1, height: .42 }; }
  else if (name === 'side-by-side') { screen = { x: 0, y: 0, width: .6, height: 1 }; frame = { x: .6, y: 0, width: .4, height: 1 }; }
  else { const width = Math.min(.25, .3 / aspect); frame = { x: .03, y: 1 - width * aspect - .03, width, height: width * aspect }; camera.shape = 'circle'; }
  return { screen: { frame: { ...screen }, fit: 'contain' }, camera: { ...camera, frame } };
}

export function alignFrame(frame, horizontal, vertical) {
  return { ...frame, x: (1 - frame.width) * horizontal, y: (1 - frame.height) * vertical };
}

export function privacyFrame(overlay, layout) {
  const { source, screen } = layout;
  const x = Math.max(0, screen.x, source.x + overlay.x * source.width);
  const y = Math.max(0, screen.y, source.y + overlay.y * source.height);
  const right = Math.min(1, screen.x + screen.width, source.x + Math.min(1, overlay.x + overlay.width) * source.width);
  const bottom = Math.min(1, screen.y + screen.height, source.y + Math.min(1, overlay.y + overlay.height) * source.height);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

export function transformFrame(frame, dx, dy, handle = 'move', squareAspect = null) {
  if (handle === 'move') return normalizeFrame({ ...frame, x: frame.x + dx, y: frame.y + dy }, squareAspect);
  const left = handle.includes('w'), top = handle.includes('n');
  let width = clamp(frame.width + (left ? -dx : dx), MIN_LAYER_SIZE, MAX_LAYER_SIZE);
  let height = clamp(frame.height + (top ? -dy : dy), MIN_LAYER_SIZE, MAX_LAYER_SIZE);
  if (squareAspect) {
    const verticalWidth = height / squareAspect;
    width = Math.abs(dy / squareAspect) > Math.abs(dx) ? verticalWidth : width;
    width = clamp(width, MIN_LAYER_SIZE, Math.min(MAX_LAYER_SIZE, MAX_LAYER_SIZE / squareAspect));
    height = width * squareAspect;
  }
  return normalizeFrame({ x: left ? frame.x + frame.width - width : frame.x, y: top ? frame.y + frame.height - height : frame.y, width, height }, squareAspect);
}
