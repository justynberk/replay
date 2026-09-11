import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import fs from 'node:fs';

const fontPath=process.env.REPLAY_FONT||'/System/Library/Fonts/Supplemental/Arial.ttf';
if(fs.existsSync(fontPath))GlobalFonts.registerFromPath(fontPath,'Replay Sans');
const fontName=fs.existsSync(fontPath)?'Replay Sans':'sans-serif';

function wrap(context,text,width) {
  const lines=[];let line='';
  for(const word of text.replace(/\s+/g,' ').trim().split(' ')) {
    if(context.measureText(word).width>width){if(line){lines.push(line);line='';}let fragment='';for(const letter of word){if(context.measureText(fragment+letter).width>width&&fragment){lines.push(fragment);fragment=letter;}else fragment+=letter;}line=fragment;continue;}
    if(line&&context.measureText(line+' '+word).width>width){lines.push(line);line=word;}else line=line?line+' '+word:word;
  }
  if(line)lines.push(line);return lines;
}

export async function overlayPng(overlay,width,height,file) {
  const canvas=createCanvas(width,height),ctx=canvas.getContext('2d');ctx.fillStyle=overlay.color;ctx.strokeStyle=overlay.color;
  if(overlay.type==='arrow') {
    const center=height/2,head=Math.min(width*.35,height*.48);ctx.lineWidth=Math.max(3,height*.1);ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(4,center);ctx.lineTo(width-5,center);ctx.moveTo(width-5-head,center-head);ctx.lineTo(width-5,center);ctx.lineTo(width-5-head,center+head);ctx.stroke();
  } else {
    let font=Math.max(12,Math.min(160,height*.7)),lines=[];
    do{ctx.font=`600 ${font}px "${fontName}"`;lines=wrap(ctx,overlay.text,width-4);if(lines.length*font*1.18<=height)break;font-=1;}while(font>10);
    ctx.textBaseline='top';ctx.textAlign='center';const top=Math.max(0,(height-lines.length*font*1.18)/2);lines.forEach((line,i)=>ctx.fillText(line,width/2,top+i*font*1.18));
  }
  await writeFile(file,canvas.toBuffer('image/png'));return file;
}

export async function captionFrames(cues,duration,size,directory) {
  const width=Math.max(2,Math.round(size.width*.9/2)*2),font=Math.max(14,Math.round(size.height*.037)),height=Math.round(font*4.6/2)*2;
  const boundaries=[...new Set([0,duration,...cues.flatMap(c=>[Math.max(0,c.start),Math.min(duration,c.end)])])].filter(t=>t>=0&&t<=duration).sort((a,b)=>a-b);
  const images=new Map(),lines=[];
  const render=async(text)=>{
    if(images.has(text))return images.get(text);
    const filename=`caption-${images.size}.png`,canvas=createCanvas(width,height),ctx=canvas.getContext('2d');
    if(text){let fontSize=font,wrapped=[];do{ctx.font=`600 ${fontSize}px "${fontName}"`;wrapped=wrap(ctx,text,width-32);if(wrapped.length<=3)break;fontSize--;}while(fontSize>10);
      const contentHeight=Math.min(height-8,wrapped.length*fontSize*1.23+16),y=height-contentHeight;
      ctx.fillStyle='rgba(12,13,15,0.9)';ctx.beginPath();ctx.roundRect(0,y,width,contentHeight,Math.min(10,fontSize*.4));ctx.fill();ctx.fillStyle='#ffffff';ctx.textAlign='center';ctx.textBaseline='top';wrapped.forEach((line,i)=>ctx.fillText(line,width/2,y+8+i*fontSize*1.23));
    }
    await writeFile(path.join(directory,filename),canvas.toBuffer('image/png'));images.set(text,filename);return filename;
  };
  let last;
  for(let i=0;i<boundaries.length-1;i++){const start=boundaries[i],end=boundaries[i+1];if(end-start<.001)continue;const middle=(start+end)/2,text=cues.filter(c=>c.start<=middle&&c.end>middle).map(c=>c.text).join(' ');last=await render(text);lines.push(`file '${last}'\nduration ${(end-start).toFixed(6)}`);}
  if(last)lines.push(`file '${last}'`);
  const concatFile=path.join(directory,'caption-frames.ffconcat');await writeFile(concatFile,'ffconcat version 1.0\n'+lines.join('\n')+'\n');return{file:concatFile,width,height};
}
