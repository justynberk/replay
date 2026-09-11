import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadEnvironment, preflight } from './doctor.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
try { loadEnvironment(); await preflight({ ports: true, development: true }); }
catch(error) { console.error(`Replay: ${error.message}`); process.exit(1); }
// The isolated viewer serves a dedicated production entry, never the owner dev app.
const viewerBuild = spawnSync(process.execPath, ['--input-type=module', '-e', 'const { build } = await import("vite"); await build();'], { cwd: root, stdio: 'inherit' });
if (viewerBuild.status !== 0) process.exit(viewerBuild.status || 1);
const children = [
  spawn(process.execPath, ['--env-file-if-exists=.env', 'server/index.mjs'], { cwd: root, stdio: 'inherit' }),
  spawn(process.execPath, [fileURLToPath(new URL('../../bin/vite.js', import.meta.resolve('vite'))), '--host', '127.0.0.1', '--port', '4317', '--strictPort', ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' }),
];
let closing = false;
function close(code = 0) { if (closing) return; closing = true; children.forEach(child => child.kill('SIGTERM')); setTimeout(() => process.exit(code), 250); }
children.forEach(child => { child.on('error', error => { console.error(error.message); close(1); }); child.on('exit', code => { if (!closing) close(code || 0); }); });
process.on('SIGINT', () => close()); process.on('SIGTERM', () => close());
