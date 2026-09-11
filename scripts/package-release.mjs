import { createRequire } from 'node:module';
import { createWriteStream } from 'node:fs';
import { lstat, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(new URL('../app/package.json',import.meta.url));
const { ZipArchive }=await import(pathToFileURL(require.resolve('archiver')).href);
const {version}=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const files=[];
async function collect(relative){
  const full=path.join(root,relative),info=await lstat(full);
  if(info.isSymbolicLink())throw new Error(`Release refuses symbolic link: ${relative}`);
  if(info.isDirectory())for(const name of await readdir(full))await collect(`${relative}/${name}`);
  else files.push(relative);
}
// Explicit inputs prevent research, private media, local evidence and credentials
// from entering the download even when they exist beside the source code.
for(const item of ['README.md','LICENSE','CHANGELOG.md','THIRD_PARTY_NOTICES.md','package.json','package-lock.json','.npmrc','.nvmrc','.gitignore','.github','scripts','docs/FEATURES.md','docs/RELEASE-CHECKLIST.md','docs/screenshots','app/package.json','app/package-lock.json','app/README.md','app/.env.example','app/.gitignore','app/.npmrc','app/index.html','app/watch.html','app/vite.config.mjs','app/src','app/server','app/scripts','app/tests','app/worker','app/.openai','app/public/assets/demo-screen.png','app/public/assets/demo-camera.png'])await collect(item);
for(const file of files){
  if(/(?:^|\/)(?:\.env(?!\.example$)|node_modules|\.replay-data|research|qa)(?:\/|$)/.test(file))throw new Error(`Private path in release: ${file}`);
  if(!/\.(png|jpg|woff2?)$/.test(file)){
    const text=await readFile(path.join(root,file),'utf8');
    if(/sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text))throw new Error(`Possible credential in ${file}; review before packaging.`);
  }
}
const directory=path.join(root,'releases');await mkdir(directory,{recursive:true});
const output=path.join(directory,`replay-${version}.zip`),stream=createWriteStream(output);
const archive=new ZipArchive({zlib:{level:9}});
const complete=new Promise((resolve,reject)=>{stream.on('close',resolve);stream.on('error',reject);archive.on('error',reject);archive.on('warning',reject);});
archive.pipe(stream);
for(const file of files.sort())archive.file(path.join(root,file),{name:`replay/${file}`});
await archive.finalize();await complete;
console.log(`Packaged ${files.length} files: ${output}`);
