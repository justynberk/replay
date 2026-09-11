import { motionAt, cameraMotionFrame, motionPrivacyFrame, sourceMotionStyle } from '../motion.js';
import { useEffect, useRef, useState } from 'react';
import { composition, frameAspect } from '../composition.js';
import { keptRanges } from '../lib.js';
import { previewCaptionAt } from '../review.js';
import { thumbnailFrame } from '../thumbnail-frame.js';
import { CaptionPreview, OverlayPreview } from './MediaPreview.jsx';

const rectStyle = rect => ({ position: 'absolute', left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` });

function Still({ url, position, enabled, fallback, fit = 'fill' }) {
  const [frame, setFrame] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setFrame(null);
    if (enabled && url) thumbnailFrame(url, position).then(value => { if (!cancelled) setFrame(value); });
    return () => { cancelled = true; };
  }, [url, position, enabled]);
  return frame || fallback ? <img src={frame || fallback} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: fit, display: 'block' }} /> : null;
}

export default function CompositionThumbnail({ asset, aspect = frameAspect(asset), contain = false, captions = asset.edits.captions }) {
  const ref = useRef(), [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } }, { rootMargin: '150px' });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const position = keptRanges(asset)[0]?.start || 0;
  const motion = motionAt(asset.edits.zooms, position);
  const layout = composition(asset, aspect), frame = cameraMotionFrame(layout.camera, motion), region = layout.screen, source = layout.source;
  const overlays = (asset.edits.overlays || []).filter(o => position >= o.start && position < o.end);
  const caption = captions && previewCaptionAt(asset, position);
  const radius = Math.min(frame.width * aspect, frame.height) * .08;
  const borderRadius = layout.shape === 'circle' ? '50%' : layout.shape === 'rounded' ? `${radius / (frame.width * aspect) * 100}% / ${radius / frame.height * 100}%` : 0;
  return <div ref={ref} className={`composition-thumbnail ${contain ? 'composition-thumbnail-contain' : ''}`} aria-hidden="true" style={{ '--thumbnail-aspect': aspect }}>
    <div className="composition-thumbnail-stage">
      <div style={{ ...rectStyle(region), overflow: 'hidden' }}>
        <div style={{ overflow: 'hidden', ...rectStyle({ x: (source.x - region.x) / region.width, y: (source.y - region.y) / region.height, width: source.width / region.width, height: source.height / region.height }) }}>
          <div style={sourceMotionStyle(motion)}>
          <Still url={asset.mediaUrl} position={position} enabled={visible} fallback={asset.thumbnailUrl} />
          {overlays.map(o => <OverlayPreview key={o.id} overlay={o} width={asset.width} height={asset.height} />)}
        </div></div>
      </div>
      {asset.cameraUrl && asset.edits.camera?.visible !== false && <div style={{ ...rectStyle(frame), borderRadius, overflow: 'hidden', background: '#101114' }}><Still url={asset.cameraUrl} position={position} enabled={visible} fit={asset.edits.camera?.fit || 'cover'} /></div>}
      {overlays.filter(o => o.type === 'redact').map(o => <div key={`privacy-${o.id}`} style={{ ...rectStyle(motionPrivacyFrame(o, layout, motion)), background: '#000000', zIndex: 3 }} />)}
      {caption && <CaptionPreview text={caption} aspect={aspect} />}
    </div>
  </div>;
}
