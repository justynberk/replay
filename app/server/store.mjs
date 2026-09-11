import { safeResourceUrl } from '../src/review.js';
import { normalizeZooms } from '../src/motion.js';
import { normalizeFrame } from '../src/composition.js';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const validId = id => typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
export const defaultEdits = duration => ({ trimStart:0,trimEnd:duration,cuts:[],zooms:[],audioMix:{microphone:1,system:1},aspect:'original',screen:{frame:null,fit:'contain'},camera:{visible:true,size:.19,position:'bottom-left',frame:null,shape:'circle',fit:'cover'},captions:false,volume:1,speed:1,overlays:[],normalizeAudio:false });
export function httpError(message,status=400){ const e=new Error(message);e.status=status;return e; }
const number = (v,min,max,fallback) => Number.isFinite(Number(v)) ? Math.min(max,Math.max(min,Number(v))) : fallback;
const text = (v,max=1000) => typeof v === 'string' ? v.slice(0,max) : '';
const enumValue = (v,values,fallback) => values.includes(v)?v:fallback;
const idValue = v => validId(v) ? v : randomUUID();

export function sanitizeEdits(input, duration, previous=defaultEdits(duration)) {
  if(!input || typeof input!=='object' || Array.isArray(input)) throw httpError('Edits must be an object');
  const e={...previous,...input,camera:{...previous.camera,...input.camera},screen:{...previous.screen,...input.screen}};
  const start=number(e.trimStart,0,duration,0),end=number(e.trimEnd,0,duration,duration);
  if(end<=start) throw httpError('The end trim point must be after the start point');
  return {
    zooms:normalizeZooms(e.zooms,duration),audioMix:{microphone:number(e.audioMix?.microphone,0,1,1),system:number(e.audioMix?.system,0,1,1)},
    trimStart:start,trimEnd:end,aspect:enumValue(e.aspect,['original','landscape','portrait','square','4:5'],'original'),
    cuts:(Array.isArray(e.cuts)?e.cuts:[]).slice(0,250).map(c=>({id:idValue(c.id),start:number(c.start,0,duration,0),end:number(c.end,0,duration,0)})).filter(c=>c.end>c.start),
    screen:{frame:e.screen.frame ? normalizeFrame({...previous.screen?.frame,...e.screen.frame}) : null,fit:enumValue(e.screen.fit,['contain','cover'],'contain')},
    camera:{frame:e.camera.frame ? normalizeFrame({...previous.camera?.frame,...e.camera.frame}) : null,shape:enumValue(e.camera.shape,['circle','square','rounded','rectangle'],'circle'),fit:enumValue(e.camera.fit,['contain','cover'],'cover'),visible:e.camera.visible!==false,size:number(e.camera.size,.08,.45,.19),position:enumValue(e.camera.position,['top-left','top-right','bottom-left','bottom-right'],'bottom-left')},
    captions:!!e.captions,volume:number(e.volume,0,3,1),speed:number(e.speed,.25,4,1),normalizeAudio:!!e.normalizeAudio,
    overlays:(Array.isArray(e.overlays)?e.overlays:[]).slice(0,60).map(o=>({id:idValue(o.id),type:enumValue(o.type,['text','box','arrow','redact'],'text'),text:text(o.text,400),x:number(o.x,0,.98,.1),y:number(o.y,0,.98,.1),width:number(o.width,.01,1,.3),height:number(o.height,.01,1,.08),start:number(o.start,0,duration,0),end:number(o.end,0,duration,duration),color:/^#[0-9a-fA-F]{6}$/.test(o.color)?o.color:'#ffffff'})).filter(o=>o.end>o.start)
  };
}

export function sanitizeTranscript(input,duration) {
  if(!Array.isArray(input)) throw httpError('Transcript must be a list of timed segments');
  return input.slice(0,30000).map(c=>({id:idValue(c.id),start:number(c.start,0,duration,0),end:number(c.end,0,duration,0),text:text(c.text,3000).trim()})).filter(c=>c.end>c.start&&c.text).sort((a,b)=>a.start-b.start);
}

export function createStore(directory) {
  fs.mkdirSync(directory,{recursive:true}); for(const name of ['media','exports','incoming'])fs.mkdirSync(path.join(directory,name),{recursive:true});
  const database=path.join(directory,'library.json');
  let state={schema:1,assets:[],jobs:[],settings:{defaultResolution:1080,defaultQuality:'balanced',defaultFolder:'My library',autoSave:true}};
  if(fs.existsSync(database)) { try { const disk=JSON.parse(fs.readFileSync(database,'utf8')); if(!Array.isArray(disk.assets)||!Array.isArray(disk.jobs))throw new Error('Invalid library');state={...state,...disk}; } catch { throw new Error('The local library file could not be read. Preserve library.json and restore a backup before restarting.'); } }
  const save=()=>{const temporary=database+'.tmp';fs.writeFileSync(temporary,JSON.stringify(state,null,2));fs.renameSync(temporary,database);};
  for(const j of state.jobs)if(['queued','running'].includes(j.status)){j.status='failed';j.error='Export was interrupted by a server restart. Queue the export again.';}
  save();
  const find=id=>{if(!validId(id))throw httpError('Invalid asset ID',400);const a=state.assets.find(x=>x.id===id);if(!a)throw httpError('Recording not found',404);return a;};
  const publicAsset=a=>{
    const {sources,...data}=a;
    const mediaUrl=n=>sources[n]?`/api/media/${a.id}/${n}?v=1`:undefined;
    return {...data,mediaUrl:mediaUrl('video'),cameraUrl:mediaUrl('camera'),microphoneUrl:mediaUrl('microphone'),systemUrl:mediaUrl('system'),thumbnailUrl:`/api/media/${a.id}/thumbnail?v=1`};
  };
  const snapshot=a=>({id:randomUUID(),createdAt:new Date().toISOString(),edits:structuredClone(a.edits),transcript:structuredClone(a.transcript),chapters:structuredClone(a.chapters)});
  const revision=a=>{a.versions.unshift(snapshot(a));a.versions=a.versions.slice(0,100);};
  const update=(id,body)=>{
    const a=structuredClone(find(id));if(!body||typeof body!=='object')throw httpError('Invalid update');
    let nextEdits,nextTranscript,nextChapters;
    if('edits'in body)nextEdits=sanitizeEdits(body.edits,a.duration,a.edits);
    if('transcript'in body)nextTranscript=sanitizeTranscript(body.transcript,a.duration);
    if('chapters'in body){if(!Array.isArray(body.chapters))throw httpError('Chapters must be a list');nextChapters=body.chapters.slice(0,500).map(c=>({id:idValue(c.id),start:number(c.start,0,a.duration,0),title:text(c.title,200)})).sort((x,y)=>x.start-y.start);}
    if((nextEdits&&JSON.stringify(nextEdits)!==JSON.stringify(a.edits))||(nextTranscript&&JSON.stringify(nextTranscript)!==JSON.stringify(a.transcript)))revision(a);
    if(nextEdits)a.edits=nextEdits;if(nextTranscript)a.transcript=nextTranscript;if(nextChapters)a.chapters=nextChapters;
    if('title'in body)a.title=text(body.title,200).trim()||'Untitled recording';
    if('folder'in body)a.folder=text(body.folder,120).trim()||'My library';
    if('tags'in body)a.tags=Array.isArray(body.tags)?[...new Set(body.tags.map(t=>text(t,50).trim()).filter(Boolean))].slice(0,30):[];
    if('favorite'in body)a.favorite=!!body.favorite;
    if('archived'in body)a.archived=!!body.archived;
    if('summary'in body)a.summary=text(body.summary,30000);
    if('resources'in body){
      if(!Array.isArray(body.resources)||body.resources.length>10)throw httpError('Add up to 10 resource links');
      a.resources=body.resources.map(link=>{
        const title=text(link?.title,120).trim(),url=safeResourceUrl(link?.url);
        if(!title||!url)throw httpError('Resources need a name and a full http or https link without credentials');
        return {id:idValue(link.id),title,url};
      });
    }
    if('comments'in body){if(!Array.isArray(body.comments))throw httpError('Comments must be a list');a.comments=body.comments.slice(0,1000).map(c=>({id:idValue(c.id),time:number(c.time,0,a.duration,0),text:text(c.text,5000),author:text(c.author,100)||'You',createdAt:Number.isFinite(Date.parse(c.createdAt))?new Date(c.createdAt).toISOString():new Date().toISOString(),resolved:!!c.resolved})).filter(c=>c.text.trim());}
    a.updatedAt=new Date().toISOString();state.assets[state.assets.findIndex(x=>x.id===id)]=a;save();return publicAsset(a);
  };
  return {directory,state,save,find,publicAsset,revision,update,
    add(a){state.assets.unshift(a);save();return publicAsset(a);},
    restoreVersion(id,versionId){const a=find(id),v=a.versions.find(x=>x.id===versionId);if(!v)throw httpError('Version not found',404);const copy=structuredClone(v);revision(a);a.edits=copy.edits;a.transcript=copy.transcript;a.chapters=copy.chapters;a.updatedAt=new Date().toISOString();save();return publicAsset(a);},
    settings(body){for(const key of ['defaultFolder','defaultResolution','defaultQuality','autoSave','recordingCountdown','recordSystemAudio','cameraEnabled','microphoneEnabled'])if(key in body){if(key==='defaultFolder')state.settings[key]=text(body[key],120);else if(key==='defaultResolution')state.settings[key]=enumValue(Number(body[key]),[720,1080,2160],1080);else if(key==='defaultQuality')state.settings[key]=enumValue(body[key],['high','balanced','small'],'balanced');else if(key==='recordingCountdown')state.settings[key]=number(body[key],0,10,3);else state.settings[key]=!!body[key];}save();return state.settings;}
  };
}
