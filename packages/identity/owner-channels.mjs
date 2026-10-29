// ORG-12b: the production owner-channels adapter for break-glass (docs/architecture/organizations-design.md §12d.3,
// §12d.8, §12d.12). Provisional (coordinator), not signed off by the user, and unreviewed. 3sln.me provider policy.
//
// The organization's single writer (packages/orgs/break-glass.mjs) asks this port, outside its transactions, for:
//   snapshot(owner, {org, at}) -> {status, lastInteractiveAt, channels:[{id, kind, enrolledAt, domainHashes?}]}
//     the owner's person-account channels as they stood at T1: confirmed emails (the current one and any replaced in the
//     30 days before), push subscriptions, passkeys (known credentials), and live sessions created
//     before `at` (known sessions); plus the last interactive sign-in (`lastInteractiveAt`, written by the identity
//     service on passkey and email sign-in and on step-up; null when unknown, which means Track S).
//     Email and push come first because the engine keeps at most 16 channels.
//   domains({org, principals}) -> [{hashes:[hex]}]
//     the email domains the organization and the named local principals control, as suffix hashes.
//   notify(owner, {org, claim, event, channel, kind, abort?}) -> {accepted}
//     one notice on one recorded channel: an email (with the single-use abort link) or a push notification; for a known
//     session or credential, acceptance means the sign-in interstitial will show it (served from the owner's hint row).
//
// Privacy: channel ADDRESSES never cross the port. Channel ids are HMACs of (kind, owner, value) under a key derived from
// the deployment secret, so a stored claim reveals no address and no push endpoint. Email domains are hashed on arrival
// with the engine's own suffix-and-IDNA rule (`emailDomainHashes`), so the engine never sees a domain either.
// Acceptance means the mail provider or push service accepted the message, never that it was delivered.
//
// Inputs (all injected by the adapters; nothing here touches a platform API):
//   origin    the app origin (abort links, and the issuer that marks a principal as local)
//   identity  (sub) -> Promise<identity record | null>   the raw person record (sessions, credentials, emails)
//   push      {list(owner) -> [{id, createdAt}], send(owner, {subscription, notice}) -> {accepted}} | null
//             the owner's own account object (packages/runtime/account/orgs.mjs orgsBreakGlassPush)
//   mailer    {sendBreakGlassNotice({email, event, orgHandle, abortUrl})} | null
//   secret    the deployment secret (KEY_ENCRYPTION_KEY), at least 16 characters
import {emailDomainHashes} from '../orgs/break-glass.mjs';
import {confirmedEmails,noticeEmail} from './emails.mjs';

const DAY=86400000,LOOKBACK_MS=30*DAY,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN=/^bg1\.[0-9a-f-]{36}\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/,HANDLE=/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** Engine notice events, grouped into the owner-facing notice kinds the mail and push templates know. */
export const OWNER_NOTICE_KINDS=Object.freeze({start:'claim-started',paid:'wait-started',remind:'reminder','remind-72h':'final-reminder',object:'held',liveness:'held',dispute:'held',undelivered:'held',proceed:'proceed',effect:'effective',
 abort:'ended',tier1:'ended','owner-active':'ended',withdraw:'ended',ineligible:'ended',lapse:'ended',unpaid:'ended',superseded:'ended','support-abort':'ended',expire:'ended'});
export const OWNER_NOTICE_KIND_LIST=Object.freeze([...new Set(Object.values(OWNER_NOTICE_KINDS)),'update']);
export const ORG_CLAIM_ABORT_PATH='/org-claim/abort';
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const safe=v=>Number.isSafeInteger(v)&&v>=0;
const domainOf=email=>typeof email==='string'&&email.includes('@')?email.slice(email.lastIndexOf('@')+1):null;

/** The abort link for one token: the capability stays in the fragment (never sent to the server on GET). */
/** Review M2: the organization's public handle rides along, for the page to show and ask the owner to type. */
export function orgClaimAbortUrl(origin,org,token,handle=null){if(!UUID.test(org??'')||!TOKEN.test(token??''))return null;return `${origin}${ORG_CLAIM_ABORT_PATH}#org=${org}&token=${token}${typeof handle==='string'&&HANDLE.test(handle)?'&handle='+handle:''}`;}

export function ownerChannelsAdapter({origin,identity,push=null,mailer=null,secret}={}){
 if(typeof origin!=='string'||!origin||typeof identity!=='function')throw new TypeError('An origin and an identity reader are required.');
 if(typeof secret!=='string'||secret.length<16)throw new TypeError('A deployment secret of at least 16 characters is required.');
 let key=null;
 const id=async(kind,owner,value)=>{key??=await crypto.subtle.importKey('raw',new TextEncoder().encode('bindle-org-owner-channel-v1\0'+secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(kind+'\0'+owner+'\0'+value)));return kind+':'+Array.from(bytes.slice(0,16),b=>b.toString(16).padStart(2,'0')).join('');};
 const local=p=>plain(p)&&(p.iss??null)===origin&&UUID.test(p.sub??'');
 const record=async sub=>{try{const r=await identity(sub);return r&&r.id===sub?r:null;}catch{return undefined;}};
 /** Confirmed emails of a person record: the current one, and replaced ones still retained (replaced after `since`). */
 const emails=(r,since)=>{const out=[];for(const entry of confirmedEmails(r))if(safe(entry.verifiedAt))out.push({email:entry.address,verifiedAt:entry.verifiedAt});
  for(const e of Array.isArray(r?.previousEmails)?r.previousEmails:[])if(typeof e?.email==='string'&&safe(e.verifiedAt)&&safe(e.replacedAt)&&e.replacedAt>since&&!out.some(x=>x.email===e.email))out.push({email:e.email,verifiedAt:e.verifiedAt});
  return out;};
 const pushRows=async sub=>{if(typeof push?.list!=='function')return [];try{const rows=await push.list(sub);return Array.isArray(rows)?rows.filter(x=>typeof x?.id==='string'&&safe(x.createdAt)).slice(0,10):[];}catch{return [];}};
 const handleOf=async org=>{const r=await record(org);return typeof r?.handle==='string'&&HANDLE.test(r.handle)?r.handle:null;};
 return Object.freeze({
  async snapshot(owner,{at}={}){
   const now=safe(at)?at:Date.now();if(!local(owner))return {status:'unknown',lastInteractiveAt:null,channels:[]};
   const r=await record(owner.sub);if(r===undefined)throw Object.assign(new Error('Break-glass is not available right now.'),{code:'break_glass_unavailable',status:503});
   if(!r||r.kind==='organization')return {status:r?'unknown':'deleted',lastInteractiveAt:null,channels:[]};
   const channels=[];
   for(const e of emails(r,now-LOOKBACK_MS))if(e.verifiedAt<now)channels.push({id:await id('email',owner.sub,e.email),kind:'email',enrolledAt:e.verifiedAt,domainHashes:await emailDomainHashes(domainOf(e.email))});
   for(const row of await pushRows(owner.sub))if(row.createdAt<now)channels.push({id:await id('push',owner.sub,row.id),kind:'push',enrolledAt:row.createdAt});
   for(const c of Array.isArray(r.credentials)?r.credentials:[])if(typeof c?.id==='string'&&safe(c.createdAt)&&c.createdAt<now)channels.push({id:await id('passkey',owner.sub,c.id),kind:'credential',enrolledAt:c.createdAt});
   for(const s of Array.isArray(r.sessions)?r.sessions:[])if(s&&s.scope===undefined&&safe(s.createdAt)&&s.createdAt<now&&Number.isSafeInteger(s.expiresAt)&&s.expiresAt>now&&typeof s.id==='string')channels.push({id:await id('session',owner.sub,s.id),kind:'session',enrolledAt:s.createdAt});
   return {status:typeof r.status==='string'?r.status:'unknown',lastInteractiveAt:safe(r.lastInteractiveAt)?r.lastInteractiveAt:null,channels};
  },
  async domains({org,principals=[]}={}){
   const out=[];const add=async email=>{const hashes=await emailDomainHashes(domainOf(email));if(hashes.length)out.push({hashes});};
   if(UUID.test(org??'')){const r=await record(org);if(r&&noticeEmail(r))await add(noticeEmail(r));}
   for(const p of (Array.isArray(principals)?principals:[]).slice(0,16)){if(!local(p))continue;const r=await record(p.sub);if(!r)continue;for(const e of emails(r,Date.now()-LOOKBACK_MS))await add(e.email);}
   return out.slice(0,64);
  },
  async notify(owner,{org,claim,event,channel,kind,abort}={}){
   if(!local(owner)||!UUID.test(org??'')||!UUID.test(claim??'')||typeof channel!=='string')return {accepted:false};
   // Known sessions and credentials are reached by the sign-in interstitial (the owner's hint row), never by a message.
   if(kind==='session'||kind==='credential')return {accepted:true};
   const notice=OWNER_NOTICE_KINDS[event]??'update',orgHandle=await handleOf(org),link=abort===undefined?null:orgClaimAbortUrl(origin,org,abort,orgHandle);
   if(abort!==undefined&&!link)return {accepted:false};
   if(kind==='email'){
    if(typeof mailer?.sendBreakGlassNotice!=='function')return {accepted:false};
    const r=await record(owner.sub);if(!r)return {accepted:false};
    // Every retained confirmed email is a candidate; only the one whose id the claim recorded at T1 is used.
    let address=null;for(const e of emails(r,0))if(await id('email',owner.sub,e.email)===channel){address=e.email;break;}
    if(!address)return {accepted:false};
    try{await mailer.sendBreakGlassNotice({email:address,event:notice,orgHandle,abortUrl:link});return {accepted:true};}catch{return {accepted:false};}
   }
   if(kind==='push'){
    if(typeof push?.send!=='function')return {accepted:false};
    let row=null;for(const x of await pushRows(owner.sub))if(await id('push',owner.sub,x.id)===channel){row=x;break;}
    if(!row)return {accepted:false};
    const path=link?link.slice(origin.length):`/console?view=organizations&org=${org}`;
    try{const out=await push.send(owner.sub,{subscription:row.id,notice:{event:notice,org,path}});return {accepted:out?.accepted===true};}catch{return {accepted:false};}
   }
   return {accepted:false};
  }
 });
}

/**
 * ORG-12b: the owner-channels port both adapters pass as ORGANIZATION_OWNER_CHANNELS. `identity(sub)` reads the raw
 * identity record, `account(sub)` reaches a person's account object (push subscriptions), `mailer` sends the notice
 * mail. Returns null when the deployment secret is missing, so no claim can start (fail closed, 503).
 */
export function organizationOwnerChannels({config,identity,account,mailer}){
 const secret=config?.KEY_ENCRYPTION_KEY;if(typeof secret!=='string'||secret.length<16||!config?.APP_ORIGIN)return null;
 const invoke=async(person,args)=>{const stub=account(person);if(!stub)throw new Error('Account unavailable.');const result=await stub.invoke({method:'orgsBreakGlassPush',args:[person,args]});if(result?.$fault)throw Object.assign(new Error(result.$fault.message??'Account unavailable.'),{code:result.$fault.code});return result;};
 return ownerChannelsAdapter({origin:config.APP_ORIGIN,secret,identity,mailer:typeof mailer?.sendBreakGlassNotice==='function'?mailer:null,push:{list:person=>invoke(person,{op:'list'}),send:(person,input)=>invoke(person,{op:'send',...input})}});
}
