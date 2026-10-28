// Generic signaling owner controls (docs/spec/extensions/signaling.md rev 3.2 §14.1, Appendix C.3), rendered inside
// existing surfaces: `signalingPrivacyPanel` in Account & security (IP policy and the blocked lists), and
// `signalingAppControls` / `signalingOtherApps` with each app in the owner's app connections (Apps & integrations, or
// Connected apps while integrations are off). Renders the `signaling` model from apps/web/src/bl/signaling-controls.mjs
// and bubbles native intents. Owner data (handles, principals, app names, kind titles and URLs) is marked
// translate="no"; interface text is localized through packages/i18n/catalogues.mjs. Provisional wording (coordinator),
// not signed off by the user. Nothing renders while the account's session features lack signalingEnabled.
import {h,badge,helpers,interfaceText} from './release-primitives.mjs';
import {signalingEnabled,signalingModel,signalingAppAnchor,signalingInput} from '../bl/signaling-controls.mjs';

const literal=value=>h('span',String(value??'')).attrs({translate:'no'});
const hostOf=origin=>{try{return new URL(origin).host;}catch{return String(origin??'');}};
/** A principal as the owner should read it: the handle this host verified, else the issuer host and a short id. */
export function principalLabel(principal,handle){return handle?'@'+handle:`${hostOf(principal?.iss)} · ${String(principal?.sub??'').slice(0,8)}`;}
const appLabel=app=>app?.name??hostOf(app?.origin??app?.clientId);
/** A kind's title in the interface language from any approval naming that kind line, else the line itself. */
export function kindTitle(model,line,locale='en'){
 for(const app of model?.apps??[])for(const a of app.approvals??[])if(a.kind===line&&a.title&&typeof a.title==='object'){const t=a.title[locale]??a.title.en;if(typeof t==='string'&&t)return t;}
 return String(line??'');
}
const confirmButton=(state,label,action,input,cls='text-button danger')=>helpers(state).btn(label,{kind:'open-modal',modal:{kind:'signaling-confirm',action,input}},cls);
function radios(name,legend,options,value){
 return h('fieldset',h('legend',legend),...options.map(([id,title,help])=>h('label',h('input').props({type:'radio',name,value:id,checked:value===id}).attrs({'aria-describedby':`signaling-${name}-${id}-help`}).key(`${name}:${id}`),h('span',h('strong',title),h('span',help).props({id:`signaling-${name}-${id}-help`}).classes('field-help'))).classes('signaling-choice'))).classes('signaling-choices');
}
const rows=(items,empty)=>items.length?h('ul',...items).classes('signaling-rows'):h('p',empty).classes('field-help');

/** Account & security: the IP policy (§14.1 "Privacy") and the blocked people and providers, each with Unblock. */
export function signalingPrivacyPanel(state){
 if(!signalingEnabled(state))return null;
 const m=signalingModel(state),{btn,form}=helpers(state);
 const head=[h('h2','Direct connections').props({id:'signaling-privacy-title',tabIndex:-1}),h('p','Apps you approve can connect your devices to each other, or to other people, directly or through a relay. Choose what the other side may learn about your network address.').classes('muted')];
 if(!m||m.status==='loading')return h('section',...head,h('p','Loading connection settings…').attrs({role:'status'}).classes('field-help')).attrs({'aria-labelledby':'signaling-privacy-title','aria-busy':'true'}).classes('panel','signaling-panel');
 if(m.status==='error')return h('section',...head,h('p','Connection settings could not be loaded.').classes('field-help'),btn('Try again',{kind:'load-signaling-settings'},'button secondary')).attrs({'aria-labelledby':'signaling-privacy-title','aria-busy':'false'}).classes('panel','signaling-panel');
 const p=m.policy??{},blocked=Array.isArray(m.blocked)?m.blocked:[],issuers=Array.isArray(m.blockedIssuers)?m.blockedIssuers:[];
 return h('section',...head,
  form([
   radios('other','With other people',[
    ['relay','Relay only (recommended)','The other person never sees your IP address; the relay does. The connection goes through the relay, which can be slower, and it cannot connect if neither you nor the app has a relay.'],
    ['public','Allow your public address','Connects without a relay when possible. The other person, their app and their provider can see your public IP address, which can reveal your approximate location and internet provider.']],p.other),
   radios('self','Between your own devices',[
    ['relay','Relay only','Your devices always connect through a relay and never share any address with each other.'],
    ['public','Public address only','Your devices connect over the internet and never share local network addresses.'],
    ['all','Direct','Your devices may use their local network addresses to connect. Only your own devices see them; your provider carries them briefly to set up the connection and then deletes them.']],p.self),
   h('p','A relay sees your IP address, that a connection happens and how much data it carries, but it cannot read what is sent.').classes('field-help')
  ],{kind:'save-signaling-policy'},'Save connection privacy'),
  h('h3','Blocked people and providers').props({id:'signaling-blocked-title',tabIndex:-1}),
  h('p','Blocked people and providers cannot connect to you, and they are not told.').classes('field-help'),
  h('h4','People'),
  rows(blocked.map(b=>h('li',h('span',literal(principalLabel(b.principal,b.handle))),btn('Unblock',{kind:'signaling-action',action:'unblock',input:{principal:b.principal}},'text-button')).classes('signaling-row').key('p:'+b.principal?.iss+' '+b.principal?.sub)),'Nobody is blocked.'),
  h('h4','Providers'),
  h('p','A blocked provider’s people cannot connect to you, including people you know there.').classes('field-help'),
  rows(issuers.map(b=>h('li',h('span',literal(hostOf(b.issuer))),btn('Unblock',{kind:'signaling-action',action:'unblock',input:{issuer:b.issuer}},'text-button')).classes('signaling-row').key('i:'+b.issuer)),'No provider is blocked.'),
  // The owner pages (bl/signaling-pages.mjs): pairings by peer, own-app pairings and every live offer.
  m.enabled===true?h('p',btn('Pairings and offers',{kind:'signaling-page',page:'overview',params:{}},'button secondary')):null
 ).attrs({'aria-labelledby':'signaling-privacy-title','aria-busy':'false'}).classes('panel','signaling-panel');
}

const OPENS={local:'This app opens it',peer:'The other side opens it',both:'Either side opens it'};
const PAIRING_STATE={pending:'Not active yet',awaiting_confirmation:'Waiting for confirmation',live:'Active'};
function otherParty(m,pairing){
 const self=pairing.peer?.self;
 if(self){const app=(m.apps??[]).find(a=>a.clientId===self.client_id);return [h('span','Your own app'),' ',literal(app?appLabel(app):hostOf(self.client_id))];}
 return [literal(principalLabel(pairing.peer?.principal,null))];
}
const has=(app,key)=>Array.isArray(app?.[key])&&app[key].length>0;
const relevant=app=>['approvals','endpoints','offers','pairings'].some(key=>has(app,key));
/** One app's signaling controls (§14.1, the app's entry in the owner's app connections), or null when it has none. */
function appControls(state,app,{title=false}={}){
 const m=signalingModel(state),{btn,date}=helpers(state),locale=state.locale??'en',id=signalingAppAnchor(app.clientId);
 const label=text=>h('p',text).classes('signaling-label');
 return h('section',
  h(title?'h3':'h4',title?literal(appLabel(app)):'Direct connections').props({id,tabIndex:-1}),
  title&&app.origin?h('p',literal(app.origin)).classes('field-help'):null,
  has(app,'approvals')?[label('Connection types'),rows(app.approvals.map(a=>h('li',
   h('span',h('strong',literal(kindTitle(m,a.kind,locale))),' ',h('span',interfaceText('Version {version}',{version:a.version})).classes('field-help')),
   a.autoConnect===true?h('span',badge('Connects automatically between your devices','good'),' ',btn('Turn off',{kind:'signaling-action',action:'session-auto-connect',input:{clientId:app.clientId,kind:a.kind}},'text-button')).classes('buttons'):a.autoConnectAllowed===true?btn('Review automatic connection',{kind:'signaling-page',page:'auto-connect',params:{client:app.clientId,kind:a.kind}},'text-button'):null,
   confirmButton(state,'Remove','session-unapprove',{clientId:app.clientId,kind:a.kind})).classes('signaling-row').key('a:'+a.kind)),'')]:null,
  has(app,'endpoints')?[label('Devices'),rows(app.endpoints.map(e=>h('li',
   h('span',e.label?literal(e.label):h('span','Unnamed device'),' ',h('span',interfaceText('Last seen {date}',{date:date(e.lastSeen)})).classes('field-help')),
   confirmButton(state,'Remove','revoke-endpoint',{endpoint:e.endpoint})).classes('signaling-row').key('e:'+e.endpoint)),'')]:null,
  has(app,'offers')?[label('Offers'),rows(app.offers.map(o=>h('li',
   h('span',h('strong',literal(kindTitle(m,o.kind,locale))),' · ',o.principal?literal(principalLabel(o.principal,null)):h('span','Anyone with the offer'),' ',
    h('span',interfaceText('{spent} of {uses} uses spent',{spent:o.spent,uses:o.uses}),' · ',interfaceText('Expires {date}',{date:date(o.expiresAt)})).classes('field-help')),
   confirmButton(state,'Revoke','revoke-offers',{id:o.id})).classes('signaling-row').key('o:'+o.id)),''),
   confirmButton(state,'Revoke all offers from this app','revoke-offers',{clientId:app.clientId},'button secondary')]:null,
  has(app,'pairings')?[label('Pairings'),rows(app.pairings.map(p=>h('li',
   h('span',p.label?h('strong',literal(p.label)):null,p.label?' · ':null,literal(kindTitle(m,p.kind?.artefact,locale)),' · ',...otherParty(m,p),' ',
    h('span',OPENS[p.opens]??'',' · ',PAIRING_STATE[p.state]??'',' · ',Number.isFinite(p.expires_at)?interfaceText('Expires {date}',{date:date(p.expires_at)}):'No expiry').classes('field-help')),
   confirmButton(state,'Remove','pairing-remove',{id:p.id})).classes('signaling-row').key('r:'+p.id)),'')]:null,
  // Pairing creation is an owner page (§5.8); this only navigates there.
  has(app,'approvals')?h('p',btn('Pair this app',{kind:'signaling-page',page:'pair',params:{client:app.clientId}},'button secondary')):null
 ).attrs({'aria-labelledby':id}).classes('signaling-app').data({signalingApp:app.clientId});
}
/** The controls for the app with this client ID, when signaling is on and enabled and that app holds any. */
export function signalingAppControls(state,clientId){
 const m=signalingModel(state);if(m?.status!=='loaded'||m.enabled!==true||typeof clientId!=='string')return null;
 const app=(m.apps??[]).find(a=>a.clientId===clientId);return app&&relevant(app)?appControls(state,app):null;
}
/** Apps holding signaling state that the surrounding list does not show (for example, apps without a connection). */
export function signalingOtherApps(state,shown=[]){
 const m=signalingModel(state);if(m?.status!=='loaded'||m.enabled!==true)return null;
 const known=new Set(shown.filter(x=>typeof x==='string')),apps=(m.apps??[]).filter(a=>!known.has(a.clientId)&&relevant(a));
 if(!apps.length)return null;
 return h('section',h('h2','Other apps with direct connections').props({id:'signaling-other-title'}),h('p','These apps can connect your devices but are not listed above.').classes('field-help'),
  ...apps.map(app=>appControls(state,app,{title:true}).key(app.clientId))).attrs({'aria-labelledby':'signaling-other-title'}).classes('panel','signaling-other');
}

const CONFIRM=Object.freeze({
 'session-unapprove':['Remove this connection type?','The app can no longer connect for this type. Its connections, devices, offers and pairings for it end now. The app can ask for it again.','Remove connection type'],
 'revoke-endpoint':['Remove this device?','This device of the app stops receiving connections, and its connections end. The app can register it again while it keeps its access.','Remove device'],
 'revoke-offer':['Revoke this offer?','Nobody can use this offer any more. Connections it started that nobody accepted yet end without telling anyone.','Revoke offer'],
 'revoke-app-offers':['Revoke every offer from this app?','Nobody can use the offers this app created. Connections they started that nobody accepted yet end without telling anyone.','Revoke offers'],
 'revoke-all-offers':['Revoke every offer?','Nobody can use any offer your apps created. Connections they started that nobody accepted yet end without telling anyone.','Revoke offers'],
 'pairing-remove':['Remove this pairing?','The paired apps can no longer connect through it, and its connections end. Pairing again needs a new approval.','Remove pairing']
});
const confirmKey=(action,input)=>action==='revoke-offers'?(input?.id?'revoke-offer':input?.clientId?'revoke-app-offers':'revoke-all-offers'):action;
/** The confirmation dialog for destructive signaling actions (modal kind `signaling-confirm`), for release-dialogs.mjs. */
export function signalingDialog(state){
 const m=state.modal;if(m?.kind!=='signaling-confirm'||!signalingInput(m.action,m.input))return null;
 const key=confirmKey(m.action,m.input);if(!Object.hasOwn(CONFIRM,key))return null;
 const {btn}=helpers(state),[title,text,label]=CONFIRM[key],model=signalingModel(state),app=(model?.apps??[]).find(a=>a.clientId===m.input?.clientId);
 return {title,body:h('div',h('p',text),app?h('p',h('strong',literal(appLabel(app)))):null,m.input?.kind?h('p',literal(kindTitle(model,m.input.kind,state.locale??'en'))):null,
  h('div',btn(label,{kind:'signaling-action',action:m.action,input:m.input},'button danger-button'),btn('Cancel',{kind:'close-modal'},'button secondary')).classes('buttons')).classes('signaling-confirm')};
}
