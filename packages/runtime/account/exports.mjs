// DX-2 carve-out. Trusted identity/notice/contributor ports come from config.exportPorts;
// neither the HTTP body nor the account operation document can replace a provider.
import {createAppEngine,perform,read,AppAction,AppQuery,operations} from '../../app/engine.mjs';
import {cryptoRandom,nullAudit} from '../../app/providers.mjs';
import {fault} from '../../app/faults.mjs';
import {UUID} from '../../core/primitives.mjs';
import {AccountExport,createExportDigest,exportRetryDelay} from '../export-generation.mjs';
import {ACCOUNT_EXPORT_OPERATIONS,ExportList,ExportStatus,CancelExport,StepExport,ExpireExports} from '../../app/domains/account-export.mjs';
import {CreateExportWithHooks as CreateExport,OfferOverQuotaExport,OverQuotaExportEvidence} from '../export-hooks.mjs';
import {decryptSecret} from '../secrets.mjs';
import {flagsFor} from './flags.mjs';
import {storageState} from '../storage-quota.mjs';
import {identitySecurityPort} from '../../identity/service.mjs';
import {Query} from '../../../vendor/ngin/index.js';
const deps=['accountStore','archives','blobs','clock','random','flags','config'],DAY=86400000,encoder=new TextEncoder(),engines=new WeakMap();
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
const equal=(a,b)=>{if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;};
const ownerOf=actor=>{if(actor?.kind!=='owner'||!UUID.test(actor.owner??''))fault('unauthorized','Sign in to continue.',401);return actor.owner;};
const service=r=>new AccountExport({...r,...r.config.exportPorts});
const fresh=(actor,now)=>{if(!Number.isSafeInteger(actor.stepUpAt)||actor.stepUpAt>now||actor.stepUpAt+300000<=now)fault('step_up_required','Verify your password or passkey again.',401);};
const ready=(job,security,now)=>{if(job.state!=='ready')fault('export_not_ready','The export is not ready.',409);if(now>=job.expiresAt)fault('export_expired','The export has expired.',410);if(job.securityEpoch!==security.epoch)fault('unauthorized','Security settings changed.',401);};
export function parseExportGrant(token){const m=typeof token==='string'&&/^bex1\.([a-f0-9-]{36})\.([a-f0-9-]{36})\.([a-f0-9-]{36})\.([A-Za-z0-9_-]{43})$/.exec(token);return m&&m.slice(1,4).every(v=>UUID.test(v))?{owner:m[1],jobId:m[2],grantId:m[3]}:null;}
class ExportGrantAction extends AppAction {static deps=deps;static lifecycle='suspended';static termsGate='exempt';static changes='exports-changed';}
export class MintExportGrant extends ExportGrantAction {
 static operation='exports.grant';
 async run(r){
  const owner=ownerOf(this.actor),s=service(r),now=r.clock.now();fresh(this.actor,now);
  if(this.input!==undefined&&(!this.input||typeof this.input!=='object'||Array.isArray(this.input)||Object.keys(this.input).length))fault('invalid_export','The grant request must be empty.',400);
  const security=await s.security(owner),id=r.random.uuid(),secret=btoa(String.fromCharCode(...r.random.bytes(32))).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''),token=`bex1.${owner}.${this.id}.${id}.${secret}`,tokenHash=await hash(token);
  const grant=await r.accountStore.transaction(async tx=>{
   await s.fence(tx,owner);const job=await s.get(tx,owner,this.id);if(!s.port(owner).enabled('ACCOUNT_EXPORT_ENABLED'))fault('not_found','Not found.',404);ready(job,security,now);
   if((job.grants??[]).length>=32)fault('export_grant_limit','The export grant limit was reached.',429);
   const grant={id,tokenHash,createdAt:now,expiresAt:Math.min(now+DAY,job.expiresAt),securityEpoch:security.epoch};job.grants=[...job.grants??[],grant];await tx.put('export/job/'+job.id,job);return grant;
  });
  // The token leaves only after the notice succeeds. A lost response can leave
  // an unusable hash, bounded by the per-job grant cap, never a plaintext token.
  await s.deliverNotice({owner,id:this.id},'export-grant-created','grant:'+id);
  return {id,token,tokenType:'Bearer',expiresAt:grant.expiresAt};
 }
}
export class RevokeExportGrant extends ExportGrantAction {
 static operation='exports.revoke-grant';static lifecycle='purging';static warm=false;
 async run(r){const owner=ownerOf(this.actor),s=service(r);if(!UUID.test(this.input?.grantId??'')||Object.keys(this.input).some(k=>k!=='grantId'))fault('invalid_export','Choose an export grant.',400);return r.accountStore.transaction(async tx=>{const job=await s.get(tx,owner,this.id),grant=job.grants?.find(g=>g.id===this.input.grantId);if(grant){grant.revokedAt=r.clock.now();await tx.put('export/job/'+job.id,job);}return {revoked:true};});}
}
export class DownloadExport extends AppQuery {
 static operation='exports.download';static deps=deps;static lifecycle='suspended';static termsGate='exempt';
 async fetch(r){
  const actor=this.actor,owner=actor?.kind==='owner'?ownerOf(actor):actor?.owner;
  if(!UUID.test(owner??'')||!['owner','export-grant'].includes(actor?.kind))fault('unauthorized','Download authority is required.',401);
  let tokenHash,parsed;if(actor.kind==='export-grant'){parsed=parseExportGrant(actor.token);if(!parsed||parsed.owner!==owner||parsed.jobId!==this.id)fault('unauthorized','Invalid export grant.',401);tokenHash=await hash(actor.token);}
  if(!this.input||Object.keys(this.input).some(k=>!['volume','range','ifRange'].includes(k)))fault('invalid_export','Choose an export volume.',400);
  // Check the grant in the SAME transaction DX-1 uses to reserve download
  // bytes. Revocation and a concurrent reservation have one linearization point.
  const thisId=this.id,volumeNumber=this.input.volume,store=new Proxy(r.accountStore,{get(target,key){if(key==='transaction')return operation=>target.transaction(async tx=>{if(parsed){const job=await tx.get('export/job/'+parsed.jobId),grant=job?.grants?.find(g=>g.id===parsed.grantId);if(!grant||grant.revokedAt!==undefined||grant.expiresAt<=r.clock.now()||grant.securityEpoch!==job.securityEpoch||!equal(grant.tokenHash,tokenHash))fault('unauthorized','Invalid export grant.',401);}try{return await operation(tx);}catch(error){if(error.status===416){const job=await tx.get('export/job/'+thisId),volume=job?.owner===owner&&job.volumes?.find(v=>v.n===volumeNumber);if(volume)error.volumeBytes=volume.bytes;}throw error;}});const value=target[key];return typeof value==='function'?value.bind(target):value;}});
  return service({...r,accountStore:store}).layout(owner,this.id,this.input,parsed?{kind:'export-grant',owner,jobId:parsed.jobId,grantId:parsed.grantId}:actor);
 }
}
// Privileged evidence is obtained through the identity engine, never from JSON.
export class ExportStepUp extends Query {static deps=['identity'];constructor(context){super();this.context=context;}async fetch({identity}){const {account,session,sessionId}=await identity.privileged(this.context,300000);return {owner:account.id,sessionId,stepUpAt:session.stepUpAt};}}
export const EXPORT_OPERATIONS=operations(...ACCOUNT_EXPORT_OPERATIONS.filter(op=>op.operation!=='exports.create'),CreateExport,OfferOverQuotaExport,OverQuotaExportEvidence,MintExportGrant,RevokeExportGrant,DownloadExport);
/** Adapter composition contract. Identity is read through its repository port;
 * domain-owned public-key, federation and external-mapping projections and the
 * idempotent audit/confirmed-channel notice port must be supplied explicitly.
 * Missing ports fail closed in DX-1; an empty projection is never invented. */
export function createExportAdapterPorts({repository,notice,contributorPorts={},...ports}){
 if(typeof repository?.get!=='function')throw new TypeError('An identity repository is required');
 return {...ports,identitySecurity:identitySecurityPort(repository),notice,contributorPorts:{identity:owner=>repository.get(owner),...contributorPorts}};
}
const PUSHED={'export-created':'export-created','export-grant-created':'export-created','export-downloaded':'export-downloaded'};
/** Public key history only (§1.1 `keys`); private keys leave only through the protected identity backup. */
async function exportKeys(c,owner){
 const history=[];for(const purpose of ['signing','encryption'])history.push(...await c.identityKeyHistory(owner,{purpose}));
 return {publicKeys:history.map(k=>({kid:k.kid,purpose:k.purpose,alg:k.alg,publicJwk:k.publicJwk,state:k.state,current:k.current,createdAt:k.createdAt,retiredAt:k.retiredAt,revokedAt:k.revokedAt})),keyIds:history.map(k=>k.kid),certificates:[],backupWorkflow:'Private keys leave only through the separately protected identity backup in your security settings.'};
}
/** The host-held logical-key to provider-object mapping (§1.5): references only, never external bytes or tokens. */
export function externalStorageMapping(c){return {async page({owner,cursor,limit}){
 const prefixes=['drive/object/','drive/folder/','resource/'],index=cursor?.index??0,rows=await c.metadata.list({prefix:prefixes[index],startAfter:typeof cursor==='string'?cursor:cursor?.after??'',limit}),out=[];
 for(const [path,row]of rows){if(row.owner!==undefined&&row.owner!==owner)continue;
  if(index===2){if(!['s3','webdav'].includes(row.provider))continue;const config=await decryptSecret(row.secret,c.config.KEY_ENCRYPTION_KEY);out.push({provider:row.provider,resourceId:row.id,resource:row.id,...row.provider==='s3'?{bucket:config.bucket,prefix:config.prefix??''}:{prefix:config.prefix??''}});}
  else {const resourceId=path.split('/')[2];out.push({provider:'google-drive',resource:resourceId,resourceId,key:row.key,fileId:row.fileId,folderId:row.folderId,version:row.version,size:row.size,contentType:row.contentType});}
 }
 const more=rows.size===limit,next=more?{index,after:[...rows.keys()].at(-1)}:index+1<prefixes.length?{index:index+1}:null;return {rows:out,cursor:next,done:next===null};
}};}

export function exportEngine(c){
 let engine=engines.get(c);if(!engine){const clock={now:()=>typeof c.config.LIFECYCLE_CLOCK==='function'?c.config.LIFECYCLE_CLOCK():Date.now()},flags={for:ctx=>flagsFor(c.config,ctx)};
  // Port properties are read per operation, preserving request-pinned flags and
  // adapter changes. Missing contributor/notice ports remain fail-closed in DX-1.
  const config=new Proxy(c.config,{get(target,key){if(key==='exportPorts'){const ports=target.exportPorts??{};return {digest:createExportDigest(),quota:owner=>c.metadata.transaction(async tx=>{if(await tx.get('owner')!==owner)fault('forbidden','Account owner mismatch.',403);return (await storageState(tx,owner,clock.now(),c.config)).storageBytes;}),...ports,
   // The adapter's notice records the owner audit event and mails; this adds the owner's own push devices.
   ...typeof ports.notice==='function'?{notice:async event=>{const out=await ports.notice(event);if(PUSHED[event.type]&&typeof c.accountSecurityNotice==='function')try{await c.accountSecurityNotice(event.owner,{event:PUSHED[event.type]});}catch{/* best effort */}return out;}}:{},
   // Account-local projections: public key history and the host-held external storage mapping.
   contributorPorts:{keys:owner=>exportKeys(c,owner),externalStorage:externalStorageMapping(c),...ports.contributorPorts}};}return target[key];}});
  engine=createAppEngine({providers:{accountStore:c.metadata,archives:c.exportArchives??c.archives,blobs:c.blobs,clock,random:cryptoRandom,audit:nullAudit,flags,config}});engines.set(c,engine);
 }return engine;
}
const actor=(owner,evidence={})=>({kind:'owner',owner,...typeof evidence.sessionId==='string'?{sessionId:evidence.sessionId}:{},...Number.isSafeInteger(evidence.stepUpAt)?{stepUpAt:evidence.stepUpAt}:{}});
// Preserve 416 length metadata across the generic RPC fault envelope, which
// intentionally carries only code/message/status. No private layout is returned.
const downloadLayout=promise=>promise.catch(error=>{if(error.status===416)return {status:416,volumeBytes:error.volumeBytes};throw error;});
const wake=async(c,result)=>{if(Number.isSafeInteger(result?.wakeAt))await c.scheduleAlarm?.(result.wakeAt);};
export const methods={
 async exportCreate(owner,input,evidence){try{return await perform(exportEngine(this),new CreateExport({actor:actor(owner,evidence),input}));}finally{if(await this.metadata.get('export/active'))await this.scheduleAlarm?.(Date.now()+2000);}},
 // Internal D092 hook; no owner RPC may forge an availability offer.
 async exportOfferOverQuota(owner,input){return perform(exportEngine(this),new OfferOverQuotaExport({actor:{kind:'system',owner},input}));},
 async exportOverQuotaEvidence(owner){return read(exportEngine(this),new OverQuotaExportEvidence({actor:actor(owner)}));},
 async exportList(owner){return read(exportEngine(this),new ExportList({actor:actor(owner)}));},
 async exportStatus(owner,id){return read(exportEngine(this),new ExportStatus({actor:actor(owner),id}));},
 async exportCancel(owner,id){try{return await perform(exportEngine(this),new CancelExport({actor:actor(owner),id}));}finally{if(await this.metadata.get('export/active'))await this.scheduleAlarm?.(Date.now()+2000);}},
 async exportGrant(owner,id,input,evidence){return perform(exportEngine(this),new MintExportGrant({actor:actor(owner,evidence),id,input}));},
 async exportRevokeGrant(owner,id,grantId){return perform(exportEngine(this),new RevokeExportGrant({actor:actor(owner),id,input:{grantId}}));},
 async exportDownload(owner,id,input,evidence){return downloadLayout(read(exportEngine(this),new DownloadExport({actor:actor(owner,evidence),id,input})));},
 async exportGrantDownload(owner,id,input,token){return downloadLayout(read(exportEngine(this),new DownloadExport({actor:{kind:'export-grant',owner,token},id,input})));},
 // Internal alarm hook: no RPC exposes generation to an owner or a CLI grant.
 async exportAlarm(){const owner=await this.metadata.get('owner');if(!owner||!await this.metadata.get('export/active')||await this.metadata.get('deletion/fence-v1')||await this.metadata.get('lifecycle/purge-v1')||!flagsFor(this.config).background('ACCOUNT_EXPORT_ENABLED'))return {busy:false};const engine=exportEngine(this),actor={kind:'system',owner};try{if(this.gate)await this.gate.run(()=>this.warm(owner));else await this.warm(owner);const expired=await perform(engine,new ExpireExports({actor}));await wake(this,expired);const result=await perform(engine,new StepExport({actor}));await wake(this,result);return result;}catch(error){
  // Wargame 4 M4: back off by the active job's consecutive failures (60 s doubling to 1 h); a failed job has ended.
  let failures=1;try{const id=await this.metadata.get('export/active'),job=id&&await this.metadata.get('export/job/'+id);if(Number.isSafeInteger(job?.failures)&&job.failures>0)failures=job.failures;}catch{}
  const result={busy:true,wakeAt:Date.now()+exportRetryDelay(failures),error:error?.code??'export_unavailable'};await wake(this,result);return result;}},
};
export const rpc={exportCreate:{lifecycle:'suspended',warm:true},exportOverQuotaEvidence:{lifecycle:'suspended'},exportList:{lifecycle:'suspended'},exportStatus:{lifecycle:'suspended'},exportCancel:{lifecycle:'purging'},exportGrant:{lifecycle:'suspended'},exportRevokeGrant:{lifecycle:'purging'},exportDownload:{lifecycle:'suspended'},exportGrantDownload:{lifecycle:'suspended'}};
