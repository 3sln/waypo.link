// RTC-g console view "Calls & connections" (docs/architecture/rtc-signaling.md §7 "Settings → Connections & calls",
// "Call links", "Activity"). Renders the `rtc` model from apps/web/src/bl/rtc-settings.mjs and bubbles native intents.
// Provisional wording (DEVLOG 2026-10-27 RTC-g, RTCg-*), not signed off by the user. Owner data (handles, principals,
// app names and origins, purpose titles from their artefacts) is marked translate="no"; interface text is localized
// through the catalogue in packages/i18n/catalogues.mjs.
import {h,badge,checkbox,pageHeader,helpers,empty,interfaceText} from './release-primitives.mjs';
import {rtcEnabled,rtcModel,rtcDeclined,silentEnd} from '../bl/rtc-settings.mjs';

const literal=value=>h('span',String(value??'')).attrs({translate:'no'});
const MEDIA={audio:'Audio',video:'Video',data:'Data',screen:'Screen sharing'};
const mediaList=media=>media.flatMap((x,i)=>[i?', ':'',MEDIA[x]??x]).filter(Boolean);
/** A purpose's title in the interface language, from its artefact (owner-visible data, never translated by us). */
export function purposeTitle(model,line,locale='en'){const p=model?.purposes?.find(x=>x.id===line);return p?(p.title?.[locale]??p.title?.en??line):line;}
const purposeSummary=(p,locale)=>p.summary?.[locale]??p.summary?.en??'';
/** A principal as the owner should read it: the handle this host verified, else the issuer host and a short id. */
export function principalLabel(principal,handle){
 if(handle)return '@'+handle;let host='';try{host=new URL(principal?.iss).host;}catch{host=String(principal?.iss??'');}
 return `${host} · ${String(principal?.sub??'').slice(0,8)}`;
}
const appLabel=app=>app?.name??(()=>{try{return new URL(app?.origin??app?.clientId).host;}catch{return String(app?.clientId??'');}})();
const confirmButton=(state,label,action,input,cls='text-button danger')=>helpers(state).btn(label,{kind:'open-modal',modal:{kind:'rtc-confirm',action,input}},cls);
const section=(id,title,description,...children)=>h('section',h('h2',title).props({id:`rtc-${id}-title`}),description?h('p',description).classes('muted'):null,...children).attrs({'aria-labelledby':`rtc-${id}-title`}).classes('panel','rtc-panel',`rtc-${id}`);
function radios(name,legend,options,value){
 return h('fieldset',h('legend',legend),...options.map(([id,title,help])=>h('label',h('input').props({type:'radio',name,value:id,checked:value===id}).attrs({'aria-describedby':`rtc-${name}-${id}-help`}).key(`${name}:${id}`),h('span',h('strong',title),h('span',help).props({id:`rtc-${name}-${id}-help`}).classes('field-help'))).classes('rtc-choice'))).classes('rtc-choices');
}

function privacyPanel(state,m){
 const {form}=helpers(state),p=m.policy;
 return section('privacy','Network privacy','Calls and data transfers connect your device to the other device directly or through a relay. Choose what the other side may learn about your network address.',
  form([
   radios('other','With other people',[
    ['relay','Relay only (recommended)','The other person never sees your IP address; the relay does. The connection goes through the relay, which can be slower, and it cannot connect if neither you nor the app has a relay.'],
    ['public','Allow your public address','Connects without a relay when possible. The other person, their app and their provider can see your public IP address, which can reveal your approximate location and internet provider.']],p.other),
   radios('self','Between your own devices',[
    ['all','Direct (recommended)','Your devices may use their local network addresses to connect. Only your own devices see them; your provider carries them briefly to set up the connection and then deletes them.'],
    ['public','Public address only','Your devices connect over the internet and never share local network addresses.'],
    ['relay','Relay only','Your devices always connect through a relay and never share any address with each other.']],p.self),
   h('p','A relay sees your IP address, that a connection happens and how much data it carries, but it cannot read calls or files.').classes('field-help')
  ],{kind:'save-rtc-policy'},'Save network privacy'));
}
function requestsPanel(state,m){
 const {form}=helpers(state),locale=state.locale??'en',shareable=m.purposes.filter(p=>p.parties!=='self');
 return section('requests','Requests from people without a link','Off by default. People who verified their identity but have no contact link or call link from you can ask to connect. Requests never ring: they wait in your missed and held list.',
  form([...shareable.map(p=>h('label',h('input').props({type:'checkbox',name:'request:'+p.id,checked:m.policy.requests.includes(p.id)}).key('request:'+p.id),h('span',literal(purposeTitle(m,p.id,locale)),h('span',literal(purposeSummary(p,locale))).classes('field-help'))).classes('checkbox-field','rtc-purpose-choice'))],{kind:'save-rtc-policy',requests:true},'Save requests'));
}
function contactsPanel(state,m){
 const {form}=helpers(state),locale=state.locale??'en',links=(state.data?.contacts??[]).filter(c=>c.active),shareable=m.purposes.filter(p=>p.parties!=='self');
 return section('contacts','Who can call you','Anyone holding one of your contact links can ring you for the purposes you check on that link. This choice is kept here, never written into the link, and never shown to the people who hold it.',
  links.length?h('div',...links.map(c=>{const chosen=m.contacts.find(x=>x.parent===c.id)?.purposes??[];return h('article',h('h3',literal(c.name??'Contact link')),
   form(shareable.map(p=>checkbox('purpose:'+p.id,literal(purposeTitle(m,p.id,locale)),chosen.includes(p.id))),{kind:'save-rtc-contact',parent:c.id},'Save for this link')).classes('rtc-contact').key(c.id);})).classes('rtc-list')
   :h('p','You have no active contact links. Create one under Contact links, then choose here who can call you through it.').classes('field-help'));
}
/**
 * An app's approved purposes. With more than one, the owner can narrow them here (`review-rtc-narrow` opens the
 * confirmation; at least one stays, removing all is removing the app's access). With one, they are listed only.
 */
function approvedPurposes(state,m,app){
 const {form}=helpers(state),locale=state.locale??'en';
 if(!app.purposes.length)return h('p','No purposes approved.').classes('field-help');
 if(app.purposes.length===1)return h('ul',h('li',literal(purposeTitle(m,app.purposes[0],locale))));
 return form([...app.purposes.map(l=>checkbox('keep:'+l,literal(purposeTitle(m,l,locale)),true)),h('p','Uncheck what this app should no longer do. Its calls and connections for those purposes end at once, and approving them again needs a new request from the app.').classes('field-help')],{kind:'review-rtc-narrow',clientId:app.clientId},'Approve fewer purposes');
}
function appsPanel(state,m){
 const {btn,form,date}=helpers(state),locale=state.locale??'en',view=state.config?.integrationsEnabled?'connections':'connected-apps';
 return section('apps','Apps that can connect you','Each app can ring you or connect your devices only for the purposes you approved for it. The call itself always happens in the app.',
  m.apps.length?h('div',...m.apps.map(app=>{const devices=m.endpoints.filter(e=>e.clientId===app.clientId),auto=m.purposes.filter(p=>p.autoAccept==='self'&&app.purposes.includes(p.id)),on=m.policy.autoAccept[app.clientId]??[];
   return h('article',h('h3',literal(appLabel(app))),app.origin?h('p',literal(app.origin)).classes('field-help'):null,
    h('p','Approved purposes').classes('rtc-label'),approvedPurposes(state,m,app),
    auto.length?form([...auto.map(p=>checkbox('auto:'+p.id,literal(purposeTitle(m,p.id,locale)),on.includes(p.id))),h('p','Lets this app answer automatically when it calls itself on another of your devices. Calls from other people always need you.').classes('field-help')],{kind:'save-rtc-auto-accept',clientId:app.clientId},'Save automatic answers'):null,
    h('p','Devices').classes('rtc-label'),devices.length?h('ul',...devices.map(e=>h('li',h('span',literal(e.label??'Unnamed device')),h('span',interfaceText('Last seen {date}',{date:date(e.lastSeen)})).classes('field-help'),confirmButton(state,'Remove device','revoke-endpoint',{endpoint:e.endpoint})).classes('rtc-row').key(e.endpoint))).classes('rtc-rows'):h('p','No device of this app is listening for calls.').classes('field-help'),
    h('p','To remove the app completely, change its access.').classes('field-help'),btn('Manage app access',{kind:'navigate',view},'button secondary')).classes('rtc-app').key(app.clientId);})).classes('rtc-list')
   :h('p','No app has asked to make calls or connections for you.').classes('field-help'));
}
/**
 * Review F1: an incoming record nobody answered ends silently (the caller rings out, nothing is sent): a ringing invite
 * offers Decline, a held request Remove and Block, never "End". RtcService ends such a record at the provider without
 * telling the caller (gate G2 closed); a record declined in this tab stays hidden until the next read drops it.
 */
function sessionControls(state,s){
 const {btn}=helpers(state),silent={kind:'rtc-action',action:'end-session',input:{sid:s.sid,caller:s.peer,silent:true},until:s.ringUntil};
 if(s.role==='callee'&&s.held)return h('span',btn('Remove',silent,'text-button'),confirmButton(state,'Block','block',{principal:s.peer})).classes('buttons');
 if(silentEnd(s))return btn('Decline',silent,'text-button');
 return confirmButton(state,'End','end-session',s.role==='callee'?{sid:s.sid,caller:s.peer}:{sid:s.sid});
}
function sessionsPanel(state,m){
 const {date}=helpers(state),locale=state.locale??'en',declined=rtcDeclined(state),sessions=m.sessions.filter(s=>!(silentEnd(s)&&declined.has(s.sid)));
 return section('sessions','Active sessions','Calls and connections that are ringing or connected now. Declining or removing one nobody answered tells the caller nothing: the call just rings out.',
  sessions.length?h('ul',...sessions.map(s=>h('li',h('span',h('strong',literal(purposeTitle(m,s.purpose,locale))),' · ',s.own?h('span','Your own devices'):literal(principalLabel(s.peer,s.peerHandle))),
   h('span',s.role==='callee'&&s.held?'Held request':s.state==='ringing'?'Ringing':'Connected',' · ',s.role==='caller'?'Outgoing':'Incoming',' · ',...mediaList(s.media),' · ',interfaceText('Started {date}',{date:date(s.createdAt)})).classes('field-help'),
   sessionControls(state,s)).classes('rtc-row').key(s.sid))).classes('rtc-rows'):h('p','Nothing is ringing or connected.').classes('field-help'));
}
function missedPanel(state,m){
 const {btn,date}=helpers(state),locale=state.locale??'en';
 return section('missed','Missed calls and held requests','Kept for up to 30 days so you can see who tried to reach you. Nobody is told when you remove an entry or block someone.',
  m.missed.length?h('div',h('ul',...m.missed.map(x=>h('li',h('span',badge(x.kind==='held'?'Held request':'Missed',x.kind==='held'?'warning':''),' ',literal(principalLabel(x.caller,x.callerHandle)),' · ',literal(purposeTitle(m,x.purpose,locale))),h('span',date(x.at)).classes('field-help'),
   h('span',btn('Remove from list',{kind:'rtc-action',action:'clear-missed',input:{id:x.id}},'text-button'),confirmButton(state,'Block','block',{principal:x.caller})).classes('buttons')).classes('rtc-row').key(x.id))).classes('rtc-rows'),confirmButton(state,'Clear the list','clear-missed',{},'button secondary'))
   :h('p','No missed calls or held requests.').classes('field-help'));
}
function blockedPanel(state,m){
 const {btn}=helpers(state);
 return section('blocked','Blocked people','Calls and requests from these people are dropped without telling them.',
  m.blocked.length?h('ul',...m.blocked.map(b=>h('li',literal(principalLabel(b.principal,b.handle)),btn('Unblock',{kind:'rtc-action',action:'unblock',input:{principal:b.principal}},'text-button')).classes('rtc-row').key(b.principal.iss+b.principal.sub))).classes('rtc-rows'):h('p','Nobody is blocked.').classes('field-help'));
}
function ticketsPanel(state,m){
 const {date}=helpers(state),locale=state.locale??'en';
 return section('tickets','Call links','Apps you approved can create call links for you, for example to pair a nearby device. Anyone holding a live link can ring you for its purposes until it is used up, expires or is revoked.',
  m.tickets.length?h('ul',...m.tickets.map(t=>h('li',h('span',h('strong',literal(t.purposes.map(l=>purposeTitle(m,l,locale)).join(', '))),' ',badge(t.revoked?'Revoked':t.live?'Live':'Ended',t.live?'good':'')),
   h('span',interfaceText('{left} of {uses} uses left',{left:t.usesLeft,uses:t.uses}),' · ',interfaceText('Expires {date}',{date:date(t.expiresAt)}),t.principal?' · ':null,t.principal?'One person only':null).classes('field-help'),
   t.live?confirmButton(state,'Revoke','revoke-ticket',{jti:t.jti}):null).classes('rtc-row').key(t.jti))).classes('rtc-rows'):h('p','You have no call links.').classes('field-help'));
}
function verifyPanel(){
 return section('verify','Check who you are talking to',null,
  h('p','During a call, an app may show a 6-digit code. Read it aloud to each other: if both of you see the same code, no provider or network in between can listen in. The app you use can still see the call.'),
  h('p','If the codes differ, end the call. Compare again whenever the app asks.').classes('field-help'));
}

export default function rtcSettingsView(state){
 if(!rtcEnabled(state))return h('div',empty('This page is not available','Choose another section from the menu.')).classes('rtc-settings');
 const m=rtcModel(state),{btn}=helpers(state),header=pageHeader('Calls & connections','Choose who can call you or connect with your devices, and how your network address is protected.');
 if(!m||m.status==='loading')return h('div',header,h('p','Loading call settings…').attrs({role:'status'}).classes('field-help')).attrs({'aria-busy':'true'}).classes('rtc-settings');
 if(m.status==='error')return h('div',header,h('p','Call settings could not be loaded.').classes('field-help'),btn('Try again',{kind:'load-rtc-settings'},'button secondary')).attrs({'aria-busy':'false'}).classes('rtc-settings');
 return h('div',header,h('div',privacyPanel(state,m),contactsPanel(state,m),requestsPanel(state,m),appsPanel(state,m),sessionsPanel(state,m),missedPanel(state,m),ticketsPanel(state,m),blockedPanel(state,m),verifyPanel()).classes('rtc-grid')).attrs({'aria-busy':'false'}).classes('rtc-settings');
}

const CONFIRM=Object.freeze({
 'end-session':['End this session?','Both sides are told the session ended. A connection that is already running may continue until the app closes it.','End session'],
 'revoke-ticket':['Revoke this call link?','Nobody can start a new call with this link. Calls already connected continue until they end.','Revoke call link'],
 'revoke-endpoint':['Remove this device from calls?','The app on this device stops receiving calls and its sessions end. It can listen again while the app keeps its access.','Remove device'],
 block:['Block this person?','Their calls and requests are dropped without telling them and are not listed as missed. You can unblock them here later.','Block'],
 'clear-missed':['Clear the missed and held list?','Every entry is removed from this list. Nobody is told.','Clear list'],
 'narrow-app':['Approve fewer purposes for this app?','The app can no longer ring you or connect your devices for these purposes. Its calls and connections for them end now, and its devices stop listening for them. Approving them again needs a new request from the app.','Approve fewer purposes'],
});
/** The narrowing dialog names the app and the purposes it loses (owner data, not translated). */
function narrowSummary(state,input){
 const m=rtcModel(state),locale=state.locale??'en',app=m?.apps?.find(a=>a.clientId===input?.clientId),kept=Array.isArray(input?.purposes)?input.purposes:[];
 if(!app)return null;const removed=app.purposes.filter(l=>!kept.includes(l));
 return h('div',h('p',h('strong',literal(appLabel(app)))),h('p','No longer approved').classes('rtc-label'),h('ul',...removed.map(l=>h('li',literal(purposeTitle(m,l,locale))).key(l))),
  h('p','Still approved').classes('rtc-label'),h('ul',...kept.map(l=>h('li',literal(purposeTitle(m,l,locale))).key(l)))).classes('rtc-narrow-summary');
}
/** The confirmation dialog for destructive RTC actions (modal kind `rtc-confirm`), for release-dialogs.mjs. */
export function rtcDialog(state){
 const m=state.modal;if(m?.kind!=='rtc-confirm'||!Object.hasOwn(CONFIRM,m.action))return null;
 const {btn}=helpers(state),[title,text,label]=CONFIRM[m.action];
 return {title,body:h('div',h('p',text),m.action==='narrow-app'?narrowSummary(state,m.input):null,h('div',btn(label,{kind:'rtc-action',action:m.action,input:m.input},'button danger-button'),btn('Cancel',{kind:'close-modal'},'button secondary')).classes('buttons')).classes('rtc-confirm')};
}
