import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { reviewTranscript, reviewChapters, safeResourceUrl, previewPlaybackRate, previewCaptionAt } from '../src/review.js';
import { createWatchMeter, coverageOf } from '../src/watch-metrics.js';
import { sourceToEditedTime } from '../src/lib.js';
import { deliveryPreset } from '../src/export-presets.js';
import { createStore, defaultEdits } from '../server/store.mjs';

const recording = () => ({ duration: 30, edits: { trimStart: 5, trimEnd: 25, speed: 2, aspect: 'square', cuts: [{ start: 8, end: 13 }], captions: true }, transcript: [{ id: 'a', start: 2, end: 7, text: 'Opening' }, { id: 'b', start: 9, end: 12, text: 'Removed words' }, { id: 'c', start: 11, end: 16, text: 'Keep this passage' }], chapters: [{ id: 'one', start: 0, title: 'Intro' }, { id: 'two', start: 8, title: 'Removed chapter' }, { id: 'three', start: 10, title: 'Main point' }, { id: 'four', start: 26, title: 'Beyond the trim' }] });

test('review search omits fully cut passages and seeks retained footage with edited timestamps', () => {
  const asset = recording();
  assert.deepEqual(reviewTranscript(asset), [
    { id: 'a', text: 'Opening', start: 0, end: 1, sourceStart: 5 },
    { id: 'c', text: 'Keep this passage', start: 1.5, end: 3, sourceStart: 13 },
  ]);
  assert.deepEqual(reviewChapters(asset), [
    { id: 'one', title: 'Intro', start: 0, sourceStart: 5 },
    { id: 'three', title: 'Main point', start: 1.5, sourceStart: 13 },
  ]);
  asset.edits.cuts = [{ start: 0, end: 30 }];
  assert.deepEqual(reviewChapters(asset), []);
  assert.deepEqual(reviewTranscript(asset), []);
});

test('viewing speed is relative to the saved edit and never changes export speed', () => {
  const asset = recording(), before = structuredClone(asset);
  assert.equal(previewPlaybackRate(asset, 1.5), 3);
  assert.equal(previewPlaybackRate(asset, .5), 1);
  assert.equal(previewPlaybackRate(asset, NaN), 2);
  assert.deepEqual(asset, before);
});

test('delivery shortcuts preserve composition and include available transcript deliverables', () => {
  const asset = recording(), before = structuredClone(asset);
  assert.equal(deliveryPreset('default', asset).preset, 'square');
  assert.equal(deliveryPreset('archive', asset).preset, 'square');
  assert.deepEqual(deliveryPreset('archive', asset).formats, ['mp4', 'json', 'md', 'srt', 'vtt', 'txt', 'zip']);
  assert.equal(deliveryPreset('archive', asset).includeSources, true);
  assert.equal(deliveryPreset('social', asset).preset, 'portrait');
  assert.equal(deliveryPreset('social', asset).burnCaptions, true);
  assert.deepEqual(deliveryPreset('audio', asset).formats, ['mp3']);
  assert.deepEqual(asset, before);
  asset.transcript = [];
  assert.equal(deliveryPreset('social', asset).burnCaptions, false);
  assert.deepEqual(deliveryPreset('archive', asset).formats, ['mp4', 'json', 'md', 'zip']);
});

test('resource links persist, reject executable schemes, and fail atomically', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'replay-resources-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createStore(root), id = randomUUID();
  store.add({ id, title: 'Resource fixture', duration: 30, sources: {}, edits: defaultEdits(30), transcript: [], chapters: [], versions: [] });
  const resources = [{ title: 'Worksheet', url: 'https://example.com/worksheet?q=1#part' }];
  const saved = store.update(id, { resources });
  assert.equal(saved.resources[0].url, resources[0].url);
  assert.ok(saved.resources[0].id);
  assert.deepEqual(createStore(root).find(id).resources, saved.resources);
  for (const url of ['javascript:alert(1)', 'data:text/html,bad', 'file:///etc/passwd', '/relative', 'https://user:password@example.com', null]) {
    assert.equal(safeResourceUrl(url), '');
    assert.throws(() => store.update(id, { title: 'Do not save', resources: [{ title: 'Unsafe', url }] }));
    assert.equal(store.find(id).title, 'Resource fixture');
    assert.deepEqual(store.find(id).resources, saved.resources);
  }
  assert.throws(() => store.update(id, { resources: Array(11).fill(resources[0]) }));
});

test('viewing rates measure real elapsed time and proportional edited coverage', () => {
  for (const viewerSpeed of [.5, 1.5, 2]) {
    const asset = { duration: 20, edits: { trimStart: 0, trimEnd: 20, cuts: [], speed: 2 } };
    const actualRate = previewPlaybackRate(asset, viewerSpeed), meter = createWatchMeter(10);
    for (let step = 0; step <= 4; step++) meter.sample({ position: sourceToEditedTime(asset, step * .25 * actualRate), rate: actualRate / asset.edits.speed, now: step * 250, active: true });
    assert.equal(meter.snapshot().watchedSeconds, 1);
    assert.equal(coverageOf(meter.snapshot().ranges), viewerSpeed / 10);
  }
});


test('paused caption seeks select the requested passage despite media timestamp rounding', () => {
  const boundary = 17.577525405405403;
  const asset = { transcript: [{ start: 12, end: boundary, text: 'Previous passage' }, { start: boundary, end: 24, text: 'Requested passage' }] };
  assert.equal(previewCaptionAt(asset, 17.577525), 'Requested passage');
  assert.equal(previewCaptionAt(asset, boundary), 'Requested passage');
  assert.equal(previewCaptionAt(asset, boundary - .01), 'Previous passage');
  assert.equal(previewCaptionAt(asset, 24), '');
});
