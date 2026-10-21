// DX-1: deterministic virtual POSIX tar. Layouts contain private bucket keys and
// stay behind the account/edge authorization boundary; only manifest paths leave it.
import {fault} from '../app/faults.mjs';
const encoder=new TextEncoder(),BLOCK=512;
export const EXPORT_VOLUME_BYTES=2*1024**3,EXPORT_VOLUME_READS=900;
export const tarPadding=size=>(BLOCK-size%BLOCK)%BLOCK;
const integer=n=>Number.isSafeInteger(n)&&n>=0;
export function exportPath(path){if(typeof path!=='string'||!path||!/^[\x20-\x7e]+$/.test(path)||path.startsWith('/')||path.includes('\\')||path.split('/').some(s=>!s||s==='.'||s==='..'))fault('invalid_export_path','Invalid archive path.',400);return path;}
export function concatBytes(chunks){const out=new Uint8Array(chunks.reduce((n,b)=>n+b.length,0));let at=0;for(const b of chunks){out.set(b,at);at+=b.length;}return out;}
function ustar(path){if(path.length<=100)return {name:path,prefix:''};for(let i=path.length-1;i>=0;i--)if(path[i]==='/'&&i<=155&&path.length-i-1<=100)return {name:path.slice(i+1),prefix:path.slice(0,i)};return null;}
function header(path,size,{prefix='',type='0'}={}){
 const bytes=new Uint8Array(BLOCK),write=(at,text)=>bytes.set(encoder.encode(text),at),octal=(at,length,n)=>write(at,n.toString(8).padStart(length-1,'0')+'\0');
 write(0,path);octal(100,8,0o600);octal(108,8,0);octal(116,8,0);octal(124,12,size);octal(136,12,0);bytes.fill(32,148,156);write(156,type);write(257,'ustar\0');write(263,'00');write(345,prefix);const sum=bytes.reduce((n,b)=>n+b,0);write(148,sum.toString(8).padStart(6,'0')+'\0 ');return bytes;
}
function paxLine(key,value){const body=` ${key}=${value}\n`;let size=body.length+1;while(String(size).length+body.length!==size)size=String(size).length+body.length;return String(size)+body;}
export function tarHeader(entry){
 const path=exportPath(entry.path),size=entry.size;if(!integer(size))fault('invalid_export_size','Invalid archive size.',400);
 const split=ustar(path),large=size>0o77777777777,pax=(!split?paxLine('path',path):'')+(large?paxLine('size',String(size)):'');
 const ordinary=header(split?.name??'entry',large?0:size,{prefix:split?.prefix??''});if(!pax)return ordinary;
 const data=encoder.encode(pax);return concatBytes([header('PaxHeaders/entry',data.length,{type:'x'}),data,new Uint8Array(tarPadding(data.length)),ordinary]);
}
export const tarEntryBytes=entry=>tarHeader(entry).length+entry.size+tarPadding(entry.size);
function volume(entries,n){
 let offset=0,reads=0;const segments=[];
 for(const entry of entries){
  if(entry.packed){segments.push({type:'object',offset,size:entry.size,objectSize:entry.size,bucket:'archives',key:entry.key,entry:entry.path});offset+=entry.size;reads++;continue;}
  const h=tarHeader(entry);segments.push({type:'header',offset,size:h.length,entry});offset+=h.length;
  if(entry.key){segments.push({type:'object',offset,size:entry.size,objectSize:entry.size,bucket:entry.bucket??'archives',key:entry.key,entry:entry.path});reads++;}
  else segments.push({type:'inline',offset,size:entry.size,bytes:entry.bytes});
  offset+=entry.size;const padding=tarPadding(entry.size);if(padding)segments.push({type:'zero',offset,size:padding});offset+=padding;
 }
 segments.push({type:'zero',offset,size:1024});return {n,bytes:offset+1024,reads,firstEntry:entries[0]?.firstEntry??entries[0]?.path??null,lastEntry:entries.at(-1)?.lastEntry??entries.at(-1)?.path??null,segments};
}
/** Volume 1 is metadata only. Each later volume contains payloads only. A single
 * oversize entry gets its own volume; it is never buffered or truncated. */
export function exportLayout(metadata,payloads=[],{volumeBytes=EXPORT_VOLUME_BYTES,maxReads=EXPORT_VOLUME_READS}={}){
 if(!integer(volumeBytes)||volumeBytes<1024||!integer(maxReads)||maxReads<1)throw new TypeError('Invalid export volume limits');
 const seen=new Set();for(const entry of [...metadata,...payloads]){exportPath(entry.path);if(seen.has(entry.path))fault('export_path_collision','Archive paths collide.',409);seen.add(entry.path);}
 const first=volume(metadata,1);if(first.bytes>volumeBytes||first.reads>maxReads)fault('export_metadata_limit','Export metadata exceeds one volume.',409);
 const result=[first];let entries=[],bytes=1024,reads=0;
 for(const entry of payloads){const size=entry.packed?entry.size:tarEntryBytes(entry),cost=entry.key?1:0;if(entries.length&&(bytes+size>volumeBytes||reads+cost>maxReads)){result.push(volume(entries,result.length+1));entries=[];bytes=1024;reads=0;}entries.push(entry);bytes+=size;reads+=cost;}
 if(entries.length)result.push(volume(entries,result.length+1));return result;
}
export function exportRange(value,size){
 if(!integer(size)||size===0)fault('range_not_satisfiable','Range is not satisfiable.',416);
 if(value===undefined||value===null)return {offset:0,length:size};
 const match=typeof value==='string'&&/^bytes=(\d*)-(\d*)$/.exec(value);if(!match||!match[1]&&!match[2])fault('range_not_satisfiable','Use a single byte range.',416);
 const start=match[1]?Number(match[1]):null,end=match[2]?Number(match[2]):null;
 if(start!==null&&!integer(start)||end!==null&&!integer(end)||start===null&&end===0||start!==null&&(start>=size||end!==null&&end<start))fault('range_not_satisfiable','Range is not satisfiable.',416);
 const offset=start===null?Math.max(0,size-end):start,last=start===null||end===null?size-1:Math.min(end,size-1);return {offset,length:last-offset+1};
}
export function mapExportRange(layout,range={offset:0,length:layout.bytes}){
 if(!integer(range.offset)||!integer(range.length)||range.length<1||range.offset+range.length>layout.bytes)fault('range_not_satisfiable','Range is not satisfiable.',416);
 const end=range.offset+range.length;return layout.segments.filter(s=>s.offset<end&&s.offset+s.size>range.offset).map(s=>({...s,skip:Math.max(0,range.offset-s.offset),take:Math.min(end,s.offset+s.size)-Math.max(range.offset,s.offset)}));
}
/** One get per intersected object, including header-only ranges. Verify the
 * observed full object size BEFORE emitting its header, then copy exactly the
 * requested bytes. A short/missing/rewritten source errors, never zero pads. */
export function streamExport(layout,{archives,blobs,range}={}){
 const slices=mapExportRange(layout,range),objects=new Map();
 async function obtain(segment){
  const key=segment.bucket+'\0'+segment.key;if(objects.has(key))return objects.get(key);
  const data=slices.find(s=>s.type==='object'&&s.bucket===segment.bucket&&s.key===segment.key),offset=data?.skip??0,length=data?.take??Math.min(1,segment.objectSize);
  const object=await ({archives,blobs}[segment.bucket]).get(segment.key,{range:{offset,length}});
  if(!object||object.size!==segment.objectSize)fault('export_payload_changed','An export object is missing or changed.',409);
  if(!object.body)fault('export_stream_unavailable','A streaming bucket is required.',503);objects.set(key,object);return object;
 }
 async function* chunks(){try{
  for(const s of slices){
   if(s.type==='header'){
    const entry=s.entry;if(entry.key)await obtain({bucket:entry.bucket??'archives',key:entry.key,objectSize:entry.size});yield tarHeader(entry).subarray(s.skip,s.skip+s.take);
   }else if(s.type==='inline')yield new Uint8Array(s.bytes).subarray(s.skip,s.skip+s.take);
   else if(s.type==='zero'){let left=s.take;while(left){const n=Math.min(left,65536);yield new Uint8Array(n);left-=n;}}
   else {const object=await obtain(s),reader=object.body.getReader();let remaining=s.take;try{for(;;){const {done,value}=await reader.read();if(done)break;if(value.byteLength>remaining)fault('export_payload_changed','An export object changed length.',409);remaining-=value.byteLength;yield value;}if(remaining)fault('export_payload_changed','An export object changed length.',409);}finally{reader.releaseLock();}}
  }
 }finally{for(const object of objects.values())if(!object.body.locked)await object.body.cancel().catch(()=>{});}}
 const iterator=chunks();return new ReadableStream({async pull(controller){try{const next=await iterator.next();if(next.done)controller.close();else controller.enqueue(next.value);}catch(error){controller.error(error);await iterator.return();}},async cancel(){await iterator.return();}});
}
