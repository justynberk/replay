import { screenMotionFilter, cameraMotionFilter, movingPrivacyFilters } from './motion.mjs';
import { composition, privacyFrame, fitFrame } from '../src/composition.js';
import { spawn } from 'node:child_process';
import { writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { overlayPng, captionFrames } from './raster.mjs';

export const FFMPEG = process.env.REPLAY_FFMPEG || 'ffmpeg';
export const FFPROBE = process.env.REPLAY_FFPROBE || 'ffprobe';
export const FONT = process.env.REPLAY_FONT || '/System/Library/Fonts/Supplemental/Arial.ttf';

export function run(command, args, { signal, timeout = 120000, onProgress, maxBytes = 8 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Cancelled'));
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', size = 0, settled = false;
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel); error ? reject(error) : resolve(result); };
    const cancel = () => { child.kill('SIGKILL'); finish(new Error('Cancelled')); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('Media processing timed out. Try a shorter recording or lower resolution.')); }, timeout);
    signal?.addEventListener('abort', cancel, { once: true });
    child.stdout.on('data', chunk => { size += chunk.length; if (size > maxBytes) { child.kill('SIGKILL'); finish(new Error('Media output exceeded the processing limit')); } else { stdout += chunk; onProgress?.(chunk.toString()); } });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-maxBytes); });
    child.once('error', e => finish(new Error(e.code === 'ENOENT' ? `${command} is unavailable` : e.message)));
    child.once('close', code => finish(code === 0 ? null : new Error(`Media processing failed: ${stderr.slice(-1800) || `exit ${code}`}`), { stdout, stderr }));
  });
}

export async function probe(file) {
  const { stdout } = await run(FFPROBE, ['-v', 'error', '-protocol_whitelist','file,pipe','-format_whitelist','mov,matroska,webm,avi,wav,mp3,aiff,flac,ogg,mpegts,aac','-show_format', '-show_streams', '-of', 'json', file]);
  const info = JSON.parse(stdout), video = info.streams?.find(x => x.codec_type === 'video');
  const audio = info.streams?.find(x => x.codec_type === 'audio');
  const duration = Number(info.format?.duration || video?.duration || audio?.duration || 0);
  const format=info.format?.format_name||'';
  const rotation=Number(video?.side_data_list?.find(s=>Number.isFinite(Number(s.rotation)))?.rotation||video?.tags?.rotate||0),swapped=Math.abs(Math.round(rotation/90))%2===1;
  const mime=video?(format.includes('matroska')?'video/webm':format.includes('avi')?'video/x-msvideo':'video/mp4'):(format.includes('mp3')?'audio/mpeg':format.includes('wav')?'audio/wav':format.includes('matroska')?'audio/webm':'audio/mp4');
  return { duration, width: (swapped?video?.height:video?.width) || 0, height: (swapped?video?.width:video?.height) || 0, hasVideo: !!video, hasAudio: !!audio, size: Number(info.format?.size || 0), videoCodec: video?.codec_name, audioCodec: audio?.codec_name,format,mime,rotation };
}

export function retainedRanges(asset) {
  const { duration, edits } = asset;
  const start = Math.max(0, Math.min(duration, Number(edits.trimStart) || 0));
  const end = Math.max(start, Math.min(duration, Number.isFinite(Number(edits.trimEnd)) ? Number(edits.trimEnd) : duration));
  const cuts = (edits.cuts || []).map(c => ({ start: Math.max(start, c.start), end: Math.min(end, c.end) })).filter(c => c.end > c.start).sort((a,b) => a.start-b.start);
  const merged = [];
  for (const c of cuts) { const last = merged.at(-1); if (last && c.start <= last.end) last.end = Math.max(last.end, c.end); else merged.push({ ...c }); }
  const result = []; let cursor = start;
  for (const c of merged) { if (c.start > cursor + .001) result.push({ start: cursor, end: c.start }); cursor = c.end; }
  if (end > cursor + .001) result.push({ start: cursor, end });
  return result;
}

export function editedDuration(asset) { return retainedRanges(asset).reduce((s,r) => s+r.end-r.start, 0) / (asset.edits.speed || 1); }

export function remapTranscript(asset) {
  const ranges = retainedRanges(asset), speed = asset.edits.speed || 1, output = [];
  let offset = 0;
  for (const range of ranges) {
    for (const cue of asset.transcript || []) {
      const start = Math.max(range.start, cue.start), end = Math.min(range.end, cue.end);
      if (end > start) {
        const mapped = { ...cue, start: (offset + start - range.start) / speed, end: (offset + end - range.start) / speed };
        const last = output.at(-1);
        if (last && last.id === mapped.id && Math.abs(last.end - mapped.start) < .002) last.end = mapped.end;
        else output.push(mapped);
      }
    }
    offset += range.end-range.start;
  }
  return output.sort((a,b)=>a.start-b.start);
}

export function mapTime(asset, time) {
  let offset = 0;
  for (const r of retainedRanges(asset)) { if (time < r.start) return offset / asset.edits.speed; if (time <= r.end) return (offset + time-r.start)/asset.edits.speed; offset += r.end-r.start; }
  return offset / asset.edits.speed;
}

const timestamp = (seconds, separator = ',') => {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}${separator}${String(ms%1000).padStart(3,'0')}`;
};

export function subtitles(cues, format = 'srt') {
  const vtt = format === 'vtt';
  const body = cues.map((c,i) => `${vtt ? '' : `${i+1}\n`}${timestamp(c.start,vtt?'.':',')} --> ${timestamp(c.end,vtt?'.':',')}\n${c.text.replace(/-->/g,'→').replace(/\r/g,'')}`).join('\n\n');
  return (vtt ? 'WEBVTT\n\n' : '') + body + '\n';
}

export function outputSize(asset, preset, resolution) {
  const originalW = asset.width, originalH = asset.height;
  let w, h; const res = Number(resolution) || 1080;
  if (preset === 'portrait') { w = res; h = res*16/9; }
  else if (preset === 'square') { w = h = res; }
  else if (preset === '4:5') { w = res; h = res*5/4; }
  else if (preset === 'landscape') { w = res*16/9; h = res; }
  else { h = Math.min(res, originalH); w = originalW * h / originalH; }
  const shrink = Math.min(1, 4096 / Math.max(w,h));
  return { width: Math.max(2, Math.round(w*shrink/2)*2), height: Math.max(2,Math.round(h*shrink/2)*2) };
}

function tempo(speed) {
  const parts=[]; let value = speed;
  while (value > 2) { parts.push('atempo=2'); value /= 2; }
  while (value < .5) { parts.push('atempo=0.5'); value /= .5; }
  parts.push(`atempo=${value}`); return parts.join(',');
}
export async function renderMaster(asset, sourcePath, directory, options, signal, progress) {
  const ranges = retainedRanges(asset), duration = editedDuration(asset);
  if (duration < .08) throw new Error('Nothing to export. Keep at least a short section between your trim points and cuts.');
  const primary = sourcePath(asset.sources.video.originalFile||asset.sources.video.file);
  const args = ['-nostdin','-hide_banner','-loglevel','error','-y','-i', primary];
  const sources = {}; let inputIndex = 1;
  for (const name of ['camera','microphone','system']) if (asset.sources[name]) { sources[name] = inputIndex++; args.push('-i',sourcePath(asset.sources[name].originalFile||asset.sources[name].file)); }
  const filters = []; let video = 'base';
  const hasMotion = Boolean(asset.edits.zooms?.length), motionFps = options.frameRate || 30;
  filters.push(`[0:v]setpts=PTS-STARTPTS,setsar=1,scale=trunc(iw/2)*2:trunc(ih/2)*2[base]`);
  for (const [index,o] of asset.edits.overlays.entries()) {
    const out = `overlay${index}`, enable=`between(t,${o.start},${o.end})`;
    const x=Math.round(o.x*asset.width),y=Math.round(o.y*asset.height),w=Math.max(2,Math.round(o.width*asset.width)),h=Math.max(2,Math.round(o.height*asset.height));
    if (o.type === 'redact' || o.type === 'box') {
      filters.push(`[${video}]drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${o.type==='redact'?'black':o.color}:t=${o.type==='redact'?'fill':'4'}:enable='${enable}'[${out}]`);
    } else {
      const imageFile=path.join(directory,`overlay-${index}.png`);await overlayPng(o,w,h,imageFile);const indexInput=inputIndex++;args.push('-i',imageFile);
      filters.push(`[${video}][${indexInput}:v]overlay=x=${x}:y=${y}:eof_action=repeat:enable='${enable}'[${out}]`);
    }
    video=out;
  }
  if (hasMotion) {
    filters.push(`[${video}]${screenMotionFilter(asset, Math.floor(asset.width / 2) * 2, Math.floor(asset.height / 2) * 2, motionFps)}[motionvideo]`);
    video = 'motionvideo';
  }
  const size = outputSize(asset,options.preset,options.resolution);
  const layout = composition(asset, size.width / size.height);
  const pixelFrame = frame => ({
    width: Math.max(2, Math.round(frame.width * size.width / 2) * 2),
    height: Math.max(2, Math.round(frame.height * size.height / 2) * 2),
    x: Math.round(frame.x * size.width / 2) * 2,
    y: Math.round(frame.y * size.height / 2) * 2,
  });
  const intersect = (a, b) => {
    const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
    return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
  };
  const canvasFrame = { x: 0, y: 0, ...size };
  function renderPiece(input, output, rect, source, fit, shape = null) {
    const frame = pixelFrame(rect), visible = intersect(frame, canvasFrame);
    const image = pixelFrame(fitFrame(rect, source.width / source.height, size.width / size.height, fit));
    const visibleImage = intersect(image, visible);
    let chain;
    if (visibleImage.width && visibleImage.height) {
      // Crop source pixels before scaling so even a 500% layer only renders visible pixels.
      const x = Math.max(0, Math.min(source.width - 1, Math.round((visibleImage.x - image.x) / image.width * source.width)));
      const y = Math.max(0, Math.min(source.height - 1, Math.round((visibleImage.y - image.y) / image.height * source.height)));
      const width = Math.max(1, Math.min(source.width - x, Math.round(visibleImage.width / image.width * source.width)));
      const height = Math.max(1, Math.min(source.height - y, Math.round(visibleImage.height / image.height * source.height)));
      chain = `crop=${width}:${height}:${x}:${y}:exact=1,scale=${visibleImage.width}:${visibleImage.height},setsar=1,pad=${visible.width}:${visible.height}:${visibleImage.x - visible.x}:${visibleImage.y - visible.y}:color=0x101114`;
    } else {
      chain = `scale=${visible.width}:${visible.height},setsar=1,drawbox=x=0:y=0:w=iw:h=ih:color=0x101114:t=fill`;
    }
    const offsetX = visible.x - frame.x, offsetY = visible.y - frame.y;
    const px = `X+${offsetX}-${frame.width / 2}`, py = `Y+${offsetY}-${frame.height / 2}`;
    if (shape === 'circle') chain += `,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(pow((${px})/${frame.width / 2},2)+pow((${py})/${frame.height / 2},2),1),255,0)'`;
    if (shape === 'rounded') {
      const radius = Math.min(frame.width, frame.height) * .08;
      chain += `,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(pow(max(abs(${px})-(${frame.width / 2}-${radius}),0),2)+pow(max(abs(${py})-(${frame.height / 2}-${radius}),0),2),${radius * radius}),255,0)'`;
    }
    if (shape) chain += `,tpad=stop_mode=clone:stop_duration=${asset.duration}`;
    filters.push(`[${input}]setpts=PTS-STARTPTS,${chain}[${output}]`);
    return visible;
  }
  filters.push(`[${video}]split[screeninput][canvasclock]`);
  filters.push(`[canvasclock]scale=${size.width}:${size.height},setsar=1,drawbox=x=0:y=0:w=iw:h=ih:color=0x101114:t=fill[canvas]`);
  const screenFrame = renderPiece('screeninput', 'screenpiece', layout.screen, { width: Math.floor(asset.width / 2) * 2, height: Math.floor(asset.height / 2) * 2 }, asset.edits.screen?.fit || 'contain');
  filters.push(`[canvas][screenpiece]overlay=${screenFrame.x}:${screenFrame.y}:eof_action=repeat[withscreen]`);
  video = 'withscreen';
  if (sources.camera !== undefined && asset.edits.camera.visible !== false) {
    const source = asset.sources.camera;
    const cameraInfo = source.width && source.height ? source : await probe(sourcePath(source.originalFile || source.file));
    const frame = renderPiece(`${sources.camera}:v`, 'cam', layout.camera, cameraInfo, asset.edits.camera.fit || 'cover', layout.shape);
    const cameraMotion = hasMotion && cameraMotionFilter(asset, layout.camera, frame.width, frame.height, motionFps);
    if (cameraMotion) filters.push(`[cam]${cameraMotion}[movingcam]`);
    filters.push(`[${video}][${cameraMotion ? 'movingcam' : 'cam'}]overlay=${frame.x}:${frame.y}:eof_action=repeat[withcam]`); video = 'withcam';
  }
  // A moved camera must not expose an area already covered by a privacy mask.
  for (const [index, overlay] of asset.edits.overlays.entries()) {
    if (overlay.type !== 'redact') continue;
    if (hasMotion) {
      filters.push(...movingPrivacyFilters(asset, overlay, layout, size, video, `privacy${index}`, motionFps, index));
      video = `privacy${index}`; continue;
    }
    const mask = privacyFrame(overlay, layout);
    if (!mask.width || !mask.height) continue;
    const x = Math.floor(mask.x * size.width), y = Math.floor(mask.y * size.height);
    const w = Math.ceil((mask.x + mask.width) * size.width) - x, h = Math.ceil((mask.y + mask.height) * size.height) - y;
    filters.push(`[${video}]drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=black:t=fill:enable='between(t,${overlay.start},${overlay.end})'[privacy${index}]`);
    video = `privacy${index}`;
  }
  const audioSources = ['microphone','system'].filter(n => sources[n] !== undefined && asset.sources[n].hasAudio);
  let hasAudio = audioSources.length > 0 || asset.sources.video.hasAudio;
  if (audioSources.length) {
    audioSources.forEach((n,i)=>filters.push(`[${sources[n]}:a]asetpts=PTS-STARTPTS,aresample=48000,volume=${asset.edits.audioMix?.[n] ?? 1},apad,atrim=0:${asset.duration}[sourceaudio${i}]`));
    if (audioSources.length > 1) filters.push(`${audioSources.map((_,i)=>`[sourceaudio${i}]`).join('')}amix=inputs=${audioSources.length}:normalize=0[baseaudio]`);
    else filters.push('[sourceaudio0]anull[baseaudio]');
  } else if (hasAudio) filters.push(`[0:a]asetpts=PTS-STARTPTS,aresample=48000,apad,atrim=0:${asset.duration}[baseaudio]`);
  else { args.push('-f','lavfi','-i','anullsrc=r=48000:cl=stereo'); filters.push(`[${inputIndex++}:a]atrim=0:${asset.duration}[baseaudio]`); hasAudio = true; }
  if (ranges.length > 1) {
    filters.push(`[${video}]split=${ranges.length}${ranges.map((_,i)=>`[vs${i}]`).join('')}`);
    filters.push(`[baseaudio]asplit=${ranges.length}${ranges.map((_,i)=>`[as${i}]`).join('')}`);
  }
  ranges.forEach((r,i)=>{
    filters.push(`[${ranges.length>1?`vs${i}`:video}]trim=start=${r.start}:end=${r.end},setpts=PTS-STARTPTS[v${i}]`);
    filters.push(`[${ranges.length>1?`as${i}`:'baseaudio'}]atrim=start=${r.start}:end=${r.end},asetpts=PTS-STARTPTS[a${i}]`);
  });
  filters.push(`${ranges.map((_,i)=>`[v${i}][a${i}]`).join('')}concat=n=${ranges.length}:v=1:a=1[cutvideo][cutaudio]`);
  let finalVideo = `[cutvideo]setpts=PTS/${asset.edits.speed},setsar=1`;
  if (options.burnCaptions && asset.transcript.length) {
    const captions=await captionFrames(remapTranscript(asset),duration,size,directory),captionVideo=path.join(directory,'caption-track.mov');
    await run(FFMPEG,['-nostdin','-v','error','-y','-f','concat','-safe','0','-i',captions.file,'-vf','fps=24','-t',String(duration),'-c:v','qtrle','-pix_fmt','argb',captionVideo],{signal,timeout:7200000});
    const captionIndex=inputIndex++;args.push('-i',captionVideo);filters.push(finalVideo+'[framed]');filters.push(`[framed][${captionIndex}:v]overlay=x=(W-w)/2:y=H-h-${Math.max(6,Math.round(size.height*.025))}:eof_action=pass[outv]`);
  } else filters.push(finalVideo+'[outv]');
  filters.push(`[cutaudio]${tempo(asset.edits.speed)},volume=${asset.edits.volume}${asset.edits.normalizeAudio?',loudnorm=I=-16:TP=-1.5:LRA=11':''},apad,atrim=0:${duration}[outa]`);
  const file = path.join(directory,'video.mp4');
  const crf = { high:18, balanced:23, small:29 }[options.quality] || 23;
  const filterFile = path.join(directory, 'composition.ffscript');
  await writeFile(filterFile, filters.join(';'));
  args.push('-filter_complex_threads','2','-filter_complex_script',filterFile,'-map','[outv]','-map','[outa]','-c:v','libx264','-preset','veryfast','-crf',String(crf),'-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-ac','2');
  if(options.frameRate)args.push('-r',String(options.frameRate),'-fps_mode','cfr');
  args.push('-movflags','+faststart','-t',String(duration),'-progress','pipe:1','-nostats',file);
  await run(FFMPEG,args,{ signal,timeout:7200000,onProgress:text=>{ const matches=[...text.matchAll(/out_time_us=(\d+)/g)]; if(matches.length) progress?.(Math.min(90,Number(matches.at(-1)[1])/1e6/duration*90)); }});
  const result=await probe(file); if (!result.hasVideo || Math.abs(result.duration-duration) > Math.max(.25,duration*.01)) throw new Error('Rendered file did not match the selected timeline. The original recording is safe.');
  return { file,duration,size };
}

export async function extractWaveform(file,hasAudio,duration) {
  if (!hasAudio) return Array(160).fill(0);
  if(!duration)duration=(await probe(file)).duration;
  return new Promise(resolve=>{
    const child=spawn(FFMPEG,['-nostdin','-v','error','-i',file,'-vn','-ac','1','-ar','8000','-f','s16le','pipe:1'],{stdio:['ignore','pipe','ignore']});
    const bins=Array(160).fill(0),amount=Array(160).fill(0);let samples=0,tail=Buffer.alloc(0);
    const timer=setTimeout(()=>child.kill('SIGKILL'),120000);
    child.stdout.on('data',chunk=>{const c=tail.length?Buffer.concat([tail,chunk]):chunk;for(let i=0;i+1<c.length;i+=2){const index=Math.min(159,Math.floor(samples++/(duration*8000)*160)),v=c.readInt16LE(i)/32768;bins[index]+=v*v;amount[index]++;}tail=c.length%2?c.subarray(c.length-1):Buffer.alloc(0);});
    child.on('error',()=>{clearTimeout(timer);resolve(Array(160).fill(0));});
    child.on('close',()=>{clearTimeout(timer);resolve(bins.map((v,i)=>amount[i]?Math.min(1,Math.sqrt(v/amount[i])*4):0));});
  });
}

export async function thumbnail(file,target) {
  await run(FFMPEG,['-nostdin','-hide_banner','-loglevel','error','-y','-ss','0','-i',file,'-frames:v','1','-vf','scale=800:-2',target]);
  return stat(target);
}
