import { spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));

export function loadEnvironment() {
  try { process.loadEnvFile(path.join(root, '.env')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

export function supportedNode(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 12);
}

export function localPorts(env = process.env, development = false) {
  const owner = Number(env.REPLAY_PORT || (development ? 4318 : 4317));
  const viewer = Number(env.REPLAY_WATCH_PORT || 4319);
  if (![owner, viewer].every(port => Number.isInteger(port) && port >= 1024 && port <= 65535)) {
    throw new Error('Replay ports must be whole numbers from 1024 to 65535. Check app/.env.');
  }
  // Owner origins and the development proxy use these fixed local ports.
  if (owner !== (development ? 4318 : 4317) || viewer !== 4319) {
    throw new Error('Remove REPLAY_PORT and REPLAY_WATCH_PORT from app/.env. Replay uses 4317 for the browser, 4319 for the viewer, and 4318 for the development API.');
  }
  return development ? [4317, owner, viewer] : [owner, viewer];
}

export async function checkPort(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', error => reject(new Error(error.code === 'EADDRINUSE'
      ? `Port ${port} is already in use. Stop the other Replay session with Ctrl+C, then try again.`
      : `Cannot open local port ${port}: ${error.message}`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

export async function preflight({ ports = false, development = false } = {}) {
  if (!supportedNode()) throw new Error('Replay requires Node.js 22.12 or newer. Install Node.js 24 LTS from https://nodejs.org/en/download, then reopen your terminal.');
  for (const name of ['vite', 'express', '@napi-rs/canvas']) {
    try { await import(name); }
    catch { throw new Error(`Replay dependency ${name} is unavailable. Run npm ci from the repo folder, then try again.`); }
  }
  for (const [label, executable] of [['FFmpeg', process.env.REPLAY_FFMPEG || 'ffmpeg'], ['ffprobe', process.env.REPLAY_FFPROBE || 'ffprobe']]) {
    const result = spawnSync(executable, ['-version'], { encoding: 'utf8', timeout: 15000 });
    if (result.error || result.status !== 0) throw new Error(`${label} is unavailable. Install FFmpeg, reopen your terminal, and run npm run doctor. See README.md for your operating system. Custom executable paths belong in app/.env.`);
  }
  const encoders = spawnSync(process.env.REPLAY_FFMPEG || 'ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8', timeout: 15000 });
  for (const codec of ['libx264', 'libvpx-vp9', 'libmp3lame', 'libopus', 'aac']) {
    if (encoders.status !== 0 || !new RegExp(`\\b${codec}\\b`).test(encoders.stdout || '')) throw new Error(`Your FFmpeg build is missing ${codec}. Install a full FFmpeg build using README.md.`);
  }
  if (ports) for (const port of localPorts(process.env, development)) await checkPort(port);
  console.log('Ready: Node.js, app dependencies, FFmpeg, ffprobe, and export codecs.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { loadEnvironment(); await preflight(); }
  catch (error) { console.error(`\nReplay: ${error.message}\n`); process.exitCode = 1; }
}
