// INT-4. Routing decisions are owner operations; persisted memory never contains an intent or its data.
import {AppAction,AppQuery,ownerOf} from '../app/engine.mjs';
import {AppFault} from '../app/faults.mjs';
import {flagsFor} from '../flags/read.mjs';
import {digestJSON,validateAdditive} from '../core/artefacts.mjs';
import {decodeIntent,encodeIntent,parseIntentURL} from './format.mjs';
import {validateIntentKind,validateIntentData} from './schema.mjs';
import {projectIntent} from './project.mjs';
import {validateIntentDeclarations} from './declarations.mjs';
import {parseLegacyIntent,legacyIntentScheme} from './legacy.mjs';
import {REGISTERED_INTENT_REFERENCES} from './registered.mjs';
import {getDomain} from '../../vendor/tldts/index.js';
const fail=(code,status=400)=>{throw new AppFault(code,code,status);};
const key=(owner,line)=>'intent-memory/'+owner+'/'+encodeURIComponent(line),flowKey=(owner,id)=>'intent-flow/'+owner+'/'+id;
const site=id=>{const host=new URL(id).hostname;return getDomain(host,{allowPrivateDomains:true})??host;};
const enabled=(r,actor,name='INTENT_LINKS_ENABLED')=>flagsFor(r.config,{subject:{kind:'account',owner:actor?.owner}}).enabled(name);
function guard(r,actor,input={},reverse=false){const owner=ownerOf(actor);if(input.entity!==undefined&&input.entity!==owner)fail('intent_member_context_unavailable',409);if(!reverse&&!enabled(r,actor))fail('not_found',404);return owner;}
async function bound(r,owner){const actual=await r.accountStore.get('owner');if(actual!==undefined&&actual!==owner)fail('forbidden',403);}
async function resolve(r,actor,input){
 const owner=guard(r,actor,input);await bound(r,owner);const parsed=input.legacy?parseLegacyIntent(input.legacy):null,intent=parsed?.intent??decodeIntent(input.value,{now:0}),ref=intent.kind;
 if(!r.config.ARTEFACTS?.enabled)fail('intent_kind_unavailable',503);
 // Wargame F1: an attacker-chosen kind URL that the operator never registered is refused before any provider-wide
 // store read, pin or fetch, so junk kinds create no artefact rows and spend no shared fetch budget.
 if(typeof r.config.ARTEFACTS.registered==='function'&&r.config.ARTEFACTS.registered(ref.artefact)!==true)fail('intent_kind_unavailable',503);
 let pin;try{try{pin=await r.config.ARTEFACTS.resolve({...ref,kind:'intent'});}catch(error){if(error.code!=='artefact_unavailable'||!r.config.ARTEFACTS.pin)throw error;pin=await r.config.ARTEFACTS.pin({...ref,kind:'intent'});}if(pin.affected)fail('intent_kind_retracted',410);}catch(e){if(e.code==='intent_kind_retracted')throw e;fail(e.code==='artefact_retracted'?'intent_kind_retracted':['artefact_unavailable','artefact_unverifiable','artefact_unregistered'].includes(e.code)?'intent_kind_unavailable':'intent_kind_invalid',e.code==='artefact_retracted'?410:['artefact_unavailable','artefact_unregistered'].includes(e.code)?503:400);}
 const body=pin.body;if(pin.reference?.digest!==ref.digest||pin.reference?.version!==ref.version||pin.kind!==undefined&&pin.kind!=='intent')fail('intent_kind_invalid');validateIntentKind(body);if(body.id!==ref.artefact)fail('intent_kind_invalid');
 // Signaling AMD-SG-I1 §20.1.2 (proposed, unsigned): a session kind never travels as an intent link; it reaches handlers
 // only through signaling's addressed delivery. Refused after kind resolution, without handoff.
 if(body.session!==undefined)fail('intent_kind_invalid');if(!parsed)validateIntentData(body,intent.data);
 if(body.capability&&input.placement==='query')fail('intent_malformed');if(intent.exp!==undefined&&intent.exp<=Math.floor(r.clock.now()/1000))fail('intent_expired',410);
 const resolutions=new Map([[JSON.stringify([ref.artefact,ref.version,ref.digest]),Promise.resolve(pin)]]),versions=reference=>{const key=JSON.stringify([reference.artefact,reference.version,reference.digest]);if(!resolutions.has(key))resolutions.set(key,Promise.resolve().then(()=>r.config.ARTEFACTS.resolve({...reference,kind:'intent'})));return resolutions.get(key);};
 return {owner,intent,body,legacy:parsed?.legacy,versions};
}
async function handlers(r,tx,owner,intent,body,memory,legacy,versions){
 const list=[...r.config.INTENT_BUILTINS??[]];
 if(!legacy&&enabled(r,{owner},'INTENT_APP_HANDLERS_ENABLED')){
  const indexed=tx.intentHandlers?await tx.intentHandlers({owner,kind:intent.kind.artefact}):null;
  const indexedDeclarations=indexed?new Set(indexed.map(h=>JSON.stringify([h.connection,h.generation,h.kind,h.version,h.digest,h.route]))):null;
  const rows=indexed?await Promise.all([...new Set(indexed.map(h=>h.connection))].map(id=>tx.get('resource/'+id))):[...(await tx.list({prefix:'resource/'})).values()];
  for(const row of rows){
   if(!row||row.kind!=='app-connection'||row.owner!==owner||row.status!=='active'||!['active','degraded'].includes(row.state)||row.entity&&row.entity!==owner||row.organization)continue;
   const manifest=row.integration?.snapshot?.manifest??row.integration?.manifest;if(!manifest)continue;
   for(const d of validateIntentDeclarations(row.clientId,manifest.intents))if(d.kind===intent.kind.artefact&&(!indexed||indexedDeclarations.has(JSON.stringify([row.id,row.generation,d.kind,d.version,d.digest,d.route]))))list.push({...d,id:row.clientId,connection:row.id,generation:row.generation,origin:new URL(row.clientId).origin});
  }
 }
 const resolveVersion=h=>versions({artefact:h.kind,version:h.version,digest:h.digest});
 const candidates=[];
 for(const h of list){
  if(h.kind!==intent.kind.artefact||memory?.excluded?.some(x=>x.site===site(h.id)))continue;
  let outgoing=intent;
  if(h.version>intent.kind.version){let target;try{target=await resolveVersion(h);validateIntentKind(target.body);}catch{continue;}if(target.affected||target.reference?.digest!==h.digest||target.reference?.version!==h.version||!validateAdditive('intent',body,target.body).additive)continue;}
  if(h.version===intent.kind.version&&h.digest!==intent.kind.digest)continue;
  if(h.version<intent.kind.version){
   let target;try{target=await resolveVersion(h);}catch{continue;}
   if(target.affected||target.reference?.digest!==h.digest||target.reference?.version!==h.version||!validateAdditive('intent',target.body,body).additive)continue;
   try{outgoing=projectIntent(intent,body,target.body,{additive:true,reference:{artefact:h.kind,version:h.version,digest:h.digest}});}catch{continue;}
  }
  candidates.push({...h,origin:new URL(h.route).origin,outgoing,projected:h.version<intent.kind.version,...legacy?{legacy}:{}});
 }
 return candidates.sort((a,b)=>a.id.localeCompare(b.id));
}
async function validDefault(r,memory,intent,body,candidates,versions){
 const d=memory?.default;if(!d)return null;const handler=candidates.find(h=>h.id===d.handler&&(!d.connection||h.connection===d.connection&&h.generation===d.generation));if(!handler)return null;
 if(intent.kind.version>d.version){let old;try{old=await versions({artefact:intent.kind.artefact,version:d.version,digest:d.digest});}catch{return null;}if(!validateAdditive('intent',old.body,body).additive)return null;
  const categories=new Set([...old.body.disclosure.categories,...Object.values(old.body.disclosure.fields).flatMap(f=>f.categories)]);
  if(Object.entries(body.disclosure.fields).some(([name,f])=>!Object.hasOwn(old.body.data.properties,name)&&f.categories.some(c=>!categories.has(c))))return null;
 }else if(intent.kind.version===d.version&&intent.kind.digest!==d.digest)return null;
 return handler;
}
const target=(r,h,wire)=>h.legacy?h.route+'#legacy='+encodeURIComponent(legacyIntentScheme(h.legacy)):h.route+'#bintent='+(wire&&!h.projected?wire:encodeIntent(h.outgoing))+'&bintent_iss='+encodeURIComponent(r.config.APP_ORIGIN);
export function intentRisk(body,data,candidates=[]){const categories=[...body.disclosure.categories,...Object.keys(data).flatMap(k=>body.disclosure.fields[k].categories)],known=['personal-data','location','send-as-you','money','identity','public'];let tier=({view:0,save:1,join:1,send:2})[body.effect]??3;if(categories.some(c=>!known.includes(c)))tier=3;else if(categories.some(c=>['money','identity','send-as-you','public'].includes(c)))tier++;if(candidates.some(h=>site(h.id)===site(body.id)))tier++;return ['low','medium','high','critical'][Math.min(3,tier)];}
const reviewed=intent=>REGISTERED_INTENT_REFERENCES.some(p=>p.artefact===intent.kind.artefact&&p.version===intent.kind.version&&p.digest===intent.kind.digest);
export function intentDisclosure(body,data){return Object.fromEntries(Object.entries(data).map(([name,value])=>{const field=body.disclosure.fields[name];return [name,field.display==='origin'?new URL(value).origin:field.display==='value'?typeof value==='object'?new URL(value.iss).host+' (according to the link)':String(value):true];}));}
const publicHandler=({outgoing,projected,legacy,...h})=>h;
export function viewerActivated(headers={}){const h=new Headers(headers),site=h.get('Sec-Fetch-Site');return h.get('Sec-Fetch-Mode')==='navigate'&&h.get('Sec-Fetch-Dest')==='document'&&!h.get('Purpose')&&!h.get('Sec-Purpose')&&(site==='none'||site==='same-origin'||site==='cross-site'&&h.get('Sec-Fetch-User')==='?1');}
export class ReceiveIntent extends AppQuery {
 static operation='intents.receive';static deps=[];
 fetch(){const input=this.input??{};return input.url?parseIntentURL(input.url,{now:0}):{intent:decodeIntent(input.value,{now:0}),value:input.value,placement:input.placement??'post'};}
}
export class Candidates extends AppQuery {
 static operation='intents.candidates';static deps=['accountStore','config','clock'];
 async fetch(r){const {owner,intent,body,legacy,versions}=await resolve(r,this.actor,this.input),memory=await r.accountStore.get(key(owner,body.id));if(memory?.ignored)return {state:'ignored',candidates:[]};const candidates=await handlers(r,r.accountStore,owner,intent,body,memory,legacy,versions),d=await validDefault(r,memory,intent,body,candidates,versions);return {state:candidates.length?'choose':'no-handler',body,risk:intentRisk(body,intent.data,candidates),reviewed:reviewed(intent),disclosure:intentDisclosure(body,intent.data),sender:'unknown',signatureUnchecked:typeof this.input.value==='string'&&this.input.value.includes('.'),account:owner,candidates:candidates.map(publicHandler),default:d?.id??null};}
}
export class ResolveIntent extends AppAction {
 static operation='intents.resolve';static deps=['accountStore','config','clock','random'];
 async run(r){const {owner,intent,body,legacy,versions}=await resolve(r,this.actor,this.input),now=r.clock.now(),digest=await digestJSON(intent);return r.accountStore.transaction(async tx=>{
  const memory=await tx.get(key(owner,body.id));if(memory?.ignored)return {state:'ignored',kind:body.id};
  const candidates=await handlers(r,tx,owner,intent,body,memory,legacy,versions),d=await validDefault(r,memory,intent,body,candidates,versions);
  // Sweep receipts; they hold only a digest, not link data. Defaults never retain a flow.
  for(const [k,f]of await tx.list({prefix:'intent-flow/'+owner+'/'}))if(f.expires<=now)await tx.delete(k);
  if(d&&this.input.activated===true){const meter=await tx.get('intent-meter/'+owner)??{start:now,count:0};if(now-meter.start>=60000){meter.start=now;meter.count=0;}if(meter.count<5){meter.count++;await tx.put('intent-meter/'+owner,meter);return {state:'handoff',target:target(r,d,this.input.value)};}}
  const receipts=[...(await tx.list({prefix:'intent-flow/'+owner+'/'}))].sort((a,b)=>a[1].created-b[1].created);while(receipts.length>=64)await tx.delete(receipts.shift()[0]);const id=r.random.uuid();await tx.put(flowKey(owner,id),{digest,kind:body.id,created:now,expires:now+3600000});
  return {state:d?'continue':candidates.length?'choose':'no-handler',flow:id,body,risk:intentRisk(body,intent.data,candidates),reviewed:reviewed(intent),disclosure:intentDisclosure(body,intent.data),sender:'unknown',signatureUnchecked:typeof this.input.value==='string'&&this.input.value.includes('.'),account:owner,candidates:candidates.map(publicHandler),default:d?.id??null,armedAt:now+1000};
 });}
}
async function receipt(r,tx,owner,input,intent){const path=flowKey(owner,input.flow),flow=await tx.get(path),now=r.clock.now();if(!flow||flow.expires<=now||flow.created+1000>now||flow.digest!==await digestJSON(intent))fail('intent_stale',409);return path;}
export class RecordDecision extends AppAction {
 static operation='intents.decide';static deps=['accountStore','config','clock'];static changes='intents-changed';
 async run(r){const {owner,intent,body,legacy,versions}=await resolve(r,this.actor,this.input);if(!['once','always'].includes(this.input.choice))fail('intent_malformed');return r.accountStore.transaction(async tx=>{
  const path=await receipt(r,tx,owner,this.input,intent),k=key(owner,body.id),memory=await tx.get(k)??{};if(memory.ignored)fail('intent_stale',409);
  const candidates=await handlers(r,tx,owner,intent,body,memory,legacy,versions),handler=candidates.find(h=>h.id===this.input.handler);if(!handler)fail('intent_stale',409);
  if(this.input.choice==='always')await tx.put(k,{...memory,kind:body.id,default:{handler:handler.id,version:intent.kind.version,digest:intent.kind.digest,...handler.connection?{connection:handler.connection,generation:handler.generation}:{},at:r.clock.now()}});
  await tx.delete(path);return {state:'handoff',target:target(r,handler,this.input.value)};
 });}
}
export class SetDefault extends RecordDecision {static operation='intents.set-default';async run(r){this.input={...this.input,choice:'always'};return super.run(r);}}
export class ExcludeHandler extends AppAction {
 static operation='intents.exclude';static deps=['accountStore','config','clock'];static changes='intents-changed';
 async run(r){const {owner,intent,body,legacy,versions}=await resolve(r,this.actor,this.input);return r.accountStore.transaction(async tx=>{const path=await receipt(r,tx,owner,this.input,intent),k=key(owner,body.id),m=await tx.get(k)??{},candidates=await handlers(r,tx,owner,intent,body,m,legacy,versions),h=candidates.find(h=>h.id===this.input.handler);if(!h)fail('intent_stale',409);const s=site(h.id);m.excluded=[...m.excluded??[],{site:s,at:r.clock.now()}];if(m.default&&site(m.default.handler)===s)delete m.default;await tx.put(k,{...m,kind:body.id});await tx.delete(path);return {state:'done'};});}
}
export class IgnoreKind extends AppAction {
 static operation='intents.ignore';static deps=['accountStore','config','clock'];static changes='intents-changed';
 async run(r){const {owner,intent,body,legacy,versions}=await resolve(r,this.actor,this.input);return r.accountStore.transaction(async tx=>{const path=await receipt(r,tx,owner,this.input,intent),k=key(owner,body.id),m=await tx.get(k)??{};await tx.put(k,{...m,kind:body.id,ignored:{at:r.clock.now()}});await tx.delete(path);return {state:'done'};});}
}
export class IntentRecords extends AppQuery {
 static operation='intents.records';static deps=['accountStore','config'];
 async fetch(r){const owner=guard(r,this.actor,this.input,true);await bound(r,owner);return [...(await r.accountStore.list({prefix:'intent-memory/'+owner+'/'})).values()];}
}
export class RemoveIntentRecord extends AppAction {
 static operation='intents.remove';static deps=['accountStore','config'];static changes='intents-changed';
 async run(r){const input=this.input??{},owner=guard(r,this.actor,input,true);await bound(r,owner);if(typeof input.kind!=='string')fail('intent_malformed');return r.accountStore.transaction(async tx=>{const k=key(owner,input.kind),m=await tx.get(k);if(!m)return {removed:false};if(input.record==='default')delete m.default;else if(input.record==='ignored')delete m.ignored;else if(input.record==='excluded')m.excluded=(m.excluded??[]).filter(x=>x.site!==input.site);else fail('intent_malformed');await tx.put(k,m);return {removed:true};});}
}
export class ReconcileIntentDefaults extends AppAction {
 static operation='intents.reconcile';static deps=['accountStore','config'];
 async run(r){const owner=guard(r,this.actor,{},true);await bound(r,owner);return r.accountStore.transaction(async tx=>{let cleared=0;for(const [k,m]of await tx.list({prefix:'intent-memory/'+owner+'/'})){const d=m.default;if(!d?.connection)continue;const c=await tx.get('resource/'+d.connection),manifest=c?.integration?.snapshot?.manifest??c?.integration?.manifest;if(c?.owner===owner&&c.status==='active'&&['active','degraded'].includes(c.state)&&c.generation===d.generation&&validateIntentDeclarations(c.clientId,manifest?.intents).some(h=>h.kind===m.kind))continue;delete m.default;await tx.put(k,m);cleared++;}return {cleared};});}
}
export const INTENT_OPERATIONS=[ReceiveIntent,Candidates,ResolveIntent,RecordDecision,SetDefault,ExcludeHandler,IgnoreKind,IntentRecords,RemoveIntentRecord,ReconcileIntentDefaults];
