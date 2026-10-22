// DX-5: the DX-3 notices.deliver contract, over the existing mail and push transports. No channel lookup:
// the request owns copied endpoints and the verified email snapshot (R1-M2). Acceptance is not delivery.
import {AppAction,createAppEngine,perform} from '../app/engine.mjs';
import {systemClock,cryptoRandom,nullAudit} from '../app/providers.mjs';
import {isUUID} from '../core/primitives.mjs';
import {deletionBackground,DELETION_BASES} from './account-deletion.mjs';
import {deletionLocalization} from '../i18n/deletion-catalogue.mjs';

export const DELETION_CANCEL_PATH='/account/deletion/cancel';
const KINDS=['scheduled','reminder-3d','reminder-1d','executing','completed'],TOKEN=/^[A-Za-z0-9_-]{43}$/;
function checkedOrigin(origin){let url;try{url=new URL(origin);}catch{throw new TypeError('Invalid deletion notice origin.');}if(url.origin!==origin||url.username||url.password||url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new TypeError('Invalid deletion notice origin.');return origin;}
/** Caller-provided URLs are never authority. Tokens travel in fragments, never in query strings or paths. */
export function deletionNoticeTemplate(notice,{origin,locale='en'}={}){
 checkedOrigin(origin);
 if(!notice||!isUUID(notice.owner)||!KINDS.includes(notice.kind)||!DELETION_BASES.includes(notice.basis)||typeof notice.handle!=='string'||!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(notice.handle)||!Number.isSafeInteger(notice.executeAfter)||notice.executeAfter<0||!Number.isSafeInteger(notice.graceDays)||notice.graceDays<1||typeof notice.cancellable!=='boolean')throw new TypeError('Invalid deletion notice.');
 const scheduled=['scheduled','reminder-3d','reminder-1d'].includes(notice.kind),cancellable=scheduled&&notice.cancellable;
 if(notice.cancellable!==(scheduled&&['owner','admin-email'].includes(notice.basis))||notice.cancellable&&(typeof notice.cancelToken!=='string'||!TOKEN.test(notice.cancelToken)))throw new TypeError('Invalid deletion cancel link.');
 const {t,date}=deletionLocalization(locale),when=date(notice.executeAfter,{dateStyle:'long',timeStyle:'short',timeZone:'UTC'})+' UTC';
 const subject=t(notice.kind==='scheduled'?'Account deletion scheduled':scheduled?'Account deletion reminder':notice.kind==='executing'?'Account deletion started':'Account deletion completed');
 const body=t(scheduled?'Deletion of @{handle} is scheduled for {date}.':notice.kind==='executing'?'Deletion of @{handle} has started. It can no longer be cancelled.':'Deletion of @{handle} is complete.',{handle:notice.handle,date:when});
 const path=cancellable?`${DELETION_CANCEL_PATH}#owner=${notice.owner}&token=${notice.cancelToken}`:`/console?account=${notice.owner}&view=account-data`;
 const guidance=t(cancellable?'Not you? Cancel deletion.':scheduled?'To appeal this deletion, contact the service operator.':'Messages others received and files in connected storage remain with them. Your name will never be reassigned.');
 return {subject,text:[body,guidance,...cancellable?[origin+path,t('Opening this link does not cancel deletion. Confirm on the page. This link cannot sign you in.')]:scheduled?[origin+path]:[]].join('\n\n'),
  push:{type:'bindle-deletion-notice',owner:notice.owner,kind:notice.kind,title:subject,body:body+' '+guidance,path}};
}
export class SendAccountDeletionNotice extends AppAction{
 static operation='deletion.deliver-notice';static deps=['config','flags','mail','push'];static termsGate='exempt';
 async run({config,flags,mail,push}){
  const notice=this.input;
  if(this.actor?.kind!=='system'||this.actor.owner!==notice?.owner)throw new TypeError('Invalid deletion notice actor.');
  if(!deletionBackground(flags,notice.owner))return {accepted:false,channels:[]};
  const template=deletionNoticeTemplate(notice,config),channels=notice.channels;
  if(!channels||!Array.isArray(channels.push)||channels.push.length>16||channels.email!==null&&typeof channels.email!=='string')throw new TypeError('Invalid deletion notice channels.');
  const attempts=[];
  if(notice.kind!=='completed'&&typeof push.send==='function')for(const subscription of channels.push)attempts.push(Promise.resolve().then(()=>push.send(subscription,template.push)).then(result=>result?.accepted===true?'push':null,()=>null));
  // The mail adapter's sendDeletionNotice uses its fixed accounts@ sender and deletionNoticeTemplate.
  // sendAccountNotice cannot substitute: its older fixed templates discard the cancel link.
  if(channels.email&&typeof mail.sendDeletionNotice==='function')attempts.push(Promise.resolve().then(()=>mail.sendDeletionNotice({email:channels.email,notice:{owner:notice.owner,kind:notice.kind,basis:notice.basis,handle:notice.handle,executeAfter:notice.executeAfter,graceDays:notice.graceDays,cancellable:notice.cancellable,...notice.cancellable?{cancelToken:notice.cancelToken}:{}},locale:config.locale??'en'})).then(result=>typeof result?.messageId==='string'&&!!result.messageId?'email':null,()=>null));
  const accepted=[...new Set((await Promise.all(attempts)).filter(Boolean))];return {accepted:accepted.length>0,channels:accepted};
 }
}
/** No retry or token persistence here: DX-3 owns both. One engine dispatch per attempt, also on Node. */
export function createDeletionNotices({origin,flags,mail=null,push=null,locale='en'}){
 checkedOrigin(origin);if(typeof flags?.for!=='function')throw new TypeError('Deletion notices require a flags port.');
 const engine=createAppEngine({providers:{config:{origin,locale},flags,mail:mail??{},push:push??{},clock:systemClock,random:cryptoRandom,audit:nullAudit}});
 return Object.freeze({deliver:input=>perform(engine,new SendAccountDeletionNotice({actor:{kind:'system',owner:input?.owner,reason:'deletion-notice'},input})),dispose:()=>engine.dispose()});
}
