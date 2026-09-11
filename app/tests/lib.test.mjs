import test from 'node:test';
import assert from 'node:assert/strict';
import { keptRanges, editedDuration, sourceToEditedTime, editedToSourceTime, nextPlayableTime, restoreSourceRange, subtitleCues } from '../src/lib.js';
import { retainedRanges, editedDuration as renderedDuration, mapTime, remapTranscript } from '../server/media.mjs';

const recording = () => ({
  duration: 30,
  edits: { trimStart: 2, trimEnd: 28, speed: 2, cuts: [{ start: 10, end: 15 }, { start: 8, end: 12 }, { start: 20, end: 21 }] },
});

test('overlapping and out-of-order cuts remove footage once', () => {
  const asset = recording();
  assert.deepEqual(keptRanges(asset), [{ start: 2, end: 8 }, { start: 15, end: 20 }, { start: 21, end: 28 }]);
  assert.equal(editedDuration(asset), 9);
  asset.edits.cuts.push({ start: -5, end: 3 }, { start: 26, end: 60 });
  assert.deepEqual(keptRanges(asset), [{ start: 3, end: 8 }, { start: 15, end: 20 }, { start: 21, end: 26 }]);
});

test('playback maps edited boundaries to the next retained source segment', () => {
  const asset = recording();
  assert.equal(sourceToEditedTime(asset, 10), 3);
  assert.equal(sourceToEditedTime(asset, 18), 4.5);
  assert.equal(editedToSourceTime(asset, 3), 15);
  assert.equal(editedToSourceTime(asset, 4.5), 18);
  assert.equal(editedToSourceTime(asset, -10), 2);
  assert.equal(editedToSourceTime(asset, 99), 28);
  assert.equal(nextPlayableTime(asset, 8), 15);
  assert.equal(nextPlayableTime(asset, 12), 15);
  assert.equal(nextPlayableTime(asset, 28), null);
});

test('restoring one transcript passage preserves neighboring cuts', () => {
  const asset = recording();
  const restored = { ...asset, edits: { ...asset.edits, ...restoreSourceRange(asset, 9, 10) } };
  assert.deepEqual(keptRanges(restored), [{ start: 2, end: 8 }, { start: 9, end: 10 }, { start: 15, end: 20 }, { start: 21, end: 28 }]);
  assert.equal(editedDuration(restored), 9.5);
  assert.deepEqual(asset.edits.cuts, recording().edits.cuts);
});

test('restoring a passage outside the trim does not restore the intervening gap', () => {
  const asset = recording();
  const restored = { ...asset, edits: { ...asset.edits, ...restoreSourceRange(asset, 0, 1) } };
  assert.deepEqual(keptRanges(restored), [{ start: 0, end: 1 }, { start: 2, end: 8 }, { start: 15, end: 20 }, { start: 21, end: 28 }]);
});

test('fully removed recordings expose an empty playable timeline', () => {
  const asset = { duration: 10, edits: { trimStart: 0, trimEnd: 10, cuts: [{ start: 0, end: 10 }], speed: 1 } };
  assert.deepEqual(keptRanges(asset), []);
  assert.equal(editedDuration(asset), 0);
  assert.equal(editedToSourceTime(asset, 5), 0);
  assert.equal(nextPlayableTime(asset, 0), null);
  assert.deepEqual(keptRanges({ duration: 10, edits: { trimStart: 9, trimEnd: 3 } }), []);
});

test('caption import handles VTT settings, Unicode, markup and invalid cues', () => {
  const text = 'WEBVTT\n\nNOTE ignore --> this\n\ncue-a\n00:01.000 --> 00:03.500 align:start\nHéllo &amp; <i>世界</i>\n\n00:08.000 --> 00:07.000\nInvalid\n\n00:04.000 --> 00:05.000\nNext';
  assert.deepEqual(subtitleCues(text).map(({ start, end, text }) => ({ start, end, text })), [
    { start: 1, end: 3.5, text: 'Héllo & 世界' }, { start: 4, end: 5, text: 'Next' },
  ]);
  const srt = subtitleCues('\uFEFF1\r\n00:00:02,100 --> 00:00:03,300\r\nTwo lines\r\nstay together\r\n');
  assert.equal(srt[0].start, 2.1);
  assert.equal(srt[0].end, 3.3);
  assert.equal(srt[0].text, 'Two lines stay together');
  assert.deepEqual(subtitleCues('1\n00:00:99,000 --> 00:01:40,000\nInvalid seconds'), []);
});

test('caption sidecars and the playback clock agree across a cut and speed change', () => {
  const asset = { duration: 12, edits: { trimStart: 2, trimEnd: 10, cuts: [{ start: 4, end: 6 }], speed: 2 }, transcript: [{ id: 'a', start: 3, end: 7, text: 'A passage spanning the cut' }, { id: 'b', start: 8, end: 10, text: 'Ending' }] };
  assert.deepEqual(remapTranscript(asset), [{ id: 'a', start: .5, end: 1.5, text: 'A passage spanning the cut' }, { id: 'b', start: 2, end: 3, text: 'Ending' }]);
  assert.equal(sourceToEditedTime(asset, 7), 1.5);
  assert.equal(sourceToEditedTime(asset, 10), 3);
  assert.equal(editedDuration(asset), 3);
});

test('client timeline math matches the renderer for 50 varied overlapping edits', () => {
  for (let index = 0; index < 50; index++) {
    const asset = {
      duration: 40,
      edits: { trimStart: index % 8, trimEnd: 30 + index % 9, speed: [.5, 1, 1.25, 2][index % 4], cuts: Array.from({ length: 7 }, (_, n) => ({ start: (index * 3 + n * 7) % 35, end: Math.min(40, (index * 3 + n * 7) % 35 + (n % 5) + 1) })) },
    };
    assert.deepEqual(keptRanges(asset), retainedRanges(asset));
    assert.equal(editedDuration(asset), renderedDuration(asset));
    for (const point of [0, 5, 10, 15, 20, 30, 40]) assert.equal(sourceToEditedTime(asset, point), mapTime(asset, point));
  }
});
