// Signaling owner pages (console view `signaling`; docs/spec/extensions/signaling.md rev 3.2 §20.1.4, §5.8, §14.1,
// §4.3; release gate "Signaling", owner pages). Renders the page model of apps/web/src/bl/signaling-pages.mjs and the
// server's review disclosures; bubbles native intents. Every decision control (Approve, Create pairing, Activate,
// Renew, Confirm newer version, Turn on, Designate) is a separate button, never default-focused, aria-disabled until
// the arming resource in release.mjs arms it, and sends its click event so that only trusted activations count.
// Nothing is preselected: the pairing form's choices start empty (its address parameters never fill it) and the
// approval page's auto-connect box unchecked. Key sentences and creation choices name apps by verified origin (§5.8);
// an app's self-chosen name appears only beside its origin in the fact lists.
// Owner data (handles, principals, app names, kind titles and summaries, labels, URLs) is marked translate="no";
// interface text is localized through packages/i18n/catalogues.mjs. Provisional wording (coordinator), unsigned.
import {h,badge,helpers,interfaceText,fire,pageHeader} from './release-primitives.mjs';
import {present} from './attrs.mjs';
import {signalingModel} from '../bl/signaling-controls.mjs';
import {pageModel} from '../bl/signaling-pages.mjs';

const literal=value=>h('span',String(value??'')).attrs({translate:'no'});
const hostOf=origin=>{try{return new URL(origin).host;}catch{return String(origin??'');}};
const title=(map,locale)=>map&&typeof map==='object'?(map[locale]??map.en??Object.values(map)[0]??''):'';
const DAY=86400000;
const PROFILE={webrtc:'A direct connection, which can carry audio, video and files',data:'Small data messages relayed by your provider'};
const PARTIES={self:'Only between your own devices and apps',other:'Only with other people and accounts',any:'Between your own devices, and with other people and accounts'};
const BASES={self:'Your own devices',pairing:'Pairings you create',offer:'Offers the app hands out in its own messages'};
const CATEGORY={'personal-data':'Personal data',location:'Location',identity:'Identity','send-as-you':'Acting as you',money:'Money',public:'Public information'};
const RISK={low:'Low',medium:'Medium',high:'High',critical:'Critical'};
const STATE={pending:'Not active yet',awaiting_confirmation:'Waiting for confirmation',live:'Active'};
const nav=(state,label,target,params={},cls='text-button')=>helpers(state).btn(label,{kind:'signaling-page',page:target,params},cls);
const dateOnly=(state,value)=>{try{return new Intl.DateTimeFormat(state.locale??'en',{dateStyle:'medium'}).format(new Date(value));}catch{return String(value);}};
const section=(heading,id,...children)=>h('section',h('h2',heading).props({id}),...children).attrs({'aria-labelledby':id}).classes('panel','signaling-page-section');
const list=(items,empty)=>items.length?h('ul',...items).classes('signaling-rows'):h('p',empty).classes('field-help');
const appOf=(m,clientId)=>(m?.apps??[]).find(a=>a.clientId===clientId)??null;
/** An app as a page names it: its name only as unverified text, beside its verified origin (intents §7.1 item 4). */
function appName(m,clientId){const a=appOf(m,clientId),origin=a?.origin??(()=>{try{return new URL(clientId).origin;}catch{return clientId;}})();return a?.name?[literal(a.name),' ',h('span','(',literal(hostOf(origin)),')').classes('field-help')]:[literal(hostOf(origin))];}
/** An app in a sentence or an option label (§5.8 "names both apps by verified origin"): the host of its verified origin,
 * never its self-chosen name; the full client id (without scheme) when another known app shares that host. */
function appText(m,clientId,origin){
 const host=hostOf(origin??appOf(m,clientId)?.origin??clientId);
 const shared=(m?.apps??[]).some(a=>a.clientId!==clientId&&hostOf(a.origin??a.clientId)===host);
 return shared?String(clientId).replace(/^[a-z][a-z0-9+.-]*:\/\//i,''):host;
}
/** A peer principal: by handle only with a verified binding, otherwise the full principal and its issuer (§5.8). */
function peerName(peer){if(peer?.handle)return [literal('@'+peer.handle)];const p=peer?.principal??peer;return [literal(p?.sub??''),' ',h('span',interfaceText('at {host}',{host:hostOf(p?.iss)})).classes('field-help')];}
const peerText=peer=>peer?.handle?'@'+peer.handle:peer?.principal?`${hostOf(peer.principal.iss)} · ${peer.principal.sub}`:'';
function kindTitleOf(m,line,locale){for(const a of m?.apps??[])for(const x of a.approvals??[])if(x.kind===line&&x.title){const t=title(x.title,locale);if(t)return t;}return line;}

/** The decision control: armed only by release.mjs (aria-disabled until then), trusted clicks only, never default focus. */
function decide(state,label,{armed,detail={},danger=false,secondary=false}={}){
 return h('button',label).props({type:'button',disabled:state.busy}).attrs(present({'aria-disabled':armed?undefined:'true','aria-describedby':armed?undefined:'signaling-arming-help'})).classes('button',danger?'danger-button':secondary?'secondary':'primary').data({signalingDecide:'true'})
  .on({click:event=>{const form=event.currentTarget.closest('form'),auto=form?new FormData(form).get('autoConnect')==='on':false;fire(event.currentTarget,'signaling-decide',{...detail,autoConnect:auto,nativeEvent:event});}});
}
/** The decision controls of a review: one armed decision (with `detail`), an optional second armed decision
 * (`alternative` {label, detail}, e.g. creating a pairing without activating it), and Cancel. */
function decisionButtons(state,p,label,{detail={},alternative=null}={}){
 const {btn}=helpers(state),armed=p.armed===true;
 return [h('p','The button becomes available in a moment.').props({id:'signaling-arming-help'}).classes('field-help','signaling-arming-help',...p.armed?['signaling-armed']:[]),
  h('div',decide(state,label,{armed,detail}),alternative?decide(state,alternative.label,{armed,detail:alternative.detail,secondary:true}):null,btn('Cancel',{kind:'signaling-cancel-review'},'button secondary')).classes('buttons')];
}
function kindFacts(state,kind,{risk}={}){
 const locale=state.locale??'en';
 return [
  h('p',h('strong','“',literal(title(kind.title,locale)),'”'),' ',h('span',interfaceText('Described by {host}. This provider has not reviewed this description.',{host:kind.host??''})).classes('field-help')),
  kind.summary?h('p','“',literal(title(kind.summary,locale)),'”').classes('signaling-quote'):null,
  h('dl',
   h('div',h('dt','Who it connects'),h('dd',PARTIES[kind.parties]??'')),
   h('div',h('dt','How it connects'),h('dd',h('ul',...kind.profiles.map(x=>h('li',PROFILE[x]??literal(x)))))),
   h('div',h('dt','When it may connect'),h('dd',kind.bases?h('ul',...kind.bases.map(b=>h('li',BASES[b]??literal(b)))):'Any way the app connects: your own devices, pairings and offers')),
   h('div',h('dt','Data it can carry'),h('dd',kind.categories.length?h('ul',...kind.categories.map(c=>h('li',CATEGORY[c]??literal(c)))):'No sensitive categories')),
   risk?h('div',h('dt','Risk'),h('dd',RISK[risk]??'High')):null,
   h('div',h('dt','Version'),h('dd',literal(String(kind.version))))
  ).classes('signaling-facts')];
}

// ---- approval page (§20.1.4) ----------------------------------------------------------------------------------------
function approvePage(state,p,m){
 const r=p.review,d=r?.disclosure,account=state.session?.account,{btn}=helpers(state);
 if(p.done?.action==='session-approve')return section('Connection type approved','signaling-decision-title',h('p','The app can now use this connection type. You can remove it at any time from the app’s entry in your app connections.'),nav(state,'Back to direct connections','overview',{},'button secondary'));
 if(!r)return section('Approve a connection type','signaling-decision-title',h('p',p.status==='loading'?'Loading…':'This approval could not be prepared. The app may not be connected, or the connection type is not available here.').attrs({role:p.status==='loading'?'status':null}),
  p.params.client&&p.params.kind&&p.status!=='loading'?btn('Try again',{kind:'signaling-review',action:'session-approve',clientId:p.params.client,kind:p.params.kind},'button secondary'):null);
 return h('form',h('section',
  h('h2','Approve a connection type').props({id:'signaling-decision-title',tabIndex:-1}),
  h('p',interfaceText('For your account {handle}',{handle:'@'+(account?.handle??'')})).classes('field-help'),
  h('h3','App'),h('p',...appName(m,d.handler.client_id)),h('p',interfaceText('Verified address: {origin}',{origin:d.handler.origin??''})).classes('field-help'),
  h('h3','Connection type'),...kindFacts(state,d.kind,{risk:d.risk}),
  h('p','This app will see who is connecting (their verified identity), the app they say they use, and the details sent with every connection request it receives for this type.').classes('security-note'),
  d.serviceClass?h('div',h('p','This app belongs to a service organization. It may hand out open offers lasting up to 90 days and single-use offers for one person lasting up to 7 days. Anyone holding an open offer can connect to it automatically on any of its devices that are online, can tell when it is running, and it may decline automatically.')).classes('security-note'):null,
  d.existing?h('p',interfaceText('This app is already approved for version {version}.',{version:d.existing.version}),d.addsDisclosure?[' ',h('strong','This version can carry more kinds of data than the one you approved.')]:null):null,
  d.autoConnectAllowed?h('div',h('label',h('input').props({type:'checkbox',name:'autoConnect',checked:false}).key('autoConnect'),h('span','Also let this app connect your own devices to each other automatically, without asking')).classes('checkbox-field'),h('p','Off unless you turn it on. You can turn it off later.').classes('field-help')):null,
  d.activatable.length?[h('h3','Pairings waiting for this approval'),h('p','Approving does not activate them. Each pairing has its own activation step.').classes('field-help'),
   list(d.activatable.map(x=>h('li',h('span',h('strong',literal(x.label)),' · ',x.peer.self?appName(m,x.peer.self.client_id===d.handler.client_id?x.local.client_id:x.peer.self.client_id):peerName({principal:x.peer.principal})),nav(state,'Review activation','pairing',{id:x.id})).classes('signaling-row').key(x.id)),'')]:null,
  ...decisionButtons(state,p,'Approve')
 ).classes('panel','signaling-decision').attrs({'aria-labelledby':'signaling-decision-title'})).on({submit:e=>e.preventDefault()});
}

// ---- automatic connection between own devices (§5.5, §20.1.4 "Widening") ------------------------------------------------
function autoConnectPage(state,p,m){
 const r=p.review,d=r?.disclosure;
 if(p.done?.action==='session-auto-connect')return section('Automatic connection turned on','signaling-decision-title',h('p','You can turn it off at any time from the app’s entry in your app connections.'),nav(state,'Back to direct connections','overview',{},'button secondary'));
 if(!r)return section('Connect your devices automatically','signaling-decision-title',h('p',p.status==='loading'?'Loading…':'This change could not be prepared. The app may no longer be approved for this connection type.'));
 return h('form',h('section',h('h2','Connect your devices automatically').props({id:'signaling-decision-title',tabIndex:-1}),
  h('h3','App'),h('p',...appName(m,d.handler.client_id)),h('h3','Connection type'),...kindFacts(state,d.kind,{risk:d.risk}),
  h('p','Your own devices running this app will connect to each other for this connection type whenever they are running, without asking you first. Other people are never connected this way.').classes('security-note'),
  ...decisionButtons(state,p,'Turn on automatic connection')).classes('panel','signaling-decision').attrs({'aria-labelledby':'signaling-decision-title'})).on({submit:e=>e.preventDefault()});
}

// ---- pairing disclosure (§5.8) ----------------------------------------------------------------------------------------
function pairingDisclosure(state,m,d){
 const local=appText(m,d.local.client_id,d.local.origin),other=d.cross?peerText(d.peer):appText(m,d.peer.self.client_id,d.peer.self.origin),opener=d.opens==='local'?local:d.opens==='peer'?other:null;
 return [
  h('dl',
   h('div',h('dt','This app'),h('dd',...appName(m,d.local.client_id))),
   h('div',h('dt',d.cross?'Paired with':'Your other app'),h('dd',...(d.cross?peerName(d.peer):appName(m,d.peer.self.client_id)))),
   d.cross&&!d.peer.handle?h('div',h('dt','Their provider'),h('dd',literal(d.peer.issuerOrigin??''))):null,
   h('div',h('dt','Label'),h('dd',literal(d.label))),
   h('div',h('dt','Who starts connections'),h('dd',opener?interfaceText('{app} starts connections; the other side answers.',{app:opener}):'Either side starts connections.')),
   h('div',h('dt','Expires'),h('dd',Number.isFinite(d.expiresAt??d.expires_at)?literal(dateOnly(state,d.expiresAt??d.expires_at)):'No expiry'))
  ).classes('signaling-facts'),
  h('p',interfaceText(d.opens==='both'?'{a} and {b} will connect automatically, with no prompt, whenever either is running.':'{a} and {b} will connect automatically, with no prompt, whenever the side that starts connections is running.',{a:local,b:other})).classes('security-note'),
  h('p',d.effect.direct?interfaceText('{other} may open a direct connection with {app} without asking, and exchange data with it.',{other,app:local}):interfaceText('{other} may exchange data with {app} without asking.',{other,app:local})),
  d.effect.categories.length?[h('p','That data can include:'),h('ul',...d.effect.categories.map(c=>h('li',CATEGORY[c]??literal(c))))]:null,
  d.peerCanTellRunning?h('p',interfaceText('{peer} can tell when {app} is running.',{peer:other,app:local})).classes('security-note'):null,
  d.recipientOnlyEnforcement?h('p','This provider can enforce only your side of this pairing. A provider that follows the standard also requires the other account’s own pairing before its app may connect to you, but a provider that does not follow it can skip that check. Your pairing still limits who, which connection type, which of your apps and until when.').classes('security-note'):null,
 ];
}
function partiesStatus(state,m,parties,kind){
 return list(parties.map(x=>h('li',h('span',...appName(m,x.client_id),' ',badge(x.connected&&x.approved?'Ready':!x.connected?'Not connected':'Not approved for this type',x.connected&&x.approved?'good':'warning')),
  x.connected&&!x.approved?nav(state,'Review approval','approve',{client:x.client_id,kind}):null).classes('signaling-row').key(x.client_id)),'');
}

// ---- pairing creation page --------------------------------------------------------------------------------------------
function choice(name,legend,options){return h('fieldset',h('legend',legend),...options.map(([value,label])=>h('label',h('input').props({type:'radio',name,value,required:true,checked:false}).key(name+':'+value),h('span',label)).classes('signaling-choice'))).classes('signaling-choices');}
/** A required choice that starts empty (§5.8, §20.1.4 "nothing preselected"): no option is ever selected for the owner,
 * whatever the page's address says. */
function pick(name,label,options,required=true){return h('label',h('span',label),h('select',h('option','Choose…').props({value:'',selected:true}),...options.map(([id,text])=>h('option',String(text)).props({value:id,selected:false}).attrs({translate:'no'}))).props({name,required}).classes('input').key('pick:'+name)).classes('field');}
function pairPage(state,p,m){
 const r=p.review;
 if(r?.action==='pairing-create'){const d=r.disclosure;return h('form',h('section',h('h2','Review this pairing').props({id:'signaling-decision-title',tabIndex:-1}),
  h('h3','Connection type'),...kindFacts(state,d.kind),h('h3','Pairing'),...pairingDisclosure(state,m,d),
  h('h3','Each app’s own access'),partiesStatus(state,m,d.parties,d.kind.artefact),
  ...(d.activateNow?[h('h3','Activation'),
   h('p',interfaceText(d.cross?'{app} already has its own access and approval. You can activate the pairing now, so that it works at once, or create it inactive and activate it later on its page.':'{app} and {other} already have their own access and approval. You can activate the pairing now, so that it works at once, or create it inactive and activate it later on its page.',{app:appText(m,d.local.client_id,d.local.origin),other:d.cross?'':appText(m,d.peer.self.client_id,d.peer.self.origin)})),
   ...decisionButtons(state,p,'Create and activate pairing',{detail:{activate:true},alternative:{label:'Create without activating',detail:{activate:false}}})]:
   [h('p','Not every app has its own access and approval yet. The pairing will be created but stays inactive until you activate it on its page. Pending pairings are deleted after 7 days.').classes('field-help'),
   ...decisionButtons(state,p,'Create pairing')])).classes('panel','signaling-decision').attrs({'aria-labelledby':'signaling-decision-title'})).on({submit:e=>e.preventDefault()});}
 const {form}=helpers(state),locale=state.locale??'en',apps=(m?.apps??[]).filter(a=>a.approvals?.length);
 const kinds=[...new Map(apps.flatMap(a=>a.approvals.map(x=>[x.kind,kindTitleOf(m,x.kind,locale)]))).entries()];
 const refusal=p.refusal?.code==='pairing_exists'?h('p','You already have a pairing with this account for this connection type.',' ',nav(state,'Open that pairing','pairing',{id:p.refusal.existing})).attrs({role:'alert'}).classes('alert','error'):null;
 return h('section',h('h2','Pair apps').props({id:'signaling-decision-title',tabIndex:-1}),
  h('p','A pairing lets one of your apps connect automatically, for one connection type, with one other app of yours or with one other account. Nothing is chosen for you.').classes('muted'),refusal,
  apps.length?form([
   pick('kind','Connection type',kinds),
   pick('local','This app',apps.map(a=>[a.clientId,appText(m,a.clientId,a.origin)])),
   choice('with','Pair with',[['self','Another of my apps'],['principal','Another account']]),
   pick('peerApp','Your other app (when pairing with another of your apps)',(m?.apps??[]).map(a=>[a.clientId,appText(m,a.clientId,a.origin)]),false),
   h('label',h('span','Their handle (when pairing with another account)'),h('input').props({name:'peerHandle',type:'text',autocomplete:'off',spellcheck:false,placeholder:'name@provider.example'}).attrs({maxlength:'320',autocapitalize:'none'}).classes('input').key('peerHandle')).classes('field'),
   choice('opens','Who starts connections',[['local','This app'],['peer','The other side'],['both','Either side']]),
   h('label',h('span','Label'),h('input').props({name:'label',type:'text',required:true}).attrs({maxlength:'64'}).classes('input').key('label')).classes('field'),
   h('label',h('span','Expires after (pairings with another account always expire)'),h('select',...[[30,'30 days'],[90,'90 days'],[180,'180 days'],[365,'1 year']].map(([v,t])=>h('option',t).props({value:String(v),selected:v===90}))).props({name:'days'}).classes('input')).classes('field'),
   h('p','Pairing with another account asks you to confirm it is you.').classes('field-help')
  ],{kind:'signaling-review',action:'pairing-create'},'Review pairing'):h('p','No app is approved for a connection type yet. Approve one from the app first.').classes('field-help')
 ).classes('panel','signaling-page-form').attrs({'aria-labelledby':'signaling-decision-title'});
}

// ---- one pairing (activation, renewal, re-confirmation, relabel, removal) ----------------------------------------------
function pairingPage(state,p,m){
 const detail=p.detail,{btn,form}=helpers(state),r=p.review;
 if(!detail)return section('Pairing','signaling-decision-title',h('p',p.status==='loading'?'Loading…':'This pairing no longer exists.'));
 const x=detail.pairing,gone=m?.status==='loaded'&&!(m.pairings??[]).some(y=>y.id===x.id);
 if(gone)return section('Pairing','signaling-decision-title',h('p','This pairing no longer exists.'),nav(state,'Back to direct connections','overview',{},'button secondary'));
 const d={...x,cross:Boolean(x.peer.principal),local:x.local,peer:detail.peer.self?detail.peer:detail.peer,effect:detail.effect??{direct:false,data:false,categories:[]},label:x.label,expires_at:x.expires_at,peerCanTellRunning:Boolean(x.peer.principal),recipientOnlyEnforcement:Boolean(x.peer.principal)};
 if(r&&['pairing-activate','pairing-update'].includes(r.action)){const rd=r.disclosure,label=r.action==='pairing-activate'?'Activate pairing':r.input.kind?'Confirm newer version':'Renew pairing';
  return h('form',h('section',h('h2',r.action==='pairing-activate'?'Activate this pairing':r.input.kind?'Confirm the newer version':'Renew this pairing').props({id:'signaling-decision-title',tabIndex:-1}),
   h('h3','Connection type'),...kindFacts(state,rd.kind),h('h3','Pairing'),...pairingDisclosure(state,m,{...rd,expiresAt:rd.next?.expires_at??rd.expires_at}),
   rd.next?.expires_at?h('p',interfaceText('The pairing will now expire on {date}.',{date:dateOnly(state,rd.next.expires_at)})):null,
   rd.next?.kind?h('p',interfaceText('Version {old} becomes version {new}.',{old:rd.current?.kind?.version??'',new:rd.next.kind.version}),rd.next.addsDisclosure?[' ',h('strong','The newer version can carry more kinds of data.')]:null):null,
   rd.parties?[h('h3','Each app’s own access'),partiesStatus(state,m,rd.parties,rd.kind.artefact)]:null,
   ...(r.action==='pairing-activate'&&!rd.activateNow?[h('p','Every app needs its own access and approval before this pairing can be activated.').attrs({role:'alert'}),btn('Cancel',{kind:'signaling-cancel-review'},'button secondary')]:decisionButtons(state,p,label))
  ).classes('panel','signaling-decision').attrs({'aria-labelledby':'signaling-decision-title'})).on({submit:e=>e.preventDefault()});}
 const ready=detail.parties.every(y=>y.connected&&y.approved);
 return h('div',
  h('section',h('h2',literal(x.label)).props({id:'signaling-decision-title',tabIndex:-1}),h('p',badge(STATE[x.state]??'',x.state==='live'?'good':'warning')),
   detail.kind?kindFacts(state,detail.kind):h('p',literal(x.kind.artefact)),...pairingDisclosure(state,m,d),
   h('h3','Each app’s own access'),partiesStatus(state,m,detail.parties,x.kind.artefact)).classes('panel'),
  x.state==='pending'?section('Activate','signaling-activate-title',h('p',ready?'Every app has its own access and approval. Review the pairing to activate it.':'Every app needs its own access and approval before this pairing can be activated.'),btn('Review activation',{kind:'signaling-review',action:'pairing-activate'},'button secondary',!ready||!detail.enabled)):null,
  x.state==='live'&&x.peer.principal?section('Renew','signaling-renew-title',form([h('label',h('span','Expires after'),h('select',...[[30,'30 days'],[90,'90 days'],[180,'180 days'],[365,'1 year']].map(([v,t])=>h('option',t).props({value:String(v),selected:v===90}))).props({name:'days'}).classes('input')).classes('field')],{kind:'signaling-review',action:'pairing-renew'},'Review renewal',!detail.enabled)):null,
  detail.newer?section('A newer version is available','signaling-newer-title',h('p',interfaceText('Version {version} of this connection type is available. Until you confirm it, this pairing covers only the versions you confirmed.',{version:detail.newer.kind.version}),detail.newer.addsDisclosure?[' ',h('strong','It can carry more kinds of data.')]:null),btn('Review newer version',{kind:'signaling-review',action:'pairing-reconfirm'},'button secondary',!detail.enabled)):null,
  section('Rename','signaling-rename-title',form([h('label',h('span','Label'),h('input').props({name:'label',type:'text',required:true,value:x.label}).attrs({maxlength:'64',translate:'no'}).classes('input').key('relabel:'+x.revision)).classes('field')],{kind:'signaling-relabel'},'Save label')),
  section('Remove','signaling-remove-title',h('p','The paired apps can no longer connect through it, and its connections end.'),btn('Remove pairing',{kind:'open-modal',modal:{kind:'signaling-confirm',action:'pairing-remove',input:{id:x.id}}},'button danger-button'))
 ).classes('signaling-pairing-page');
}

// ---- service designation (§4.3) ---------------------------------------------------------------------------------------
function servicePage(state,p){
 const s=p.service,r=p.review,{btn}=helpers(state);
 if(!s)return section('Service organization','signaling-decision-title',h('p',p.status==='loading'?'Loading…':'This setting is available only to an administrator of the organization.'));
 if(r?.action==='set-service'){const d=r.disclosure;return h('form',h('section',h('h2','Designate this organization as a service').props({id:'signaling-decision-title',tabIndex:-1}),
  h('p',interfaceText('Its approved apps, on every device they register, may then publish open offers lasting up to {open} days and offers for one person lasting up to {bound} days. Anyone holding an open offer can connect to the app automatically, and can tell when the app is running.',{open:Math.round(d.openSeconds/86400),bound:Math.round(d.boundSeconds/86400)})).classes('security-note'),
  h('p','Apps used by members on their own devices in member context never become service endpoints.'),
  h('h3','Apps this applies to now'),list(d.apps.map(a=>h('li',literal(hostOf(a.origin??a.client_id))).key(a.client_id)),'No app is approved yet.'),
  ...decisionButtons(state,p,'Designate as a service')).classes('panel','signaling-decision').attrs({'aria-labelledby':'signaling-decision-title'})).on({submit:e=>e.preventDefault()});}
 return section('Service organization','signaling-decision-title',
  !s.eligible?h('p','Only an organization can be a service. A person’s apps never publish long-lived offers.'):
  s.designated?[h('p','This organization is a service. Its approved apps may publish long-lived offers that anyone holding them can use to connect automatically.'),
   h('p',s.longOffers?interfaceText('Removing the designation revokes {count} offers that last longer than 15 minutes.',{count:s.longOffers}):'No offer lasting longer than 15 minutes is live.').classes('field-help'),
   btn('Remove designation',{kind:'open-modal',modal:{kind:'signaling-page-confirm',action:'service-remove'}},'button danger-button')]:
  [h('p','This organization is not a service. Its apps follow the same short limits as a person’s apps.'),btn('Review designation',{kind:'signaling-review',action:'set-service'},'button secondary',s.enabled!==true)]);
}

// ---- overview (§14.1: pairings by peer, own-app pairings, pending activations, live offers) -----------------------------
function pairingRow(state,m,x,{peer=true}={}){
 const locale=state.locale??'en',{date}=helpers(state);
 return h('li',h('span',h('strong',literal(x.label)),' · ',literal(kindTitleOf(m,x.kind.artefact,locale)),' · ',...(x.peer.self?[...appName(m,x.local.client_id),' ↔ ',...appName(m,x.peer.self.client_id)]:[...appName(m,x.local.client_id),...peer?[' ↔ ',...peerName({handle:x.peerHandle,principal:x.peer.principal})]:[]]),' ',
  h('span',STATE[x.state]??'',' · ',Number.isFinite(x.expires_at)?interfaceText('Expires {date}',{date:date(x.expires_at)}):'No expiry').classes('field-help')),
  h('span',nav(state,'Open','pairing',{id:x.id}),' ',helpers(state).btn('Remove',{kind:'open-modal',modal:{kind:'signaling-confirm',action:'pairing-remove',input:{id:x.id}}},'text-button danger')).classes('buttons')).classes('signaling-row').key(x.id);
}
function overview(state,m){
 const {btn,date}=helpers(state),locale=state.locale??'en',pairings=m?.pairings??[];
 const cross=pairings.filter(x=>x.peer.principal),own=pairings.filter(x=>x.peer.self),pending=pairings.filter(x=>x.state==='pending');
 const peers=new Map();for(const x of cross){const key=x.peer.principal.iss+' '+x.peer.principal.sub;if(!peers.has(key))peers.set(key,[]);peers.get(key).push(x);}
 const offers=(m?.apps??[]).flatMap(a=>(a.offers??[]).map(o=>({...o,clientId:a.clientId})));
 return h('div',
  pending.length?section('Waiting for activation','signaling-pending-title',h('p','These pairings do nothing until you activate them. Pending pairings are deleted after 7 days.').classes('field-help'),list(pending.map(x=>h('li',h('span',h('strong',literal(x.label))),nav(state,'Review activation','pairing',{id:x.id})).classes('signaling-row').key('p:'+x.id)),'')):null,
  section('Pairings with other accounts','signaling-peers-title',h('p','Grouped by the account each pairing is with. A pairing with another account always expires.').classes('field-help'),
   peers.size?h('div',...[...peers.values()].map(group=>h('div',h('h3',...peerName({handle:group[0].peerHandle,principal:group[0].peer.principal})),list(group.map(x=>pairingRow(state,m,x,{peer:false})),'')).classes('signaling-peer').key(group[0].peer.principal.iss+group[0].peer.principal.sub))):h('p','No pairing with another account.').classes('field-help')),
  section('Pairings between your apps','signaling-own-title',list(own.map(x=>pairingRow(state,m,x)),'No pairing between your apps.')),
  section('Live offers','signaling-offers-title',h('p','Offers your apps handed out that can still start a connection. The offers themselves are never shown here.').classes('field-help'),
   list(offers.map(o=>h('li',h('span',...appName(m,o.clientId),' · ',literal(kindTitleOf(m,o.kind,locale)),' · ',o.principal?literal(`${hostOf(o.principal.iss)} · ${String(o.principal.sub).slice(0,8)}`):h('span','Anyone with the offer'),' ',
    h('span',interfaceText('{spent} of {uses} uses spent',{spent:o.spent,uses:o.uses}),' · ',interfaceText('Expires {date}',{date:date(o.expiresAt)})).classes('field-help')),
    btn('Revoke',{kind:'open-modal',modal:{kind:'signaling-confirm',action:'revoke-offers',input:{id:o.id}}},'text-button danger')).classes('signaling-row').key('o:'+o.id)),'No live offers.'),
   offers.length?btn('Revoke every offer',{kind:'open-modal',modal:{kind:'signaling-confirm',action:'revoke-offers',input:{all:true}}},'button secondary'):null)
 );
}

/** The `signaling` console view: the owner pages. Nothing while the account's session features lack signaling. */
export function signalingPagesView(state){
 const p=pageModel(state),m=signalingModel(state),{btn}=helpers(state);
 const head=pageHeader('Direct connections','Approve connection types, pair apps, and review the offers your apps handed out.',h('div',nav(state,'Overview','overview',{},'button secondary'),' ',nav(state,'Pair apps','pair',{},'button primary')).classes('buttons'));
 if(!p)return h('div',head,h('p','This page is not available right now.').classes('field-help')).classes('signaling-pages');
 const body=p.status==='error'&&!p.review&&!p.detail&&!p.service?h('section',h('p','This page could not be loaded.'),btn('Try again',{kind:'signaling-page',page:p.page,params:p.params},'button secondary')).classes('panel'):
  p.page==='approve'?approvePage(state,p,m):p.page==='auto-connect'?autoConnectPage(state,p,m):p.page==='pair'?pairPage(state,p,m):p.page==='pairing'?pairingPage(state,p,m):p.page==='service'?servicePage(state,p):p.status==='loading'&&m?.status!=='loaded'?h('p','Loading…').attrs({role:'status'}):overview(state,m);
 return h('div',head,h('h2',p.page==='approve'?'Approve a connection type':p.page==='auto-connect'?'Connect your devices automatically':p.page==='pair'?'Pair apps':p.page==='pairing'?'Pairing':p.page==='service'?'Service organization':'Overview').props({id:'signaling-page-title',tabIndex:-1}).classes('visually-hidden'),body).classes('signaling-pages').attrs({'aria-busy':p.status==='loading'?'true':'false'});
}

/** The service designation removal dialog (modal kind `signaling-page-confirm`), for release-dialogs.mjs. */
export function signalingPageDialog(state){
 const modal=state.modal;if(modal?.kind!=='signaling-page-confirm'||modal.action!=='service-remove')return null;
 const p=pageModel(state),{btn}=helpers(state),count=p?.service?.longOffers??0;
 return {title:'Remove the service designation?',body:h('div',h('p','The organization’s apps return to the short limits of a person’s apps.'),h('p',count?interfaceText('{count} offers that last longer than 15 minutes are revoked now.',{count}):'No live offer lasts longer than 15 minutes, so none is revoked.'),
  h('div',btn('Remove designation',{kind:'signaling-remove-designation'},'button danger-button'),btn('Cancel',{kind:'close-modal'},'button secondary')).classes('buttons')).classes('signaling-confirm')};
}
