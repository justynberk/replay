import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { httpError, validId } from './store.mjs';
import { editedDuration } from '../src/lib.js';
import { reviewTranscript, reviewChapters, safeResourceUrl } from '../src/review.js';

// This app runs on its own listener. Never mount the owner API on the viewer origin.
export function createWatchService(store, exports, analytics, { clientDirectory, origin = 'http://127.0.0.1:4319' } = {}) {
  const file = path.join(store.directory, 'watch.json');
  const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { shares: [] };
  const save = () => { fs.writeFileSync(file + '.tmp', JSON.stringify(state)); fs.renameSync(file + '.tmp', file); };
  const jobFor = share => store.state.jobs.find(job => job.id === share.jobId);
  const find = token => {
    const share = /^[a-f0-9]{64}$/.test(token || '') && state.shares.find(item => item.token === token && !item.revoked);
    if (!share || store.find(share.assetId).archived) throw httpError('This watch link is unavailable.', 404);
    return share;
  };
  const status = share => ({ url: `${origin}/?watch=${share.token}`, createdAt: share.createdAt, status: jobFor(share)?.status || 'failed', progress: jobFor(share)?.progress || 0 });
  const latest = id => state.shares.find(share => share.assetId === id && !share.revoked);
  const owner = {
    get(id) { store.find(id); const share = latest(id); return share ? status(share) : null; },
    create(id) {
      const asset = store.find(id);
      if (asset.archived) throw httpError('Restore this recording before sharing.');
      const existing = latest(id);
      if (existing) return status(existing);
      const job = exports.create({ assetId: id, formats: ['mp4'], preset: asset.edits.aspect, resolution: 1080, quality: 'balanced', burnCaptions: !!asset.edits.captions });
      const share = { token: randomBytes(32).toString('hex'), assetId: id, jobId: job.id, createdAt: new Date().toISOString(), comments: [] };
      state.shares.unshift(share); save(); return status(share);
    },
    revoke(id) { store.find(id); for (const share of state.shares) if (share.assetId === id) share.revoked = true; save(); return { ok: true }; },
  };
  const app = express(); app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
    if (!['GET', 'HEAD'].includes(req.method) && (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== origin))) return res.status(403).json({ error: 'Open the watch link to participate.' });
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  app.get('/api/watch/:token', (req, res, next) => {
    try {
      const share = find(req.params.token), job = jobFor(share);
      if (job?.status !== 'completed') return res.json({ status: job?.status || 'failed', progress: job?.progress || 0 });
      const a = job.snapshot;
      res.json({ status: 'completed', id: a.id, title: a.title, duration: editedDuration(a), summary: a.summary || '',
        transcript: reviewTranscript(a).map(({ id, start, end, text }) => ({ id, start, end, text })),
        chapters: reviewChapters(a).map(({ id, start, title }) => ({ id, start, title })),
        resources: (a.resources || []).filter(link => safeResourceUrl(link.url)),
        mediaUrl: `/api/watch/${share.token}/video`, comments: share.comments, createdAt: share.createdAt });
    } catch (error) { next(error); }
  });
  app.get('/api/watch/:token/video', (req, res, next) => {
    try { const share = find(req.params.token); const video = exports.findFile(share.jobId, 'video.mp4'); res.type('video/mp4').sendFile(path.basename(video), { root: path.dirname(video), acceptRanges: true, dotfiles: 'deny' }, error => { if (error) next(error); }); }
    catch (error) { next(error); }
  });
  app.post('/api/watch/:token/comments', (req, res, next) => {
    try {
      const share = find(req.params.token), job = jobFor(share), body = req.body;
      if (job?.status !== 'completed') throw httpError('Wait for the video to finish preparing.', 409);
      if (!validId(body?.id) || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 2000 || typeof body.author !== 'string' || !body.author.trim() || body.author.length > 80 || !Number.isFinite(body.time) || body.time < 0 || body.time > editedDuration(job.snapshot)) throw httpError('Add your name, a comment up to 2,000 characters, and a valid video time.');
      const existing = share.comments.find(comment => comment.id === body.id);
      if (existing) return res.json(existing);
      if (share.comments.length >= 1000) throw httpError('This discussion has reached its comment limit.', 429);
      if (share.comments.filter(comment => Date.parse(comment.createdAt) > Date.now() - 60000).length >= 30) throw httpError('Please wait a moment before adding another comment.', 429);
      const comment = { id: body.id, author: body.author.trim(), text: body.text.trim(), time: body.time, createdAt: new Date().toISOString() };
      share.comments.push(comment); save(); res.status(201).json(comment);
    } catch (error) { next(error); }
  });
  app.post('/api/watch/:token/activity', (req, res, next) => {
    try { const share = find(req.params.token), job = jobFor(share); if (job?.status !== 'completed') throw httpError('Video is preparing.', 409); res.json(analytics.record({ ...req.body, assetId: share.assetId }, job.snapshot)); }
    catch (error) { next(error); }
  });
  app.use('/api', (req, res) => res.status(404).json({ error: 'This page only provides access to the shared video.' }));
  if (clientDirectory) {
    app.use('/assets', express.static(path.join(clientDirectory, 'assets'), { dotfiles: 'deny', index: false }));
    app.get('/', (req, res) => res.sendFile(path.join(clientDirectory, 'watch.html')));
  }
  app.use((req, res) => res.status(404).send('Page unavailable. Open your watch link.'));
  app.use((error, req, res, next) => { if (res.headersSent) return next(error); res.status(error.status || 500).json({ error: error.status ? error.message : 'The watch page could not complete this request.' }); });
  return { app, owner };
}
