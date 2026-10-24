import {Provider} from '../shared/stack.mjs';
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
// Thin HTTP port. The person session remains the authentication context; organization
// routing is explicit and never replaces the API's selected account or its CSRF binding.
const READS={list:'',get:'',members:'/members',audit:'/audit',membership:'/membership',requests:'/requests',connections:'/connections',preferences:'/preferences',ownership:'/ownership',plans:'/plans','break-glass-view':'/break-glass','break-glass-items':'/break-glass'};
const WRITES={create:'',rename:'/name',label:'/label',invite:'/invitations',accept:'/accept',leave:'/leave',remove:'/remove-member',grants:'/member-grants',decide:'/grant-decision',connection:'/connections',preference:'/preferences',
 'creation-checkout':'/checkout','billing-checkout':'/billing-checkout',transfer:'/transfer','transfer-recipient':'/transfer-recipient',claim:'/claim','recovery-file':'/recovery-file',invitee:'/invitee','invitation-preview':'/invitation-preview','invitation-revoke':'/invitation-revoke','break-glass':'/break-glass','break-glass-checkout':'/break-glass-checkout'};
// Root-level paths (no organization id) and organization paths must not be confused.
const ROOT_ONLY=new Set(['list','plans','create','creation-checkout','break-glass-items']);
export function createOrganizationsPort(){const tabs=recoveryTabs();return Object.freeze({
 async call(action,input,{api,org}={}){
  if(org!==undefined&&!uuid.test(org))throw Object.assign(Error('invalid_organization'),{code:'invalid_organization'});
  if(ROOT_ONLY.has(action)!==(org===undefined)&&!['list','create'].includes(action))throw Object.assign(Error('invalid_request'),{code:'invalid_request'});
  const root='/api/orgs'+(org===undefined?'':'/'+org);
  // Paged reads carry only their cursors as query parameters (members: after, requestsAfter).
  if(Object.hasOwn(READS,action)){const query=action==='members'&&input&&typeof input==='object'?new URLSearchParams(Object.entries(input).filter(([k,v])=>['after','requestsAfter','limit'].includes(k)&&v!==undefined&&v!==null&&v!=='').map(([k,v])=>[k,String(v)])).toString():'';return api.get(root+READS[action]+(query?'?'+query:''));}
  if(action==='cancel-deletion'){if(org===undefined)throw Object.assign(Error('invalid_request'),{code:'invalid_request'});return api.request(root+'/deletion',undefined,'DELETE');}
  if(!Object.hasOwn(WRITES,action))throw Object.assign(Error('invalid_request'),{code:'invalid_request'});
  return api.request(root+WRITES[action],input);
 },
 id:()=>crypto.randomUUID(),passphrase:()=>{const bytes=crypto.getRandomValues(new Uint8Array(32));return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');},
 // F-1: which organizations still need their recovery file saved, per person account. Only organization ids are kept
 // (never the file, the passphrase or any key material), so the console can warn after a reload or navigation.
 unsaved:Object.freeze({list:owner=>readUnsaved(owner),add:(owner,org)=>writeUnsaved(owner,[...new Set([...readUnsaved(owner),org])]),remove:(owner,org)=>writeUnsaved(owner,readUnsaved(owner).filter(id=>id!==org))}),
 // M3: which organization recovery files this browser's other tabs are saving right now (see recoveryTabs below).
 recoveryTabs:tabs,
 // F-3: an invitation opened while signed out survives sign-in or signup in this tab only (sessionStorage, cleared when
 // the tab closes, on acceptance or when dismissed). It is a bounded routing hint; the server validates it on accept.
 invitation:Object.freeze({get:()=>{try{const v=JSON.parse(sessionStorage.getItem(INVITATION_KEY)??'null');return v&&uuid.test(v.org)&&typeof v.invitation==='string'&&v.invitation.length<=8192&&/^[A-Za-z0-9_.-]+$/.test(v.invitation)?{org:v.org,invitation:v.invitation}:null;}catch{return null;}},
  set:value=>{try{if(value)sessionStorage.setItem(INVITATION_KEY,JSON.stringify({org:value.org,invitation:value.invitation}));else sessionStorage.removeItem(INVITATION_KEY);}catch{}}}),
 copy:async text=>{await navigator.clipboard.writeText(String(text));return true;}
});}
const INVITATION_KEY='3sln-org-invitation',UNSAVED_PREFIX='3sln-org-recovery-unsaved:';
function readUnsaved(owner){if(typeof owner!=='string'||!owner)return [];try{const v=JSON.parse(localStorage.getItem(UNSAVED_PREFIX+owner)??'[]');return Array.isArray(v)?v.filter(id=>typeof id==='string'&&uuid.test(id)).slice(0,64):[];}catch{return [];}}
function writeUnsaved(owner,list){if(typeof owner!=='string'||!owner)return [];const clean=list.filter(id=>typeof id==='string'&&uuid.test(id)).slice(0,64);try{if(clean.length)localStorage.setItem(UNSAVED_PREFIX+owner,JSON.stringify(clean));else localStorage.removeItem(UNSAVED_PREFIX+owner);}catch{}return clean;}
// M3: cross-tab coordination of the organization recovery step. A tab saving a file claims its organization in
// localStorage ({tab, issue, at}) and refreshes the claim while it is open; other tabs treat a claim younger than
// RECOVERY_CLAIM_TTL as "being saved in another tab". The latest issue per organization lets a tab detect that another
// tab issued a newer file (which rotates the key and invalidates this copy). Only organization ids, random issue ids
// and timestamps are stored: never the file, the passphrase or any key material. Storage failures degrade to no
// coordination (the server still decides every reissue).
const ACTIVE_PREFIX='3sln-org-recovery-active:',RECOVERY_CLAIM_TTL=60000,RECOVERY_HEARTBEAT=15000;
export function recoveryTabs({storage=()=>globalThis.localStorage,now=()=>Date.now(),tab=globalThis.crypto?.randomUUID?.()??String(Math.random()),schedule=globalThis.setInterval?.bind(globalThis),cancel=globalThis.clearInterval?.bind(globalThis)}={}){
 const read=owner=>{try{const v=JSON.parse(storage().getItem(ACTIVE_PREFIX+owner)??'{}');return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}catch{return {};}};
 const write=(owner,value)=>{try{const clean=Object.fromEntries(Object.entries(value).filter(([id,row])=>uuid.test(id)&&row&&typeof row==='object').slice(0,64));if(Object.keys(clean).length)storage().setItem(ACTIVE_PREFIX+owner,JSON.stringify(clean));else storage().removeItem(ACTIVE_PREFIX+owner);}catch{}};
 const mine=new Map();let timer=null,hidden=null;
 const beat=()=>{for(const [key,issue] of mine){const [owner,org]=key.split('\n'),all=read(owner),row=all[org];if(row?.tab===tab&&row.issue===issue)write(owner,{...all,[org]:{...row,at:now()}});else mine.delete(key);}if(!mine.size&&timer!==null){cancel?.(timer);timer=null;}};
 const valid=owner=>typeof owner==='string'&&owner.length>0;
 return Object.freeze({
  /** This tab starts saving a newly issued file for `org`. */
  claim(owner,org,issue){if(!valid(owner)||!uuid.test(org??''))return;write(owner,{...read(owner),[org]:{tab,issue:String(issue).slice(0,128),at:now(),saving:true}});mine.set(owner+'\n'+org,String(issue).slice(0,128));if(timer===null&&schedule)timer=schedule(beat,RECOVERY_HEARTBEAT);if(!hidden&&typeof globalThis.addEventListener==='function'){hidden=()=>{for(const key of [...mine.keys()]){const [o,id]=key.split('\n');this.release(o,id);}};globalThis.addEventListener('pagehide',hidden);}},
  /** This tab finished or abandoned its step: the claim ends, the latest issue stays recorded. */
  release(owner,org,issue){if(!valid(owner))return;const all=read(owner),row=all[org];mine.delete(owner+'\n'+org);if(row?.tab===tab&&(issue===undefined||row.issue===issue))write(owner,{...all,[org]:{issue:row.issue,at:row.at}});},
  /** Organizations another tab is saving now. */
  active(owner){if(!valid(owner))return [];const at=now();return Object.entries(read(owner)).filter(([,row])=>row.saving===true&&row.tab!==tab&&Number.isFinite(row.at)&&at-row.at<RECOVERY_CLAIM_TTL&&row.at<=at+RECOVERY_CLAIM_TTL).map(([id])=>id);},
  /** The most recently issued file for `org` in this browser (any tab), or null. */
  latest(owner,org){if(!valid(owner))return null;const row=read(owner)[org];return typeof row?.issue==='string'?row.issue:null;},
  dispose(){if(timer!==null)cancel?.(timer);timer=null;if(hidden)globalThis.removeEventListener?.('pagehide',hidden);hidden=null;for(const key of mine.keys()){const [owner,org]=key.split('\n');this.release(owner,org);}mine.clear();}
 });
}
// One port per engine, so this tab's recovery claims (and their heartbeat) outlive a single action.
export default class OrganizationsProvider extends Provider{obtain(){return this.port??=createOrganizationsPort();}release(){}async dispose(){this.port?.recoveryTabs.dispose();this.port=null;}}
