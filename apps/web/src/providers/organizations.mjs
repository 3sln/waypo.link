import {Provider} from '../shared/stack.mjs';
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
// Thin HTTP port. The person session remains the authentication context; organization
// routing is explicit and never replaces the API's selected account or its CSRF binding.
const READS={list:'',get:'',members:'/members',audit:'/audit',membership:'/membership',requests:'/requests',connections:'/connections',preferences:'/preferences',ownership:'/ownership',plans:'/plans'};
const WRITES={create:'',rename:'/name',label:'/label',invite:'/invitations',accept:'/accept',leave:'/leave',remove:'/remove-member',grants:'/member-grants',decide:'/grant-decision',connection:'/connections',preference:'/preferences',
 'creation-checkout':'/checkout','billing-checkout':'/billing-checkout',transfer:'/transfer','transfer-recipient':'/transfer-recipient',claim:'/claim','recovery-file':'/recovery-file',invitee:'/invitee','invitation-preview':'/invitation-preview','invitation-revoke':'/invitation-revoke'};
// Root-level paths (no organization id) and organization paths must not be confused.
const ROOT_ONLY=new Set(['list','plans','create','creation-checkout']);
export function createOrganizationsPort(){return Object.freeze({
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
 // F-3: an invitation opened while signed out survives sign-in or signup in this tab only (sessionStorage, cleared when
 // the tab closes, on acceptance or when dismissed). It is a bounded routing hint; the server validates it on accept.
 invitation:Object.freeze({get:()=>{try{const v=JSON.parse(sessionStorage.getItem(INVITATION_KEY)??'null');return v&&uuid.test(v.org)&&typeof v.invitation==='string'&&v.invitation.length<=8192&&/^[A-Za-z0-9_.-]+$/.test(v.invitation)?{org:v.org,invitation:v.invitation}:null;}catch{return null;}},
  set:value=>{try{if(value)sessionStorage.setItem(INVITATION_KEY,JSON.stringify({org:value.org,invitation:value.invitation}));else sessionStorage.removeItem(INVITATION_KEY);}catch{}}}),
 copy:async text=>{await navigator.clipboard.writeText(String(text));return true;}
});}
const INVITATION_KEY='3sln-org-invitation',UNSAVED_PREFIX='3sln-org-recovery-unsaved:';
function readUnsaved(owner){if(typeof owner!=='string'||!owner)return [];try{const v=JSON.parse(localStorage.getItem(UNSAVED_PREFIX+owner)??'[]');return Array.isArray(v)?v.filter(id=>typeof id==='string'&&uuid.test(id)).slice(0,64):[];}catch{return [];}}
function writeUnsaved(owner,list){if(typeof owner!=='string'||!owner)return [];const clean=list.filter(id=>typeof id==='string'&&uuid.test(id)).slice(0,64);try{if(clean.length)localStorage.setItem(UNSAVED_PREFIX+owner,JSON.stringify(clean));else localStorage.removeItem(UNSAVED_PREFIX+owner);}catch{}return clean;}
export default class OrganizationsProvider extends Provider{obtain(){return createOrganizationsPort();}release(){}}
