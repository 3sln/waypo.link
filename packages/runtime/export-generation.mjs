// DX-1 resource behind exports.*. Account/HTTP registration belongs to DX-2.
// Injected ports are trusted composition inputs, never request documents:
// {identitySecurity(owner), contributors:[{name,version,page({owner,cursor,limit})}],
//  digest:{sha256(bytes|ReadableStream)}, quota(owner)->bytes, notice(event)}.
// notice is an idempotent security-event port: append the owner audit event;
// created/downloaded additionally notify confirmed channels. Its operationId is
// stable across lost replies. Cancellation needs the audit event only.
// The adapter supplies fresh step-up evidence on the actor, not in wire input.
import {Provider} from '../../vendor/ngin/index.js';
import {fault} from '../app/faults.mjs';
import {UUID,canonical} from '../core/primitives.mjs';
import {concatBytes,tarHeader,tarPadding,exportLayout,exportRange,mapExportRange,exportPath} from './export-tar.mjs';
import {EXPORT_EXCLUDED_PREFIXES,createExportContributors} from './export-contributors.mjs';
const DAY=86400000,ACTIVE='export/active',HISTORY='export/history',JOB='export/job/',PIN='export/pin/',PIN_INDEX='export/pins/',PATH='export/path/',encoder=new TextEncoder();
export const EXPORT_PART_BYTES=16*1024**2,EXPORT_PACK_THRESHOLD=256*1024,EXPORT_TTL=7*DAY;
const terminal=state=>['cancelled','expired','failed'].includes(state),int=n=>Number.isSafeInteger(n)&&n>=0;
const clean=value=>JSON.parse(JSON.stringify(value)),json=value=>encoder.encode(canonical(clean(value))),line=value=>encoder.encode(canonical(clean(value))+'\n'),pad=n=>String(n).padStart(4,'0');
const safeJob=job=>job?Object.fromEntries(['v','id','owner','purpose','createdAt','notBefore','state','payloads','counts','sealedAt','expiresAt','downloadedBytes','downloadCap','rootDigest','failure','cleanupPending'].filter(k=>job[k]!==undefined).map(k=>[k,structuredClone(job[k])]).concat([['volumes',(job.volumes??[]).map(({n,bytes,firstEntry,lastEntry})=>({n,bytes,firstEntry,lastEntry}))]])):null;
const unavailable=()=>fault('export_unavailable','The export service is unavailable.',503);
export function createExportDigest(){return {async sha256(source){
 const stream=source instanceof ReadableStream?source:new Blob([source]).stream();
 if(typeof crypto.DigestStream==='function'){const digest=new crypto.DigestStream('SHA-256');await stream.pipeTo(digest);return [...new Uint8Array(await digest.digest)].map(v=>v.toString(16).padStart(2,'0')).join('');}
 const {createHash}=await import('node:crypto'),hash=createHash('sha256');for await(const chunk of stream)hash.update(chunk);return hash.digest('hex');
}};}
/** Catalogue registration is a coordinator hunk. The streaming implementation
 * is usable as a normal injected ngin provider in both platform compositions. */
export class ExportDigestProvider extends Provider {obtain(){return createExportDigest();}release(){}}
export class AccountExport {
 constructor({accountStore,archives,blobs,clock,random,flags,config={},...ports}){
  Object.assign(this,{store:accountStore,archives,blobs,clock,random,flags,...ports});this.issuer=config.APP_ORIGIN;this.partBytes=EXPORT_PART_BYTES;
  this.contributors=ports.contributors??createExportContributors({accountStore,flags,quota:ports.quota,...ports.contributorPorts});
  if(!Array.isArray(this.contributors)||!this.contributors.length||new Set(this.contributors.map(c=>c.name)).size!==this.contributors.length||this.contributors.some(c=>!/^[a-z][a-z0-9-]*$/.test(c.name)||['pack','index'].includes(c.name)||!int(c.version??1)||(c.version??1)<1||typeof c.page!=='function'))throw new TypeError('Invalid export contributors');
 }
 port(owner){return this.flags.for({subject:{kind:'account',owner}});}
 async bound(tx,owner){if(await tx.get('owner')!==owner)fault('forbidden','Account owner mismatch.',403);}
 async fence(tx,owner){await this.bound(tx,owner);if(await tx.get('deletion/fence-v1')||await tx.get('lifecycle/purge-v1'))fault('account_deleting','Account deletion has begun.',410);}
 async security(owner){if(typeof this.identitySecurity!=='function')unavailable();const value=await this.identitySecurity(owner);if(!int(value?.epoch)||!int(value.changedAt)||value.changedAt>this.clock.now())unavailable();return value;}
 async get(tx,owner,id){if(typeof id!=='string'||!UUID.test(id))fault('not_found','Export not found.',404);await this.bound(tx,owner);const job=await tx.get(JOB+id);if(!job||job.owner!==owner)fault('not_found','Export not found.',404);return job;}
 async create(owner,input,actor){
  try{if(typeof this.issuer!=='string'||new URL(this.issuer).origin!==this.issuer)unavailable();}catch{unavailable();}
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['operationId','purpose'].includes(k))||!UUID.test(input.operationId??'')||input.purpose!==undefined&&input.purpose!=='owner')fault('invalid_export','Provide an export operation ID.',400);
  const now=this.clock.now();if(!int(actor.stepUpAt)||actor.stepUpAt>now||now-actor.stepUpAt>300000||actor.stepUpMethod!==undefined&&!['password','passkey'].includes(actor.stepUpMethod))fault('step_up_required','Verify your password or passkey again.',401);
  const fingerprint=canonical({purpose:input.purpose??'owner'}),security=await this.security(owner),id=this.random.uuid();
  const result=await this.store.transaction(async tx=>{
   await this.fence(tx,owner);const history=await tx.get(HISTORY)??[],receipt=history.find(h=>h.operationId===input.operationId);
   if(receipt){if(receipt.fingerprint!==fingerprint)fault('export_operation_conflict','This operation ID was already used.',409);return {job:await tx.get(JOB+receipt.id),created:false};}
   if(!this.port(owner).enabled('ACCOUNT_EXPORT_ENABLED'))fault('not_found','Not found.',404);
   if(await tx.get(ACTIVE))fault('export_active','An export is already active.',409);
   if(history.filter(h=>h.createdAt>now-7*DAY).length>=2)fault('export_rate_limited','Two exports are available per seven days.',429);
   const job={v:1,id,owner,purpose:'owner',operationId:input.operationId,fingerprint,createdAt:now,notBefore:security.changedAt?Math.max(now,security.changedAt+3*DAY):now,securityEpoch:security.epoch,state:'queued',revision:0,contributor:0,cursor:null,parts:[],buffers:{},sequences:{},payloads:{count:0,bytes:0},counts:{},payloadEntries:[],keys:[],downloadedBytes:0,sessionsSeen:[],noticePending:true};
   const receipts=[...history,{id,operationId:input.operationId,fingerprint,createdAt:now}];for(const old of receipts.slice(0,-32))await tx.delete(JOB+old.id);
   await tx.put(JOB+id,job);await tx.put(ACTIVE,id);await tx.put(HISTORY,receipts.slice(-32));return {job,created:true};
  });
  if(result.job?.noticePending)await this.deliverNotice(result.job,'export-created');return safeJob(result.job);
 }
 async deliverNotice(job,type,session){
  if(typeof this.notice!=='function')unavailable();await this.notice({type,owner:job.owner,jobId:job.id,...session?{session}:{},operationId:job.id+'/'+type+'/'+(session??'created')});
  if(type==='export-created')await this.store.transaction(async tx=>{const current=await tx.get(JOB+job.id);if(current){current.noticePending=false;await tx.put(JOB+job.id,current);}});
 }
 async list(owner){return this.store.transaction(async tx=>{await this.bound(tx,owner);const history=await tx.get(HISTORY)??[];return {jobs:(await Promise.all(history.map(h=>tx.get(JOB+h.id)))).filter(Boolean).map(safeJob)};});}
 async status(owner,id){return this.store.transaction(async tx=>safeJob(await this.get(tx,owner,id)));}
 async cancel(owner,id,state='cancelled'){
  await this.store.transaction(async tx=>{const job=await this.get(tx,owner,id);if(!terminal(job.state)){job.state=state;job.cleanupPending=true;job.revision++;await tx.put(JOB+id,job);}});
  await this.cleanup(owner,id);if(state==='cancelled')await this.deliverNotice({owner,id},'export-cancelled');return this.status(owner,id);
 }
 /** Shared E6 port for DX-3 and inactivity purge. Inject this resource as
  * ports.exports; never run a parts-only fallback against a DX-1 write intent.
  * No identity, flag targeting or notice transport is needed to erase bytes. */
 async cancelAll(owner,{budget=64}={}){
  if(!int(budget)||budget<1||budget>500)throw new TypeError('Invalid export cleanup budget');
  const jobs=await this.list(owner);let deleted=0,work=0;
  for(const job of jobs.jobs){
   if(terminal(job.state)&&!job.cleanupPending)continue;
   await this.store.transaction(async tx=>{const current=await this.get(tx,owner,job.id);if(!terminal(current.state)){current.state='cancelled';current.cleanupPending=true;current.revision++;await tx.put(JOB+job.id,current);}});
   const result=await this.cleanup(owner,job.id,{limit:budget-work});deleted+=result.deleted??0;work+=Math.max(1,result.deleted??0);
   if(result.busy)return {done:false,deleted,wakeAt:result.wakeAt};if(work>=budget)return {done:false,deleted,wakeAt:this.clock.now()+2000};
  }
  return {done:true,deleted};
 }
 async cleanup(owner,id,{limit=500}={}){
  // The write intent names every possible object before a put is attempted.
  // An in-flight writer owns its cleanup until its lease expires. Cancelling
  // never discards that intent, even when an upload has an uncertain outcome.
  const job=await this.store.transaction(tx=>this.get(tx,owner,id));if(!terminal(job.state))return {busy:false};
  if(job.writer&&job.writer.until>this.clock.now())return {busy:true,wakeAt:job.writer.until};
  const recorded=job.keys.slice(0,limit),keys=recorded.filter(key=>typeof key==='string'&&key.startsWith(`exports/${owner}/${id}/`)&&!key.includes('..')&&key.length<=1024);if(keys.length)await this.archives.delete(keys);
  return this.store.transaction(async tx=>{const current=await this.get(tx,owner,id);if(!terminal(current.state))return {busy:true};if(current.writer&&current.writer.until>this.clock.now())return {busy:true,wakeAt:current.writer.until};
   current.keys=current.keys.filter(k=>!recorded.includes(k));const pins=await tx.list({prefix:PIN_INDEX+id+'/',limit});for(const [index,key]of pins){if((await tx.get(key))?.jobId===id)await tx.delete(key);await tx.delete(index);}
   const paths=await tx.list({prefix:PATH+id+'/',limit});for(const key of paths.keys())await tx.delete(key);
   const morePins=(await tx.list({prefix:PIN_INDEX+id+'/',limit:1})).size>0,morePaths=(await tx.list({prefix:PATH+id+'/',limit:1})).size>0;current.cleanupPending=!!current.keys.length||morePins||morePaths;current.writer=null;
   if(!current.cleanupPending){current.parts=[];current.buffers={};current.payloadEntries=[];current.volumes=[];if(await tx.get(ACTIVE)===id)await tx.delete(ACTIVE);}
   await tx.put(JOB+id,current);return {busy:current.cleanupPending,deleted:keys.length,wakeAt:current.cleanupPending?this.clock.now()+2000:null};
  });
 }
 async expire(owner){const jobs=await this.list(owner);let busy=false,wakeAt=null;for(const job of jobs.jobs){let result;if(job.state==='ready'&&this.clock.now()>=job.expiresAt){const status=await this.cancel(owner,job.id,'expired');result={busy:status.cleanupPending,wakeAt:this.clock.now()+2000};}else if(job.state==='ready')wakeAt=Math.min(wakeAt??Infinity,job.expiresAt);else if(terminal(job.state)&&job.cleanupPending)result=await this.cleanup(owner,job.id);if(result?.busy){busy=true;wakeAt=Math.min(wakeAt??Infinity,result.wakeAt);}}return {busy,wakeAt};}
 async append(job,kind,bytes,writes,{packed=false,entries=[]}={}){
  const capacity=kind==='index'?Math.floor(this.partBytes*.75):this.partBytes;if(bytes.length>capacity)fault('export_row_limit','An export row exceeds the part limit.',409);
  const before=job.buffers[kind],old=before?await this.archives.get(before.key):null;if(before&&(!old||old.size!==before.size))fault('export_part_missing','An export buffer is unavailable.',503);
  const prior=old?new Uint8Array(await old.arrayBuffer()):new Uint8Array();let data=concatBytes([prior,bytes]),members=[...before?.entries??[],...entries];
  if(data.length>capacity){await this.flush(job,kind,prior,before?.entries??[],writes,packed);data=bytes;members=entries;}
  const key=this.prefix(job)+`buffer.${kind}.${job.revision%2}`;writes.push({key,bytes:data});job.buffers[kind]={key,size:data.length,packed,entries:members};
 }
 async flush(job,kind,bytes,entries,writes,packed=false){
  if(!bytes.length){delete job.buffers[kind];return;}
  const n=job.sequences[kind]??0;job.sequences[kind]=n+1;
  const path=packed?`pack.${pad(n)}`:kind==='index'?`payloads/index.${pad(n)}.jsonl`:`account/${kind}.${pad(n)}.jsonl`,key=this.prefix(job)+path,sha256=await this.digest.sha256(bytes);
  writes.push({key,bytes});const part={key,path,size:bytes.length,sha256,packed};job.parts.push(part);
  if(packed)job.payloadEntries.push({...part,entries,firstEntry:entries[0],lastEntry:entries.at(-1)});delete job.buffers[kind];
 }
 // A resumed expired lease gets a fresh physical namespace. A delayed old
 // writer can neither overwrite nor delete its successor's committed objects.
 prefix(job){return `exports/${job.owner}/${job.id}/`+(job.writeEpoch?`epoch.${job.writeEpoch}/`:'');}
 async plan(job,page,deadline){
  const writes=[],contributor=this.contributors[job.contributor];
  const metadata=concatBytes(page.rows.map(row=>line({...row,schemaVersion:contributor.version??1})));if(metadata.length)await this.append(job,contributor.name,metadata,writes);
  const index=[],pack=[],packedPaths=[];
  let processed=0;for(const payload of page.payloads??[]){
   if(processed>=32||processed&&this.clock.now()>=deadline)break;
   const object=await this.blobs.get(payload.ref);if(!object||!int(object.size)||!object.body)fault('export_payload_missing','An export payload is unavailable.',409);
   const size=object.size;
   if(size!==payload.size){
    const pinKey=PIN+await this.digest.sha256(encoder.encode(payload.ref)),quota=await this.quota(job.owner);
    await this.store.transaction(async tx=>{const current=await this.get(tx,job.owner,job.id);if(current.writer?.token!==job.writer.token||terminal(current.state))fault('export_stale','The export changed.',409);const pin=await tx.get(pinKey);if(pin?.jobId!==job.id)fault('export_stale','The export pin changed.',409);current.pinnedBytes=(current.pinnedBytes??0)+size-pin.size;if(current.pinnedBytes>quota)fault('export_pin_budget','The export pin budget was exceeded.',409);await tx.put(pinKey,{jobId:job.id,size});await tx.put(JOB+job.id,current);job.pinnedBytes=current.pinnedBytes;});
   }
   let sha256,bytes;
   if(size<=EXPORT_PACK_THRESHOLD){bytes=new Uint8Array(await new Response(object.body).arrayBuffer());if(bytes.length!==size)fault('export_payload_changed','An export payload changed length.',409);sha256=await this.digest.sha256(bytes);}
   else {let observed=0;const counted=object.body.pipeThrough(new TransformStream({transform(chunk,controller){observed+=chunk.byteLength;controller.enqueue(chunk);}}));sha256=await this.digest.sha256(counted);if(observed!==size)fault('export_payload_changed','An export payload changed length.',409);}
   const {ref,...record}=payload,entry={...record,size,sha256};index.push(line(entry));
   if(bytes){pack.push(tarHeader(entry),bytes,new Uint8Array(tarPadding(size)));packedPaths.push(entry.path);}
   else job.payloadEntries.push({path:entry.path,key:ref,size,bucket:'blobs'});
   job.payloads.count++;job.payloads.bytes+=size;processed++;
  }
  if(pack.length)await this.append(job,'pack',concatBytes(pack),writes,{packed:true,entries:packedPaths});
  if(index.length)await this.append(job,'index',concatBytes(index),writes);
  job.counts[contributor.name]??={rows:0,bytes:0};job.counts[contributor.name].rows+=page.rows.length;job.counts[contributor.name].bytes+=metadata.length;
  const remaining=(page.payloads??[]).slice(processed);job.digestCursor=job.payloads.count;
  if(remaining.length)job.pendingPage={...page,rows:[],payloads:remaining};
  else {delete job.pendingPage;job.cursor=page.cursor??null;if(page.done){job.contributor++;job.cursor=null;}if(job.contributor>=this.contributors.length)job.state='sealing';}
  return writes;
 }
 async seal(job){
  // One buffer or index part per alarm step, so sealing never buffers every
  // contributor (or a whole volume) in the isolate at once.
  const writes=[],pending=Object.entries(job.buffers)[0];
  if(pending){const [kind,buffer]=pending,object=await this.archives.get(buffer.key);if(!object||object.size!==buffer.size)fault('export_part_missing','An export buffer is unavailable.',503);await this.flush(job,kind,new Uint8Array(await object.arrayBuffer()),buffer.entries,writes,buffer.packed);return writes;}
  const indexed=job.parts.find(p=>p.path.startsWith('payloads/')&&!p.volumesAssigned);
  if(indexed){
   const assignment=new Map();for(const volume of exportLayout([],job.payloadEntries))for(const segment of volume.segments)if(segment.type==='object'){const packed=job.payloadEntries.find(p=>p.key===segment.key&&p.packed);for(const path of packed?.entries??[segment.entry])assignment.set(path,volume.n);}
   const source=await this.archives.get(indexed.key);if(!source||source.size!==indexed.size)fault('export_part_missing','An export index is unavailable.',503);
   if(!source.body)unavailable();let carry='';const decoder=new TextDecoder('utf-8',{fatal:true}),emit=(text,controller)=>{if(!text)return;const row=JSON.parse(text),volume=assignment.get(row.path);if(volume===undefined)fault('export_part_missing','An export payload has no volume.',503);controller.enqueue(line({...row,volume}));};
   const mapped=source.body.pipeThrough(new TransformStream({transform(chunk,controller){carry+=decoder.decode(chunk,{stream:true});let end;while((end=carry.indexOf('\n'))>=0){emit(carry.slice(0,end),controller);carry=carry.slice(end+1);}},flush(controller){carry+=decoder.decode();emit(carry,controller);}})),bytes=new Uint8Array(await new Response(mapped).arrayBuffer());
   if(bytes.length>this.partBytes)fault('export_row_limit','The export index exceeds the part limit.',409);
   // Keep the committed source until the new cursor commits. Retrying a failed
   // put or commit therefore cannot append duplicate index rows.
   const key=this.prefix(job)+indexed.path+'.volumes';writes.push({key,bytes});Object.assign(indexed,{key,size:bytes.length,sha256:await this.digest.sha256(bytes),volumesAssigned:true});return writes;
  }
  const readme=encoder.encode('Bindle export, format bindle-export/1.\nConsistency: paged live state, not an atomic snapshot.\nPrivate keys and authentication/capability secrets are excluded. Use the protected identity-backup workflow separately.\nConnected storage contains references and host-held mappings only; export external files and connected-app data at their providers.\nRestore semantics for app contracts and future schema versions may be unknown.\n');
  const metadata=job.parts.filter(p=>!p.packed).map(p=>({...p,bucket:'archives'})),readmePart={path:'README.txt',size:readme.length,sha256:await this.digest.sha256(readme)};
  let volumes=[],manifest,bytes=json({});
  for(let iteration=0;iteration<12;iteration++){
   const next=exportLayout([{path:'manifest.json',size:bytes.length,bytes:[...bytes]},{path:'README.txt',size:readme.length,bytes:[...readme]},...metadata],job.payloadEntries);
   volumes=next;manifest={format:'bindle-export/1',version:1,issuer:this.issuer,subject:job.owner,jobId:job.id,purpose:job.purpose,createdAt:job.createdAt,sealedAt:this.clock.now(),consistency:'paged',startedAt:job.startedAt,finishedAt:this.clock.now(),counts:job.counts,payloads:job.payloads,parts:[readmePart,...job.parts.map(({path,size,sha256})=>({path,size,sha256}))],payloadIndex:job.parts.filter(p=>p.path.startsWith('payloads/')).map(p=>p.path),volumes:next.map(({n,bytes,firstEntry,lastEntry})=>({n,bytes,firstEntry,lastEntry})),excluded:Object.entries(EXPORT_EXCLUDED_PREFIXES).map(([prefix,reason])=>({prefix,reason})),unknownRestoreSemantics:['Application-specific contracts','Future schema versions'],identityBackup:'Use the separately protected identity-backup workflow for private keys.'};
   const encoded=json(manifest);if(encoded.length===bytes.length){bytes=encoded;break;}bytes=encoded;if(iteration===11)fault('export_layout_unstable','Export layout could not be sealed.',503);
  }
  volumes[0].segments[0].entry.bytes=[...bytes];const inline=volumes[0].segments.find(s=>s.type==='inline');inline.bytes=[...bytes];
  const key=this.prefix(job)+'manifest.json';writes.push({key,bytes});job.rootDigest=await this.digest.sha256(bytes);job.volumes=volumes;job.sealedAt=this.clock.now();job.expiresAt=job.sealedAt+EXPORT_TTL;job.downloadCap=3*volumes.reduce((n,v)=>n+v.bytes,0);job.state='ready';return writes;
 }
 async step(owner){
  if(!this.port(owner).background('ACCOUNT_EXPORT_ENABLED'))return {busy:false,killed:true};
  const token=this.random.uuid(),now=this.clock.now();let job=await this.store.transaction(async tx=>{
   await this.fence(tx,owner);const id=await tx.get(ACTIVE);if(!id)return null;const current=await this.get(tx,owner,id);
   if(current.state==='ready')return {idle:true,wakeAt:current.expiresAt};if(terminal(current.state))return {cleanup:current.id};
   if(current.writer&&current.writer.until>now)return {busy:true,wakeAt:current.writer.until};
   if(current.writer)current.writeEpoch=(current.writeEpoch??0)+1;
   current.writer={token,until:now+60000};current.startedAt??=now;current.state=current.state==='queued'?'generating':current.state;await tx.put(JOB+id,current);return current;
  });
  if(!job)return {busy:false};if(job.idle)return {busy:false,wakeAt:job.wakeAt};if(job.cleanup)return this.cleanup(owner,job.cleanup);if(job.busy)return job;
  try{
   if(!this.digest||typeof this.quota!=='function')unavailable();if(job.noticePending)await this.deliverNotice(job,'export-created');
   if(job.state==='generating'){
    const page=job.pendingPage??await this.contributors[job.contributor].page({owner,cursor:job.cursor,limit:32});
    if(!Array.isArray(page.rows)||page.rows.length>500||(page.payloads??[]).length>500||page.done!==true&&canonical(page.cursor??null)===canonical(job.cursor))fault('invalid_export_page','The contributor returned an invalid page.',503);
    // Pin exact immutable refs BEFORE digest reads. The cursor and indexed pins
    // are committed together below; a crash leaves conservative provisional pins
    // which cancellation/expiry also releases, never a deletion window.
    const paths=new Set(),pageId=canonical({contributor:job.contributor,cursor:job.cursor}),pins=await Promise.all((page.payloads??[]).map(async p=>{exportPath(p.path);if(paths.has(p.path))fault('export_path_collision','Archive paths collide.',409);paths.add(p.path);if(typeof p.ref!=='string'||!p.ref.startsWith(`messages/${owner}/`)&&!p.ref.startsWith(`objects/${owner}/`)||!int(p.size))fault('export_payload_invalid','Invalid export payload reference.',409);return {key:PIN+await this.digest.sha256(encoder.encode(p.ref)),pathKey:PATH+job.id+'/'+await this.digest.sha256(encoder.encode(p.path)),size:p.size};}));
    const quota=await this.quota(owner);if(!int(quota))unavailable();await this.store.transaction(async tx=>{const current=await this.get(tx,owner,job.id);if(current.writer?.token!==token||terminal(current.state))fault('export_stale','The export changed.',409);for(const p of pins){const path=await tx.get(p.pathKey);if(path&&path.pageId!==pageId)fault('export_path_collision','Archive paths collide.',409);await tx.put(p.pathKey,{pageId});const prior=await tx.get(p.key);if(prior&&prior.jobId!==job.id)fault('export_stale','The export pin changed.',409);if(!prior){current.pinnedBytes=(current.pinnedBytes??0)+p.size;if(current.pinnedBytes>quota)fault('export_pin_budget','The export pin budget was exceeded.',409);await tx.put(p.key,{jobId:job.id,size:p.size});}await tx.put(PIN_INDEX+job.id+'/'+p.key.slice(PIN.length),p.key);}await tx.put(JOB+job.id,current);job.pinnedBytes=current.pinnedBytes;});
    job.writes=await this.plan(job,page,now+20000);
   }else job.writes=await this.seal(job);
   const writes=job.writes;delete job.writes;
   // Record exact keys, including both alternating buffer slots. A crash before
   // cursor commit reuses the old committed buffer and overwrites the other slot.
   const permitted=await this.store.transaction(async tx=>{await this.fence(tx,owner);const current=await this.get(tx,owner,job.id);if(current.writer?.token!==token||terminal(current.state))return false;current.keys=[...new Set([...current.keys,...writes.map(w=>w.key)])];await tx.put(JOB+job.id,current);job.keys=current.keys;return true;});
   if(!permitted)return {busy:true,wakeAt:now+2000};
   for(const write of writes)await this.archives.put(write.key,write.bytes);
   const committed=await this.store.transaction(async tx=>{const current=await this.get(tx,owner,job.id);if(current.writer?.token!==token||terminal(current.state)||await tx.get('deletion/fence-v1')||await tx.get('lifecycle/purge-v1'))return false;job.writer=null;job.revision++;job.noticePending=current.noticePending;await tx.put(JOB+job.id,job);return true;});
   if(!committed){await this.archives.delete(writes.map(w=>w.key));return {busy:true,wakeAt:now+2000};}
   return {busy:job.state!=='ready',wakeAt:job.state==='ready'?job.expiresAt:now+2000};
  }catch(error){
   if(['export_pin_budget','export_payload_missing','export_payload_changed','export_payload_invalid','export_row_limit','export_metadata_limit','export_path_collision'].includes(error.code))await this.store.transaction(async tx=>{const current=await this.get(tx,owner,job.id);if(current.writer?.token===token&&!terminal(current.state)){current.state='failed';current.failure=error.code;current.cleanupPending=true;await tx.put(JOB+job.id,current);}});
   throw error;
  }finally{
   await this.store.transaction(async tx=>{const current=await tx.get(JOB+job.id);if(current?.writer?.token===token){current.writer=null;await tx.put(JOB+job.id,current);}});
   const current=await this.store.get(JOB+job.id);if(current&&terminal(current.state))await this.cleanup(owner,job.id);
  }
 }
 async layout(owner,id,input={},actor){
  const security=await this.security(owner),now=this.clock.now(),session=actor.kind==='export-grant'?'grant:'+actor.grantId:'session:'+actor.sessionId;
  if(!/^(?:session|grant):[A-Za-z0-9_-]{1,200}$/.test(session)||actor.kind==='export-grant'&&actor.jobId!==id)fault('unauthorized','Download authority is required.',401);
  const result=await this.store.transaction(async tx=>{
   await this.fence(tx,owner);const job=await this.get(tx,owner,id);if(!this.port(owner).background('ACCOUNT_EXPORT_ENABLED'))unavailable();
   if(job.state!=='ready')fault('export_not_ready','The export is not ready.',409);if(now>=job.expiresAt)fault('export_expired','The export has expired.',410);if(now<job.notBefore)fault('export_not_before','The export is delayed after a security change.',403);
   if(job.securityEpoch!==security.epoch)fault('unauthorized','Security settings changed. Create a new export.',401);
   const volume=job.volumes.find(v=>v.n===input.volume);if(!volume)fault('not_found','Export volume not found.',404);
   const etag=`"${job.rootDigest}-${volume.n}"`,range=exportRange(input.ifRange&&input.ifRange!==etag?undefined:input.range,volume.bytes);
   if(job.downloadedBytes+range.length>job.downloadCap)fault('export_download_cap','The export download limit was reached.',429);
   const first=!job.sessionsSeen.includes(session);if(first&&job.sessionsSeen.length>=100)fault('export_download_cap','The export session limit was reached.',429);
   // A reservation is charged even if notice or network delivery fails. No byte
   // leaves until the notice port succeeds, including retries after a lost reply.
   job.downloadedBytes+=range.length;await tx.put(JOB+id,job);return {volume,range,etag,first};
  });
  if(result.first){await this.deliverNotice({owner,id},'export-downloaded',session);await this.store.transaction(async tx=>{const job=await this.get(tx,owner,id);if(!job.sessionsSeen.includes(session))job.sessionsSeen.push(session);await tx.put(JOB+id,job);});}
  const {volume,range,etag}=result;return {volume,range,etag,contentLength:range.length,status:input.range!==undefined&&(!input.ifRange||input.ifRange===etag)?206:200,slices:mapExportRange(volume,range)};
 }
}
