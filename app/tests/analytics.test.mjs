import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createStore, defaultEdits } from '../server/store.mjs';
import { createAnalytics, analyticsCsv } from '../server/analytics.mjs';
import { createReplayServer } from '../server/server.mjs';
import { createWatchMeter, coverageOf, mergeCoverage } from '../src/watch-metrics.js';
import { editedDuration, sourceToEditedTime } from '../src/lib.js';

function asset(duration = 100) {
  return { id: randomUUID(), title: 'Analytics test recording', duration, sources: {}, edits: defaultEdits(duration), versions: [], transcript: [], chapters: [], comments: [] };
}
function input(a, watchedSeconds, ranges, overrides = {}) {
  return { sessionId: randomUUID(), viewerId: randomUUID(), assetId: a.id, duration: editedDuration(a), watchedSeconds, ranges, ...overrides };
}
async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'replay-analytics-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createStore(directory), a = asset(); store.add(a);
  let now = Date.parse('2026-09-04T16:00:00Z');
  const analytics = createAnalytics(store, () => now);
  return { directory, store, a, analytics, advance: seconds => now += seconds * 1000 };
}

test('watch time excludes paused, hidden, buffered and seek time; replays do not duplicate coverage', () => {
  const meter = createWatchMeter(10);
  for (let i = 0; i <= 4; i++) meter.sample({ now: i * 500, position: i / 2, active: true });
  assert.equal(meter.snapshot().watchedSeconds, 2);
  meter.sample({ now: 2500, position: 2, active: false });
  meter.sample({ now: 10000, position: 7, active: false });
  meter.sample({ now: 11000, position: 7, active: true });
  meter.sample({ now: 12000, position: 7, active: true });
  assert.equal(meter.snapshot().watchedSeconds, 2);
  meter.reset();
  meter.sample({ now: 13000, position: 9, active: true });
  meter.sample({ now: 14000, position: 10, active: true });
  assert.equal(meter.snapshot().watchedSeconds, 3);
  assert.ok(Math.abs(coverageOf(meter.snapshot().ranges) - .3) < .00001);
  meter.reset();
  meter.sample({ now: 15000, position: 0, active: true });
  meter.sample({ now: 16000, position: 1, active: true });
  assert.equal(meter.snapshot().watchedSeconds, 4);
  assert.ok(Math.abs(coverageOf(meter.snapshot().ranges) - .3) < .00001);
});

test('unexpected jumps and suspended timers are not treated as watch time', () => {
  const meter = createWatchMeter(100);
  meter.sample({ position: 0, now: 0, active: true });
  meter.sample({ position: 99, now: 1000, active: true });
  meter.sample({ position: 100, now: 20000, active: true });
  assert.equal(meter.snapshot().watchedSeconds, 0);
  assert.deepEqual(mergeCoverage([[.5, .7], [0, .2], [.1, .4], [.4, .5]]), [[0, .7]]);
});

test('trimmed and sped-up playback measures finished timeline coverage and real elapsed seconds', () => {
  const a = asset(20); a.edits = { ...a.edits, trimStart: 2, trimEnd: 18, cuts: [{ start: 6, end: 10 }], speed: 2 };
  assert.equal(editedDuration(a), 6);
  const meter = createWatchMeter(editedDuration(a));
  for (let source = 2; source <= 6; source++) meter.sample({ position: sourceToEditedTime(a, source), now: (source - 2) * 500, active: true });
  meter.reset();
  for (let source = 10; source <= 18; source++) meter.sample({ position: sourceToEditedTime(a, source), now: (source - 6) * 500, active: true });
  assert.equal(meter.snapshot().watchedSeconds, 6);
  assert.equal(coverageOf(meter.snapshot().ranges), 1);
});

test('analytics persists, deduplicates retries, preserves cumulative time and separates browsers from views', async t => {
  const { store, directory, a, analytics, advance } = await fixture(t);
  const session = input(a, 5, [[0, .05]]);
  analytics.record(session); analytics.record(session);
  advance(5); analytics.record({ ...session, watchedSeconds: 10, ranges: [[0, .1]] });
  analytics.record(session);
  analytics.record(input(a, 5, [[0, .05]], { viewerId: session.viewerId }));
  analytics.record(input(a, 5, [[.5, .55]]));
  const report = analytics.report();
  assert.equal(report.totals.views, 3); assert.equal(report.totals.uniqueViewers, 2);
  assert.equal(report.totals.watchSeconds, 20); assert.equal(report.content[0].watchSeconds, 20);
  assert.equal(report.daily.at(-1).views, 3);
  const disk = JSON.parse(await readFile(path.join(directory, 'analytics.json'), 'utf8'));
  assert.equal(disk.sessions.length, 3);
  assert.equal(createAnalytics(store).report({ days: '90' }).totals.views, 3);
  assert.equal(store.find(a.id).versions.length, 0);
});

test('completion requires coverage, with truthful retention after skipping and replaying', async t => {
  const { a, analytics, advance } = await fixture(t);
  const session = input(a, 1, [[.99, 1]]);
  analytics.record(session);
  assert.equal(analytics.report().totals.completions, 0);
  advance(89);
  analytics.record({ ...session, watchedSeconds: 90, ranges: [[0, .89], [.99, 1]] });
  let report = analytics.report();
  assert.equal(report.totals.completions, 1);
  assert.equal(report.content[0].retention[0].value, 1);
  assert.ok(report.content[0].retention[18].value < .00001);
  advance(50); analytics.record({ ...session, watchedSeconds: 140, ranges: [[0, .89], [.99, 1]] });
  report = analytics.report();
  assert.equal(report.totals.watchSeconds, 140); assert.equal(report.totals.views, 1);
  assert.ok(Math.abs(report.totals.averageCoverage - .9) < .00001);
});

test('dates use the requested local calendar and exclude sessions outside the selected period', async t => {
  const { store, a } = await fixture(t);
  let clock = Date.parse('2026-08-28T03:59:00Z');
  const analytics = createAnalytics(store, () => clock);
  analytics.record(input(a, 5, [[0, .05]]));
  clock = Date.parse('2026-09-04T03:59:00Z'); analytics.record(input(a, 5, [[0, .05]]));
  const local = analytics.report({ days: '7', timeZone: 'America/Toronto' });
  assert.equal(local.from, '2026-08-28'); assert.equal(local.to, '2026-09-03'); assert.equal(local.totals.views, 1);
  assert.equal(local.daily.at(-1).views, 1);
  assert.equal(analytics.report({ days: '30', timeZone: 'America/Toronto' }).totals.views, 2);
  clock = Date.parse('2026-03-09T04:30:00Z');
  const dst = analytics.report({ days: '7', timeZone: 'America/Toronto' });
  assert.equal(dst.from, '2026-03-03'); assert.equal(dst.to, '2026-03-09'); assert.equal(dst.daily.length, 7);
});

test('invalid events cannot inflate coverage or overwrite another session', async t => {
  const { a, analytics, store } = await fixture(t);
  const session = input(a, 1, [[0, .01]]); analytics.record(session);
  const invalid = [null, { ...session, sessionId: 'no' }, { ...session, watchedSeconds: -1 }, { ...session, duration: 0 }, { ...session, ranges: [[0, 2]] }, { ...session, ranges: [[1, 0]] }, { ...session, ranges: [[0, 1]] }, { ...session, ranges: 'invalid' }, { ...session, viewerId: randomUUID() }];
  for (const body of invalid) assert.throws(() => analytics.record(body));
  assert.throws(() => analytics.report({ days: '-1' }));
  assert.throws(() => analytics.report({ timeZone: 'no/such-zone' }));
  assert.equal(analytics.report().totals.watchSeconds, 1);
  store.update(a.id, { edits: { speed: 2 } });
  assert.throws(() => analytics.record(input(a, 5, [[0, .05]])), /changed/);
  analytics.record(session); // An existing session retains its original finished duration.
});

test('existing libraries gain empty analytics and corrupted analytics is preserved', async t => {
  const { store, directory, analytics } = await fixture(t);
  assert.equal(analytics.report().totals.views, 0);
  assert.equal(analytics.report().content.length, 1);
  await writeFile(path.join(directory, 'analytics.json'), '{broken');
  assert.throws(() => createAnalytics(store), /could not be read/);
  assert.equal(await readFile(path.join(directory, 'analytics.json'), 'utf8'), '{broken');
});

test('CSV preserves filters and numbers, quotes titles, and neutralizes spreadsheet formulas', async t => {
  const { a, store, analytics } = await fixture(t);
  store.update(a.id, { title: '=HYPERLINK("example"), test' });
  analytics.record(input(a, 3, [[0, .03]]));
  const csv = analyticsCsv(analytics.report(), 'hyperlink');
  assert.ok(csv.startsWith('\ufeff"Recording"'));
  assert.match(csv, /"'=HYPERLINK\(""example""\), test"/);
  assert.match(csv, /"1","1","3","3","3.0"/);
  assert.equal(analyticsCsv(analytics.report(), 'no match').split('\r\n').length, 1);
});

test('local analytics API integrates without counting editor reads and rejects foreign origins', async t => {
  const { directory } = await fixture(t);
  const service = await createReplayServer({ directory });
  const listener = service.app.listen(0, '127.0.0.1'); await once(listener, 'listening');
  t.after(async () => { service.close(); await new Promise(resolve => listener.close(resolve)); });
  const base = `http://127.0.0.1:${listener.address().port}`;
  const a = service.store.state.assets[0];
  await fetch(base + `/api/assets/${a.id}`);
  assert.equal((await (await fetch(base + '/api/analytics')).json()).totals.views, 0);
  const body = input(a, 1, [[0, .01]]);
  const send = headers => fetch(base + '/api/analytics/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await send({ Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await send({ Origin: 'http://127.0.0.1:4317' })).status, 200);
  assert.equal((await send({})).status, 200);
  assert.equal((await (await fetch(base + '/api/analytics?days=7&timeZone=America%2FToronto')).json()).totals.views, 1);
  assert.equal((await fetch(base + '/api/analytics?days=10000')).status, 400);
  const csv = await fetch(base + '/api/analytics/export.csv?days=7&query=Analytics');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-disposition'), /attachment; filename="replay-analytics-/);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(await csv.text(), /"Analytics test recording","1","1","1"/);
});
