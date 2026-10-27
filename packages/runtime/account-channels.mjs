// DX-6 notice-channel port (docs/architecture/account-deletion-export.md §3, §6 `accountChannels(owner)`).
//
// Email removal must not strand an owner without any notice channel, so the identity service asks the account
// object which OTHER channels remain. Today that is push: the account's stored push subscriptions, counted as
// ready by the unchanged lifecycle `contactReady` rule when a push transport is configured. Email is excluded on
// purpose: it is the channel being removed.
//
// Account side (runs inside the account object over its own metadata; RPC registration is a coordinator hunk):
//   accountChannelState(reader, owner, {push}) → Readonly<{owner, ready:boolean, count:number, revision:string}>
//     reader  account metadata or a metadata transaction: list({prefix}) → Map (DO storage, SqliteMetadata)
//     push    the account's push transport; without send() no push channel is available
//   accountSecurityNotice(reader, owner, {push, event}) → {accepted:number}
//     sends {type:'bindle-security-notice', owner, event, path} to each stored subscription (at most 10). The
//     payload carries no secret or free text; the service worker builds any text (DX-8 hunk in apps/web/sw.js).
// Identity side:
//   accountChannelsPort(invoke) → {state(owner), notify(owner, event)}
//     invoke(owner, method, args) reaches the owner's account object; `$fault` results and malformed state throw,
//     and IdentityService#emailRemove turns a throw into `notice_channels_unavailable` (503), never into "no channel".
import {AccountLifecycle} from './account-lifecycle.mjs';
import {key} from '../core/records.mjs';
import {livePushRows} from '../activity/notifications.mjs';
import {isUUID as uuid} from '../core/primitives.mjs';

export const SECURITY_NOTICE_EVENTS=Object.freeze(['email-removed','export-created','export-downloaded','recovery-reissued','recovery-reissue-started','recovery-reissue-cancelled','passkey-added','passkey-removed','email-changed','sessions-revoked','sessions-evicted','password-changed']);
const contactReady=channel=>AccountLifecycle.prototype.contactReady.call(null,channel);
const MAX_PUSH=10;

async function rows(reader,owner){
 const prefix=key('push-subscription',owner),listed=await reader.list({prefix});
 const values=listed instanceof Map?[...listed.values()]:[];
 // Wargame 4 M1: a row bound to an ended session is neither counted nor notified (read-only here).
 return livePushRows({get:path=>reader.get(path)},owner,values.filter(row=>row?.owner===owner&&typeof row.endpoint==='string'&&typeof row.id==='string'));
}
// Not a secret: an opaque change marker over the subscription IDs, like the lifecycle channel revision.
function revision(ids){let a=0x811c9dc5,b=0x01000193;const text=ids.join(',');for(let i=0;i<text.length;i++){const code=text.charCodeAt(i);a=Math.imul(a^code,16777619)>>>0;b=Math.imul(b^code,2246822507)>>>0;}return `p1-${ids.length}-${a.toString(16)}-${b.toString(16)}`;}

export async function accountChannelState(reader,owner,{push}={}){
 if(!uuid(owner))throw new TypeError('An account owner is required.');
 const ids=(await rows(reader,owner)).map(row=>row.id).sort(),available=typeof push?.send==='function'&&ids.length>0;
 const channel={verified:available,available,revision:revision(ids)};
 return Object.freeze({owner,ready:contactReady(channel),count:available?ids.length:0,revision:channel.revision});
}

export async function accountSecurityNotice(reader,owner,{push,event}={}){
 if(!uuid(owner)||!SECURITY_NOTICE_EVENTS.includes(event))throw new TypeError('Invalid security notice.');
 if(typeof push?.send!=='function')return {accepted:0};
 let accepted=0;
 for(const subscription of (await rows(reader,owner)).slice(0,MAX_PUSH))
  try{await push.send({endpoint:subscription.endpoint,keys:subscription.keys},{type:'bindle-security-notice',owner,event,path:`/console?account=${owner}&security=review`});accepted++;}catch{/* A gone or failing endpoint never blocks the others. */}
 return {accepted};
}

export function accountChannelsPort(invoke){
 if(typeof invoke!=='function')throw new TypeError('An account invoke port is required.');
 const call=async(owner,method,args)=>{const result=await invoke(owner,method,args);if(result?.$fault)throw Object.assign(new Error(result.$fault.message??'Account unavailable.'),{code:result.$fault.code??'account_unavailable'});return result;};
 return Object.freeze({
  async state(owner){const value=await call(owner,'accountChannels',[owner]);if(value?.owner!==owner||typeof value.ready!=='boolean'||!Number.isSafeInteger(value.count)||value.count<0||typeof value.revision!=='string')throw Object.assign(new Error('Malformed channel state.'),{code:'account_unavailable'});return Object.freeze({ready:value.ready,count:value.count,revision:value.revision});},
  /** Wargame 4 M1: delete push subscriptions bound to ended sessions; `keep` also ends every row not bound to a kept session. */
  async endSessions(owner,{sessionIds=[],keep,keepSubscriptions=[]}={}){const value=await call(owner,'pushSessionsEnded',[owner,{sessionIds,...keep?{keep,keepSubscriptions}:{}}]);return {removed:Number.isSafeInteger(value?.removed)?value.removed:0};},
  async notify(owner,event){if(!SECURITY_NOTICE_EVENTS.includes(event))throw new TypeError('Invalid security notice.');const value=await call(owner,'accountSecurityNotice',[owner,{event}]);return {accepted:Number.isSafeInteger(value?.accepted)?value.accepted:0};}
 });
}
