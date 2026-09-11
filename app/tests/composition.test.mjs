import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { composition, frameAspect, layoutPreset, normalizeFrame, transformFrame, scaleFrame, MAX_LAYER_SIZE } from '../src/composition.js';
import { defaultEdits, sanitizeEdits } from '../server/store.mjs';
import { FFMPEG, run, renderMaster, probe } from '../server/media.mjs';

const asset = () => ({ width: 320, height: 180, duration: .5, edits: defaultEdits(.5), transcript: [], sources: { video: { file: 'screen.mp4', hasAudio: false }, camera: { file: 'camera.mp4' } } });

test('old camera placement stays attached to its original visual location until customized', () => {
  const a = asset();
  for (const preset of ['original', 'portrait', 'square', '4:5']) {
    a.edits.aspect = preset;
    const c = composition(a), aspect = frameAspect(a);
    assert.ok(Math.abs(c.camera.width * aspect - c.camera.height) < 1e-9);
    assert.ok(Math.abs(c.camera.x - (c.source.x + c.source.width * .02)) < 1e-9);
    assert.ok(c.camera.y >= c.source.y);
  }
});

test('camera and screen use independent canvas coordinates across aspect changes', () => {
  const a = asset(); a.edits.aspect = 'portrait';
  Object.assign(a.edits, layoutPreset('camera-bottom', a));
  assert.equal(composition(a).screen.height, .58);
  assert.equal(composition(a).camera.y, .58);
  for (const preset of ['portrait', 'landscape', 'square', '4:5']) {
    a.edits.aspect = preset;
    assert.deepEqual(composition(a).camera, { x: 0, y: .58, width: 1, height: .42 });
  }
  a.edits.camera.shape = 'circle';
  for (const preset of ['portrait', 'landscape']) {
    a.edits.aspect = preset;
    const c = composition(a).camera;
    assert.ok(Math.abs(c.width * frameAspect(a) - c.height) < 1e-9);
    assert.ok(c.width <= MAX_LAYER_SIZE && c.height <= MAX_LAYER_SIZE);
  }
});

test('drags and corner resizes allow overflow, keep a reachable edge and preserve circle geometry', () => {
  const rect = { x: .2, y: .3, width: .4, height: .225 };
  const moved = transformFrame(rect, 20, -20);
  assert.equal(moved.x, .96); assert.ok(Math.abs(moved.y - (.04 - rect.height)) < 1e-9);
  for (const handle of ['nw', 'ne', 'sw', 'se']) for (const dx of [-2, -.1, .1, 2]) {
    const next = transformFrame(rect, dx, -dx, handle, 9 / 16);
    assert.ok(next.x <= .96 && next.y <= .96 && next.x + next.width >= .039999 && next.y + next.height >= .039999);
    assert.ok(next.width <= MAX_LAYER_SIZE && next.height <= MAX_LAYER_SIZE);
    assert.ok(Math.abs(next.width * 9 / 16 - next.height) < 1e-9);
  }
  assert.deepEqual(normalizeFrame({ x: Infinity, y: -4, width: NaN, height: 5 }), { x: 0, y: -4, width: 1, height: 5 });
});

test('partial saves preserve layer geometry and reset/undo can restore legacy layouts', () => {
  let edits = sanitizeEdits({ camera: { frame: { x: .15, y: .6, width: .7, height: .3 }, shape: 'rounded' }, screen: { frame: { x: 0, y: 0, width: 1, height: .6 } } }, 5);
  edits = sanitizeEdits({ camera: { frame: { x: .25 } }, screen: { frame: { height: .5 } } }, 5, edits);
  assert.deepEqual(edits.camera.frame, { x: .25, y: .6, width: .7, height: .3 });
  assert.deepEqual(edits.screen.frame, { x: 0, y: 0, width: 1, height: .5 });
  assert.equal(edits.camera.shape, 'rounded');
  edits = sanitizeEdits({ camera: { frame: null }, screen: { frame: null } }, 5, edits);
  assert.equal(edits.camera.frame, null); assert.equal(edits.screen.frame, null);
});

test('scaling past 100% preserves the center and saves oversized frames without clipping their coordinates', () => {
  const original = { x: 0, y: 0, width: 1, height: 1 };
  const scaled = scaleFrame(original, 2);
  assert.deepEqual(scaled, { x: -.5, y: -.5, width: 2, height: 2 });
  const large = scaleFrame(original, 5);
  assert.deepEqual(large, { x: -2, y: -2, width: 5, height: 5 });
  let saved = sanitizeEdits({ screen: { frame: scaled }, camera: { frame: large, shape: 'rectangle' } }, 5);
  saved = sanitizeEdits({ screen: { frame: { x: -.75 } }, camera: { frame: { y: -1.5 } } }, 5, saved);
  assert.deepEqual(saved.screen.frame, { ...scaled, x: -.75 });
  assert.deepEqual(saved.camera.frame, { ...large, y: -1.5 });
  const circle = scaleFrame({ x: .3, y: .3, width: .4, height: .4 * 16 / 9 }, 2, 16 / 9);
  assert.ok(Math.abs(circle.height - circle.width * 16 / 9) < 1e-9);
  assert.ok(Math.abs(circle.x + circle.width / 2 - .5) < 1e-9);
});

test('real oversized exports zoom and pan screen and camera pixels while keeping output dimensions fixed', { timeout: 120000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'replay-scale-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await run(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=24:d=0.5', '-vf', 'drawbox=x=120:y=45:w=80:h=90:color=yellow:t=fill', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(root, 'screen.mp4')]);
  await run(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=24:d=0.5', '-vf', 'drawbox=x=80:y=0:w=80:h=90:color=lime:t=fill', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(root, 'camera.mp4')]);
  const a = asset();
  const render = async (name, preset = 'original') => {
    const dir = path.join(root, name); await mkdir(dir);
    const master = await renderMaster(a, file => path.join(root, file), dir, { preset, resolution: preset === 'portrait' ? 180 : 720, quality: 'high' });
    const info = await probe(master.file); const width = preset === 'portrait' ? 180 : 320, height = preset === 'portrait' ? 320 : 180; assert.equal(info.width, width); assert.equal(info.height, height);
    const image = path.join(dir, 'frame.rgb');
    await run(FFMPEG, ['-v', 'error', '-y', '-i', master.file, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', image]);
    const pixels = await readFile(image);
    return (x, y) => [...pixels.subarray((y * width + x) * 3, (y * width + x) * 3 + 3)];
  };
  const yellow = p => p[0] > 170 && p[1] > 170 && p[2] < 60;
  const blue = p => p[2] > 170 && p[0] < 60;
  const red = p => p[0] > 170 && p[1] < 60;
  const green = p => p[1] > 170 && p[0] < 60;
  a.edits.camera.visible = false;
  let pixel = await render('screen-original'); assert.ok(blue(pixel(100, 90)));
  a.edits.screen.frame = scaleFrame({ x: 0, y: 0, width: 1, height: 1 }, 2);
  pixel = await render('screen-200'); assert.ok(yellow(pixel(100, 90))); assert.ok(blue(pixel(20, 90)));
  a.edits.screen.frame.x = 0;
  pixel = await render('screen-panned'); assert.ok(blue(pixel(100, 90))); assert.ok(yellow(pixel(280, 90)));
  a.edits.screen.frame = scaleFrame({ x: 0, y: 0, width: 1, height: 1 }, 5);
  pixel = await render('screen-500'); assert.ok(yellow(pixel(10, 10))); assert.ok(yellow(pixel(310, 170)));
  a.edits.screen.frame = null;
  a.edits.camera = { visible: true, shape: 'rectangle', fit: 'cover', frame: { x: -.5, y: -.5, width: 2, height: 2 } };
  pixel = await render('camera-200'); assert.ok(red(pixel(20, 90))); assert.ok(green(pixel(300, 90)));
  a.edits.camera.frame.x = 0;
  pixel = await render('camera-panned'); assert.ok(red(pixel(20, 90))); assert.ok(red(pixel(280, 90)));
  a.edits.camera.frame = { x: -.5, y: -.2, width: 1.5, height: 1.5 * 16 / 9 }; a.edits.camera.shape = 'circle';
  pixel = await render('circle-cropped'); assert.ok(blue(pixel(310, 10)), 'circle mask retains its original center outside the crop'); assert.ok(!blue(pixel(80, 100)));
  a.edits.camera = { visible: true, shape: 'rounded', fit: 'contain', frame: { x: -.5, y: -.5, width: 2, height: 2 } };
  pixel = await render('rounded-200'); assert.ok(red(pixel(20, 90))); assert.ok(green(pixel(300, 90)));
  a.edits.aspect = 'portrait'; a.edits.camera.fit = 'cover'; a.edits.camera.shape = 'rectangle';
  pixel = await render('portrait-camera-200', 'portrait'); assert.ok(red(pixel(10, 160))); assert.ok(green(pixel(170, 160)));
  a.edits.camera.visible = false; a.edits.screen.frame = { x: -2, y: -2, width: 5, height: 5 };
  pixel = await render('portrait-screen-500', 'portrait'); assert.ok(blue(pixel(90, 10))); assert.ok(yellow(pixel(90, 160)));

});

test('real portrait exports render stacked and freely placed camera shapes and hidden layers', { timeout: 120000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'replay-layout-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [name, color, dimensions] of [['screen', 'blue', '320x180'], ['camera', 'red', '160x90']]) {
    await run(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=${dimensions}:r=24:d=0.5`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(root, `${name}.mp4`)]);
  }
  const a = asset(); a.edits.aspect = 'portrait';
  const render = async name => {
    const dir = path.join(root, name); await mkdir(dir);
    const master = await renderMaster(a, file => path.join(root, file), dir, { preset: 'portrait', resolution: 180, quality: 'high' });
    const info = await probe(master.file); assert.equal(info.width, 180); assert.equal(info.height, 320);
    const image = path.join(dir, 'frame.rgb');
    await run(FFMPEG, ['-v', 'error', '-y', '-i', master.file, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', image]);
    const pixels = await readFile(image);
    return (x, y) => [...pixels.subarray((y * 180 + x) * 3, (y * 180 + x) * 3 + 3)];
  };
  const red = p => p[0] > 180 && p[1] < 55 && p[2] < 55;
  const blue = p => p[2] > 180 && p[0] < 55;
  Object.assign(a.edits, layoutPreset('camera-bottom', a));
  let pixel = await render('stack-bottom'); assert.ok(blue(pixel(90, 90))); assert.ok(red(pixel(90, 250))); assert.ok(red(pixel(8, 310)));
  Object.assign(a.edits, layoutPreset('camera-top', a));
  pixel = await render('stack-top'); assert.ok(red(pixel(90, 50))); assert.ok(blue(pixel(90, 220)));
  a.edits.screen = { frame: null, fit: 'contain' };
  for (const shape of ['circle', 'square', 'rounded', 'rectangle']) {
    a.edits.camera = { visible: true, frame: { x: .1, y: .65, width: .8, height: .3 }, shape, fit: 'cover' };
    const rect = composition(a).camera;
    pixel = await render(shape);
    assert.ok(red(pixel(Math.round((rect.x + rect.width / 2) * 180), Math.round((rect.y + rect.height / 2) * 320))), `${shape} center is camera`);
    const corner = pixel(Math.round(rect.x * 180) + 1, Math.round(rect.y * 320) + 1);
    assert.equal(red(corner), ['square', 'rectangle'].includes(shape), `${shape} mask corners`);
  }
  a.edits.camera.frame = { x: .1, y: .4, width: .8, height: .3 };
  a.edits.overlays = [{ id: 'privacy', type: 'redact', x: .3, y: .3, width: .4, height: .4, start: 0, end: .5 }];
  pixel = await render('privacy-over-camera'); assert.ok(pixel(90, 160).every(v => v < 15), 'camera cannot cover an existing privacy mask');
  a.edits.overlays = []; a.edits.camera.frame = { x: .1, y: .65, width: .8, height: .3 };
  a.edits.camera.visible = false;
  pixel = await render('hidden'); assert.ok(!red(pixel(90, 270))); assert.ok(blue(pixel(90, 160)));
  a.edits.camera.visible = true; a.edits.camera.fit = 'contain';
  pixel = await render('fit-camera'); assert.ok(red(pixel(90, 255))); assert.ok(!red(pixel(90, 300)), 'fit preserves full camera with padding');
});
