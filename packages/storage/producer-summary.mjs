// AU-S6 managed-storage attribution and retained settings. Existing records from before
// attribution and external app copies remain unknown; an empty summary is never proof of complete cleanup.
import {AppAction} from '../app/engine.mjs';
import {AppFault} from '../app/faults.mjs';
const fail=(code,message,status=409)=>{throw new AppFault(code,message,status);};
export class DeleteRemovalSettings extends AppAction{
 static operation='app-removal.delete-settings';static deps=['federation'];static changes='app-removal-settings-changed';
 constructor({authority,...options}={}){super(options);this.authority=authority;}
 async run({federation:s}){const v=this.input;if(!v||Object.keys(v).some(k=>!['removeSettings','fragment','expectedRevision'].includes(k))||v.removeSettings!==true||typeof v.fragment!=='string'||typeof v.expectedRevision!=='string')fail('invalid_request','Review the saved settings first.',400);
 const identity=await s.authenticateOwner(this.authority),subject=await s.owner(this.authority);
 return s.store.transaction(async tx=>{const path=`federation/preferences/${subject}|${v.fragment}`,row=await tx.get(path);if(!row)return {deleted:false};if(row.revision!==v.expectedRevision)fail('consent_stale','These settings changed. Review them again.');const consumers=await s.consumerSnapshot(tx,subject,v.fragment,identity.epoch);if(consumers.consumers.length)fail('settings_in_use','Other apps still use these settings. Revoke their access before deleting.');await tx.delete(path);return {deleted:true};});
 }
}

// Attribution markers live in the existing managed-object record: `producer` is the last app writer
// (an owner overwrite removes it) and `createdBy` is the creating app, preserved across overwrites. No second
// per-object record or app-specific file-name index is created; older/unmanaged objects stay unknown. Keeping
// a marker per object is a provisional deviation from RR1-M7 (docs/architecture/app-uninstall.md AU-S6).
import {Provider} from '../../vendor/ngin/index.js';
import {AppQuery,ownerOf} from '../app/engine.mjs';
import {StorageError} from './policy.mjs';
export const PRODUCER_DELETION='storage/producer-deletion/',PRODUCER_KEEP='storage/producer-keep/',PRODUCER_CURSOR_KEY='storage/producer-cursor-key',PRODUCER_LINEAGE='storage/producer-lineage/',PRODUCER_GC='storage/producer-gc';
// Per-removal bound on keep choices (one per resource plus "all"); never a connection-wide lockout.
export const KEEP_ROWS_PER_REMOVAL=128;
// Lineage: written when a concluded (forced/completed) removal record is pruned, so What's left stays reachable by
// its connection and generation. The alarm-driven sweep strips markers it covers unless an active keep protects them.
export const lineageRow=(r,now)=>({removal:r.removal,entity:r.entity,connection:r.connection,generation:r.generation,client_id:r.client_id,state:r.state,concluded_at:r.concluded_at??r.committed_at??r.started_at??null,prunedAt:now,swept:false});
const DELETABLE=['hosted','google-drive'],PERMANENT=['retention_limit','forbidden','object_limit','invalid_record','reauthorization_required'],SKIPPABLE=['not_found','conflict'];
export function producerAttribution(connection,scope={},key){
 if(typeof connection?.id!=='string'||!Number.isSafeInteger(connection.generation))return undefined;
 return {connection:connection.id,generation:connection.generation,prefix:typeof key==='string'?key.includes('/')?key.split('/')[0]+'/':'':typeof scope?.prefix==='string'&&scope.prefix.split('/').filter(Boolean)[0]?scope.prefix.split('/').filter(Boolean)[0]+'/':''};
}
// Markers for a write committing over `current` (read inside the commit transaction).
export function producerMarkers(producer,current){const createdBy=current?current.createdBy:producer?{connection:producer.connection,generation:producer.generation}:undefined;return {...producer?{producer}:{},...createdBy?{createdBy}:{}};}
export function stripProducerMarkers(record){if(!record||typeof record!=='object')return record;const {producer,createdBy,...rest}=record;return rest;}
// Re-checked inside the commit transaction: a write that started before a removal or reinstall never lands.
export async function assertLiveProducer(tx,owner,producer){const c=await tx.get('resource/'+producer.connection);if(c?.kind!=='app-connection'||c.owner!==owner||c.status!=='active'||c.generation!==producer.generation)throw new StorageError('invalid_token','The app was disconnected. Reconnect with fresh consent.',401);}
const generationOf=(marker,removal)=>marker?.connection===removal.connection&&Number.isSafeInteger(marker.generation)&&marker.generation>=0?marker.generation:null;
// null: not last written by the removed app. kept: covered by the owner's keep choice in another removal of the same connection.
export function classifyProducerObject(object,removal,keeps=[],resource){
 const last=generationOf(object?.producer,removal);if(last===null||last>removal.generation)return null;
 const created=generationOf(object.createdBy,removal);
 return {created:created!==null&&created<=removal.generation,kept:keeps.some(k=>(k.resource===null||k.resource===resource)&&(last<=k.generation||created!==null&&created<=k.generation))};
}
const roots=['hosted/','drive/object/'];
const resourceOf=path=>path.startsWith('hosted/')?path.split('/')[1]:path.split('/')[2];
const pageLimit=(value,maximum=5000)=>{if(!Number.isSafeInteger(value)||value<1||value>maximum)fail('invalid_request','Choose a bounded batch size.',400);return value;};
const utf8=value=>new TextEncoder().encode(value),b64u=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,''),unb64u=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
const empty=()=>({items:0,bytes:0});
export function deletability(binding,removal){if(!binding||binding.owner!==removal.entity||!DELETABLE.includes(binding.provider))return {deletable:false,reason:'unavailable'};if(binding.provider==='google-drive'&&binding.status!=='connected')return {deletable:false,reason:'reconnect'};return {deletable:true};}
export function aggregateProducerRows(rows,removal,{keeps=[],bindings=new Map()}={}){
 const resources=new Map();
 for(const [path,object]of rows){
  const resource=resourceOf(path),c=classifyProducerObject(object,removal,keeps,resource);if(!c)continue;
  let row=resources.get(resource);if(!row){row={resource,items:0,bytes:0,created:empty(),changed:empty(),kept:{...empty(),created:empty(),changed:empty()},prefixes:[],physicalRetention:path.startsWith('drive/'),...deletability(bindings.get(resource),removal)};resources.set(resource,row);}
  let prefix=object.producer.prefix??'',bucket=row.prefixes.find(b=>b.prefix===prefix);
  if(!bucket){if(row.prefixes.length>=64)prefix='[other]';bucket=row.prefixes.find(b=>b.prefix===prefix);if(!bucket){bucket={prefix,items:0,bytes:0};row.prefixes.push(bucket);}}
  const size=Number.isSafeInteger(object.size)&&object.size>=0?object.size:0,part=c.kept?row.kept:c.created?row.created:row.changed;
  bucket.items++;bucket.bytes+=size;row.items++;row.bytes+=size;part.items++;part.bytes+=size;if(c.kept){const k=c.created?row.kept.created:row.kept.changed;k.items++;k.bytes+=size;}
 }
 return [...resources.values()];
}
// Client-visible job projection: never the stored continuation position.
const jobView=job=>job?.action==='delete'?{action:'delete',resource:job.resource??null,complete:job.complete===true,stopped:job.stopped===true,includeChanged:job.includeChanged===true,includeKept:job.includeKept===true,totalDeleted:job.totalDeleted??0,skipped:{...job.skipped},passes:job.passes??1,at:job.at}:null;
export class ProducerSummaryService{
 constructor({metadata,deleteObject,clock={now:Date.now}}){Object.assign(this,{metadata,deleteObject,clock});}
 async removal(actor,id){const owner=ownerOf(actor);if(await this.metadata.get('owner')!==owner)fail('forbidden','Account owner mismatch.',403);let r=typeof id==='string'&&id.length<=200&&await this.metadata.get('app-removal/record/'+id);if(!r&&typeof id==='string'&&id.length<=200){const l=await this.metadata.get(PRODUCER_LINEAGE+id);if(l?.removal===id&&Number.isSafeInteger(l.generation)&&typeof l.connection==='string')r={removal:id,entity:l.entity,connection:l.connection,generation:l.generation,client_id:l.client_id,state:l.state==='completed'?'completed':'forced',pruned:true};}if(!r||r.entity!==owner)fail('not_found','Removal not found.',404);if(!['forced','completed'].includes(r.state))fail('removal_pending','Finish removing the app before reviewing retained data.');return r;}
 keepPrefix(removal,own=false){return PRODUCER_KEEP+encodeURIComponent(removal.connection)+'/'+(own?encodeURIComponent(removal.removal)+'/':'');}
 // Keep choices made in other removals of the same app connection. Bounded and fail-closed.
 async keeps(removal){const rows=await this.all(this.keepPrefix(removal));return rows.map(([,v])=>v).filter(k=>k?.action==='keep'&&k.active===true&&k.removal!==removal.removal&&k.connection===removal.connection&&Number.isSafeInteger(k.generation));}
 // Paged listing of a bounded family (keep rows are capped per removal; lineage rows are pruned by the sweep).
 async all(prefix){const out=[];let after='';for(;;){const page=[...(await this.metadata.list({prefix,startAfter:after,limit:500})).entries()];out.push(...page);if(page.length<500)return out;after=page.at(-1)[0];}}
 // A resource named by an owner action must be a current binding or appear among this removal's attributed rows.
 async knownResource(removal,resource){const binding=await this.metadata.get('resource/'+resource);if(binding)return binding.owner===removal.entity&&binding.kind!=='app-connection';for(const prefix of ['hosted/'+resource+'/','drive/object/'+resource+'/']){const rows=await this.metadata.list({prefix,limit:5000});for(const [path,o]of rows)if(resourceOf(path)===resource&&classifyProducerObject(o,removal,[],resource))return true;}return false;}
 async cursorKey(){let raw=await this.metadata.get(PRODUCER_CURSOR_KEY);if(typeof raw!=='string')raw=await this.metadata.transaction(async tx=>{const existing=await tx.get(PRODUCER_CURSOR_KEY);if(typeof existing==='string')return existing;const value=b64u(crypto.getRandomValues(new Uint8Array(32)));await tx.put(PRODUCER_CURSOR_KEY,value);return value;});return crypto.subtle.importKey('raw',unb64u(raw),'AES-GCM',false,['encrypt','decrypt']);}
 // Opaque, owner- and removal-bound: the sealed position is never readable or transplantable by a client.
 async sealCursor(removal,value){const iv=crypto.getRandomValues(new Uint8Array(12)),data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:utf8(removal.entity+'|'+removal.removal)},await this.cursorKey(),utf8(JSON.stringify(value)));return b64u(iv)+'.'+b64u(new Uint8Array(data));}
 async openCursor(removal,cursor){try{if(typeof cursor!=='string'||cursor.length>8192)throw Error();const [iv,data,...rest]=cursor.split('.');if(rest.length||!iv||!data)throw Error();const c=JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64u(iv),additionalData:utf8(removal.entity+'|'+removal.removal)},await this.cursorKey(),unb64u(data))));if(![0,1].includes(c.root)||typeof c.after!=='string'||c.after.length>4096||c.after&&!c.after.startsWith(roots[c.root]))throw Error();return c;}catch{fail('invalid_cursor','Refresh the remaining data view.',400);}}
 async scan(start,limit){let {root,after}=start,remaining=limit;const rows=[];while(root<roots.length&&remaining){const size=Math.min(remaining,200),page=await this.metadata.list({prefix:roots[root],startAfter:after,limit:size});for(const entry of page)rows.push(entry);remaining-=page.size;if(page.size<size){root++;after='';}else after=[...page.keys()].at(-1);}return {rows,next:root<roots.length?{root,after}:null};}
 async page(removal,{cursor,limit=5000}={}){limit=pageLimit(limit);const {rows,next}=await this.scan(cursor?await this.openCursor(removal,cursor):{root:0,after:''},limit);return {rows,cursor:next?await this.sealCursor(removal,next):null};}
 async summary(removal,options={}){
  const {rows,cursor}=await this.page(removal,options),keeps=await this.keeps(removal),bindings=new Map();
  for(const [path,object]of rows){const id=resourceOf(path);if(!bindings.has(id)&&classifyProducerObject(object,removal,[],id))bindings.set(id,await this.metadata.get('resource/'+id));}
  const jobs=[...(await this.metadata.list({prefix:PRODUCER_DELETION+removal.removal+'/',limit:101})).values()].map(jobView).filter(Boolean);
  const own=[...(await this.metadata.list({prefix:this.keepPrefix(removal,true),limit:101})).values()].filter(k=>k?.action==='keep').map(k=>({resource:k.resource??null,active:k.active===true,at:k.at,...k.supersededAt?{supersededAt:k.supersededAt}:{}}));
  return {...removal.pruned?{pruned:true}:{},resources:aggregateProducerRows(rows,removal,{keeps,bindings}),cursor,complete:cursor===null,coverage:'provider-managed-only',transports:['bindle','mcp'],unattributed:true,deletion:jobs.find(j=>j.resource===null)??null,deletions:jobs,keeps:own};
 }
 async act(removal,input={}){
  const {action,resource,limit=64,includeChanged=false,includeKept=false}=input??{};
  if(!['keep','delete','export'].includes(action)||resource!==undefined&&(typeof resource!=='string'||!resource||resource.length>200)||typeof includeChanged!=='boolean'||typeof includeKept!=='boolean')fail('invalid_request','Choose keep, delete, or export.',400);
  if(resource){if(!await this.knownResource(removal,resource))fail('not_found','Managed resource not found.',404);const binding=await this.metadata.get('resource/'+resource);if(action==='delete'&&!deletability(binding,removal).deletable)fail('not_deletable','This storage cannot be deleted here. Reconnect it or review it directly.',409);}
  if(action==='export')return {action,exportRequired:true};
  const suffix=resource?encodeURIComponent(resource):'~all',jobPath=PRODUCER_DELETION+removal.removal+'/'+suffix,keepPath=this.keepPrefix(removal,true)+suffix,now=this.clock.now();
  // Keep choices are stored apart from deletion checkpoints. Keeping stops an unfinished deletion of the same scope.
  if(action==='keep'){await this.metadata.transaction(async tx=>{if(!await tx.get(keepPath)&&(await tx.list({prefix:this.keepPrefix(removal,true),limit:KEEP_ROWS_PER_REMOVAL+1})).size>=KEEP_ROWS_PER_REMOVAL)fail('keep_limit','Too many saved keep choices for this removal.',409);await tx.put(keepPath,{action:'keep',removal:removal.removal,connection:removal.connection,generation:removal.generation,resource:resource??null,active:true,at:now});const job=await tx.get(jobPath);if(job?.action==='delete'&&!job.complete&&!job.stopped)await tx.put(jobPath,{...job,stopped:true,stoppedAt:now});});return {action,kept:true};}
  pageLimit(limit,200);
  const keeps=includeKept?[]:await this.keeps(removal),previous=await this.metadata.get(jobPath);
  // A completed pass is not terminal: a later request starts a new pass, so late or newly found rows are deleted.
  const resume=previous?.action==='delete'&&!previous.complete&&!previous.stopped&&previous.includeChanged===includeChanged&&previous.includeKept===includeKept,start=resume&&previous.cursor?previous.cursor:{root:0,after:''};
  // Deleting is choosing again: it supersedes this removal's own keep choice for the same scope.
  await this.metadata.transaction(async tx=>{const keep=await tx.get(keepPath);if(keep?.active){await tx.put(keepPath,{...keep,active:false,supersededAt:now});const lineage=await tx.get(PRODUCER_LINEAGE+removal.removal);if(lineage?.swept)await tx.put(PRODUCER_LINEAGE+removal.removal,{...lineage,swept:false});}const job=await tx.get(jobPath);await tx.put(jobPath,{action:'delete',removal:removal.removal,resource:resource??null,includeChanged,includeKept,cursor:start,complete:false,totalDeleted:job?.action==='delete'?job.totalDeleted??0:0,passes:(job?.action==='delete'?job.passes??0:0)+(resume?0:1),skipped:resume?{...job.skipped}:{},at:now});});
  const {rows,next}=await this.scan(start,limit),skipped={changed:0,kept:0,unavailable:0,failed:0,conflict:0},bindings=new Map();let deleted=0;
  for(const [objectPath,object]of rows){
   const id=objectPath.startsWith('hosted/')||objectPath.startsWith('drive/object/')?resourceOf(objectPath):null;if(!id||resource&&resource!==id)continue;
   const c=classifyProducerObject(object,removal,keeps,id);if(!c)continue;
   if(c.kept&&!includeKept){skipped.kept++;continue;}if(!c.created&&!includeChanged){skipped.changed++;continue;}
   if(!bindings.has(id))bindings.set(id,await this.metadata.get('resource/'+id));const binding=bindings.get(id);if(!deletability(binding,removal).deletable){skipped.unavailable++;continue;}
   // Re-read before handing off to the existing version-conditional executor; its transaction rechecks the version.
   const current=await this.metadata.get(objectPath),now2=classifyProducerObject(current,removal,keeps,id);if(!now2||current.version!==object.version||now2.created!==c.created||now2.kept!==c.kept){skipped.conflict++;continue;}
   // The executor calls `commit` inside its delete transaction, so totalDeleted counts exactly the committed deletions.
   try{await this.deleteObject({resource:binding,object:current,producer:current.producer,commit:async tx=>{const job=await tx.get(jobPath);await tx.put(jobPath,{...job,totalDeleted:(job?.totalDeleted??0)+1});}});deleted++;}
   catch(error){if(SKIPPABLE.includes(error?.code))skipped.conflict++;else if(PERMANENT.includes(error?.code))skipped.failed++;else throw error;}
  }
  const job=await this.metadata.transaction(async tx=>{const job=await tx.get(jobPath),total={...job.skipped};for(const [k,v]of Object.entries(skipped))total[k]=(total[k]??0)+v;const value={...job,cursor:next,complete:next===null,skipped:total,scanned:rows.length,at:this.clock.now()};await tx.put(jobPath,value);return value;});
  return {...jobView(job),deleted,scanned:rows.length};
 }
}
// Alarm sweep: strip markers covered only by pruned removals (lineage) and no active keep. One bounded batch per call;
// a write happens only for an object whose markers change. Rows of fully swept lineages are pruned with it.
export function strippedMarkers(object,resource,{lineages,removals,keeps}){
 const eligible=m=>m&&Number.isSafeInteger(m.generation)&&lineages.some(l=>l.connection===m.connection&&m.generation<=l.generation)&&!removals.some(r=>r?.connection===m.connection&&m.generation<=r.generation);
 const kept=m=>m&&keeps.some(k=>k.connection===m.connection&&(k.resource===null||k.resource===resource)&&m.generation<=k.generation);
 if(kept(object?.producer)||kept(object?.createdBy))return null;
 const dropProducer=eligible(object?.producer),dropCreated=eligible(object?.createdBy);if(!dropProducer&&!dropCreated)return null;
 const {producer,createdBy,...rest}=object;return {...rest,...!dropProducer&&producer?{producer}:{},...!dropCreated&&createdBy?{createdBy}:{}};
}
ProducerSummaryService.prototype.collectMarkers=async function({limit=200}={}){
 const lineages=(await this.all(PRODUCER_LINEAGE)).map(([,v])=>v).filter(l=>l&&typeof l.connection==='string'&&Number.isSafeInteger(l.generation));
 let state=await this.metadata.get(PRODUCER_GC);if(!state?.cursor&&!lineages.some(l=>!l.swept))return {done:true,stripped:0};
 const now=this.clock.now();if(!state?.cursor)state={cursor:{root:0,after:''},passStartedAt:now};
 const removals=[...(await this.metadata.list({prefix:'app-removal/record/',limit:1000})).values()],keeps=(await this.all(PRODUCER_KEEP)).map(([,v])=>v).filter(k=>k?.action==='keep'&&k.active===true),context={lineages,removals,keeps};
 const {rows,next}=await this.scan(state.cursor,limit);let stripped=0;
 for(const [path,object]of rows){const resource=resourceOf(path);if(!strippedMarkers(object,resource,context))continue;
  if(await this.metadata.transaction(async tx=>{const live=await tx.get(path);if(live?.version!==object.version)return false;const value=strippedMarkers(live,resource,context);if(!value)return false;await tx.put(path,value);return true;}))stripped++;}
 if(next){await this.metadata.put(PRODUCER_GC,{...state,cursor:next});return {done:false,stripped};}
 // Pass complete: every lineage pruned before the pass started is swept. Keep it only while an active keep refers to it.
 for(const l of lineages){if(l.swept||l.prunedAt>state.passStartedAt)continue;const conn=encodeURIComponent(l.connection),own=PRODUCER_KEEP+conn+'/'+encodeURIComponent(l.removal)+'/',rowsOwn=await this.all(own),active=rowsOwn.some(([,k])=>k?.active===true);
  await this.metadata.transaction(async tx=>{for(const [path,k]of rowsOwn)if(!active||k?.active!==true)await tx.delete(path);for(const [path,job]of await tx.list({prefix:PRODUCER_DELETION+l.removal+'/',limit:200}))if(!active||job?.complete||job?.stopped)await tx.delete(path);if(active)await tx.put(PRODUCER_LINEAGE+l.removal,{...l,swept:true});else await tx.delete(PRODUCER_LINEAGE+l.removal);});}
 await this.metadata.delete(PRODUCER_GC);return {done:!lineages.some(l=>!l.swept&&l.prunedAt>state.passStartedAt),stripped};
};
export const producerSummaryProvider=service=>Provider.fromSingleton(service);
export class RemovalRemaining extends AppQuery{
 static operation='app-removal.remaining';static deps=['producerSummary'];static refreshOn=['app-removal-remaining-changed'];
 async fetch({producerSummary:s}){const r=await s.removal(this.actor,this.input?.removal);const {removal,...options}=this.input??{};return s.summary(r,options);}
}
export class RemovalRemainingAction extends AppAction{
 static operation='app-removal.remaining-action';static deps=['producerSummary'];static changes='app-removal-remaining-changed';
 async run({producerSummary:s}){const r=await s.removal(this.actor,this.input?.removal);const {removal,...options}=this.input??{};return s.act(r,options);}
}
