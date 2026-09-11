import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { createReplayServer } from '../server/server.mjs';
import { run,FFMPEG,probe } from '../server/media.mjs';

test('stitch honors edits and retry preserves the original export snapshot',{timeout:120000},async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'replay-stitch-')),fixture=path.join(root,'source.mp4');
  await run(FFMPEG,['-nostdin','-v','error','-y','-f','lavfi','-i','color=c=blue:s=320x180:r=24:d=2','-f','lavfi','-i','sine=frequency=330:duration=2','-c:v','libx264','-preset','ultrafast','-c:a','aac','-pix_fmt','yuv420p',fixture]);
  const service=await createReplayServer({directory:path.join(root,'data')}),listener=service.app.listen(0,'127.0.0.1');await once(listener,'listening');const base=`http://127.0.0.1:${listener.address().port}`;
  t.after(async()=>{service.close();await new Promise(r=>listener.close(r));await rm(root,{recursive:true,force:true});});
  const request=(url,method='GET',body)=>fetch(base+url,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  const awaitJob=async id=>{for(let i=0;i<600;i++){const job=(await(await request('/api/jobs')).json()).find(j=>j.id===id);if(['completed','failed','cancelled'].includes(job.status)){assert.equal(job.status,'completed',job.error);return job;}await new Promise(r=>setTimeout(r,100));}throw new Error('Export did not finish');};
  const form=new FormData();form.append('video',new Blob([await readFile(fixture)]),'source.mp4');form.append('title','First clip');form.append('sample','true');form.append('transcript',JSON.stringify([{start:0,end:2,text:'A real timed segment'}]));
  const a=await(await fetch(base+'/api/assets/import',{method:'POST',body:form})).json();
  await request(`/api/assets/${a.id}`,'PATCH',{edits:{trimStart:0,trimEnd:1,speed:2}});
  const b=await(await request(`/api/assets/${a.id}/duplicate`,'POST',{})).json();await request(`/api/assets/${b.id}`,'PATCH',{title:'Second clip',edits:{trimStart:.5,trimEnd:1.5,speed:1}});
  const stitchResponse=await request('/api/assets/stitch','POST',{assetIds:[a.id,b.id],title:'Two approved edits'});assert.equal(stitchResponse.status,201);const stitched=await stitchResponse.json();
  assert.equal(stitched.title,'Two approved edits');assert.equal(stitched.width,1920);assert.equal(stitched.height,1080);assert.ok(Math.abs(stitched.duration-1.5)<.12,`stitched duration ${stitched.duration}`);assert.equal(stitched.cameraUrl,undefined);assert.equal(stitched.stitchedFrom.length,2);assert.equal(stitched.sample,true);assert.equal(stitched.transcript.length,2);assert.ok(Math.abs(stitched.transcript[1].start-.5)<.08);assert.equal(stitched.chapters.length,2);
  const source=service.store.find(a.id).sources.video.file;assert.deepEqual(await readFile(path.join(root,'data','media',source)),await readFile(fixture),'stitch keeps original sources unchanged');
  const first=await(await request('/api/exports','POST',{assetId:a.id,formats:['mp4'],resolution:720,preset:'original'})).json();await awaitJob(first.id);
  await request(`/api/assets/${a.id}`,'PATCH',{edits:{trimStart:0,trimEnd:2,speed:1}});
  const retryResponse=await request(`/api/jobs/${first.id}/retry`,'POST',{});assert.equal(retryResponse.status,202);const retry=await retryResponse.json();assert.notEqual(retry.id,first.id);assert.equal(retry.retryOf,first.id);await awaitJob(retry.id);
  const retried=await probe(path.join(root,'data','exports',retry.id,'video.mp4'));assert.ok(Math.abs(retried.duration-.5)<.1,`retry duration ${retried.duration}`);assert.equal(service.store.find(a.id).edits.trimEnd,2,'retry leaves current edits untouched');
  assert.equal((await request('/api/assets/stitch','POST',{assetIds:[a.id]})).status,400);await request(`/api/assets/${b.id}`,'DELETE');assert.equal((await request('/api/assets/stitch','POST',{assetIds:[a.id,b.id]})).status,400);
});
