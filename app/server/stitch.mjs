import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { httpError } from './store.mjs';
import { FFMPEG, run, probe, renderMaster, remapTranscript, mapTime, editedDuration } from './media.mjs';

export async function stitchAssets(store,importFiles,body,signal) {
  if(!Array.isArray(body?.assetIds)||body.assetIds.length<2||body.assetIds.length>10)throw httpError('Choose between 2 and 10 recordings to stitch');
  const assets=body.assetIds.map(id=>structuredClone(store.find(id)));
  if(assets.some(a=>a.archived))throw httpError('Restore archived recordings before stitching');
  if(assets.some(a=>editedDuration(a)<.08))throw httpError('Each recording must contain a section that is not cut away');
  const directory=path.join(store.directory,'incoming',`stitch-${randomUUID()}`);await mkdir(directory,{recursive:true});
  try {
    const transcript=[],chapters=[],segments=[];let offset=0;
    for(let i=0;i<assets.length;i++) {
      if(signal.aborted)throw new Error('Stitch cancelled');
      const asset=assets[i],part=path.join(directory,`part-${i}`);await mkdir(part);
      const rendered=await renderMaster(asset,file=>path.join(store.directory,'media',file),part,{preset:'landscape',resolution:1080,quality:'high',frameRate:30,burnCaptions:!!asset.edits.captions},signal);
      const measured=await probe(rendered.file);
      for(const cue of remapTranscript(asset))transcript.push({...cue,id:randomUUID(),start:offset+cue.start,end:offset+cue.end});
      chapters.push({id:randomUUID(),start:offset,title:asset.title});
      for(const c of asset.chapters.filter(c=>c.start>asset.edits.trimStart&&c.start<asset.edits.trimEnd))chapters.push({id:randomUUID(),start:offset+mapTime(asset,c.start),title:c.title});
      segments.push(`file 'part-${i}/video.mp4'`);offset+=measured.duration;
    }
    const list=path.join(directory,'segments.ffconcat'),combined=path.join(directory,'stitched.mp4');await writeFile(list,'ffconcat version 1.0\n'+segments.join('\n')+'\n');
    await run(FFMPEG,['-nostdin','-v','error','-y','-f','concat','-safe','1','-i',list,'-c','copy','-movflags','+faststart',combined],{signal,timeout:7200000});
    if(signal.aborted)throw new Error('Stitch cancelled');
    const result=await importFiles({video:[{path:combined,originalname:'stitched.mp4'}]},{title:typeof body.title==='string'&&body.title.trim()?body.title:'Stitched recording',sample:assets.some(a=>a.sample),transcript});
    const bakedCaptions=assets.some(a=>a.edits.captions);
    store.update(result.id,{chapters,summary:`Stitched from ${assets.length} approved edits: ${assets.map(a=>a.title).join('; ')}. This is a flattened recording.${assets.some(a=>a.sample)?' Contains illustrative sample media.':''}${bakedCaptions?' Captions that were enabled on source recordings are baked into this video.':''}`});
    const saved=store.find(result.id);saved.stitchedFrom=assets.map(a=>({id:a.id,title:a.title,updatedAt:a.updatedAt}));store.save();
    return store.publicAsset(saved);
  } finally {await rm(directory,{recursive:true,force:true});}
}
