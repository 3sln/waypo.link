// BB-B9: presentation-independent client operations. Providers own I/O; Actions own decisions.
import {ReceiveAppIntent,ConfirmAppIntent,DiscardAppIntent,CONNECT_REFERENCE} from './intents.mjs';
import {encodeIntent} from '../../../../packages/intents/format.mjs';
import {Engine,Action,Query,Provider} from '../../../../vendor/ngin/index.js';
import {perform} from '../../../../packages/messaging-engine/engine.mjs';
export const PAGE_SIZE=40;
const disabled=()=>{throw Object.assign(new Error('Disabled'),{code:'not_found'});};
export const initialState=({locale='en',online=true}={})=>({locale:locale.startsWith('es')?'es':'en',online,section:'conversations',rooms:[],views:[],outbox:[],requests:[],rejected:[],items:[],invites:[],contactMembers:[],freshInvite:null,detail:null,page:0,cursor:null,pages:[],resume:null,draft:'',pendingDraft:null,busy:false,error:null,notice:null,archive:null,generation:0});
export class ClientState extends Query {
 static deps=['state'];
 fetch({state}){return structuredClone(state.value);}
 boot({state},{notify,engineFeed}){const update=()=>notify(structuredClone(state.value));engineFeed.addEventListener('web-changed',update);this.kill=()=>engineFeed.removeEventListener('web-changed',update);update();}
}
class ClientAction extends Action {
 static deps=['state','mailbox','browser','permissions'];
 constructor(input={}){super();this.input=input;}
 async execute(resources,{dispatchFeed,engineFeed}){
  if(!resources.state.enabled)disabled();const s=resources.state.value;
  try{const result=!s.online&&this.constructor.needsOnline!==false?{offline:true}:await this.run(resources);s.error=null;dispatchFeed.dispatchEvent(new CustomEvent('result',{detail:result}));}
  catch(error){s.notice=null;s.error=error?.code==='unauthorized'?'sign-in':error?.code==='cursor_stale'?'changed':'retry';throw error;}
  finally{engineFeed.dispatchEvent(new Event('web-changed'));}
 }
}
const call=(mailbox,name,input={},id)=>mailbox.run(name,{input,...id!==undefined?{id}:{}});
async function snapshot(mailbox,s){
 const sequence=(s.snapshotSequence??0)+1;s.snapshotSequence=sequence;
 const values=await Promise.all(['conversations.list','views.list','outbox.list','intake.requests','intake.rejected','conversations.invitations'].map(name=>call(mailbox,name))),requests=values[3];
 if(s.snapshotSequence!==sequence)return;
 const invitations=values[5].invitations.filter(i=>!requests.some(r=>r.id===i.itemId)).map(i=>({...i,id:i.itemId,kind:'conversation-init',author:{verified:true,principal:i.creator}}));
 [s.rooms,s.views,s.outbox,s.requests,s.rejected]=[values[0].conversations,values[1].views,values[2],[...invitations,...requests],values[4]];
}
// Contacts spike phase 3 (rethink §4.4, §5; provisional): the owner's invitation links and the built-in Contacts list.
async function invitations(mailbox,s){
 const generation=s.generation,[links,members]=await Promise.all([call(mailbox,'invites.list'),call(mailbox,'lists.members',{list:'contacts'})]);
 if(s.generation!==generation||s.section!=='contacts')return;s.invites=Array.isArray(links?.invites)?links.invites:[];s.contactMembers=Array.isArray(members?.members)?members.members:[];
}
async function selected(mailbox,s){
 const generation=s.generation;
 if(s.section==='contacts'&&!s.detail)await invitations(mailbox,s);
 if(s.detail){const id=s.detail.id,detail=await call(mailbox,'conversations.get',{conversationId:id,limit:PAGE_SIZE,...s.detail.pagination?{offset:s.detail.pagination.offset}:{}});if(s.generation!==generation||s.detail?.id!==id)return;s.detail=detail;s.page=detail.pagination?Math.floor(detail.pagination.offset/PAGE_SIZE):Math.min(s.page,Math.max(0,Math.ceil(detail.timeline.length/PAGE_SIZE)-1));}
 if(s.section==='views'&&s.view){const page=await call(mailbox,'incoming.query',{view:s.view.id,viewRevision:s.view.revision,limit:PAGE_SIZE});if(s.generation===generation)Object.assign(s,{items:page.items,cursor:page.cursor,pages:[]});}
}
export class LoadClient extends ClientAction {
 static needsOnline=false;
 async run({state,mailbox}){const s=state.value;if(!s.online)return {offline:true};await snapshot(mailbox,s);await selected(mailbox,s);return {loaded:true};}
}
export class Navigate extends ClientAction {
 static needsOnline=false;
 async run({state,mailbox,browser}){
  const s=state.value,{section,id,page,view}=this.input,generation=++s.generation;
  if(page!==undefined&&s.detail?.pagination){const detail=await call(mailbox,'conversations.get',{conversationId:s.detail.id,limit:PAGE_SIZE,offset:Math.max(0,Math.floor(page))*PAGE_SIZE});if(s.generation===generation){s.detail=detail;s.page=Math.floor(detail.pagination.offset/PAGE_SIZE);}return;}
  if(page!==undefined){const count=s.detail?.timeline.length??({conversations:s.rooms,contacts:s.contactMembers,requests:s.requests,rejected:s.rejected,delivery:s.outbox}[s.section]??[]).length;s.page=Math.max(0,Math.min(Math.floor(page),Math.max(0,Math.ceil(count/PAGE_SIZE)-1)));return;}
  if(section){if(!['conversations','contacts','views','requests','rejected','delivery','settings'].includes(section))throw new TypeError('Invalid section');s.section=section;s.detail=null;s.view=null;s.page=0;s.freshInvite=null;}
  if(id&&s.online){const detail=await call(mailbox,'conversations.get',{conversationId:id,limit:PAGE_SIZE}),draft=await browser.drafts.get(id)??'',pending=await browser.drafts.get('pending:'+id);if(s.generation!==generation)return;s.detail=detail;s.page=detail.pagination?Math.floor(detail.pagination.offset/PAGE_SIZE):Math.max(0,Math.ceil(detail.timeline.length/PAGE_SIZE)-1);s.draft=draft;s.pendingDraft=pending?JSON.parse(pending):null;}
  if(view&&s.online){s.view=view;await selected(mailbox,s);}
  if(section==='contacts'&&s.online)await invitations(mailbox,s);
  if(section==='settings'&&mailbox.archive?.status&&s.online)s.archiveStatus=await call(mailbox,mailbox.archive.status.operation);
 }
}
export class SaveDraft extends ClientAction {
 static needsOnline=false;
 async run({state,browser}){const s=state.value;if(!s.detail)return;const text=String(this.input.text??'').slice(0,16000);s.draft=text;await browser.drafts.set(s.detail.id,text);}
}
export class SubmitMessage extends ClientAction {
 async run({state,mailbox,browser}){
  const s=state.value;if(s.busy||!s.detail||!s.draft.trim())return;if(!s.online){s.notice='offline';return;}
  // A lost response retains the exact operation ID and text. A changed draft must resolve it first.
  const pending=s.pendingDraft??{operationId:browser.id(),conversationId:s.detail.id,text:s.draft};s.pendingDraft=pending;s.busy=true;
  await browser.drafts.set('pending:'+pending.conversationId,JSON.stringify(pending));
  try{const result=await call(mailbox,'conversations.send',pending);if(s.detail?.id===pending.conversationId){if(s.draft===pending.text){s.draft='';await browser.drafts.set(pending.conversationId,'');}s.pendingDraft=null;}await browser.drafts.set('pending:'+pending.conversationId,'');await snapshot(mailbox,s);await selected(mailbox,s);s.notice='queued';return result;}finally{s.busy=false;}
 }
}
export class RetryMissing extends ClientAction {
 async run({state,mailbox}){const s=state.value;if(!s.online)return;const result=await call(mailbox,'outbox.retry-missing',{},this.input.id);await snapshot(mailbox,s);if(s.delivery?.messageId===this.input.id)s.delivery=await call(mailbox,'outbox.get',{},this.input.id);s.notice='retried';return result;}
}
export class DeliveryDetail extends ClientAction {
 async run({state,mailbox}){state.value.delivery=await call(mailbox,'outbox.get',{},this.input.id);}
}
export class SyncProgress extends ClientAction {
 async run({state,mailbox}){
  const s=state.value;if(!s.online)return;if(state.syncing)return;state.syncing=true;
  try{
   // Cursor commits only AFTER every snapshot/detail refresh succeeds. Gaps never merge stale rows.
   let page;try{page=await mailbox.progress(s.resume);}catch(error){if(error?.code==='unauthorized')throw error;await snapshot(mailbox,s);await selected(mailbox,s);if(s.delivery)s.delivery=await call(mailbox,'outbox.get',{},s.delivery.messageId);s.notice='polling';return {polling:true};}
   const reset=page.reset||page.events.some(e=>e.type==='reset');
   // Also poll incoming snapshots: B3's journal currently records outbound changes only.
   await snapshot(mailbox,s);await selected(mailbox,s);if(s.delivery)s.delivery=await call(mailbox,'outbox.get',{},s.delivery.messageId);
   s.resume=page.resumeToken??page.events.at(-1)?.id??s.resume;if(reset)s.notice='reset';return {reset};
  }finally{state.syncing=false;}
 }
}
export class Connectivity extends ClientAction {
 static needsOnline=false;
 async run({state,mailbox}){const s=state.value;s.online=this.input.online===true;if(s.online){await snapshot(mailbox,s);await selected(mailbox,s);s.notice='recovered';}else s.notice='offline';}
}
export class Rescue extends ClientAction {
 async run({state,mailbox}){if(!state.value.online)return;const result=await call(mailbox,'intake.rescue',{id:this.input.id,allow:this.input.allow===true});await snapshot(mailbox,state.value);state.value.notice='rescued';return result;}
}
export class ReadRequestBody extends ClientAction {
 async run({state,mailbox}){const result=await call(mailbox,'receive.body',{id:this.input.id});state.value.requestBodies??={};state.value.requestBodies[this.input.id]=result;return result;}
}
// A new conversation with a member of the owner's lists (contacts spike phase 4: conversations.create with the member's
// principal; the engine uses the binding its two-party conversation verified). Contact links are gone.
export class StartConversation extends ClientAction {
 async run({state,mailbox,browser}){const p=this.input.principal;if(typeof p?.issuer!=='string'||typeof p?.subject!=='string')throw new TypeError('Choose a contact');const result=await call(mailbox,'conversations.create',{participants:[{principal:{issuer:p.issuer,subject:p.subject}}],subject:this.input.subject??'',text:this.input.text??'',operationId:browser.id()});await snapshot(mailbox,state.value);return result;}
}
// The invitation link appears once, in this in-memory state only: the token is a bearer secret, so it is never written
// to drafts or storage, never returned from the operation and never logged. Navigating away or Done discards it.
export class InviteAction extends ClientAction {
 static needsOnline=false;
 async run({state,mailbox,browser}){
  const s=state.value,{kind}=this.input;
  if(kind==='dismiss'){s.freshInvite=null;return;}
  if(kind==='copy'){if(!s.freshInvite)return;try{if(typeof browser.copy!=='function')throw 0;await browser.copy(s.freshInvite.link);s.notice='invite-copied';}catch{s.notice='invite-copy-failed';}return;}
  if(!s.online)return {offline:true};
  if(kind==='create'){
   const name=typeof this.input.name==='string'?this.input.name.trim():'';if([...name].length>80)throw Object.assign(new Error('Choose a shorter name'),{code:'invalid_input'});
   s.freshInvite=null;const result=await call(mailbox,'invites.create',{template:'person',...name?{name}:{}});
   s.freshInvite={id:result.invite.id,name:result.invite.name??null,expiresAt:result.invite.expiresAt,link:'web+bindle://intent?bintent='+encodeIntent({bintent:1,kind:{...CONNECT_REFERENCE},data:result.data})};
   s.notice='invite-created';await invitations(mailbox,s);return {id:result.invite.id};
  }
  if(kind==='revoke'){await call(mailbox,'invites.revoke',{id:this.input.id});if(s.freshInvite?.id===this.input.id)s.freshInvite=null;s.notice='invite-revoked';}
  else if(kind==='block'){await call(mailbox,'contacts.block',{principal:this.input.principal});s.notice='invite-blocked';}
  else if(kind==='remove'){await call(mailbox,'lists.remove',{list:'contacts',principal:this.input.principal});}
  else throw new TypeError('Invalid invitation operation');
  await invitations(mailbox,s);
 }
}
export class ViewAction extends ClientAction {
 async run({state,mailbox,browser}){
  const s=state.value,{kind,...input}=this.input;
  if(kind==='create'){
   const data={name:input.name,filter:{version:1,...input.unread?{read:false}:{}},sort:'activity-desc'},stored=await browser.drafts.get('view-operation'),pending=stored?JSON.parse(stored):{operationId:browser.id(),...data};
   if(JSON.stringify({...pending,operationId:undefined})!==JSON.stringify({...data,operationId:undefined}))throw Object.assign(new Error('Resolve the previous View request first'),{code:'operation_pending'});
   await browser.drafts.set('view-operation',JSON.stringify(pending));await call(mailbox,'views.create',pending);await snapshot(mailbox,s);await browser.drafts.set('view-operation','');return;
  }
  else if(kind==='next'&&s.cursor){const generation=s.generation,page=await call(mailbox,'incoming.query',{view:s.view.id,viewRevision:s.view.revision,limit:PAGE_SIZE,cursor:s.cursor});if(generation!==s.generation)return;s.pages.push({items:s.items,cursor:s.cursor});s.items=page.items;s.cursor=page.cursor;return;}
  else if(kind==='previous'&&s.pages.length){Object.assign(s,s.pages.pop());return;}
  else throw new TypeError('Invalid View operation');
 }
}
export class RequestAccess extends ClientAction {
 async run({state,permissions}){
  // Only explicitly configured fragment deltas enter the SDK's incremental authorization flow.
  const request=permissions.requests?.[this.input.feature];if(!request){state.value.notice='unavailable';return;}
  const result=await permissions.client.grantMore(request);state.value.notice=['granted','partial'].includes(result?.outcome)?'access-updated':'access-declined';return result;
 }
}
export class ArchiveAction extends ClientAction {
 static needsOnline=false;
 async run({state,mailbox}){
  // B6 capability map uses its actual public operations. Import pins the previous app's handoff anchor.
  if(this.input.kind==='cancel'){state.value.confirmArchive=null;return;}
  if(!state.value.online)return {offline:true};
  const capability=mailbox.archive?.[this.input.kind];if(!capability){state.value.notice='unavailable';return;}
  const s=state.value,args=this.input.args??s.confirmArchive?.args??{};
  if(this.input.kind==='import'&&(!Number.isSafeInteger(args.expect?.generation)||args.expect.generation<1||!/^[-_A-Za-z0-9]{43}$/.test(args.expect?.digest??'')))throw Object.assign(new Error('A handoff anchor is required'),{code:'invalid_input'});
  if(capability.confirm&&this.input.confirmed!==true){s.confirmArchive={kind:this.input.kind,args:structuredClone(args)};return;}
  const result=await call(mailbox,capability.operation,args);s.confirmArchive=null;
  if(this.input.kind==='status')s.archiveStatus=result;else{s.archive=result;if(this.input.kind==='export')s.archiveAnchor={generation:result.generation,digest:result.digest};if(mailbox.archive.status)s.archiveStatus=await call(mailbox,mailbox.archive.status.operation);}
  if(['import','rejoin'].includes(this.input.kind))await snapshot(mailbox,s);return result;
 }
}
export class Locale extends ClientAction {static needsOnline=false;run({state}){state.value.locale=this.input.locale==='es'?'es':'en';}}
export class AcceptRequest extends ClientAction {async run({state,mailbox}){const result=await call(mailbox,'conversations.accept',this.input);await snapshot(mailbox,state.value);return result;}}
export const CLIENT_OPERATIONS=Object.freeze({discardIntent:DiscardAppIntent,intent:ReceiveAppIntent,confirmIntent:ConfirmAppIntent,body:ReadRequestBody,start:StartConversation,load:LoadClient,navigate:Navigate,draft:SaveDraft,submit:SubmitMessage,retry:RetryMissing,delivery:DeliveryDetail,sync:SyncProgress,connectivity:Connectivity,rescue:Rescue,invite:InviteAction,view:ViewAction,access:RequestAccess,archive:ArchiveAction,locale:Locale,accept:AcceptRequest});
export function createClientEngine({PARLAY_ENABLED=false,INTENT_LINKS_ENABLED=false,mailbox,browser,permissions={},locale='en',online=true}={}){
 const state={enabled:PARLAY_ENABLED===true,intentLinksEnabled:INTENT_LINKS_ENABLED===true,value:initialState({locale,online}),syncing:false};
 const engine=new Engine({providers:Object.fromEntries(Object.entries({state,mailbox,browser,permissions}).map(([name,value])=>[name,Provider.fromSingleton(value)]))});
 return {engine,state,run(name,input){const Operation=CLIENT_OPERATIONS[name];if(!Operation)throw new TypeError('Unknown client operation');return perform(engine,new Operation(input));},read:()=>engine.query(new ClientState()).peek(),dispose:()=>engine.dispose()};
}
