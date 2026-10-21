import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {exportLayout,exportRange,mapExportRange,streamExport,tarHeader,tarPadding,concatBytes,exportPath} from '../packages/runtime/export-tar.mjs';
import {createRandom,forEachSeed} from './helpers/chaos.mjs';
const bytes=value=>new TextEncoder().encode(value),read=stream=>new Response(stream).arrayBuffer().then(b=>new Uint8Array(b));
function bucket(rows){return {calls:[],async get(key,{range}={}){this.calls.push({key,range});const data=rows.get(key);return data?{size:data.length,body:new Blob([range?data.slice(range.offset,range.offset+range.length):data]).stream()}:null;}};}
function fixture(){const data=bytes('immutable payload'),archives=bucket(new Map([['account-part',bytes('{"id":1}\n')]])),blobs=bucket(new Map([['blob',data]])),metadata=[{path:'manifest.json',size:2,bytes:[123,125]},{path:'account/messages.0000.jsonl',key:'account-part',size:9}],payloads=[{path:'data/messages/id/0.bin',bucket:'blobs',key:'blob',size:data.length}],layout=exportLayout(metadata,payloads);return {archives,blobs,layout};}

test('deterministic ustar headers extract with native tar; pax handles unrepresentable fields',async()=>{
 const f=fixture(),full=await read(streamExport(f.layout[1],f));assert.deepEqual(full,await read(streamExport(exportLayout([{path:'manifest.json',size:2,bytes:[123,125]}],[{path:'data/messages/id/0.bin',bucket:'blobs',key:'blob',size:17}])[1],f)));
 assert.equal(execFileSync('tar',['-tf','-'],{input:full}).toString().trim(),'data/messages/id/0.bin');
 assert.equal(execFileSync('tar',['-xOf','-'],{input:full}).toString(),'immutable payload');
 const long='data/'+('a'.repeat(240))+'/item.bin',h=tarHeader({path:long,size:0});assert.equal(h[156],120);assert.ok(new TextDecoder().decode(h).includes('path='+long));
 const large=tarHeader({path:'data/huge.bin',size:2**40});assert.ok(new TextDecoder().decode(large).includes('size=1099511627776'));assert.deepEqual(large,tarHeader({path:'data/huge.bin',size:2**40}));
});

test('seeded arbitrary ranges equal full-volume slices at headers, data, padding and boundaries',async()=>{
 await forEachSeed(40,async random=>{
  const f=fixture();for(const layout of f.layout){const full=await read(streamExport(layout,f));for(let i=0;i<12;i++){const offset=random.int(full.length),length=1+random.int(full.length-offset),range={offset,length};assert.deepEqual(await read(streamExport(layout,{...f,range})),full.slice(offset,offset+length));assert.equal(mapExportRange(layout,range).reduce((n,s)=>n+s.take,0),length);}}
 });
 const f=fixture(),layout=f.layout[1],full=await read(streamExport(layout,f));for(const offset of [0,1,511,512,528,529,530,1023,1024,1535])if(offset<full.length)assert.deepEqual(await read(streamExport(layout,{...f,range:{offset,length:Math.min(600,full.length-offset)}})),full.slice(offset,offset+600));
});

test('single HTTP ranges, suffixes and invalid ranges are exact',()=>{
 assert.deepEqual(exportRange(undefined,100),{offset:0,length:100});assert.deepEqual(exportRange('bytes=3-6',100),{offset:3,length:4});assert.deepEqual(exportRange('bytes=-200',100),{offset:0,length:100});assert.deepEqual(exportRange('bytes=97-',100),{offset:97,length:3});assert.deepEqual(exportRange('bytes=97-200',100),{offset:97,length:3});
 for(const value of ['bytes=100-','bytes=8-2','bytes=-0','bytes=-','bytes=1-2,4-6','items=1-2','bytes=9007199254740992-'])assert.throws(()=>exportRange(value,100),{code:'range_not_satisfiable'});
 for(const path of ['/absolute','a/../b','a/./b','a//b','a\\b','é'])assert.throws(()=>exportPath(path));
 assert.throws(()=>exportLayout([{path:'x',size:0,bytes:[]},{path:'x',size:0,bytes:[]}]),{code:'export_path_collision'});
});

test('missing, rewritten and short objects abort before alignment can be padded',async()=>{
 for(const mode of ['missing','size','short']){
  const f=fixture();f.blobs.get=async()=>mode==='missing'?null:{size:mode==='size'?99:17,body:new Blob([bytes('short')]).stream()};
  const reader=streamExport(f.layout[1],f).getReader();if(mode==='short'){assert.equal((await reader.read()).value.length,512);assert.equal((await reader.read()).value.length,5);}await assert.rejects(reader.read(),{code:'export_payload_changed'});
 }
});

test('volumes enforce byte/read budgets, packs carry 100,000 small messages in a handful of volumes',()=>{
 const payloads=Array.from({length:1801},(_,i)=>({path:`data/${i}.bin`,key:`blob-${i}`,bucket:'blobs',size:1}));
 const layout=exportLayout([],payloads);assert.deepEqual(layout.map(v=>v.reads),[0,900,900,1]);
 const limited=exportLayout([],payloads.slice(0,5),{volumeBytes:3072,maxReads:900});assert.equal(limited.length,4);assert.ok(limited.every(v=>v.bytes<=3072));
 const segment=512+100+tarPadding(100),perPack=Math.floor(16*1024**2/segment),packs=Array.from({length:Math.ceil(100000/perPack)},(_,i)=>({packed:true,path:`pack.${i}`,key:`pack-${i}`,size:Math.min(perPack,100000-i*perPack)*segment}));
 const packed=exportLayout([],packs);assert.equal(packed.length,2);assert.ok(packed[1].reads<10);assert.equal(packed[1].bytes,100000*segment+1024);
 const huge=exportLayout([],[{path:'data/huge.bin',key:'big',size:3*1024**3}]);assert.equal(huge.length,2);assert.equal(huge[1].reads,1);
});

test('packed segments stream unchanged with one bucket read, including ranges',async()=>{
 const entry={path:'data/messages/id/0.bin',size:3},pack=concatBytes([tarHeader(entry),bytes('abc'),new Uint8Array(tarPadding(3))]),archives=bucket(new Map([['pack',pack]])),layout=exportLayout([],[{path:'pack.0000',packed:true,key:'pack',size:pack.length}])[1];
 const full=await read(streamExport(layout,{archives}));assert.equal(archives.calls.length,1);assert.equal(execFileSync('tar',['-xOf','-'],{input:full}).toString(),'abc');
 const random=createRandom(1);for(let i=0;i<30;i++){const offset=random.int(full.length),length=1+random.int(full.length-offset);assert.deepEqual(await read(streamExport(layout,{archives,range:{offset,length}})),full.slice(offset,offset+length));}
});

test('real workerd R2 streams, native DigestStream and FixedLengthStream match Node tar/range bytes',async t=>{
 const {build}=await import('esbuild'),{Miniflare,Log,LogLevel,convertV4MiniflareOptions}=await import('miniflare'),directory=await mkdtemp(join(tmpdir(),'dx1-tar-worker-')),out=join(directory,'worker.mjs');let worker;
 t.after(async()=>{await worker?.dispose();await rm(directory,{recursive:true,force:true});});
 const contents=`import {exportLayout,exportRange,streamExport} from './packages/runtime/export-tar.mjs';import {createExportDigest} from './packages/runtime/export-generation.mjs';
 export default {async fetch(request,env,ctx){let reads=0;const url=new URL(request.url),digest=createExportDigest();await env.BLOBS.put('blob',url.pathname==='/broken'?'x':'immutable payload');const blobs={get:(key,options)=>{reads++;return env.BLOBS.get(key,options);}},layout=exportLayout([],[{path:'data/messages/id/0.bin',bucket:'blobs',key:'blob',size:17}])[1];
 if(url.pathname==='/digest')return Response.json({native:typeof crypto.DigestStream,sha256:await digest.sha256(new Blob(['abc']).stream())});
 if(url.pathname==='/proof'||url.pathname==='/broken'){try{const bytes=await new Response(streamExport(layout,{blobs})).arrayBuffer();return Response.json({length:bytes.byteLength,sha256:await digest.sha256(bytes),reads});}catch(error){return Response.json({code:error.code,reads});}}
 const range=exportRange(request.headers.get('Range'),layout.bytes),fixed=new FixedLengthStream(range.length);ctx.waitUntil(streamExport(layout,{blobs,range}).pipeTo(fixed.writable));return new Response(fixed.readable,{status:request.headers.has('Range')?206:200,headers:{'Content-Length':String(range.length)}});}};`;
 await build({stdin:{contents,resolveDir:process.cwd()},outfile:out,bundle:true,format:'esm',platform:'browser',external:['node:*','cloudflare:workers'],logLevel:'silent'});
 worker=new Miniflare(convertV4MiniflareOptions({name:'dx1-tar',modulesRoot:directory,modules:[{type:'ESModule',path:out}],compatibilityDate:'2026-10-11',compatibilityFlags:['nodejs_compat'],r2Buckets:['BLOBS'],log:new Log(LogLevel.ERROR)}));
 const native=await(await worker.dispatchFetch('https://export.example/digest')).json();assert.equal(native.native,'function');assert.equal(native.sha256,'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
 const f=fixture(),full=await read(streamExport(f.layout[1],f)),response=await worker.dispatchFetch('https://export.example/download',{headers:{'Accept-Encoding':'identity'}});assert.equal(response.status,200,await response.clone().text());assert.equal(Number(response.headers.get('Content-Length')),full.length);assert.deepEqual(await read(response.body),full);
 for(const value of ['bytes=1-20','bytes=500-530','bytes=512-528','bytes=529-1025','bytes=-513']){const range=exportRange(value,full.length),response=await worker.dispatchFetch('https://export.example/download',{headers:{Range:value}});assert.equal(response.status,206);assert.deepEqual(await read(response.body),full.slice(range.offset,range.offset+range.length));}
 const {createExportDigest}=await import('../packages/runtime/export-generation.mjs'),proof=await(await worker.dispatchFetch('https://export.example/proof')).json();assert.deepEqual(proof,{length:full.length,sha256:await createExportDigest().sha256(full),reads:1});assert.deepEqual(await(await worker.dispatchFetch('https://export.example/broken')).json(),{code:'export_payload_changed',reads:1});
});
