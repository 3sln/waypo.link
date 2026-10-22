#!/usr/bin/env node
// DX-9: save sealed tar volumes, never extract untrusted paths. Mint a fresh
// job grant at POST /api/exports/:job/grants (owner session, CSRF, step-up),
// then use BINDLE_EXPORT_GRANT or --grant-file (0600).
// node scripts/bindle-export.mjs --origin https://host.example --job <uuid> --out ./backup
// Run the same command to resume. A new grant for the SAME job is accepted.
import {constants} from 'node:fs';
import {open,mkdir,lstat,rename,unlink,realpath} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {createAppEngine,perform,AppAction} from '../packages/app/engine.mjs';
import {systemClock,cryptoRandom,nullAudit} from '../packages/app/providers.mjs';
import {parseExportGrant} from '../packages/runtime/account/exports.mjs';
const BLOCK=512,CHUNK=4*1024**2,MAX_JSON=16*1024**2,CP='checkpoint.json',LOCK='.bindle-export.lock',HEX=/^[a-f0-9]{64}$/;
const int=n=>Number.isSafeInteger(n)&&n>=0,hash=b=>createHash('sha256').update(b).digest('hex');
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const check=(value,message)=>{if(!value)fail('export_verification_failed',message);};
const text=b=>new TextDecoder('utf-8',{fatal:true}).decode(b);
function safePath(path){check(typeof path==='string'&&/^[A-Za-z0-9_./-]+$/.test(path)&&!path.startsWith('/')&&!path.split('/').some(s=>!s||s==='.'||s==='..'||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s)),'Unsafe tar path.');return path;}
async function file(io,path,create=false){
 const handle=await io.open(path,constants.O_RDWR|constants.O_NOFOLLOW|(create?constants.O_CREAT|constants.O_EXCL:0),0o600);
 try{const stat=await handle.stat();check(stat.isFile()&&stat.nlink===1,'Output must be a regular file with one link.');return handle;}catch(error){await handle.close();throw error;}
}
async function acquireLock(io,root){
 const path=join(root,LOCK);for(let attempt=0;attempt<3;attempt++){try{const h=await file(io,path,true);await h.writeFile(JSON.stringify({pid:io.pid})+'\n');await h.sync();return h;}catch(error){if(error.code!=='EEXIST')throw error;const h=await file(io,path);let stat,record;try{stat=await h.stat();check(stat.size<128,'Invalid download lock.');record=JSON.parse(await h.readFile('utf8'));}finally{await h.close();}check(int(record.pid)&&record.pid>0,'Invalid download lock.');try{io.probeProcess(record.pid);fail('export_locked','Another downloader owns this directory.');}catch(error){if(error.code!=='ESRCH')throw error;}if((await io.lstat(path)).ino===stat.ino)await io.unlink(path);}}fail('export_locked','The output directory is busy.');
}
async function bytes(handle,at,size){const out=Buffer.alloc(size);let used=0;while(used<size){const {bytesRead}=await handle.read(out,used,size-used,at+used);check(bytesRead>0,'Truncated local file.');used+=bytesRead;}return out;}
async function digest(handle,at,size){const h=createHash('sha256');for(let used=0;used<size;){const n=Math.min(CHUNK,size-used);h.update(await bytes(handle,at+used,n));used+=n;}return h.digest('hex');}
async function zeros(handle,at,size){for(let used=0;used<size;){const n=Math.min(CHUNK,size-used);check((await bytes(handle,at+used,n)).every(v=>v===0),'Nonzero tar padding.');used+=n;}}
async function save(io,root,state){const name=join(root,'.checkpoint-'+io.uuid()),handle=await file(io,name,true);try{await handle.writeFile(JSON.stringify(state)+'\n');await handle.sync();}finally{await handle.close();}await io.rename(name,join(root,CP));}
function octal(b){const value=text(b).replace(/\0.*$/s,'').trim();check(/^[0-7]+$/.test(value),'Invalid tar integer.');const n=parseInt(value,8);check(int(n),'Unsafe tar size.');return n;}
function field(b){const n=b.indexOf(0);return text(n<0?b:b.subarray(0,n));}
function pax(data){const values={};let at=0;while(at<data.length){const space=data.indexOf(32,at),length=Number(text(data.subarray(at,space)));check(space>at&&int(length)&&length>space-at+3&&at+length<=data.length&&data[at+length-1]===10,'Invalid pax record.');const record=text(data.subarray(space+1,at+length-1)),eq=record.indexOf('='),key=record.slice(0,eq),value=record.slice(eq+1);check(['path','size'].includes(key)&&!Object.hasOwn(values,key),'Unsupported pax record.');values[key]=value;at+=length;}return values;}
/** Streaming hashes with bounded JSON reads; no archive-supplied name is used
 * for a filesystem write. Accept only regular ustar files and local pax headers. */
export async function inspectTar(handle,total,visit){
 check(int(total)&&total>=1024&&total%BLOCK===0,'Invalid tar volume size.');let at=0,pending=null,segment=0;const paths=new Set();
 while(at<total){const header=await bytes(handle,at,BLOCK);if(header.every(v=>v===0)){check(!pending&&at+1024===total,'Invalid tar terminator.');await zeros(handle,at,total-at);return;}
  check(at+BLOCK<=total&&field(header.subarray(257,263))==='ustar','Invalid tar header.');const stored=octal(header.subarray(148,156)),sum=header.reduce((n,b,i)=>n+(i>=148&&i<156?32:b),0);check(stored===sum,'Tar header checksum mismatch.');
  let path=field(header.subarray(0,100)),prefix=field(header.subarray(345,500));if(prefix)path=prefix+'/'+path;
  let size=octal(header.subarray(124,136));const type=header[156];check(type===0||type===48||type===120,'Links and special tar entries are forbidden.');
  if(type===120){check(!pending&&size<=MAX_JSON&&at+BLOCK+size<=total,'Invalid pax header.');segment=at;pending=pax(await bytes(handle,at+BLOCK,size));await zeros(handle,at+BLOCK+size,(BLOCK-size%BLOCK)%BLOCK);at+=BLOCK+size+(BLOCK-size%BLOCK)%BLOCK;continue;}
  const start=pending?segment:at;if(pending?.path!==undefined)path=pending.path;if(pending?.size!==undefined){check(/^\d+$/.test(pending.size),'Invalid pax size.');size=Number(pending.size);check(int(size),'Unsafe pax size.');}pending=null;
  safePath(path);check(!paths.has(path.toLowerCase()),'Duplicate or case-colliding tar path.');paths.add(path.toLowerCase());
  const dataAt=at+BLOCK,end=dataAt+size,padding=(BLOCK-size%BLOCK)%BLOCK;check(int(end)&&end+padding+1024<=total,'Truncated tar entry.');
  const sha256=await digest(handle,dataAt,size);await visit({path,size,sha256,start,end:end+padding,read:async()=>{check(size<=MAX_JSON,'JSON part exceeds the bound.');return bytes(handle,dataAt,size);}});await zeros(handle,end,padding);at=end+padding;
 }
 fail('export_verification_failed','Missing tar terminator.');
}
async function downloadFile(io,path,existing){try{return await file(io,path,!existing);}catch(error){if(error.code!=='EEXIST'||existing)throw error;const h=await file(io,path);if((await h.stat()).size===0)return h;await h.close();fail('export_verification_failed','Uncheckpointed output is not empty.');}}
async function volumePath(io,root,n){const part=join(root,`volume-${n}.tar.part`),final=join(root,`volume-${n}.tar`),exists=async p=>{try{await io.lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};const a=await exists(part),b=await exists(final);check(!(a&&b),'Both partial and final volume files exist.');return b?final:part;}
async function validateCheckpoint(io,root,state){
 check(state?.v===1&&HEX.test(state.rootDigest)&&state.volumes&&typeof state.volumes==='object'&&!Array.isArray(state.volumes),'Invalid checkpoint.');
 for(const [key,v]of Object.entries(state.volumes)){check(/^[1-9][0-9]*$/.test(key)&&int(v.bytes)&&v.bytes>=1024&&v.bytes%BLOCK===0&&Array.isArray(v.chunks),'Invalid checkpoint volume.');let offset=0;const h=await file(io,await volumePath(io,root,key));try{
   for(const chunk of v.chunks){check(int(chunk.size)&&chunk.size>0&&chunk.size<=CHUNK&&offset+chunk.size<=v.bytes&&HEX.test(chunk.sha256),'Invalid checkpoint chunk.');check(await digest(h,offset,chunk.size)===chunk.sha256,'Local checkpoint chunk digest mismatch.');offset+=chunk.size;}
   check((await h.stat()).size>=offset,'Truncated checkpoint output.');await h.truncate(offset);
  }finally{await h.close();}
 }
}
function manifestValid(m,{origin,job,owner,rootDigest},raw){
 check(hash(raw)===rootDigest,'Manifest root digest mismatch.');check(m?.format==='bindle-export/1'&&m.version===1&&m.issuer===origin&&m.jobId===job&&m.subject===owner,'Manifest belongs to another export.');
 check(Array.isArray(m.volumes)&&m.volumes.length>0&&m.volumes.length<=100000&&m.volumes.every((v,i)=>v.n===i+1&&int(v.bytes)&&v.bytes>=1024&&v.bytes%BLOCK===0),'Invalid manifest volumes.');
 check(Array.isArray(m.parts)&&Array.isArray(m.payloadIndex),'Invalid manifest parts.');const names=new Set();for(const p of m.parts){safePath(p.path);check(!names.has(p.path.toLowerCase())&&int(p.size)&&HEX.test(p.sha256),'Invalid manifest part.');names.add(p.path.toLowerCase());}
 check(new Set(m.payloadIndex).size===m.payloadIndex.length&&m.payloadIndex.every(p=>/^payloads\/index\.\d+\.jsonl$/.test(p)&&names.has(p.toLowerCase())),'Invalid payload index.');
}
async function verifyVolume(io,root,state,n,manifest,expected,seen,packState){
 const volume=state.volumes[n],h=await file(io,await volumePath(io,root,n));let raw,parsed;
 try{check(volume.chunks.reduce((s,c)=>s+c.size,0)===volume.bytes,'Incomplete tar volume.');await inspectTar(h,volume.bytes,async entry=>{
   if(n===1&&entry.path==='manifest.json'){check(!raw,'Duplicate manifest.');raw=await entry.read();parsed=JSON.parse(text(raw));manifestValid(parsed,state,raw);manifest=parsed;for(const p of manifest.parts)if(!/^pack\.\d+$/.test(p.path))expected.set(p.path,{...p,volume:1});return;}
   check(!!manifest,'Manifest must be the first tar entry.');const record=expected.get(entry.path);check(record&&record.volume===n&&record.size===entry.size&&record.sha256===entry.sha256&&!seen.has(entry.path),'Tar entry does not match the manifest: '+entry.path);seen.add(entry.path);
   if(n===1&&manifest.payloadIndex.includes(entry.path)){const data=text(await entry.read());for(const line of data.split('\n')){if(!line)continue;const row=JSON.parse(line);safePath(row.path);check(row.path.startsWith('data/')&&!expected.has(row.path)&&int(row.size)&&HEX.test(row.sha256)&&int(row.volume)&&row.volume>=2&&row.volume<=manifest.volumes.length,'Invalid payload index row.');expected.set(row.path,{...row});}}
   if(n>1&&entry.size<=256*1024){const packs=manifest.parts.filter(p=>/^pack\.\d+$/.test(p.path));if(packState.index<packs.length){const pack=packs[packState.index];if(packState.size===0)packState.start=entry.start;packState.size+=entry.end-entry.start;check(packState.size<=pack.size,'Invalid payload pack boundary.');if(packState.size===pack.size){check(await digest(h,packState.start,pack.size)===pack.sha256,'Payload pack digest mismatch.');packState.index++;packState.size=0;}}}
  });check(packState.size===0,'Payload pack crosses a volume boundary.');if(n===1){check(!!raw,'Manifest is missing.');check(manifest.volumes[0].bytes===volume.bytes,'Manifest volume length mismatch.');}return manifest;
 }finally{await h.close();}
}
async function requestRange(io,url,token,offset,length,etag,signal){
 for(let attempt=0;;attempt++){
  signal?.throwIfAborted();const response=await io.fetch(url,{headers:{Authorization:'Bearer '+token,Range:`bytes=${offset}-${offset+length-1}`,...etag?{'If-Range':etag}:{}},redirect:'error',signal});
  if([429,502,503,504].includes(response.status)&&attempt<3){const retry=Number(response.headers.get('Retry-After'));await response.body?.cancel();await io.wait(Math.min(10000,Math.max(250,Number.isFinite(retry)?retry*1000:250*2**attempt)),signal);continue;}
  if(response.status===403){await response.body?.cancel();fail('export_access_refused','The export is delayed or download authority was refused. Check the job status before retrying.');}
  if(response.status===401){await response.body?.cancel();fail('export_grant_required','The grant expired or was revoked. Mint a new grant for this job and resume.');}
  const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range')??''),observed=response.headers.get('ETag');
  if(response.status!==206||!match||Number(match[1])!==offset||!int(Number(match[3]))||Number(match[2])!==Math.min(offset+length,Number(match[3]))-1||etag&&observed!==etag){await response.body?.cancel();fail('export_range_mismatch','The server did not return the exact immutable range (206 required).');}
  const size=Number(match[2])-offset+1;check(size>0&&size<=length&&Number(response.headers.get('Content-Length'))===size,'Invalid range length.');
  const reader=response.body.getReader(),chunks=[];let received=0;try{for(;;){const {done,value}=await reader.read();if(done)break;received+=value.length;check(received<=size,'Oversized range response.');chunks.push(value);}check(received===size,'Truncated range response.');}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  return {bytes:Buffer.concat(chunks),total:Number(match[3]),etag:observed};
 }
}
export function nodeExportDownloadPorts(){return {open,mkdir,lstat,rename,unlink,realpath,uuid:randomUUID,pid:process.pid,probeProcess:pid=>process.kill(pid,0),fetch:(...args)=>fetch(...args),async wait(ms,signal){const {setTimeout}=await import('node:timers/promises');await setTimeout(ms,undefined,{signal});}};}
export class DownloadBindleExport extends AppAction {
 static operation='exports.cli-download';static deps=['config'];
 async run({config}){
  const {origin,job,out,token,rootDigest:expectedRoot,signal}=this.input??{},grant=parseExportGrant(token),url=new URL(origin),io=config.exportDownloadPorts;
  check(url.origin===origin&&!url.username&&!url.password&&(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)),'Use an HTTPS origin (HTTP is allowed only on loopback).');check(grant&&grant.jobId===job,'The CLI grant must belong to this job.');check(typeof out==='string'&&out.length>0&&(!expectedRoot||HEX.test(expectedRoot)),'Provide an output directory and valid root digest.');
  const target=resolve(out);await io.mkdir(target,{recursive:true,mode:0o700});check((await io.lstat(target)).isDirectory()&&!(await io.lstat(target)).isSymbolicLink(),'Output directory cannot be a symlink.');const root=await io.realpath(target),lock=await acquireLock(io,root);let state;
  try{
   // No grant or cookie is persisted. A checkpoint pins the authenticated root
   // and chunk hashes; every completed local chunk is rehashed on every run.
   try{const h=await file(io,join(root,CP));try{check((await h.stat()).size<=MAX_JSON,'Checkpoint exceeds the bound.');state=JSON.parse(text(await h.readFile()));}finally{await h.close();}}catch(error){if(error.code!=='ENOENT')throw error;}
   if(state){check(state.origin===origin&&state.job===job&&state.owner===grant.owner&&(!expectedRoot||state.rootDigest===expectedRoot),'Checkpoint belongs to another export.');await validateCheckpoint(io,root,state);}
   const expected=new Map(),seen=new Set(),packState={index:0,size:0};let manifest;
   for(let n=1;n<=(manifest?.volumes.length??1);n++){
    const existing=state?.volumes[n],path=await volumePath(io,root,n),h=await downloadFile(io,path,existing);let offset=existing?.chunks.reduce((s,c)=>s+c.size,0)??0,total=existing?.bytes??manifest?.volumes[n-1].bytes;
    try{while(total===undefined||offset<total){
      const etag=state?`"${state.rootDigest}-${n}"`:undefined,chunk=await requestRange(io,origin+`/api/exports/${job}/volumes/${n}.tar`,token,offset,Math.min(CHUNK,total===undefined?CHUNK:total-offset),etag,signal),m=new RegExp('^"([a-f0-9]{64})-'+n+'"$').exec(chunk.etag??'');
      check(m&&(!state||m[1]===state.rootDigest)&&(!expectedRoot||m[1]===expectedRoot),'Export root digest changed.');check(total===undefined||chunk.total===total,'Export volume length changed.');total=chunk.total;
      state??={v:1,origin,job,owner:grant.owner,rootDigest:m[1],volumes:{}};const v=state.volumes[n]??={bytes:total,chunks:[]};if(!v.chunks.length)await save(io,root,state);
      let used=0;while(used<chunk.bytes.length){const {bytesWritten}=await h.write(chunk.bytes,used,chunk.bytes.length-used,offset+used);check(bytesWritten>0,'Could not write output.');used+=bytesWritten;}await h.sync();v.chunks.push({size:chunk.bytes.length,sha256:hash(chunk.bytes)});offset+=chunk.bytes.length;await save(io,root,state);
     }}finally{await h.close();}
    manifest=await verifyVolume(io,root,state,n,manifest,expected,seen,packState);check(manifest.volumes[n-1].bytes===state.volumes[n].bytes,'Manifest volume length mismatch.');
   }
   check([...expected.keys()].every(path=>seen.has(path)),'The export is missing a manifest entry.');check(packState.index===manifest.parts.filter(p=>/^pack\.\d+$/.test(p.path)).length,'Missing payload pack.');check(Object.keys(state.volumes).length===manifest.volumes.length,'Unexpected checkpoint volume.');
   // Publish fixed filenames only after every manifest entry verifies. Resume
   // tolerates a crash between these renames and the completion checkpoint.
   for(const v of manifest.volumes){const source=await volumePath(io,root,v.n),destination=join(root,`volume-${v.n}.tar`);if(source!==destination)await io.rename(source,destination);}
   state.verified=true;await save(io,root,state);return {verified:true,job,rootDigest:state.rootDigest,volumes:manifest.volumes.length,directory:root};
  }finally{await lock.close();await io.unlink(join(root,LOCK));}
 }
}
export async function downloadBindleExport(input,{io=nodeExportDownloadPorts()}={}){const engine=createAppEngine({providers:{clock:systemClock,random:cryptoRandom,audit:nullAudit,config:{exportDownloadPorts:io}}});try{return await perform(engine,new DownloadBindleExport({input}));}finally{await engine.dispose();}}
async function main(){
 const args=process.argv.slice(2),options={};if(args.includes('--help')){process.stdout.write('node scripts/bindle-export.mjs --origin https://host.example --job <uuid> --out ./backup [--grant-file file] [--root-digest sha256]\nSet BINDLE_EXPORT_GRANT to the token from POST /api/exports/:job/grants (owner session, CSRF and fresh step-up). Repeat to resume; all tar entries and saved chunks are rehashed. Verified archives are volume-N.tar; checkpoint verified:true is the completion receipt. No extraction is performed.\n');return;}
 for(let i=0;i<args.length;i+=2){const key=args[i];if(!['--origin','--job','--out','--grant-file','--root-digest'].includes(key)||!args[i+1]||Object.hasOwn(options,key))fail('invalid_arguments','Use --help for usage.');options[key]=args[i+1];}
 const io=nodeExportDownloadPorts();let token=process.env.BINDLE_EXPORT_GRANT;if(options['--grant-file']){const h=await file(io,resolve(options['--grant-file']));try{const s=await h.stat();check(!(s.mode&0o077)&&s.size<4096,'Grant file must be private (0600) and small.');token=(await h.readFile('utf8')).trim();}finally{await h.close();}}
 const abort=new AbortController(),stop=()=>abort.abort(new Error('Download interrupted; repeat the command to resume.'));process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{const result=await downloadBindleExport({origin:options['--origin'],job:options['--job'],out:options['--out'],rootDigest:options['--root-digest'],token,signal:abort.signal});process.stdout.write(JSON.stringify(result)+'\n');}finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{process.stderr.write((error.code??'export_failed')+': '+(error.message?.includes('bex1.')?'Export failed.':error.message)+'\n');process.exitCode=1;});
