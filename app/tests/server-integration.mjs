import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import http from 'node:http';
import { createReplayServer } from '../server/server.mjs';
import { FFMPEG, run, probe, remapTranscript, editedDuration } from '../server/media.mjs';

// Inspect the central directory of the small ZIP fixture without an OS utility.
function zipEntryNames(bytes) {
  const end=bytes.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
  assert.ok(end>=0,'ZIP end record exists');
  const count=bytes.readUInt16LE(end+10),size=bytes.readUInt32LE(end+12);
  let offset=bytes.readUInt32LE(end+16);const start=offset,names=[];
  for(let i=0;i<count;i++) {
    assert.equal(bytes.readUInt32LE(offset),0x02014b50,'valid ZIP directory entry');
    const length=bytes.readUInt16LE(offset+28),extra=bytes.readUInt16LE(offset+30),comment=bytes.readUInt16LE(offset+32);
    names.push(bytes.subarray(offset+46,offset+46+length).toString('utf8'));
    offset+=46+length+extra+comment;
  }
  assert.equal(offset,start+size,'complete ZIP central directory');
  return names;
}

test('real import, edits, exports, persistence and local request isolation', {timeout:180000}, async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'replay-test-'));
  const screen=path.join(root,'screen.mp4'),camera=path.join(root,'camera.mp4');
  await run(FFMPEG,['-nostdin','-v','error','-y','-f','lavfi','-i','color=c=blue:s=320x180:r=24:d=4','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=4','-af',"volume=enable='between(t,0.8,1.8)':volume=0",'-c:v','libx264','-preset','ultrafast','-c:a','aac','-pix_fmt','yuv420p',screen]);
  await run(FFMPEG,['-nostdin','-v','error','-y','-f','lavfi','-i','color=c=red:s=96x96:r=24:d=4','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',camera]);
  const service=await createReplayServer({directory:path.join(root,'.replay-data')}),listener=service.app.listen(0,'127.0.0.1');await once(listener,'listening');
  const base=`http://127.0.0.1:${listener.address().port}`;
  const request=(url,method='GET',body)=>fetch(base+url,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  t.after(async()=>{service.close();await new Promise(resolve=>listener.close(resolve));if(process.env.REPLAY_TEST_KEEP)console.log('Kept integration artifacts:',root);else await rm(root,{recursive:true,force:true});});
  const form=new FormData();form.append('video',new Blob([await readFile(screen)],{type:'video/mp4'}),'screen.mp4');form.append('camera',new Blob([await readFile(camera)],{type:'video/mp4'}),'camera.mp4');form.append('title','Export calibration');form.append('transcript',JSON.stringify([{start:0,end:1,text:'First sentence'},{start:1,end:2,text:'Middle sentence'},{start:2,end:4,text:'Last sentence'}]));
  const imported=await fetch(base+'/api/assets/import',{method:'POST',body:form});assert.equal(imported.status,201);const a=await imported.json();assert.equal(a.width,320);assert.equal(a.height,180);assert.ok(a.cameraUrl);assert.ok(a.waveform.some(v=>v>.05));
  const ranged=await fetch(base+a.mediaUrl,{headers:{Range:'bytes=0-99'}});assert.equal(ranged.status,206);assert.equal((await ranged.arrayBuffer()).byteLength,100);assert.match(ranged.headers.get('content-type'),/video\/mp4/);
  const fullMedia=await fetch(base+a.mediaUrl);assert.equal(fullMedia.status,200);assert.deepEqual(Buffer.from(await fullMedia.arrayBuffer()),await readFile(screen),'media body served from hidden data directory');
  const thumbnailResponse=await fetch(base+a.thumbnailUrl);assert.equal(thumbnailResponse.status,200);assert.ok((await thumbnailResponse.arrayBuffer()).byteLength>100);
  const blocked=await fetch(base+`/api/assets/${a.id}`,{method:'PATCH',headers:{Origin:'https://malicious.example','Content-Type':'application/json'},body:JSON.stringify({title:'No'})});assert.equal(blocked.status,403);
  const hostileHost=await new Promise((resolve,reject)=>{http.get(base+'/api/health',{headers:{Host:'evil.example'}},r=>{r.resume();resolve(r.statusCode);}).on('error',reject);});assert.equal(hostileHost,403);
  const invalid=(await request('/api/media/not-an-id/video'));assert.equal(invalid.status,400);
  const patch={resources:[{title:'Calibration worksheet',url:'https://example.com/worksheet'}],edits:{trimStart:.4,trimEnd:3.8,cuts:[{start:1,end:1.8}],speed:2,camera:{position:'bottom-right',size:.2},overlays:[{type:'redact',x:.1,y:.1,width:.2,height:.2,start:0,end:4},{type:'text',text:"Safe text: ' ; [out]",x:.1,y:.45,width:.7,height:.1,start:0,end:4}]},comments:[{time:2,text:'Review this moment',author:'You'}],chapters:[{start:0,title:'Start'},{start:2,title:'Next'}]};
  const patched=await request(`/api/assets/${a.id}`,'PATCH',patch);assert.equal(patched.status,200);const edited=await patched.json();assert.equal(edited.versions.length,1);assert.ok(Math.abs(editedDuration(edited)-1.3)<.001);assert.ok(Math.abs(remapTranscript(edited).at(-1).end-1.3)<.001);
  const invalidPatch=await request(`/api/assets/${a.id}`,'PATCH',{title:'Should not save',comments:'invalid'});assert.equal(invalidPatch.status,400);assert.equal(service.store.find(a.id).title,'Export calibration');
  const created=await request('/api/exports','POST',{assetId:a.id,formats:['mp4','webm','mp3','wav','gif','srt','vtt','txt','md','json','png','source','zip'],preset:'original',resolution:720,quality:'balanced',includeSources:true,burnCaptions:false});assert.equal(created.status,202);const job=await created.json();
  const cancelled=await request('/api/exports','POST',{assetId:a.id,formats:['mp4']});const pending=await cancelled.json();assert.equal((await request(`/api/jobs/${pending.id}/cancel`,'POST',{})).status,200);
  let completed;const deadline=Date.now()+120000;
  while(Date.now()<deadline){const list=await (await request('/api/jobs')).json();completed=list.find(j=>j.id===job.id);if(['completed','failed'].includes(completed.status))break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(completed.status,'completed',completed.error);assert.equal(completed.files.length,13);
  const file=path.join(root,'.replay-data','exports',job.id,'video.mp4');const info=await probe(file);assert.ok(Math.abs(info.duration-1.3)<.15);assert.ok(info.hasAudio);
  const videoDownload=await fetch(base+completed.files.find(f=>f.name==='video.mp4').url);assert.equal(videoDownload.status,200);assert.match(videoDownload.headers.get('content-disposition'),/attachment/);assert.deepEqual(Buffer.from(await videoDownload.arrayBuffer()),await readFile(file),'download body served from hidden data directory');
  const captions=await(await fetch(base+completed.files.find(f=>f.name==='captions.srt').url)).text();assert.match(captions,/00:00:00,400 --> 00:00:01,300/);assert.match(captions,/Last sentence/);
  const json=await(await fetch(base+completed.files.find(f=>f.name==='project.json').url)).json();assert.deepEqual(json.resources,edited.resources);const notes=await(await fetch(base+completed.files.find(f=>f.name==='notes.md').url)).text();assert.match(notes,/Calibration worksheet: https:\/\/example.com\/worksheet/);assert.ok(Math.abs(json.duration-1.3)<.001);assert.ok(Math.abs(json.comments[0].time-.4)<.001);
  const rgb=path.join(root,'frame.rgb');await run(FFMPEG,['-nostdin','-v','error','-y','-ss','0.3','-i',file,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo',rgb]);const pixels=await readFile(rgb),pixel=(x,y)=>[...pixels.subarray((y*320+x)*3,(y*320+x)*3+3)];assert.ok(pixel(48,25).every(v=>v<15),'redaction is black');const camPixel=pixel(280,140);assert.ok(camPixel[0]>170&&camPixel[1]<60,'separate camera is rendered');
  const archive=path.join(root,'.replay-data','exports',job.id,'replay-package.zip'),entries=zipEntryNames(await readFile(archive));assert.ok(entries.includes('sources/video.mp4'));assert.ok(entries.includes('captions.srt'));
  const silence=await(await request(`/api/assets/${a.id}/detect-silence`,'POST',{})).json();assert.ok(silence.ranges.some(r=>r.start<1.1&&r.end>1.5));assert.equal(service.store.find(a.id).edits.cuts.length,1,'silence detection does not mutate edits');
  if(!process.env.OPENAI_API_KEY)assert.equal((await request(`/api/assets/${a.id}/transcribe`,'POST',{})).status,503);
  const restored=await(await request(`/api/assets/${a.id}/versions/${edited.versions[0].id}/restore`,'POST',{})).json();assert.equal(restored.edits.speed,1);assert.equal(restored.edits.cuts.length,0);
  await request('/api/settings','PATCH',{defaultResolution:720,defaultFolder:'Client work'});
  const duplicate=await(await request(`/api/assets/${a.id}/duplicate`,'POST',{})).json();assert.notEqual(duplicate.id,a.id);assert.equal((await fetch(base+duplicate.mediaUrl)).status,200);
  await request(`/api/assets/${a.id}`,'DELETE');assert.equal(service.store.find(a.id).archived,true);await request(`/api/assets/${a.id}/restore`,'POST',{});assert.equal(service.store.find(a.id).archived,false);
  const streamFile=path.join(root,'live.webm');await run(FFMPEG,['-nostdin','-v','error','-y','-f','lavfi','-i','color=c=blue:s=320x180:r=24:d=2','-c:v','libvpx','-deadline','realtime','-live','1',streamFile]);assert.equal((await probe(streamFile)).duration,0,'fixture reproduces MediaRecorder missing duration');
  const streamForm=new FormData();streamForm.append('video',new Blob([await readFile(streamFile)],{type:'video/webm'}),'live.webm');streamForm.append('transcript',JSON.stringify([{start:0,end:2,text:'Visible burned captions'}]));const streamResponse=await fetch(base+'/api/assets/import',{method:'POST',body:streamForm});assert.equal(streamResponse.status,201);const streamed=await streamResponse.json();assert.ok(streamed.duration>1.9);assert.equal(streamed.folder,'Client work');
  const burn=await(await request('/api/exports','POST',{assetId:streamed.id,formats:['mp4','source'],preset:'landscape',resolution:720,burnCaptions:true})).json();let burned;
  for(let i=0;i<600;i++){burned=(await(await request('/api/jobs')).json()).find(j=>j.id===burn.id);if(['completed','failed'].includes(burned.status))break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(burned.status,'completed',burned.error);const burnFile=path.join(root,'.replay-data','exports',burn.id,'video.mp4'),burnInfo=await probe(burnFile);assert.equal(burnInfo.width,1280);assert.equal(burnInfo.height,720);assert.ok(burnInfo.hasAudio,'silent video is exportable');
  const original=await(await fetch(base+burned.files.find(f=>f.name==='original.webm').url)).arrayBuffer();assert.deepEqual(Buffer.from(original),await readFile(streamFile),'original source bytes are preserved');
  const burnRgb=path.join(root,'burn.rgb');await run(FFMPEG,['-nostdin','-v','error','-y','-ss','0.5','-i',burnFile,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo',burnRgb]);const captionPixels=await readFile(burnRgb);let whitePixels=0;for(let y=550;y<710;y++)for(let x=100;x<1180;x++){const at=(y*1280+x)*3;if(captionPixels[at]>190&&captionPixels[at+1]>190&&captionPixels[at+2]>190)whitePixels++;}assert.ok(whitePixels>100,'captions are visibly burned into exported pixels');
  const malicious=new FormData();malicious.append('video',new Blob(['#EXTM3U\n#EXTINF:10,\nhttp://127.0.0.1/private\n']),'playlist.m3u8');assert.equal((await fetch(base+'/api/assets/import',{method:'POST',body:malicious})).status,400,'reference playlists are not accepted as recording media');
  const second=await createReplayServer({directory:path.join(root,'.replay-data')});assert.equal(second.store.find(a.id).title,'Export calibration');assert.equal(second.store.state.settings.defaultFolder,'Client work');assert.equal(second.exports.list().find(j=>j.id===job.id).status,'completed');second.close();
});
