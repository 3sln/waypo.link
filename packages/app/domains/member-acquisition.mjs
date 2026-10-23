// ORG-6a top-level consent. Exact registered redirects establish the observed client origin (R2-M3).
// The account issuer retains the consent, PoP, epoch and revocation semantics; this slice only composes its ports.
import {AppAction,AppQuery,ownerOf} from '../engine.mjs';
import {fault} from '../faults.mjs';
import {MEMBER_PURPOSES} from '../../identity/member-certificates.mjs';
import {originValid} from '../../identity/delegation.mjs';
const ACCESS=Object.freeze([MEMBER_PURPOSES.access]);
const invalid=()=>fault('invalid_request','Choose a registered application redirect and an organization identity.',400);
async function inspect(actor,input,{config,federationStore}){
 const subject=ownerOf(actor);if(!input||typeof input!=='object'||Array.isArray(input))invalid();
 const {client_id,redirect_uri,aud}=input;
 if(typeof client_id!=='string'||!client_id||client_id.length>200||typeof redirect_uri!=='string'||redirect_uri.length>2048||typeof aud!=='string'||aud.length>2048)invalid();
 if(!config.enabled(client_id))fault('not_found','Not found.',404);
 let redirect,organization;try{redirect=new URL(redirect_uri);organization=new URL(aud);}catch{invalid();}
 if(redirect.href!==redirect_uri||redirect.username||redirect.password||redirect.hash||!originValid(redirect.origin,config.allowLoopback)||organization.href!==aud||organization.username||organization.password||organization.hash||organization.search||!originValid(organization.origin,config.allowLoopback)||!/^\/identity\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(organization.pathname))invalid();
 const registered=await federationStore.resolve(client_id);
 if(registered?.id!==client_id||registered.origin!==redirect.origin||!registered.redirectUris?.includes(redirect_uri))fault('invalid_client','Unregistered application or redirect.',400);
 return {view:{subject,issuer:config.issuer,aud,client:{client_id,origin:redirect.origin},redirectUri:redirect_uri,purposes:[...ACCESS]},registered};
}
const text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(value)?value:null;
// Review M2: the consent screen names the organization and the app. `organizations.describe(aud)` reads the local
// record or the directory and never membership (ORG-D9); the answer reaches only the authenticated member's page.
async function describe(aud,organizations){
 let found=null;try{found=await organizations?.describe(aud);}catch{found=null;}
 const name=text(found?.name,80),handle=text(found?.handle,320),verified=found?.verified===true&&(name!==null||handle!==null);
 return {name:verified?name:null,handle:verified?handle:null,host:new URL(aud).host,verified,source:['local','directory'].includes(found?.source)?found.source:null};
}
export class InspectMemberAcquisition extends AppQuery {
 static operation='member-acquisition.inspect';static deps=['config','federationStore','organizations'];
 async fetch(ports){
  if(Object.keys(this.input??{}).some(k=>!['client_id','redirect_uri','aud'].includes(k)))invalid();
  const {view,registered}=await inspect(this.actor,this.input,ports);
  // The registered name is the verified label (a metadata-document client's host, or the operator's name); a
  // self-declared client_name is only ever a claim.
  const app={name:text(registered.name,100)??view.client.origin,claimedName:registered.reviewed===true?null:text(registered.claimedName,100),reviewed:registered.reviewed===true||!('reviewed' in registered)};
  return {...view,organization:await describe(view.aud,ports.organizations),app};
 }
}
export class AcquireMemberCertificate extends AppAction {
 static operation='member-acquisition.acquire';static deps=['config','federationStore','accounts'];
 async run(ports){
  const input=this.input;if(!input||Object.keys(input).some(k=>!['client_id','redirect_uri','aud','delegate','proof','consent'].includes(k))||input.consent!==true)invalid();
  const {view}=await inspect(this.actor,input,ports),account=ports.accounts.get(view.subject);
  // Review M1: consent and issuance commit together, so a refused or stale proof leaves no active consent behind.
  const issued=await account.memberCertificateAcquire(view.subject,{client:view.client,input:{aud:view.aud,purposes:view.purposes,delegate:input.delegate,proof:input.proof}});
  return {...issued,client:view.client,aud:view.aud};
 }
}
