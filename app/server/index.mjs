import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReplayServer } from './server.mjs';
import { mountLocalClient } from './local-client.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const server=await createReplayServer({directory:process.env.REPLAY_DATA_DIR||path.join(root,'.replay-data'),seed:process.env.REPLAY_SEED!=='false',watchOptions:{clientDirectory:path.join(root,'dist/client'),origin:process.env.REPLAY_WATCH_ORIGIN||'http://127.0.0.1:4319'}});
const local=process.argv.includes('--local');
if(local)mountLocalClient(server.app,path.join(root,'dist/client'));
const port=Number(process.env.REPLAY_PORT)||(local?4317:4318);
const listener=server.app.listen(port,'127.0.0.1');
const viewer=server.watchApp.listen(Number(process.env.REPLAY_WATCH_PORT)||4319,'127.0.0.1');
let closing=false;
function close(code=0){
  if(closing)return;closing=true;server.close();
  const timer=setTimeout(()=>process.exit(code),3000);timer.unref();
  let remaining=2;const done=()=>{if(--remaining===0)process.exit(code);};
  viewer.close(done);listener.close(done);
}
for(const socket of [listener,viewer])socket.once('error',error=>{console.error(`Replay could not start: ${error.code==='EADDRINUSE'?'a local port is already in use. Stop the other session and retry.':error.message}`);close(1);});
await Promise.all([new Promise(resolve=>listener.once('listening',resolve)),new Promise(resolve=>viewer.once('listening',resolve))]);
console.log(`\nReplay is ready: http://127.0.0.1:${local?port:4317}\nKeep this terminal open. Press Ctrl+C to stop.\nRecordings: ${server.store.directory}\n`);
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>close());
