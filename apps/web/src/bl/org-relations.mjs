// ORG-10g Relationships tab of the organization console (docs/architecture/organizations-design.md §8b.10 "Console
// surfaces"; API contract: ORG-10f console routes under /api/orgs/{org}/relations). Logic only: OrganizationsIntent
// delegates every `rel-*` action here, and the render-only views (apps/web/src/ui/org-relations.mjs) read the model.
// Nothing here derives authority: which actions are offered is a display hint from the server's own answers, every
// operation names only rows this console loaded (never form-supplied principals, resources or `aep`s), and the server
// rechecks each one. Widening operations meet the existing step-up through the API (reauthentication_required).
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/,META=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,HANDLE=/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const fail=code=>{throw Object.assign(Error(code),{code});};
/** Model fields owned by the Relationships tab; cleared with every other private field on a context switch. */
export const RELATION_FIELDS=Object.freeze({relations:null,relationsUnavailable:false,relationImports:null,relationsTab:false,relationPane:null,relationWizard:null,relationAccept:null,relationIssued:null,relationPool:null,relationAdmit:null,relationRebind:null,relationError:null,relationNotice:null});
export const RELATION_STEPS=Object.freeze(['relation','slot','counterparty','values','review']);
export const INVITATION_DAYS=Object.freeze([7,14,30]);
export const validMeta=value=>typeof value==='string'&&value.length<=8192&&META.test(value);
const str=(v,n=512)=>typeof v==='string'?v.slice(0,n):null;
const num=v=>Number.isFinite(v)?v:null;
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v);
const list=(v,n=256)=>Array.isArray(v)?v.filter(obj).slice(0,n):[];
export const principalOf=p=>obj(p)&&typeof p.iss==='string'&&typeof p.sub==='string'&&p.iss.length<=512&&p.sub.length<=256?{iss:p.iss,sub:p.sub}:null;
/** A principal as one stable key (rows are named by it in intents; the principal itself comes from the loaded row). */
export const principalKey=p=>p?p.iss+' '+p.sub:'';
export const identityURI=p=>p?`${p.iss}/identity/${p.sub}`:'';
const pin=p=>obj(p)&&typeof p.artefact==='string'?{artefact:str(p.artefact,2048),version:p.version,digest:str(p.digest,256)}:null;
const half=h=>obj(h)?{state:['pending','live','suspended','ended'].includes(h.state)?h.state:null,generation:num(h.generation),live:h.live===true,...['billing','moved'].includes(h.cause)?{cause:h.cause}:{},entries:list(h.entries,64).map(e=>({index:num(e.index),...e.required===true?{required:true}:{},...['pairwise','named'].includes(e.actor_disclosure)?{actor_disclosure:e.actor_disclosure}:{},resources:list(e.resources,16).filter(x=>typeof x.resource==='string').map(x=>({resource:str(x.resource,2048),field:str(x.field,128),methods:obj(x.methods)?x.methods:{},...obj(x.scope)?{scope:x.scope}:{},...num(x.expires_at)?{expires_at:x.expires_at}:{}}))})).filter(e=>e.index!==null)}:{state:null,generation:null,live:false,entries:[]};
const HOLD_CAUSES=['aep-increase','key-reset','contested','move','attested-move'];
const hold=h=>obj(h)&&['full','write'].includes(h.kind)&&Number.isSafeInteger(h.aep)?{kind:h.kind,aep:h.aep,cause:HOLD_CAUSES.includes(h.cause)?h.cause:null,since:num(h.since),...num(h.until)?{until:h.until}:{}}:null;
const importRow=i=>({grantor:principalOf(i.grantor),grantorHandle:str(i.grantorHandle,64),grantorName:str(i.grantorName,200),instance:str(i.instance,2048),entry:num(i.entry),status:i.status==='available'?'available':'unavailable',...i.held===true?{held:true}:{},...i.preAccepted===true?{preAccepted:true}:{},
 ...typeof i.id==='string'?{id:str(i.id,256)}:{},contracts:Array.isArray(i.contracts)?i.contracts.filter(c=>typeof c==='string').slice(0,16):[],resources:list(i.resources,64).map(x=>({id:str(x.id,256),resource:str(x.resource,2048),contracts:Array.isArray(x.contracts)?x.contracts.filter(c=>typeof c==='string').slice(0,16):[],methods:obj(x.methods)?x.methods:{},status:x.status==='available'?'available':'unavailable',...num(x.expires_at)?{expires_at:x.expires_at}:{}}))});
/** The admin overview, shape-checked and bounded (untrusted display data; strings render as plain text). */
export function normalizeRelations(raw){
 const r=obj(raw)?raw:{};
 const instances=list(r.instances).filter(i=>typeof i.instance==='string').map(i=>({instance:str(i.instance,2048),relation:pin(i.relation),title:str(i.title,200),slots:Array.isArray(i.slots)?i.slots.filter(x=>typeof x==='string').slice(0,8):[],state:['pending','live','left'].includes(i.state)?i.state:'pending',
  counterparts:list(i.counterparts,256).filter(c=>principalOf(c.principal)).map(c=>({principal:principalOf(c.principal),handle:str(c.handle,64),name:str(c.name,200),slot:str(c.slot,128),as:str(c.as,128),state:['pending','live','ended'].includes(c.state)?c.state:'pending',outgoing:half(c.outgoing),incoming:half(c.incoming),...hold(c.hold)?{hold:hold(c.hold)}:{},...obj(c.unreachable)?{unreachable:{since:num(c.unreachable.since),flagged:c.unreachable.flagged===true}}:{}}))}));
 const inbound=obj(r.inbound)?r.inbound:{},holds=obj(r.holds)?r.holds:{};
 return {enabled:r.enabled===true,billing:['active','read-only','export-only'].includes(r.billing)?r.billing:'active',closing:r.closing===true,instances,
  invitations:list(r.invitations).filter(x=>typeof x.invitation==='string').map(x=>({invitation:str(x.invitation,128),instance:str(x.instance,2048),slot:str(x.slot,128),as:str(x.as,128),invitee:principalOf(x.invitee),inviteeHandle:str(x.inviteeHandle,64),expiresAt:num(x.expiresAt),createdAt:num(x.createdAt)})),
  inbound:{items:list(inbound.items).filter(x=>typeof x.invitation==='string'&&validMeta(x.meta)).map(x=>({invitation:str(x.invitation,128),meta:x.meta,from:principalOf(x.from),fromHandle:str(x.fromHandle,64),fromName:str(x.fromName,200),instance:str(x.instance,2048),relation:pin(x.relation),slot:str(x.slot,128),receivedAt:num(x.receivedAt),expiresAt:num(x.expiresAt)})),
   introductions:list(inbound.introductions).filter(x=>typeof x.introduction==='string'&&principalOf(x.candidate)).map(x=>({introduction:str(x.introduction,128),proposer:principalOf(x.proposer),proposerHandle:str(x.proposerHandle,64),instance:str(x.instance,2048),slot:str(x.slot,128),candidate:principalOf(x.candidate),candidateHandle:str(x.candidateHandle,64),receivedAt:num(x.receivedAt),expiresAt:num(x.expiresAt)}))},
  holds:{holds:list(holds.holds).filter(x=>principalOf(x.counterpart)&&hold(x)).map(x=>({counterpart:principalOf(x.counterpart),...hold(x)})),unreachable:list(holds.unreachable).filter(x=>principalOf(x.counterpart)).map(x=>({counterpart:principalOf(x.counterpart),since:num(x.since),flagged:x.flagged===true}))},
  imports:list(r.imports,512).map(importRow)};
}
const entry=e=>obj(e)&&Number.isSafeInteger(e.index)?{index:e.index,...typeof e.to==='string'?{to:e.to}:{},...typeof e.from==='string'?{from:e.from}:{},fragment:obj(e.fragment)?{fragment:str(e.fragment.fragment,2048),version:e.fragment.version,digest:str(e.fragment.digest,256)}:null,fields:Array.isArray(e.fields)?e.fields.filter(f=>typeof f==='string').slice(0,16):null,methods:obj(e.methods)?Object.fromEntries(Object.entries(e.methods).slice(0,16).filter(([,v])=>obj(v))):{},required:e.required===true,actor_disclosure:e.actor_disclosure==='named'?'named':'pairwise'}:null;
const entries=v=>(Array.isArray(v)?v:[]).slice(0,64).map(entry).filter(Boolean);
/** Pool resources (the organization's own; imports are never listed by the server). */
const poolRow=x=>obj(x)&&typeof x.id==='string'?{id:str(x.id,2048),label:str(x.label,200),contracts:obj(x.contracts)?x.contracts:{},...obj(x.scoping?.fields)?{scoping:{fields:x.scoping.fields}}:{}}:null;
/** Whether a pool resource fits one field of an entry (shares a contract with it). */
export const fits=(resource,contracts)=>Object.keys(contracts??{}).some(c=>Array.isArray(resource?.contracts?.[c]));
function dayEnd(value,now){if(value===undefined||value===null||value==='')return undefined;const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));if(!m)fail('relation_values_invalid');const end=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]),23,59,59).getTime();if(!Number.isFinite(end)||end<=now)fail('relation_values_invalid');return Math.floor(end/1000);}
/**
 * Values for the entries this organization gives, from the console's form. Resources are named by their position in
 * the loaded pool (`res:<entry>:<field>:<n>`), never by a form-supplied identifier; scoping only where the resource
 * offers it. Optional entries with nothing chosen are left out; a required one fails before anything is sent.
 */
export function relationValues(gives,pool,form={},now=Date.now()){
 const out={};
 for(const e of gives){
  const fields=Object.keys(e.methods??{});
  if(!fields.length){if(e.required||form['inc:'+e.index]===true)out[e.index]=[];continue;}
  const items=[],ends=dayEnd(form['exp:'+e.index],now);
  fields.forEach((field,fi)=>pool.forEach((resource,n)=>{
   const key=`${e.index}:${fi}:${n}`;if(form['res:'+key]!==true)return;if(!fits(resource,e.methods[field]))fail('relation_values_invalid');
   const options=resource.scoping?.fields??{},scope={},prefix=String(form['px:'+key]??'').trim();
   if(form['ro:'+key]===true){if(!obj(options.readOnly))fail('relation_values_invalid');scope.readOnly=true;}
   if(prefix){if(!obj(options.prefix)||Number.isSafeInteger(options.prefix.maxLength)&&prefix.length>options.prefix.maxLength||/[\u0000-\u001f]/.test(prefix))fail('relation_values_invalid');scope.prefix=prefix;}
   items.push({resource:resource.id,field,...Object.keys(scope).length?{scope}:{},...ends!==undefined?{expires_at:ends}:{}});
  }));
  if(items.length>16)fail('relation_values_invalid');
  if(items.length)out[e.index]=items;else if(e.required)fail('relation_values_incomplete');
 }
 return out;
}
/** Narrowing from the edge-detail form: the entries (whole, or some of their resources) to keep. */
export function keptEntries(outgoing,form={}){
 const out={};
 for(const e of outgoing?.entries??[]){
  const kept=e.resources.filter((x,k)=>form[`keepr:${e.index}:${k}`]===true).map(x=>x.resource);
  if(form['keep:'+e.index]!==true||e.resources.length&&!kept.length){if(e.required)fail('relation_values_incomplete');continue;}
  out[e.index]=kept.length===e.resources.length?true:kept;
 }
 // Dropping everything is ending the edge, which has its own confirmed action.
 if(!Object.keys(out).length)fail('relation_values_incomplete');
 return out;
}
/** Rebinding after a move: new resources per outgoing entry, from the pool (fields as the edge already had them). */
export function rebindGives(outgoing,pool=[]){
 return (outgoing?.entries??[]).map(e=>{const field=e.resources.find(x=>x.field)?.field??'files',contracts=Object.fromEntries(e.resources.flatMap(x=>Object.entries(x.methods??{})));return {index:e.index,required:e.required===true,actor_disclosure:e.actor_disclosure??'pairwise',methods:{[field]:Object.keys(contracts).length?contracts:Object.fromEntries(pool.flatMap(p=>Object.keys(p.contracts)).map(c=>[c,[]]))}};});
}
export const rebindValues=(outgoing,pool,form={},now=Date.now())=>relationValues(rebindGives(outgoing,pool),pool,form,now);
/** The default fragment landing (`#relation-invitation=<meta>` on the console address): read once, removed from the
 * address bar at once, and kept privately in this tab's sessionStorage until accepted, declined or set aside. */
const LANDING_KEY='3sln-relation-invitation';
export const relationLanding=Object.freeze({
 capture(){try{const hash=globalThis.location?.hash??'';if(!hash.startsWith('#relation-invitation='))return;const url=new URL(globalThis.location.href),org=url.searchParams.get('org'),meta=decodeURIComponent(hash.slice('#relation-invitation='.length));
  globalThis.history?.replaceState(globalThis.history.state,'',url.pathname+url.search);
  globalThis.sessionStorage?.setItem(LANDING_KEY,JSON.stringify({org:UUID.test(org??'')?org:null,meta:validMeta(meta)?meta:null}));}catch{}},
 take(){this.capture();try{const v=JSON.parse(globalThis.sessionStorage?.getItem(LANDING_KEY)??'null');return obj(v)?{org:UUID.test(v.org??'')?v.org:null,meta:validMeta(v.meta)?v.meta:null}:null;}catch{return null;}},
 clear(){try{globalThis.sessionStorage?.removeItem(LANDING_KEY);}catch{}}
});
// The fragment is taken as soon as the console's modules load, before any address rewrite can drop it.
relationLanding.capture();
const definite=error=>Number.isInteger(error?.status)&&error.status>=400&&error.status<500&&error.status!==408;
/** The code shown for a refusal: the server's own (mapped to text by the view) or a generic limit/fallback code. */
export const relationCode=error=>typeof error?.code==='string'&&/^[a-z][a-z0-9_]{0,63}$/.test(error.code)?error.code:error?.status===429?'rate_limited':'unavailable';
const path=(org,suffix='')=>{if(!UUID.test(org??''))fail('organization_required');return '/api/orgs/'+org+'/relations'+suffix;};

/** Loads the tab's data for a context: the admin overview, or for any other member only the imports they hold
 * grants on (RL-13). A non-admin never requests the overview; each read fails closed on its own. */
export async function loadRelations({api,put,id,admin}){
 if(admin){try{const raw=await api.get(path(id));put({relations:normalizeRelations(raw),relationsUnavailable:false});}catch(error){if(error?.code==='organization_changed')throw error;put({relations:null,relationsUnavailable:true});}return;}
 try{const raw=await api.get(path(id,'/imports'));put({relationImports:list(raw?.imports,512).map(importRow)});}catch(error){if(error?.code==='organization_changed')throw error;put({relationImports:[]});}
}
/** After details() loaded a context: an accept landing for this organization opens its acceptance page. */
export async function relationLandingOpen(env){
 const {landing,org}=env,pending=landing?.take?.();if(!pending||pending.org&&pending.org!==org)return;
 env.put({relationsTab:true,relationPane:{kind:'accept'}});
 if(!pending.meta){landing.clear?.();env.put({relationAccept:{invalid:true}});env.focus('#org-rel-accept');return;}
 try{await openAcceptance(env,pending.meta,{landed:true});}catch(error){if(error?.code==='organization_changed')throw error;env.put({relationError:relationCode(error)});}
}
async function openAcceptance(env,meta,extra={}){
 const {api,put,org,focus}=env;put({relationsTab:true,relationPane:{kind:'accept'},relationAccept:{meta,disclosure:null,...extra},relationError:null,relationNotice:null});
 let disclosure;try{disclosure=await api.post(path(org),{operation:'inbound-preview',invitation:meta});}
 catch(error){if(error?.code==='organization_changed')throw error;const code=relationCode(error);if(code==='invitation_invalid'||code==='not_found'){if(extra.landed||env.m.relationAccept?.landed)env.landing?.clear?.();put({relationAccept:{invalid:true,reason:code}});focus('#org-rel-accept');return;}throw error;}
 const d=obj(disclosure)?disclosure:{};
 const view={invitation:str(d.invitation,128),inviter:{identity:str(d.inviter?.identity,2048),handle:str(d.inviter?.handle,64),origin:str(d.inviter?.origin,512)},relation:{id:str(d.relation?.id,2048),title:str(d.relation?.title,200),publisher:str(d.relation?.publisher,2048),pin:pin(d.relation?.pin)},slot:str(d.slot,128),counterpartySlot:str(d.counterpartySlot,128),gives:entries(d.gives),receives:entries(d.receives),
  warnings:(Array.isArray(d.warnings)?d.warnings:[]).filter(w=>['new-counterparty','new-relation','same-title-different-relation'].includes(w)),caveats:(Array.isArray(d.caveats)?d.caveats:[]).filter(c=>typeof c==='string').slice(0,8),expiresAt:num(d.expiresAt),disclosure:str(d.disclosure,256)};
 if(!view.disclosure)fail('relation_disclosure_changed');
 const pool=view.gives.length?await loadPool(env):env.m.relationPool;
 put({relationAccept:{meta,disclosure:view,...extra},...pool?{relationPool:pool}:{}});focus('#org-rel-accept');
}
async function loadPool({api,org,put}){const out=await api.get(path(org,'/resources'));const pool=(Array.isArray(out?.resources)?out.resources:[]).slice(0,256).map(poolRow).filter(Boolean);put({relationPool:pool});return pool;}

/**
 * The `rel-*` steps of OrganizationsIntent. `env`: {r, m, v, d, a, org, admin, api:{get,post}, put, focus, call,
 * landing, copy, details}. Errors are kept on the tab (relationError) as codes, mapped to text by the view.
 */
export async function relationsIntent(env){
 try{await relationStep(env);}
 catch(error){if(error?.code==='organization_changed')throw error;env.put({relationError:relationCode(error)});}
}
async function relationStep(env){
 const {m,v,d,a,org,api,put,focus}=env,rel=m.relations,w=m.relationWizard,now=Date.now();
 const reload=async()=>{await loadRelations({api,put,id:org,admin:true});};
 const counterpart=(instance,key)=>{const i=rel?.instances.find(x=>x.instance===instance),c=i?.counterparts.find(x=>principalKey(x.principal)===key);if(!i||!c)fail('not_found');return {i,c};};
 const knownOrganization=key=>[...(rel?.instances??[]).flatMap(i=>i.counterparts.map(c=>c.principal)),...(rel?.inbound.items??[]).map(x=>x.from),...(rel?.inbound.introductions??[]).flatMap(x=>[x.proposer,x.candidate])].find(p=>p&&principalKey(p)===key)??null;
 const widen=()=>{if(!rel?.enabled||rel.closing)fail('relation_unavailable');if(rel.billing!=='active')fail('relation_billing_lapsed');};
 // One operation; a definite refusal applied nothing. An uncertain outcome refreshes the overview and says so.
 const op=async(operation,input,notice)=>{put({relationError:null,relationNotice:null});let result;
  try{result=await api.post(path(org),{operation,...input});}
  catch(error){if(error?.code==='organization_changed')throw error;if(!definite(error)){try{await reload();}catch{}fail('change_uncertain');}if(error?.status===404)try{await reload();}catch{}throw error;}
  if(notice)put({relationNotice:notice});try{await reload();}catch{put({relationError:'saved_stale'});}return result;};
 const step=next=>{put({relationWizard:next,relationError:null,relationNotice:null});focus('#org-rel-step');};
 if(a==='rel-tab'){put({relationsTab:d.tab==='relationships',relationPane:null,relationError:null,relationNotice:null});focus(d.tab==='relationships'?'#org-relations':'#org-details');return;}
 if(!env.admin){fail('not_found');}
 if(a==='rel-reload'){await reload();return;}
 if(a==='rel-export'){
  put({relationError:null,relationNotice:null});
  const records=[],seen=new Set();let after=null,version,organization;
  do{
   const page=await api.get(path(org,'/export')+(after?'?after='+encodeURIComponent(after):''));
   if(!obj(page)||!Array.isArray(page.records)||page.version!==1||!principalOf(page.organization)||after&&(page.version!==version||principalKey(page.organization)!==principalKey(organization)))fail('unavailable');
   version=page.version;organization=principalOf(page.organization);records.push(...page.records);
   after=typeof page.next==='string'&&page.next?page.next:null;
   if(after&&(seen.has(after)||seen.size>=10000))fail('unavailable');if(after)seen.add(after);
  }while(after);
  env.download('organization-relations-'+org+'.json',JSON.stringify({version,organization,records},null,2));
  put({relationNotice:'relation_exported'});return;
 }

 if(a==='rel-pane'){put({relationPane:d.pane==='imports'?{kind:'imports'}:null,relationError:null,relationNotice:null});focus(d.pane==='imports'?'#org-rel-imports':'#org-relations');return;}
 if(a==='rel-back'){put({relationPane:null,relationAccept:null,relationAdmit:null,relationRebind:null,relationError:null});focus('#org-relations');return;}
 if(a==='rel-edge'){counterpart(d.instance,d.counterpart);put({relationPane:{kind:'edge',instance:d.instance,counterpart:d.counterpart},relationRebind:null,relationError:null,relationNotice:null});focus('#org-rel-edge');return;}
 // "Share with an organization": one question per step; nothing is created before the reviewed last step.
 if(a==='rel-wizard-open'){widen();const out=await api.get(path(org,'/catalogue'));const catalogue=(Array.isArray(out?.relations)?out.relations:[]).filter(x=>obj(x)&&typeof x.key==='string'&&pin(x.pin)).slice(0,32).map(x=>({key:str(x.key,64),title:str(x.title,200),description:str(x.description,1000),publisher:str(x.publisher,2048),listedBy:str(x.listedBy,64),pin:pin(x.pin),slots:list(x.slots,8).filter(s=>typeof s.name==='string').map(s=>({name:str(s.name,128),title:str(s.title,200),min:num(s.min),max:num(s.max)}))}));
  put({relationPane:{kind:'wizard'},relationIssued:null});step({step:'relation',catalogue});return;}
 if(a==='rel-wizard-cancel'){put({relationWizard:null,relationPane:null});focus('#org-relations');return;}
 if(a==='rel-wizard-back'){if(!w)return;const i=RELATION_STEPS.indexOf(w.step);if(i<=0){put({relationWizard:null,relationPane:null});focus('#org-relations');return;}step({...w,step:RELATION_STEPS[i-1],...w.step==='counterparty'?{found:null}:{}});return;}
 if(a==='rel-wizard-relation'){if(w?.step!=='relation')fail('review_required');const relation=w.catalogue.find(x=>x.key===v.relation||typeof v.relationUrl==='string'&&x.pin.artefact===v.relationUrl.trim());if(!relation)fail('review_required');step({...w,step:'slot',relation,slot:null,matrix:null,found:null,counterparty:null,values:null});return;}
 if(a==='rel-wizard-slot'){if(w?.step!=='slot')fail('review_required');const slot=w.relation.slots.find(s=>s.name===v.slot);if(!slot)fail('review_required');
  const others=w.relation.slots.filter(s=>s.name!==slot.name),invite=(others[0]??slot).name;
  const out=await api.post(path(org),{operation:'preview',relation:w.relation.pin,slot:slot.name}),matrix=obj(out?.matrix)?out.matrix:{};
  const gives=entries(matrix.gives).filter(e=>!e.to||e.to===invite),receives=entries(matrix.receives).filter(e=>!e.from||e.from===invite);
  const pool=gives.length?await loadPool(env):[];
  step({...w,step:'counterparty',slot:slot.name,invite,matrix:{gives,receives},warnings:(Array.isArray(out?.warnings)?out.warnings:[]).filter(x=>['new-relation','same-title-different-relation'].includes(x)),pool,found:null,counterparty:null,values:null});return;}
 if(a==='rel-wizard-find'){if(w?.step!=='counterparty')fail('review_required');const handle=String(v.handle??'').trim().replace(/^@/,'').split('@')[0];if(!HANDLE.test(handle))fail('invitee_unrecognized');
  let out;try{out=await api.post(path(org,'/counterparty'),{handle});}catch(error){if(error?.status===404)fail('counterparty_unavailable');throw error;}
  const c=out?.counterparty,p=principalOf(c);if(!p)fail('counterparty_unavailable');
  const seen=(rel?.instances??[]).some(i=>i.counterparts.some(x=>principalKey(x.principal)===principalKey(p)));
  step({...w,found:{...p,handle:str(c.handle,64),name:str(c.name,200),identity:str(c.identity,2048)??identityURI(p),origin:str(c.origin,512)??p.iss,seen}});return;}
 if(a==='rel-wizard-unfind'){if(w?.step!=='counterparty')fail('review_required');step({...w,found:null});return;}
 if(a==='rel-wizard-counterparty'){if(w?.step!=='counterparty'||!w.found)fail('review_required');step({...w,step:'values',counterparty:w.found});return;}
 if(a==='rel-wizard-values'){if(w?.step!=='values'||!w.counterparty)fail('review_required');const values=relationValues(w.matrix.gives,w.pool??[],v,now);step({...w,step:'review',values});return;}
 if(a==='rel-wizard-create'){
  if(w?.step!=='review'||!w.counterparty||!w.values||!w.slot||v.confirm!==true)fail('review_required');widen();
  const days=INVITATION_DAYS.includes(Number(v.expiresInDays))?Number(v.expiresInDays):7,expiresAt=now+days*86400000-60000;
  // A created instance is kept on the wizard, so a refused invitation (step-up cancelled, limit) is retried without
  // creating a second instance.
  let instance=w.instance;if(!instance){const out=await op('create',{relation:w.relation.pin,slots:[w.slot]});instance=str(out?.instance,2048);if(!instance)fail('unavailable');put({relationWizard:{...w,instance}});}
  const result=await op('invite',{instance,as:w.slot,slot:w.invite,invitee:{iss:w.counterparty.iss,sub:w.counterparty.sub},...Object.keys(w.values).length?{values:w.values}:{},receive:v.receive===true&&w.matrix.receives.length>0,expiresAt},'relation_invited');
  put({relationWizard:null,relationPane:null,relationIssued:{invitation:validMeta(result?.invitation)?result.invitation:null,jti:str(result?.jti,128),expiresAt:num(result?.expiresAt),counterparty:w.counterparty,accept:w.counterparty.iss+'/relations/accept'}});focus('#org-rel-issued');return;}
 if(a==='rel-copy'){const code=m.relationIssued?.invitation;if(!code)fail('review_required');try{await env.copy(code);}catch{fail('copy_failed');}put({relationNotice:'relation_copied',relationError:null});return;}
 if(a==='rel-issued-dismiss'){put({relationIssued:null,relationNotice:null});focus('#org-relations');return;}
 if(a==='rel-withdraw'){const inv=rel?.invitations.find(x=>x.invitation===d.invitation);if(!inv)fail('not_found');await op('withdraw',{invitation:inv.invitation},'relation_withdrawn');if(m.relationIssued?.jti===inv.invitation)put({relationIssued:null});return;}
 // Acceptance: from an inbound activity item, a pasted code, or the accept landing.
 if(a==='rel-inbound'){const item=rel?.inbound.items.find(x=>x.invitation===d.invitation);if(!item)fail('not_found');await openAcceptance(env,item.meta,{item:item.invitation});return;}
 if(a==='rel-paste'){const code=String(v.invitation??'').trim();if(!validMeta(code))fail('invitation_invalid');await openAcceptance(env,code);return;}
 if(a==='rel-accept'){const x=m.relationAccept,dis=x?.disclosure;if(!dis||x.invalid||v.confirm!==true)fail('review_required');widen();
  const values=relationValues(dis.gives,m.relationPool??[],v,now);
  try{await op('accept',{invitation:x.meta,disclosure:dis.disclosure,...Object.keys(values).length?{values}:{},receive:v.receive===true&&dis.receives.length>0},'relation_accepted');}
  catch(error){const code=relationCode(error);if(code==='relation_disclosure_changed'){await openAcceptance(env,x.meta,{landed:x.landed,item:x.item});}else if(code==='invitation_invalid'){if(x.landed)env.landing?.clear?.();put({relationAccept:{invalid:true,reason:code}});}throw error;}
  if(x.landed)env.landing?.clear?.();put({relationAccept:null,relationPane:null});focus('#org-relations');return;}
 if(a==='rel-accept-decline'){const x=m.relationAccept,item=x?.disclosure?.invitation??x?.item;if(!item)fail('review_required');await op('decline',{item},'relation_declined');if(x.landed)env.landing?.clear?.();put({relationAccept:null,relationPane:null});focus('#org-relations');return;}
 if(a==='rel-accept-close'){if(m.relationAccept?.landed||m.relationAccept?.invalid)env.landing?.clear?.();put({relationAccept:null,relationPane:null,relationError:null});focus('#org-relations');return;}
 if(a==='rel-decline'){const item=rel?.inbound.items.find(x=>x.invitation===d.item)?.invitation??rel?.inbound.introductions.find(x=>x.introduction===d.item)?.introduction;if(!item)fail('not_found');await op('decline',{item},'relation_declined');return;}
 if(a==='rel-mute'){const organization=knownOrganization(d.organization);if(!organization||v.confirm!==true)fail('review_required');await op('mute',{organization,muted:true},'relation_muted');return;}
 // Edge changes. Narrowing never needs a step-up; Resume is widening (the server asks for the security check).
 if(['rel-suspend','rel-end','rel-resume'].includes(a)){const {i,c}=counterpart(d.instance,d.counterpart),direction=d.direction==='incoming'?'incoming':'outgoing';
  if(a==='rel-end'&&v.confirm!==true)fail('review_required');if(a==='rel-resume')widen();
  await op(a.slice(4),{instance:i.instance,counterpart:c.principal,direction},a==='rel-suspend'?'relation_suspended':a==='rel-end'?'relation_ended':'relation_resumed');return;}
 if(a==='rel-narrow'){const {i,c}=counterpart(d.instance,d.counterpart);if(v.confirm!==true)fail('review_required');await op('narrow',{instance:i.instance,counterpart:c.principal,entries:keptEntries(c.outgoing,v)},'relation_narrowed');return;}
 if(a==='rel-leave'){const i=rel?.instances.find(x=>x.instance===d.instance);if(!i||v.confirm!==true)fail('review_required');await op('leave',{instance:i.instance},'relation_left');put({relationPane:null});focus('#org-relations');return;}
 if(a==='rel-introduce'){const {i,c}=counterpart(d.instance,d.counterpart);if(!(c.outgoing.live||c.incoming.live)||v.confirm!==true)fail('review_required');if(!rel.enabled)fail('relation_unavailable');await op('introduce',{instance:i.instance,slot:c.slot,candidate:c.principal},'relation_introduced');return;}
 // Introductions received: admitting issues an invitation with this organization's own values (widening).
 if(a==='rel-admit-open'){const x=rel?.inbound.introductions.find(y=>y.introduction===d.introduction);if(!x)fail('not_found');widen();const i=rel.instances.find(y=>y.instance===x.instance);if(!i?.relation||!i.slots.length)fail('relation_introduction_invalid');
  const as=i.slots[0],out=await api.post(path(org),{operation:'preview',relation:i.relation,slot:as}),matrix=obj(out?.matrix)?out.matrix:{};
  const gives=entries(matrix.gives).filter(e=>!e.to||e.to===x.slot),receives=entries(matrix.receives).filter(e=>!e.from||e.from===x.slot);if(gives.length)await loadPool(env);
  put({relationAdmit:{introduction:x.introduction,as,title:i.title,gives,receives},relationPane:{kind:'admit'},relationError:null,relationNotice:null});focus('#org-rel-admit');return;}
 if(a==='rel-admit'){const x=m.relationAdmit;if(!x||v.confirm!==true)fail('review_required');widen();const values=relationValues(x.gives,m.relationPool??[],v,now);
  const result=await op('admit',{introduction:x.introduction,...Object.keys(values).length?{values}:{},receive:v.receive===true&&x.receives.length>0,as:x.as},'relation_invited');
  const intro=rel.inbound.introductions.find(y=>y.introduction===x.introduction);
  put({relationAdmit:null,relationPane:null,relationIssued:validMeta(result?.invitation)?{invitation:result.invitation,jti:str(result?.jti,128),expiresAt:num(result?.expiresAt),counterparty:intro?{...intro.candidate,handle:intro.candidateHandle}:null,accept:intro?intro.candidate.iss+'/relations/accept':null}:null});focus(validMeta(result?.invitation)?'#org-rel-issued':'#org-relations');return;}
 // RL-4: a hold is released only by an admin's confirmation bound to the hold's own `aep` (from the loaded row).
 if(a==='rel-hold-confirm'){const h=rel?.holds.holds.find(x=>principalKey(x.counterpart)===d.counterpart);if(!h)fail('relation_hold_changed');widen();await op('confirm-counterpart',{counterpart:h.counterpart,aep:h.aep},'relation_confirmed');return;}
 // Rebinding after this organization's move: new values from the pool for each outgoing entry.
 if(a==='rel-rebind-open'){const {c}=counterpart(d.instance,d.counterpart);if(c.outgoing.cause!=='moved')fail('review_required');widen();await loadPool(env);put({relationPane:{kind:'edge',instance:d.instance,counterpart:d.counterpart},relationRebind:{instance:d.instance,counterpart:d.counterpart},relationError:null});focus('#org-rel-rebind');return;}
 if(a==='rel-rebind'){const x=m.relationRebind;if(!x)fail('review_required');const {i,c}=counterpart(x.instance,x.counterpart);if(c.outgoing.cause!=='moved'||v.confirm!==true)fail('review_required');widen();
  await op('rebind',{instance:i.instance,counterpart:c.principal,values:rebindValues(c.outgoing,m.relationPool??[],v,now)},'relation_rebound');put({relationRebind:null});return;}
 if(a==='rel-audit'){put({relationsTab:false,relationPane:null});await env.audit();focus('#org-audit');return;}
 fail('invalid_request');
}
