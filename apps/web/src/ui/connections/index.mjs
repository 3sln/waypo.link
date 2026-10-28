// EXT-X11 unified Apps & integrations console (docs/architecture/extensibility-design.md X11). Render-only: every rule
// (flags, fencing, review, selection policy, step-up, discovery) lives in bl/connections.mjs. Untrusted names, labels
// and hosts are isolated text nodes. "Who has access" views are CX-3's (ui/access); this console only links to them.
import {AppRemovalIntent} from '../../bl/app-removal.mjs';
import {removalPanels} from './removal.mjs';
import {h,fire} from '../release-primitives.mjs';
import {ConnectionsIntent,connectionsEnabled,connectionsModel,connectionOfferings} from '../../bl/connections.mjs';
import {connectionManifest,connectionHost,connectionLink} from '../../bl/connections-port.mjs';
import {accessLink} from '../../bl/access.mjs';
import {connectionsCopy} from './copy.mjs';
import {connectionsCSS} from './style.mjs';
const plain=text=>h('bdi',String(text??'')).attrs({dir:'auto',translate:'no'});
const SERVING=['active','degraded'];
// Shell intent adapter: deserialize only native form controls. No authorization or selection rules live here.
export function connectionsAction(detail){const values={fields:{}};if(detail.form)for(const control of detail.form.elements){if(!control.name||control.disabled)continue;const value=control.type==='checkbox'?control.checked:control.value;if(control.name.startsWith('fields.'))values.fields[control.name.slice(7)]=value;else values[control.name]=value;}const {kind,form,...rest}=detail;return new (detail.action?.startsWith('removal-')?AppRemovalIntent:ConnectionsIntent)({...rest,values:detail.values??values});}
// CX-3 deep links (`/#access/<kind>/<id>`): the app view is keyed by client ID, the settings view by fragment.
export const connectionsAccessHref=m=>({connection,fragment})=>{if(fragment)return accessLink('fragment',fragment);const c=m?.connections.find(c=>c.id===connection);return c?.clientId?accessLink('app',c.clientId):null;};
export default function connections(state,{accessHref}={}){
 if(!connectionsEnabled(state)||!state.session?.account||state.offline)return null;
 const t=connectionsCopy(state.locale),m=connectionsModel(state),busy=state.busy||Boolean(m?.stale),href=accessHref??connectionsAccessHref(m),issuer=state.config.origin;
 const link=(label,url,extra={})=>url?h('a',label).props({href:url}).attrs({rel:'noopener noreferrer',...extra}):null;
 const btn=(label,action,detail={},disabled=false,extra={})=>h('button',label).props({type:'button',disabled:state.busy||disabled}).data({action}).attrs(extra).on({click:e=>fire(e.currentTarget,'connections',{action,...detail})});
 const form=(children,action,label,detail={},disabled=false)=>h('form',...children,h('button',label).props({type:'submit',disabled:state.busy||disabled}).classes('connections-primary').data({action})).on({submit:e=>{e.preventDefault();if(!state.busy&&!disabled&&!e.currentTarget.checkValidity())e.currentTarget.reportValidity();else if(!state.busy&&!disabled)fire(e.currentTarget,'connections',{action,...detail,form:e.currentTarget});}});
 const input=(name,label,value='',type='text',extra={})=>{const {minLength,maxLength,...props}=extra;return h('label',h('span',label),h('input').props({name,type,value,...props}).attrs({...minLength!==undefined?{minlength:String(minLength)}:{},...maxLength!==undefined?{maxlength:String(maxLength)}:{}}).key(name+':'+type));};
 const confirm=()=>h('label',h('input').props({type:'checkbox',name:'confirm',required:true}).key('confirm'),h('span',t.confirm)).classes('connections-check');
 const select=(name,label,rows)=>h('label',h('span',label),h('select',h('option','—').props({value:''}),...rows.map(([value,text])=>h('option',String(text??'')).attrs({translate:'no'}).props({value}))).props({name,required:true}));
 const panel=(id,title,...children)=>h('section',h('h2',title).props({id,tabIndex:-1}),...children).classes('connections-panel').attrs({'aria-labelledby':id});
 const manage=(c,label,contracts)=>c?link(label,connectionLink(connectionManifest(c).management_url,c.clientId,issuer,{contracts}),{'aria-describedby':'connections-external-site'}):null;
 const stateOf=c=>c.state??(c.status==='disconnected'?'disconnected':'active'),badge=c=>h('span',t[stateOf(c)]??t.unavailable).classes('connections-state').data({state:stateOf(c)});

 const review=m?.confirm,definition=m?.offerings.find(x=>x.id===review?.id);
 const confirmation=review?panel('connections-review',review.kind==='replace'?t.replacementTitle:review.kind==='disconnect'?t.disconnectTitle:review.kind==='feature'?t.featureTitle:t.connect,
  h('p',plain(review.kind==='connect'?definition?.name:review.kind==='replace'?review.old:review.kind==='feature'?review.title:review.name)),review.new?h('p','→ ',plain(review.new)):null,
  review.kind==='feature'?h('p',plain(review.description),' · ',plain(review.host)):null,
  review.kind==='feature'?h('ul',...Object.entries(review.methods??{}).map(([contract,methods])=>h('li',plain(methods.join(', ')),' · ',plain(contract))),...(review.field??[]).map(name=>h('li',t.featureResource,': ',plain(name)))):null,
  h('p',review.kind==='disconnect'?t.cascade:review.kind==='replace'?t.replacement:review.kind==='feature'?t.featureConsent:t.configureConsent),
  review.fields?.length?h('ul',...review.fields.map(title=>h('li',plain(title)))):null,
  review.consumers?.length?h('ul',...review.consumers.map(title=>h('li',plain(title)))):null,
  review.kind==='connect'?h('ul',...(definition?.manifest?.setup?.fragments??[]).map(f=>h('li',plain(f.purpose),))):null,
  review.kind==='manifest'?h('pre',plain(JSON.stringify(review.manifest,null,2))).styles({whiteSpace:'pre-wrap',overflowWrap:'anywhere'}):null,
  form([confirm()],review.kind==='manifest'?'confirm-manifest':review.kind==='disconnect'?'confirm-disconnect':review.kind==='replace'?'confirm-replace':review.kind==='feature'?'confirm-feature':'confirm-built-in',review.kind==='disconnect'?t.disconnect:review.kind==='replace'?t.replace:review.kind==='feature'?t.featureEnable:t.connect,{id:review.id}),
  btn(t.cancel,'close')).classes('connections-review'):null;

 const owner=m?.connections.find(c=>c.id===m.setup?.connection);
 const setup=m?.setup?panel('connections-setup',t.setup,owner?h('p',plain(owner.name)):null,h('p',t.setupIntro),...m.setup.fragments.map(f=>{
  const fields=Object.entries(f.schema.fields).filter(([name])=>!f.request?.fields||f.request.fields.includes(name)),unsupported=fields.some(([,v])=>(v.cardinality?.max??1)>1&&v.type!=='resource');
  return h('article',h('h3',plain(f.schema.title)),h('p',plain(new URL(f.schema.id).host)),f.request?.purpose?h('p',t.purpose+': ',plain(f.request.purpose)):null,link(t.shared,href({fragment:f.schema.id})),form(fields.map(([name,field])=>{
   const value=f.values?.[name]??'',key=f.schema.id+'#'+name,required=(field.cardinality?.min??1)>0;
   if(field.type==='resource')return h('div',h('p',plain(field.title)),m.setup.resources?.[key]?h('p',t.resourceSelected).classes('connections-note'):null,btn(t.picker,'picker',{fragment:f.schema.id,field:name},busy)).classes('connections-field');
   if((field.cardinality?.max??1)>1)return h('p',t.unsupported);
   if(field.type==='boolean')return h('label',h('input').props({type:'checkbox',name:'fields.'+name,checked:value===true}).key(name),h('span',plain(field.title))).classes('connections-check');
   if(field.type==='enum')return h('label',h('span',plain(field.title)),h('select',...field.values.map(v=>h('option',String(v)).attrs({translate:'no'}).props({value:v,selected:f.values?.[name]===v}))).props({name:'fields.'+name,required}));
   return input('fields.'+name,plain(field.title),value,['integer','number'].includes(field.type)?'number':field.type==='url'?'url':'text',{required,minLength:field.minLength,maxLength:field.maxLength,min:field.minimum,max:field.maximum,step:field.type==='integer'?1:'any'});
  }).concat([confirm()]),'save-setup',t.save,{fragment:f.schema.id},busy||unsupported)).key(f.schema.id);
 }),manage(owner,t.manage),btn(t.cancel,'close')):null;

 const source=m?.picker&&m.connections.find(c=>c.id===m.picker.connection);
 const picker=m?.picker?panel('connections-picker',t.picker,h('p',t.unverified).classes('connections-note'),
  h('div',h('p',t.candidates),...m.picker.candidates.map(c=>btn(plain(c.name??c.origin),'discover',{connection:c.connection},busy,{'aria-pressed':String(c.connection===m.picker.connection)})),m.picker.candidates.length?null:h('p',t.noResources)).attrs({role:'group'}),
  m.picker.connection?form([input('text',t.search,m.picker.text??'','search',{maxLength:200})],'discover',t.search,{},busy):null,
  m.picker.connection?btn(t.root,'discover',{root:true},busy):null,
  m.picker.connection?h('ul',...m.picker.items.map(item=>h('li',h('p',plain(item.label)),h('small',plain(item.id)),h('div',item.container?btn(t.browse,'discover',{parent:item.id},busy):null,item.assignable?btn(t.pick,'pick',{resource:item.id},busy):null)).key(item.id))).classes('connections-items'):null,
  m.picker.connection&&!m.picker.items.length?h('p',t.noResources):null,m.picker.cursor?btn(t.next,'discover',{next:true},busy):null,
  manage(source,t.create,m.picker.contracts),btn(t.cancel,'close')):null;

 const external=m?.external?panel('connections-external',plain(m.external.host),h('p',t.login),link(t.leave,m.external.url,{'aria-describedby':'connections-external-site'}),btn(t.cancel,'close')):null;

 const connect=h('section',h('h2',t.available),h('ul',...connectionOfferings(state).map(d=>h('li',h('h3',plain(d.name)),h('p',t.builtin),...(d.manifest?.setup?.fragments??[]).map(f=>h('p',plain(f.purpose))),btn(d.connected?(state.locale==='es'?'Conectado':'Connected'):t.connect,'connect-built-in',{id:d.id},busy||d.connected,{'aria-label':(d.connected?(state.locale==='es'?'Conectado':'Connected'):t.connect)+': '+d.name})).key(d.id))).classes('connections-grid'),
  h('h2',t.externalTitle),h('p',t.externalHint),form([input('clientId',t.client,'','url',{required:true,maxLength:2048,pattern:'https://.*'})],'connect-external',t.continue,{},busy));

 const list=h('section',h('h2',t.connected),m&&!m.connections.length?h('p',t.empty):null,h('ul',...(m?.connections??[]).map(c=>{const host=connectionHost(c),s=stateOf(c);return h('li',h('article',
  h('h3',plain(c.name??host)),h('dl',h('div',h('dt',t.state),h('dd',badge(c))),h('div',h('dt',t.kind),h('dd',c.integration?.kind==='built-in'?t.builtin:t.external)),h('div',h('dt',host?t.host:t.unknown),h('dd',plain(host)))),
  h('div',link(t.access,href({connection:c.id})),s!=='disconnected'?manage(c,t.manage):null).classes('connections-links'),
  h('div',c.integration?.staged?btn(state.locale==='es'?'Revisar cambios':'Review changes','review-manifest',{id:c.id},busy):null,s!=='disconnected'&&c.integration?btn(t.setup,'setup',{id:c.id},busy):null,s==='suspended'?btn(t.resume,'resume',{id:c.id},busy):[...SERVING,'configuring'].includes(s)&&c.integration?btn(t.suspend,'suspend',{id:c.id},busy):null,s!=='disconnected'?btn(state.locale==='es'?'Quitar app…':'Remove app…','removal-review',{id:c.id},busy):null,s!=='disconnected'?btn(t.disconnect,'disconnect',{id:c.id},busy).classes('connections-danger'):null).classes('connections-actions'),s!=='disconnected'?h('p',state.locale==='es'?'Desconectar detiene el acceso. Quitar app también permite revisar y gestionar sus datos.':'Disconnect stops access. Remove app also lets you review and manage its data.').classes('connections-note'):null
 ).data({connection:c.id})).key(c.id);})).classes('connections-grid'));

 // Extensions rev 3.2 (behind EXTENSIONS_ENABLED, minimal): provider-consumable fields with their values in owner order,
 // the consumers each value is approved for, provider-listed candidates (neutral order, none preselected, supplier
 // claims marked), provider features (descriptor text with its host) and owner-only notices.
 const fieldsView=h('section',h('h2',t.fields).props({id:'connections-fields',tabIndex:-1}),h('p',t.fieldsIntro),h('ul',...(m?.fields??[]).map(field=>{
  const shown=m.candidates?.fragment===field.fragment?m.candidates.list:null,full=field.selection==='ordered'&&field.values.length>=field.max;
  return h('li',h('article',h('h3',plain(field.title)),h('p',plain(field.host)),h('p',t[field.selection]??t.noPolicy).classes('connections-note'),
   field.consumers.length?h('p',t.consumers,': ',...field.consumers.map((f,i)=>h('span',i?', ':'',plain(f.title),' · ',plain(f.host),f.state==='suspended'?' ('+t.suspendedFeature+')':''))):h('p',t.noConsumers).classes('connections-note'),
   field.values.length?h('ol',...field.values.map((o,i)=>h('li',plain(o.name??o.clientId),o.builtIn?' · '+t.builtinMarker:'',' · ',o.available?t.active:t.offline,h('div',btn(t.remove,'field-remove',{fragment:field.fragment,seat:o.seat},busy,{'aria-label':t.remove+': '+(o.name??o.clientId??'')}),field.selection==='ordered'?btn(t.up,'field-up',{fragment:field.fragment,seat:o.seat},busy||i===0,{'aria-label':t.up+': '+(o.name??o.clientId??'')}):null).classes('connections-actions')).key(o.seat))):h('p',t.noValues),
   shown?(shown.length?form([select('candidate',t.candidate,shown.map(c=>[c.id,`${c.builtIn?t.builtinMarker+' · ':''}${c.label??''} · ${c.origin}${c.claimed?' · '+t.claimed:''}`])),...field.consumers.filter(f=>f.state==='active').map(f=>h('label',h('input').props({type:'checkbox',name:'approve.'+f.feature,checked:false}).key('approve.'+f.feature),h('span',t.approveFor,' ',plain(f.title),' · ',plain(f.host))).classes('connections-check'))],'field-assign',(field.selection==='exclusive'||field.max===1)&&field.values.length?t.replace:t.assign,{fragment:field.fragment},busy||full):h('p',t.noEligible)):btn(t.candidates,'field-candidates',{fragment:field.fragment},busy)
  ).data({fragment:field.fragment})).key(field.fragment);})).classes('connections-grid'));
 const featuresView=m?.features?.length?h('section',h('h2',t.features),h('ul',...m.features.map(f=>h('li',h('article',h('h3',plain(f.title)),h('p',plain(f.description)),h('p',plain(f.host)),h('p',t['feature_'+f.state]??f.state).classes('connections-note'),
  f.state==='active'||f.state==='suspended'?btn(t.featureDisable,'feature-disable',{feature:f.feature},busy):btn(t.featureEnable,'feature-enable',{feature:f.feature},busy||!f.declared)
 )).key(f.feature))).classes('connections-grid')):null;
 const noticesView=m?.notices?.length?h('section',h('h2',t.notices),h('ul',...m.notices.map(n=>h('li',h('p',n.kind==='announcement'?[t.announcement,' ',plain(n.supplier?.origin),' · ',...(n.consumers??[]).map((c,i)=>h('span',i?', ':'',plain(c.title),' · ',plain(c.host))),' (',t.claimed,')']:t['notice_'+n.kind]??n.kind),n.kind==='announcement'?btn(t.candidates,'field-candidates',{fragment:n.fragment},busy):null,btn(t.dismiss,'notice-dismiss',{notice:n.id},busy)).key(n.id)))):null;

 return h('section',h('style',connectionsCSS),h('header',h('h1',t.title).props({id:'connections-title',tabIndex:-1}),h('p',t.intro),btn(t.reload,'reload')),
  h('p',t.external_site).props({id:'connections-external-site',hidden:true}),
  m?.error?h('p',t[m.error]??t.error).attrs({role:'alert'}):null,m?.notice&&!m.error?h('p',t[m.notice]??t.saved).attrs({role:'status'}):null,!m?h('p',t.loading):null,
  removalPanels(state,{btn,form,confirm,panel,plain}),confirmation,setup,picker,external,m?list:null,noticesView,m?.fields?.length?fieldsView:null,featuresView,m?connect:null)
 .classes('connections-console').attrs({lang:state.locale==='es'?'es':'en','aria-labelledby':'connections-title','aria-busy':state.busy?'true':'false'});
}
