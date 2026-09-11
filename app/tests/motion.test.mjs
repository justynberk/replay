import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeZooms, motionAt, sourceCrop, cameraMotionFrame, motionPrivacyFrame } from '../src/motion.js';
import { composition } from '../src/composition.js';
import { defaultEdits, sanitizeEdits, createStore } from '../server/store.mjs';
import { FFMPEG, run, renderMaster, probe, editedDuration } from '../server/media.mjs';

const region = { id: 'test-zoom', start: .2, end: 1.8, ease: .4, zoom: 2, x: .75, y: .5, cameraScale: .75 };

test('motion returns smoothly to the original framing and clamps edge focus', () => {
  assert.equal(motionAt([region], .2).zoom, 1);
  assert.ok(Math.abs(motionAt([region], .4).zoom - 1.5) < 1e-8);
  assert.equal(motionAt([region], 1).zoom, 2);
  assert.ok(Math.abs(motionAt([region], 1.6).zoom - 1.5) < 1e-8);
  assert.equal(motionAt([region], 1.8).zoom, 1);
  assert.equal(motionAt([], 1).cameraScale, 1);
  assert.deepEqual(sourceCrop({ zoom: 2, x: 1, y: 0 }), { x: .5, y: 0, width: .5, height: .5 });
  const short = { ...region, start: 0, end: .2, ease: 2 };
  assert.equal(motionAt([short], .1).zoom, 2);
  assert.equal(motionAt([short], .2).zoom, 1);
});

test('motion and track mix persist with bounded values and survive unrelated saves and version restore', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'replay-motion-store-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = createStore(root), id = 'da0fded2-f5fd-4cb3-9dce-d29956553711';
  store.add({ id, duration: 2, sources: {}, edits: defaultEdits(2), transcript: [], chapters: [], versions: [] });
  store.update(id, { edits: { zooms: [region], audioMix: { microphone: .4, system: 0 } } });
  store.update(id, { edits: { volume: .8 } });
  const reopened = createStore(root), a = reopened.find(id);
  assert.equal(a.edits.zooms[0].x, .75); assert.equal(a.edits.audioMix.system, 0);
  reopened.update(id, { edits: { zooms: [] } });
  reopened.restoreVersion(id, reopened.find(id).versions[0].id);
  assert.equal(reopened.find(id).edits.zooms.length, 1);
  const normalized = normalizeZooms([null, { ...region, start: -10, zoom: 100, x: Infinity }, { ...region, start: 1, end: 10 }], 2);
  assert.equal(normalized[0].zoom, 3); assert.equal(normalized[0].x, .5); assert.equal(normalized[1].start, 1.8);
  assert.equal(normalized[1].end, 2);
  assert.deepEqual(sanitizeEdits({ audioMix: { microphone: -4, system: 3 } }, 2).audioMix, { microphone: 0, system: 1 });
});

test('camera motion preserves its center and leaves cropped layouts stable', () => {
  const frame = { x: .1, y: .2, width: .4, height: .4 };
  const next = cameraMotionFrame(frame, motionAt([region], 1));
  assert.ok(Math.abs(next.width - .3) < 1e-8);
  assert.ok(Math.abs(next.x + next.width / 2 - .3) < 1e-8);
  const cropped = { ...frame, x: -.2 };
  assert.deepEqual(cameraMotionFrame(cropped, motionAt([region], 1)), cropped);
});

test('real exports independently mute microphone and app audio without restoring the mixed source', { timeout: 120000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'replay-audio-mix-')); t.after(() => rm(root, { recursive: true, force: true }));
  await run(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=96x54:r=30:d=1', '-c:v', 'libx264', path.join(root, 'screen.mp4')]);
  for (const [name, frequency] of [['microphone', 440], ['system', 880]]) await run(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=48000:duration=1`, path.join(root, `${name}.wav`)]);
  const asset = { width: 96, height: 54, duration: 1, edits: defaultEdits(1), transcript: [], sources: { video: { file: 'screen.mp4', hasAudio: false }, microphone: { file: 'microphone.wav', hasAudio: true }, system: { file: 'system.wav', hasAudio: true } } };
  for (const [microphone, system] of [[1, 0], [0, 1], [0, 0]]) {
    asset.edits.audioMix = { microphone, system };
    const dir = path.join(root, `${microphone}-${system}`); await mkdir(dir);
    const { file } = await renderMaster(asset, f => path.join(root, f), dir, { preset: 'original', resolution: 54, quality: 'high' });
    const pcm = path.join(dir, 'audio.pcm');
    await run(FFMPEG, ['-v', 'error', '-y', '-ss', '0.1', '-i', file, '-t', '0.5', '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', pcm]);
    const bytes = await readFile(pcm), samples = Array.from({ length: bytes.length / 2 }, (_, i) => bytes.readInt16LE(i * 2));
    const amplitude = frequency => Math.hypot(samples.reduce((s, v, i) => s + v * Math.sin(i * 2 * Math.PI * frequency / 48000), 0), samples.reduce((s, v, i) => s + v * Math.cos(i * 2 * Math.PI * frequency / 48000), 0)) / samples.length;
    if (microphone) assert.ok(amplitude(440) > Math.max(20, amplitude(880) * 20));
    else if (system) assert.ok(amplitude(880) > Math.max(20, amplitude(440) * 20));
    else assert.ok(samples.every(v => Math.abs(v) < 5), 'both tracks muted stays silent');
  }
});

test('real motion export tracks focus, camera size and privacy masks through cuts and speed changes', { timeout: 120000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'replay-motion-render-')); t.after(() => rm(root, { recursive: true, force: true }));
  await run(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=30:d=2', '-vf', 'drawbox=x=160:y=0:w=160:h=180:color=green:t=fill', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(root, 'screen.mp4')]);
  await run(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=30:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(root, 'camera.mp4')]);
  const asset = { width: 320, height: 180, duration: 2, edits: defaultEdits(2), transcript: [], sources: { video: { file: 'screen.mp4', hasAudio: false }, camera: { file: 'camera.mp4', width: 160, height: 90 } } };
  asset.edits.zooms = [region]; asset.edits.camera = { visible: true, shape: 'rectangle', fit: 'cover', frame: { x: .05, y: .05, width: .3, height: .3 } };
  async function render(name, preset = 'original') {
    const dir = path.join(root, name); await mkdir(dir);
    const result = await renderMaster(asset, f => path.join(root, f), dir, { preset, resolution: 180, quality: 'high', frameRate: 30 });
    const info = await probe(result.file);
    assert.ok(Math.abs(info.duration - editedDuration(asset)) < .1);
    return async second => {
      const output = path.join(dir, `frame-${second}.rgb`);
      await run(FFMPEG, ['-v', 'error', '-y', '-ss', String(second), '-i', result.file, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', output]);
      const pixels = await readFile(output);
      return (x, y) => [...pixels.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3)];
    };
  }
  const blue = p => p[2] > 150 && p[0] < 50, green = p => p[1] > 65 && p[0] < 50 && p[2] < 50, red = p => p[0] > 160 && p[1] < 50, black = p => p.every(v => v < 20);
  let frameAt = await render('zoom-camera');
  let pixel = await frameAt(0); assert.ok(blue(pixel(120, 90))); assert.ok(red(pixel(20, 20)));
  pixel = await frameAt(1); assert.ok(green(pixel(120, 90)), 'focus brings the right half into view'); assert.ok(!red(pixel(20, 20)), 'camera shrinks at its edges'); assert.ok(red(pixel(60, 30)), 'camera center remains');
  pixel = await frameAt(1.9); assert.ok(blue(pixel(120, 90))); assert.ok(red(pixel(20, 20)), 'camera returns to original size');
  asset.edits.camera.frame = { x: .18, y: .3, width: .35, height: .4 };
  const mask = { id: 'mask', type: 'redact', x: .6, y: .4, width: .15, height: .2, start: 0, end: 2, color: '#000000' };
  asset.edits.overlays = [mask]; asset.edits.cuts = [{ id: 'cut', start: .8, end: 1.2 }]; asset.edits.speed = 1.25;
  frameAt = await render('privacy-cut'); pixel = await frameAt(.64);
  const expected = motionPrivacyFrame(mask, composition(asset), motionAt([region], 1.2));
  assert.ok(black(pixel(Math.round((expected.x + expected.width / 2) * 320), Math.round((expected.y + expected.height / 2) * 180))), 'moving mask stays above camera after a cut');
  asset.edits.aspect = 'portrait';
  frameAt = await render('portrait', 'portrait'); pixel = await frameAt(.64);
  const portraitMask = motionPrivacyFrame(mask, composition(asset), motionAt([region], 1.2));
  assert.ok(black(pixel(Math.round((portraitMask.x + portraitMask.width / 2) * 180), Math.round((portraitMask.y + portraitMask.height / 2) * 320))));
});
