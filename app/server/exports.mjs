import { reviewChapters } from '../src/review.js';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { mkdir, writeFile, stat, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { ZipArchive } from 'archiver';
import { FFMPEG, run, renderMaster, remapTranscript, subtitles, mapTime, editedDuration, thumbnail } from './media.mjs';
import { httpError, validId } from './store.mjs';

const FORMATS=['mp4','webm','mp3','wav','gif','srt','vtt','txt','md','json','png','zip','source'];
export function validateExport(body) {
  if(!body||!validId(body.assetId))throw httpError('Choose a recording to export');
  if(!Array.isArray(body.formats)||!body.formats.length||body.formats.some(f=>!FORMATS.includes(f)))throw httpError('Choose at least one supported export format');
  const preset=['original','landscape','portrait','square','4:5'].includes(body.preset)?body.preset:'original';
  return {assetId:body.assetId,formats:[...new Set(body.formats)],preset,resolution:[720,1080,2160].includes(Number(body.resolution))?Number(body.resolution):1080,burnCaptions:!!body.burnCaptions,includeSources:!!body.includeSources,quality:['high','balanced','small'].includes(body.quality)?body.quality:'balanced'};
}

export function createExports(store) {
  let active=null;const queue=[],controllers=new Map();
  const publicJob=j=>{const {options,snapshot,...publicData}=j;return publicData;};
  const update=(job,fields)=>{Object.assign(job,fields,{updatedAt:new Date().toISOString()});store.save();};
  const mediaPath=file=>path.join(store.directory,'media',file);
  const enqueue=(asset,options,retryOf)=>{
    if(queue.filter(j=>j.status==='queued').length>=20)throw httpError('The export queue is full. Let a few jobs finish first.',429);
    const job={id:randomUUID(),assetId:asset.id,title:asset.title,status:'queued',progress:0,createdAt:new Date().toISOString(),files:[],options:structuredClone(options),snapshot:structuredClone(asset),...(retryOf?{retryOf}:{})};
    store.state.jobs.unshift(job);store.save();queue.push(job);setImmediate(next);return publicJob(job);
  };
  async function build(job,signal) {
    const a=job.snapshot,options=job.options,dir=path.join(store.directory,'exports',job.id);await mkdir(dir,{recursive:true});
    const wants=new Set(options.formats.filter(f=>f!=='zip'));
    if(options.formats.includes('zip')&&wants.size===0)['mp4','srt','txt','json','png'].forEach(f=>wants.add(f));
    const needsMaster=['mp4','webm','mp3','wav','gif','png'].some(f=>wants.has(f));
    const cues=remapTranscript(a),duration=editedDuration(a),files=[];
    const add=async(name,file)=>{if(signal.aborted)throw new Error('Cancelled');files.push({name,file,size:(await stat(file)).size});};
    const write=async(name,data)=>{const file=path.join(dir,name);await writeFile(file,data);await add(name,file);};
    let master;
    if(needsMaster){master=await renderMaster(a,mediaPath,dir,options,signal,p=>update(job,{progress:Math.round(p*.7)}));if(wants.has('mp4'))await add('video.mp4',master.file);}
    const convert=async(name,args)=>{const file=path.join(dir,name);await run(FFMPEG,['-nostdin','-hide_banner','-loglevel','error','-y','-i',master.file,...args,file],{signal,timeout:7200000});await add(name,file);};
    if(wants.has('webm'))await convert('video.webm',['-c:v','libvpx-vp9','-deadline','realtime','-cpu-used','6','-crf',String({high:27,balanced:33,small:40}[options.quality]),'-b:v','0','-c:a','libopus','-b:a','128k']);
    if(wants.has('mp3'))await convert('audio.mp3',['-vn','-c:a','libmp3lame','-b:a','192k']);
    if(wants.has('wav'))await convert('audio.wav',['-vn','-c:a','pcm_s16le','-ar','48000']);
    if(wants.has('gif')){if(duration>120)throw new Error('GIF export is limited to two minutes. Trim a short section or choose MP4.');await convert('preview.gif',['-filter_complex','fps=12,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse','-loop','0']);}
    if(wants.has('png')){const file=path.join(dir,'thumbnail.png');await thumbnail(master.file,file);await add('thumbnail.png',file);}
    if(wants.has('srt'))await write('captions.srt',subtitles(cues));
    if(wants.has('vtt'))await write('captions.vtt',subtitles(cues,'vtt'));
    if(wants.has('txt'))await write('transcript.txt',cues.map(c=>c.text).join('\n\n')+'\n');
    const chapters=reviewChapters(a).map(({sourceStart,...chapter})=>chapter);
    const resources=a.resources||[];
    const resourceNotes=resources.length?'## Resources\n\n'+resources.map(link=>`- ${link.title.replace(/\s+/g,' ')}: ${link.url}`).join('\n')+'\n\n':'';
    if(wants.has('md'))await write('notes.md',`# ${a.title}\n\n${a.sample?'Illustrative sample recording.\n\n':''}${a.summary?`${a.summary}\n\n`:''}${chapters.length?'## Chapters\n\n'+chapters.map(c=>`- ${Math.floor(c.start/60)}:${String(Math.floor(c.start%60)).padStart(2,'0')} ${c.title}`).join('\n')+'\n\n':''}${resourceNotes}## Transcript\n\n${cues.map(c=>c.text).join('\n\n')}\n`);
    const manifest={schema:1,title:a.title,assetId:a.id,sample:a.sample,sourceDuration:a.duration,duration,timeCoordinates:'edited',editTimeCoordinates:'source',transcript:cues,chapters,comments:a.comments.map(c=>({...c,time:mapTime(a,c.time)})),summary:a.summary,resources,edits:a.edits,exportedAt:new Date().toISOString(),options:{...options},note:'Interactive web features are not embedded in flat video. Original files are unchanged.'};
    if(wants.has('json'))await write('project.json',JSON.stringify(manifest,null,2));
    if(wants.has('source')){const source=a.sources.video,original=source.originalFile||source.file,name='original'+path.extname(original);const file=path.join(dir,name);await copyFile(mediaPath(original),file);await add(name,file);}
    update(job,{progress:90});
    if(options.formats.includes('zip')) {
      const filename=path.join(dir,'replay-package.zip');
      await new Promise((resolve,reject)=>{
        const output=fs.createWriteStream(filename),zip=new ZipArchive({zlib:{level:3}});
        const cancel=()=>{zip.abort();output.destroy();reject(new Error('Cancelled'));};signal.addEventListener('abort',cancel,{once:true});
        output.once('close',()=>{signal.removeEventListener('abort',cancel);resolve();});output.once('error',reject);zip.once('error',reject);zip.pipe(output);
        for(const f of files)zip.file(f.file,{name:f.name});
        if(!wants.has('json'))zip.append(JSON.stringify(manifest,null,2),{name:'project.json'});
        if(options.includeSources)for(const[name,source]of Object.entries(a.sources))if(name!=='thumbnail'){const original=source.originalFile||source.file;zip.file(mediaPath(original),{name:`sources/${name}${path.extname(original)}`});}
        zip.append('Replay export package\n\nVideo files preserve the rendered edit. Captions and chapter times follow the edited timeline. Original source files, when included, retain their original timelines.\n',{name:'README.txt'});
        zip.finalize().catch(reject);
      });
      await add('replay-package.zip',filename);
    }
    return files.map(({name,size})=>({name,size,url:`/api/jobs/${job.id}/files/${encodeURIComponent(name)}`}));
  }
  async function next() {
    if(active||!queue.length)return;
    const job=queue.shift();if(job.status==='cancelled'){next();return;}
    active=job.id;const controller=new AbortController();controllers.set(job.id,controller);update(job,{status:'running',progress:1});
    try {const files=await build(job,controller.signal);if(controller.signal.aborted)throw new Error('Cancelled');update(job,{status:'completed',progress:100,files});}
    catch(e){update(job,{status:controller.signal.aborted?'cancelled':'failed',error:controller.signal.aborted?'Export cancelled':e.message.slice(0,2000)});}
    finally {controllers.delete(job.id);active=null;next();}
  }
  return {
    list:()=>store.state.jobs.map(publicJob),
    create(body){const options=validateExport(body),a=store.find(options.assetId);if(a.archived)throw httpError('Restore this recording before exporting');if(editedDuration(a)<.08)throw httpError('Nothing to export. Keep a section of the recording.');return enqueue(a,options);},
    retry(id){if(!validId(id))throw httpError('Invalid export ID');const previous=store.state.jobs.find(j=>j.id===id);if(!previous)throw httpError('Export not found',404);if(['queued','running'].includes(previous.status))throw httpError('This export is already in progress',409);return enqueue(previous.snapshot,previous.options,previous.id);},
    cancel(id){const job=store.state.jobs.find(j=>j.id===id);if(!job)throw httpError('Export not found',404);if(['completed','failed','cancelled'].includes(job.status))return publicJob(job);controllers.get(id)?.abort();update(job,{status:'cancelled'});return publicJob(job);},
    findFile(id,name){if(!validId(id)||!name||name!==path.basename(name))throw httpError('Invalid file',400);const job=store.state.jobs.find(j=>j.id===id);if(!job||job.status!=='completed'||!job.files.some(f=>f.name===name))throw httpError('Export file not found',404);return path.join(store.directory,'exports',id,name);},
    shutdown(){for(const c of controllers.values())c.abort();}
  };
}
