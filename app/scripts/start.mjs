import { spawn } from 'node:child_process';
import { loadEnvironment, preflight, root } from './doctor.mjs';

let child;
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  closing = true;
  if (child) child.kill(signal);
  else process.exit(0);
});

function run(args) {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', env: process.env });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      child = null;
      if (closing) process.exit(0);
      if (code !== 0) reject(new Error(`Startup stopped${signal ? ` (${signal})` : ` (exit ${code})`}. See the message above.`));
      else resolve();
    });
  });
}

try {
  loadEnvironment();
  await preflight({ ports: true });
  console.log('\nBuilding Replay for your browser...');
  await run(['--input-type=module', '-e', 'const { build } = await import("vite"); await build();']);
  if (!closing) await run(['server/index.mjs', '--local']);
} catch (error) {
  console.error(`\nReplay: ${error.message}\n`);
  process.exitCode = 1;
}
