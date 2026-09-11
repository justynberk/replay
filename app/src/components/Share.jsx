import React, { useEffect, useState } from 'react';
import { ArrowRight, Check, Copy, DownloadSimple, HardDrive, LinkSimple, Package, WarningCircle } from '@phosphor-icons/react';
import { api } from '../lib.js';
import { Modal, Spinner } from './UI.jsx';

export default function Share({ onWatch, asset, onClose, onQueued, onToast, onFlush }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [includeSources, setIncludeSources] = useState(true), [watchCopied, setWatchCopied] = useState(false);
  const [share, setShare] = useState(null), [linkBusy, setLinkBusy] = useState(false);
  useEffect(() => { let active = true; api(`/assets/${asset.id}/watch`).then(value => { if (active) setShare(value); }).catch(error => { if (active) setError(error.message); }); return () => { active = false; }; }, [asset.id]);
  async function prepare() { await onFlush?.(); const next = await api(`/assets/${asset.id}/watch`, { method: 'POST', body: {} }); setShare(next); return next; }
  async function copyWatch() { setLinkBusy(true); setError(''); try { const next = await prepare(); await navigator.clipboard.writeText(next.url); setWatchCopied(true); onToast?.('Viewer link copied'); } catch (err) { setError(`Could not copy the watch link: ${err.message}`); } finally { setLinkBusy(false); } }
  async function revoke() { setLinkBusy(true); setError(''); try { await api(`/assets/${asset.id}/watch`, { method: 'DELETE' }); setShare(null); setWatchCopied(false); onToast?.('Watch link disabled. Existing viewers can no longer load it.'); } catch (err) { setError(err.message); } finally { setLinkBusy(false); } }
  async function bundle() {
    setBusy(true); setError('');
    try {
      await onFlush?.();
      const formats = ['mp4', 'json', 'md', 'png', 'zip', ...(asset.transcript?.length ? ['srt', 'vtt', 'txt'] : [])];
      const job = await api('/exports', { method: 'POST', body: { assetId: asset.id, formats, preset: asset.edits?.aspect || 'original', resolution: 1080, quality: 'balanced', burnCaptions: Boolean(asset.edits?.captions && asset.transcript?.length), includeSources } });
      onQueued?.(job); onToast?.('Handoff package queued');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <Modal title="Share your recording" onClose={onClose} className="share-modal"><div style={{ padding: '23px 26px 25px', overflowY: 'auto' }}>
    <p style={{ color: 'var(--theme-ink-secondary,#9aa8b5)', fontSize: 12, lineHeight: 1.7, margin: '0 0 23px' }}>Share a viewer-only video, or make a portable package for someone else.</p>
    <section style={{ ...sectionStyle, marginBottom: 15 }}><div style={headingStyle}><LinkSimple size={20} /><h3 style={titleStyle}>Viewer link</h3><span style={badgeStyle}>VIDEO + COMMENTS ONLY</span></div><p style={descriptionStyle}>A separate page for watching and leaving timestamped comments. Viewers cannot open your library, editor, settings, or original files. The link keeps a finished copy of this edit.</p>{share && <input readOnly aria-label="Viewer link" value={share.url} onFocus={event => event.target.select()} style={{ width: '100%', fontSize: 10, marginBottom: 10 }} />}<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="button primary" disabled={linkBusy} onClick={onWatch} style={{ fontSize: 11 }}>Open watch page<ArrowRight size={16} /></button><button className="button" disabled={linkBusy} onClick={copyWatch} style={{ fontSize: 11 }}>{watchCopied ? <Check size={16} /> : <Copy size={16} />}{linkBusy ? 'Working...' : watchCopied ? 'Copied' : 'Copy viewer link'}</button>{share && <button className="button" disabled={linkBusy} onClick={revoke} style={{ fontSize: 11 }}>Disable link</button>}</div><p style={{ ...descriptionStyle, marginBottom: 0 }}>Available on this computer while Replay is running. The first visit waits for the finished video. To share newer edits, disable this link and create another. A new link starts a new discussion.</p></section>
    <section style={{ ...sectionStyle, marginTop: 15 }}><div style={headingStyle}><Package size={20} color="var(--theme-accent-ink,#dbb879)" /><h3 style={titleStyle}>Portable handoff</h3></div><p style={descriptionStyle}>A ZIP with the finished MP4, thumbnail, project metadata and available captions, transcript and notes. Send the downloaded file using your preferred service.</p><label style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 9, margin: '17px 0 20px', fontSize: 11, color: 'var(--theme-ink,#c2cfdb)', cursor: 'pointer' }}><input type="checkbox" checked={includeSources} onChange={event => setIncludeSources(event.target.checked)} style={{ accentColor: 'var(--theme-accent-fill,#f3bd60)', margin: '2px 0 0', padding: 0, width: 14, height: 14, minWidth: 14, flexShrink: 0 }} /><span>Include original source files<small style={{ display: 'block', fontSize: 10, color: 'var(--theme-ink-muted,#8093a3)', marginTop: 5, lineHeight: 1.5 }}>Keeps the screen, camera and audio tracks when available. This makes a larger download.</small></span></label><button className="button primary" onClick={bundle} disabled={busy || asset.archived} style={{ width: '100%', justifyContent: 'center', minHeight: 39, fontSize: 12 }}>{busy ? <Spinner>Preparing package</Spinner> : <><DownloadSimple size={18} />Create handoff package<ArrowRight size={16} /></>}</button>{asset.archived && <p style={{ color: 'var(--theme-accent-ink,#d1ad74)', fontSize: 10, margin: '12px 0 0' }}>Restore this recording before creating a package.</p>}</section>
    {error && <p role="alert" style={{ display: 'flex', gap: 7, color: 'var(--theme-danger-ink,#e4a38b)', fontSize: 11, lineHeight: 1.6, margin: '17px 0 0' }}><WarningCircle size={17} style={{ flexShrink: 0 }} />{error}</p>}
    <p style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 10, lineHeight: 1.6, color: 'var(--theme-ink-muted,#728797)', margin: '19px 0 0' }}><HardDrive size={16} style={{ flexShrink: 0 }} />Internet hosting is not connected. Viewer links and comments currently work on this computer.</p>
  </div></Modal>;
}
const sectionStyle = { border: '1px solid var(--theme-edge-strong,#3a4753)', borderRadius: 8, background: 'var(--theme-surface,#1b2229)', padding: 17 };
const headingStyle = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' };
const titleStyle = { fontSize: 13, fontWeight: 500, margin: 0, color: 'var(--theme-ink,#dee7ef)' };
const badgeStyle = { color: 'var(--theme-ink-muted,#8f9ca8)', fontSize: 7, letterSpacing: '.6px', marginLeft: 'auto', background: 'var(--theme-raised,#2c353e)', padding: '4px 5px', borderRadius: 3 };
const descriptionStyle = { fontSize: 11, lineHeight: 1.75, color: 'var(--theme-ink-secondary,#91a1b1)', margin: '11px 0 15px' };
