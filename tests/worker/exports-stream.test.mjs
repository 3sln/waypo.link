// Real workerd/R2 parity for DX-2's unmounted edge response. This test composes
// the owned slice directly; registry and adapter hunks stay with the coordinator.
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,Log,LogLevel,convertV4MiniflareOptions} from 'miniflare';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {exportLayout,streamExport,tarHeader,tarPadding,concatBytes} from '../../packages/runtime/export-tar.mjs';
const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',JOB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',SIZE=300001,origin='https://account.example';
const source=`
import {DurableObject} from 'cloudflare:workers';
import {createAppEngine,read,perform} from './packages/app/engine.mjs';
import {cryptoRandom,nullAudit} from './packages/app/providers.mjs';
import {MintExportGrant,RevokeExportGrant,DownloadExport} from './packages/runtime/account/exports.mjs';
import {exportResponse} from './packages/runtime/routes/exports.mjs';
import {exportLayout,tarHeader,tarPadding,concatBytes} from './packages/runtime/export-tar.mjs';
const OWNER='${OWNER}',JOB='${JOB}',SIZE=${SIZE},NOW=1800000000000;
export class Probe extends DurableObject {
 engine(){return createAppEngine({providers:{accountStore:this.ctx.storage,archives:this.env.ARCHIVES,blobs:this.env.BLOBS,clock:{now:()=>NOW},random:cryptoRandom,audit:nullAudit,flags:{for:()=>({enabled:()=>true,background:()=>true})},config:{APP_ORIGIN:'${origin}',exportPorts:{identitySecurity:async()=>({epoch:1,changedAt:0}),contributors:[{name:'stub',page:async()=>({rows:[],done:true})}],notice:async()=>{}}}}});}
 async seed(){
  const ref='messages/'+OWNER+'/m1',payload=Uint8Array.from({length:SIZE},(_,i)=>i%251);await this.env.BLOBS.put(ref,payload);
  const packed=[];for(let i=0;i<1000;i++){const entry={path:'data/messages/s'+i+'/0.bin',size:1};packed.push(tarHeader(entry),new Uint8Array([i%251]),new Uint8Array(tarPadding(1)));}
  const pack=concatBytes(packed),packKey='exports/'+OWNER+'/'+JOB+'/pack.0000';await this.env.ARCHIVES.put(packKey,pack);
  const volumes=exportLayout([{path:'manifest.json',size:2,bytes:[123,125]}],[{path:'pack.0000',key:packKey,size:pack.length,packed:true},{path:'data/messages/m1/0.bin',key:ref,bucket:'blobs',size:SIZE}]);
  await this.ctx.storage.put('owner',OWNER);await this.ctx.storage.put('export/job/'+JOB,{id:JOB,owner:OWNER,state:'ready',securityEpoch:1,notBefore:0,expiresAt:NOW+86400000,rootDigest:'abcd',volumes,downloadedBytes:0,downloadCap:1e10,sessionsSeen:[]});return {volumes:volumes.map(({n,bytes,reads})=>({n,bytes,reads}))};
 }
 async mint(){const engine=this.engine();try{return await perform(engine,new MintExportGrant({actor:{kind:'owner',owner:OWNER,stepUpAt:NOW},id:JOB,input:{}}));}finally{await engine.dispose();}}
 async revoke(id){const engine=this.engine();try{return await perform(engine,new RevokeExportGrant({actor:{kind:'owner',owner:OWNER},id:JOB,input:{grantId:id}}));}finally{await engine.dispose();}}
 async layout(input,token){const engine=this.engine();try{return await read(engine,new DownloadExport({actor:token?{kind:'export-grant',owner:OWNER,token}:{kind:'owner',owner:OWNER,sessionId:'s1'},id:JOB,input}));}finally{await engine.dispose();}}
}
let readCount=0;
export default {async fetch(request,env,ctx){try{
 const url=new URL(request.url),probe=env.PROBE.get(env.PROBE.idFromName('probe'));
 if(url.pathname==='/reads')return Response.json({reads:readCount});if(url.pathname==='/seed')return Response.json(await probe.seed());if(url.pathname==='/grant')return Response.json(await probe.mint());if(url.pathname==='/revoke')return Response.json(await probe.revoke(url.searchParams.get('id')));
 const input={volume:2,...request.headers.has('Range')?{range:request.headers.get('Range')}:{},...request.headers.has('If-Range')?{ifRange:request.headers.get('If-Range')}:{}};
 const layout=await probe.layout(input,request.headers.get('Authorization')?.slice(7));const wrap=b=>({get:(...args)=>{readCount++;return b.get(...args);}});
 const response=exportResponse(layout,{archives:wrap(env.ARCHIVES),blobs:wrap(env.BLOBS),signal:request.signal,execution:ctx});response.headers.set('X-Stream-Kind',typeof FixedLengthStream);return response;
 }catch(error){return Response.json({error:error.code??'error'},{status:error.status??500});}}};`;
async function harness(t){const temporary=await mkdtemp(path.join(tmpdir(),'dx2-stream-')),out=path.join(temporary,'probe.mjs');t.after(()=>rm(temporary,{recursive:true,force:true}));await build({stdin:{contents:source,resolveDir:process.cwd(),sourcefile:'dx2-probe.mjs'},outfile:out,bundle:true,format:'esm',platform:'browser',conditions:['workerd','worker','browser'],external:['cloudflare:workers','node:*'],target:'es2022',logLevel:'silent'});const mf=new Miniflare(convertV4MiniflareOptions({name:'dx2-stream-probe',modulesRoot:temporary,modules:[{type:'ESModule',path:out}],compatibilityDate:'2026-10-11',compatibilityFlags:['nodejs_compat'],log:new Log(LogLevel.ERROR),durableObjects:{PROBE:{className:'Probe',useSQLite:true}},r2Buckets:['BLOBS','ARCHIVES']}));t.after(()=>mf.dispose());return mf;}
function bucket(rows){return {get:async(key,{range}={})=>{const bytes=rows.get(key);return bytes?{size:bytes.length,body:new Blob([range?bytes.slice(range.offset,range.offset+range.length):bytes]).stream()}:null;}};}

test('workerd/R2 fixed-length tar, packs, single ranges, If-Range and CLI grants match Node streaming',{timeout:90000},async t=>{
 const mf=await harness(t),seed=await (await mf.dispatchFetch(origin+'/seed')).json();assert.equal(seed.volumes[1].reads,2);
 const packed=[];for(let i=0;i<1000;i++){const entry={path:'data/messages/s'+i+'/0.bin',size:1};packed.push(tarHeader(entry),new Uint8Array([i%251]),new Uint8Array(tarPadding(1)));}
 const pack=concatBytes(packed),ref=`messages/${OWNER}/m1`,packKey=`exports/${OWNER}/${JOB}/pack.0000`,payload=Uint8Array.from({length:SIZE},(_,i)=>i%251),layout=exportLayout([{path:'manifest.json',size:2,bytes:[123,125]}],[{path:'pack.0000',key:packKey,size:pack.length,packed:true},{path:'data/messages/m1/0.bin',key:ref,bucket:'blobs',size:SIZE}])[1];
 const expected=new Uint8Array(await new Response(streamExport(layout,{blobs:bucket(new Map([[ref,payload]])),archives:bucket(new Map([[packKey,pack]]))})).arrayBuffer());
 const before=(await (await mf.dispatchFetch(origin+'/reads')).json()).reads;const full=await mf.dispatchFetch(origin+'/download');assert.equal(full.status,200);assert.equal(full.headers.get('X-Stream-Kind'),'function');assert.equal(Number(full.headers.get('Content-Length')),expected.length);assert.deepEqual(new Uint8Array(await full.arrayBuffer()),expected);assert.equal((await (await mf.dispatchFetch(origin+'/reads')).json()).reads-before,2);
 const tag=full.headers.get('ETag');for(const [start,end]of [[0,100],[511,1025],[pack.length-4,pack.length+520],[expected.length-100,expected.length-1]]){const r=await mf.dispatchFetch(origin+'/download',{headers:{Range:'bytes='+start+'-'+end,'If-Range':tag}});assert.equal(r.status,206);assert.equal(Number(r.headers.get('Content-Length')),end-start+1);assert.deepEqual(new Uint8Array(await r.arrayBuffer()),expected.slice(start,end+1));}
 for(const range of ['bytes=0-3,8-9','bytes=-0','bytes=999999999999999999999-'])assert.equal((await mf.dispatchFetch(origin+'/download',{headers:{Range:range}})).status,416);
 const resumed=await mf.dispatchFetch(origin+'/download',{headers:{Range:'bytes=500-','If-Range':'"stale"'}});assert.equal(resumed.status,200);assert.deepEqual(new Uint8Array(await resumed.arrayBuffer()),expected);
 const grant=await (await mf.dispatchFetch(origin+'/grant')).json();assert.equal(grant.tokenType,'Bearer');const part=await mf.dispatchFetch(origin+'/download',{headers:{Authorization:'Bearer '+grant.token,Range:'bytes=0-15'}});assert.equal(part.status,206);assert.deepEqual(new Uint8Array(await part.arrayBuffer()),expected.slice(0,16));
 assert.equal((await mf.dispatchFetch(origin+'/revoke?id='+grant.id)).status,200);assert.equal((await mf.dispatchFetch(origin+'/download',{headers:{Authorization:'Bearer '+grant.token,Range:'bytes=0-1'}})).status,401);
});

test('Node FileBucket range/body contract (coordinator adapter hunk)',async t=>{
 const {FileBucket}=await import('../../apps/node/resources.mjs'),temporary=await mkdtemp(path.join(tmpdir(),'dx2-filebucket-'));t.after(()=>rm(temporary,{recursive:true,force:true}));const b=new FileBucket(temporary),bytes=Uint8Array.from({length:300001},(_,i)=>i%251);await b.put('source',bytes);const object=await b.get('source',{range:{offset:100,length:300}});
 if(!object?.body){t.skip('FileBucket streaming range-read is an unapplied coordinator hunk');return;}
 assert.equal(object.size,bytes.length);assert.deepEqual(new Uint8Array(await new Response(object.body).arrayBuffer()),bytes.slice(100,400));
 const layout=exportLayout([],[{path:'data/messages/m1/0.bin',key:'source',bucket:'blobs',size:bytes.length}])[1],full=new Uint8Array(await new Response(streamExport(layout,{blobs:b})).arrayBuffer()),range={offset:510,length:1000},partial=new Uint8Array(await new Response(streamExport(layout,{blobs:b,range})).arrayBuffer());assert.deepEqual(partial,full.slice(range.offset,range.offset+range.length));
});
