import { motionExpressions, cameraCanAnimate } from '../src/motion.js';

export function screenMotionFilter(asset, width, height, fps) {
  const m = motionExpressions(asset.edits.zooms, asset.duration);
  return `fps=${fps},zoompan=z='${m.zoom}':x='iw*(${m.x})':y='ih*(${m.y})':d=1:s=${width}x${height}:fps=${fps}`;
}

export function cameraMotionFilter(asset, frame, width, height, fps) {
  if (!cameraCanAnimate(frame) || !asset.edits.zooms.some(r => r.cameraScale < 1)) return null;
  const m = motionExpressions(asset.edits.zooms, asset.duration, 't');
  return `fps=${fps},format=rgba,scale=w='max(2,trunc(iw*(${m.camera})/2)*2)':h='max(2,trunc(ih*(${m.camera})/2)*2)':eval=frame,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0:eval=frame`;
}

// Place a second mask above the camera, following the exact source-space zoom.
export function movingPrivacyFilters(asset, overlay, layout, size, input, output, fps, index) {
  const m = motionExpressions(asset.edits.zooms, asset.duration, 't');
  const { source: s, screen: r } = layout;
  const left = `${s.x}+(${overlay.x}-(${m.x}))*(${m.zoom})*${s.width}`;
  const top = `${s.y}+(${overlay.y}-(${m.y}))*(${m.zoom})*${s.height}`;
  const x = `max(${Math.max(0, s.x, r.x)},${left})`, y = `max(${Math.max(0, s.y, r.y)},${top})`;
  const right = `min(${Math.min(1, s.x + s.width, r.x + r.width)},(${left})+${overlay.width * s.width}*(${m.zoom}))`;
  const bottom = `min(${Math.min(1, s.y + s.height, r.y + r.height)},(${top})+${overlay.height * s.height}*(${m.zoom}))`;
  const w = `ceil((${right})*${size.width})-floor((${x})*${size.width})`, h = `ceil((${bottom})*${size.height})-floor((${y})*${size.height})`;
  return [
    `color=c=black:s=16x16:r=${fps}:d=${asset.duration},scale=w='max(2,${w})':h='max(2,${h})':eval=frame[mask${index}]`,
    `[${input}][mask${index}]overlay=x='floor((${x})*${size.width})':y='floor((${y})*${size.height})':enable='gte(t,${overlay.start})*lt(t,${overlay.end})*gt(${w},0)*gt(${h},0)':eof_action=pass[${output}]`,
  ];
}
