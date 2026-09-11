import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { supportedNode, localPorts, checkPort } from '../scripts/doctor.mjs';
import { createReplayServer } from '../server/server.mjs';
import { mountLocalClient } from '../server/local-client.mjs';

test('startup rejects unsupported Node versions and incompatible ports', () => {
  for(const version of ['18.20.0','20.19.0','22.11.0'])assert.equal(supportedNode(version),false);
  for(const version of ['22.12.0','24.0.0','26.3.1'])assert.equal(supportedNode(version),true);
  assert.deepEqual(localPorts({}),[4317,4319]);
  assert.deepEqual(localPorts({},true),[4317,4318,4319]);
  for(const env of [{REPLAY_PORT:'hello'},{REPLAY_PORT:'80'},{REPLAY_PORT:'4319'},{REPLAY_WATCH_PORT:'4317'}])assert.throws(()=>localPorts(env));
});

test('installed browser app serves built UI and API while keeping private files and viewer isolated', async t => {
  const directory=await mkdtemp(path.join(os.tmpdir(),'replay-startup-'));
  const client=path.join(directory,'client');await mkdir(client);
  await writeFile(path.join(client,'index.html'),'<h1>Replay browser app</h1>');
  await writeFile(path.join(client,'.env'),'PRIVATE KEY');
  await writeFile(path.join(directory,'private.txt'),'PRIVATE FILE');
  const service=await createReplayServer({directory:path.join(directory,'data')});
  mountLocalClient(service.app,client);
  const owner=service.app.listen(0,'127.0.0.1'),viewer=service.watchApp.listen(0,'127.0.0.1');
  await Promise.all([once(owner,'listening'),once(viewer,'listening')]);
  t.after(async()=>{service.close();await Promise.all([new Promise(r=>owner.close(r)),new Promise(r=>viewer.close(r))]);await rm(directory,{recursive:true,force:true});});
  const url=`http://127.0.0.1:${owner.address().port}`;
  assert.match(await (await fetch(url)).text(),/Replay browser app/);
  assert.equal((await (await fetch(url+'/api/health')).json()).ok,true);
  for(const route of ['/.env','/private.txt','/server/index.mjs','/node_modules/express/package.json','/.replay-data/library.json','/api/unknown'])assert.equal((await fetch(url+route)).status,404,route);
  assert.equal((await fetch(`http://127.0.0.1:${viewer.address().port}/api/assets`)).status,404);
  assert.equal((await fetch(url+'/api/settings',{method:'PATCH',headers:{'Content-Type':'application/json',Origin:'https://foreign.example'},body:'{}'})).status,403);
  assert.equal((await fetch(url+'/api/settings',{method:'PATCH',headers:{'Content-Type':'application/json',Origin:'http://127.0.0.1:4317'},body:'{}'})).status,200);
  await assert.rejects(checkPort(owner.address().port),/already in use/);
});
