import path from 'node:path';
import fs from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { FFMPEG, run, probe } from './media.mjs';

export async function seedSample(store,importFiles) {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),screen=path.join(root,'public/assets/demo-screen.png'),camera=path.join(root,'public/assets/demo-camera.png');
  if(!fs.existsSync(screen)||!fs.existsSync(camera))return false;
  const directory=path.join(store.directory,'incoming',randomUUID());await mkdir(directory,{recursive:true});
  const speech=path.join(directory,'narration.aiff'),video=path.join(directory,'sample.mp4'),cam=path.join(directory,'camera.mp4');
  const lines=[
    'Welcome to this sample onboarding walkthrough.',
    'Start with the checklist on the left. Invite your team, and then connect the tools you already use.',
    'The project overview keeps every setup task in one place.',
    'In Replay, you can trim the opening, move the camera, or add a caption.',
    'When the edit is ready, export a video, an audio file, or a complete handoff package.',
    'This is an illustrative demo with synthetic narration and images.'
  ];
  try {
    let hasNarration=true;try{await run('/usr/bin/say',['-r','163','-o',speech,lines.join(' ')]);}catch{hasNarration=false;}
    const duration=hasNarration?(await probe(speech)).duration+1:30;
    const args=['-nostdin','-v','error','-y','-loop','1','-i',screen];
    if(hasNarration)args.push('-i',speech);else args.push('-f','lavfi','-i','anullsrc=r=48000:cl=stereo');
    args.push('-t',String(duration),'-vf','scale=1600:900:force_original_aspect_ratio=decrease,pad=1600:900:(ow-iw)/2:(oh-ih)/2','-r','24','-c:v','libx264','-preset','ultrafast','-tune','stillimage','-pix_fmt','yuv420p','-c:a','aac','-af','apad','-movflags','+faststart',video);
    await run(FFMPEG,args,{timeout:240000});
    await run(FFMPEG,['-nostdin','-v','error','-y','-loop','1','-i',camera,'-t',String(duration),'-vf','scale=512:512','-r','24','-c:v','libx264','-preset','ultrafast','-tune','stillimage','-pix_fmt','yuv420p','-movflags','+faststart',cam],{timeout:240000});
    const weights=lines.map(s=>s.split(' ').length),sum=weights.reduce((a,b)=>a+b,0);let time=0;
    const transcript=hasNarration?lines.map((text,i)=>{const start=time;time+=(duration-1)*weights[i]/sum;return{id:randomUUID(),start,end:time,text};}):[];
    const result=await importFiles({video:[{path:video,originalname:'sample.mp4'}],camera:[{path:cam,originalname:'camera.mp4'}]},{title:'Client onboarding walkthrough',sample:true,transcript});
    store.update(result.id,{folder:'Product demos',tags:['Sample','Onboarding'],summary:'Illustrative sample media with synthetic narration and generated images. Explore the editor, make a cut, and export a real file.',chapters:[{start:0,title:'Welcome'},{start:transcript[1]?.start||8,title:'Your setup checklist'},{start:transcript[3]?.start||16,title:'Edit and export'}]});
    return true;
  } finally {await rm(directory,{recursive:true,force:true});}
}
