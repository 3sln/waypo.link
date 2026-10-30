import {Query} from '../shared/stack.mjs';
import {OwnerFlow,snapshot,publish} from './owner-flow.mjs';
import {connectionLink} from './connections-port.mjs';
export const connectionsEnabled=s=>s.config?.integrationsEnabled===true;
export const connectionsModel=s=>connectionsEnabled(s)&&!s.offline&&s.session?.account?.id&&s.connectionsConsole?.owner===s.session.account.id&&s.connectionsConsole?.session===s.session.sessionContext&&s.connectionsConsole?.generation===(s.beamGeneration??0)?s.connectionsConsole:null;
// Display availability follows configured upstream capability and the current connection state.
export const connectionOfferings=s=>{const m=connectionsModel(s);return (m?.offerings??[]).filter(d=>d.id!=='google-drive'||s.config?.providers?.google?.enabled===true||s.data?.providerCapabilities?.['google-drive']?.enabled===true).map(d=>({...d,connected:(m.connections??[]).some(c=>c.integration?.builtin===d.id&&c.state!=='disconnected')}));};
const base=s=>connectionsModel(s)??{owner:s.session.account.id,session:s.session.sessionContext,generation:s.beamGeneration??0,connections:[],fields:[],features:[],notices:[],offerings:[]};
const put=(r,ctx,p)=>publish(r,ctx,{connectionsConsole:{...base(snapshot(r)),...p}});
// Optional host focus port: moves focus to a rendered panel heading (or back to the console title) after a change.
const focus=(r,id)=>{try{r.browser?.focusConnections?.(id);}catch{}};
const fail=code=>{throw Object.assign(Error(code),{code});};
export class ConnectionsView extends Query {
 static deps=['state'];
 boot({state},{notify,engineFeed}){this.feed=engineFeed;this.paint=()=>notify(connectionsModel(state.snapshot()));engineFeed.addEventListener('browser-state-updated',this.paint);this.paint();}
 kill(){this.feed.removeEventListener('browser-state-updated',this.paint);}
}
// All intent logic runs in the engine. The UI only serializes fields and dispatches this Action.
export class ConnectionsIntent extends OwnerFlow {
 static deps={state:{write:true},api:{},browser:{},connectionsConsole:{}};
 async execute(r,ctx){if(!connectionsEnabled(snapshot(r)))return;return super.execute(r,ctx);}
 async perform(resources,ctx,d){
  const initial=snapshot(resources),session=initial.session.sessionContext,r={...resources,current:()=>resources.current()&&snapshot(resources).session?.sessionContext===session&&connectionsEnabled(snapshot(resources))},port=r.connectionsConsole;
  const options={api:r.api,owner:initial.session.account.id},checked=async fn=>{if(!r.current())fail('connection_changed');const result=await fn();if(!r.current())fail('connection_changed');return result;},call=(operation,input)=>checked(()=>port.owner({operation,...input===undefined?{}:{input}},options)),m=base(initial),v=d.values??{},a=d.action;
  // Extensions rev 3.2: provider-consumable fields, provider features and owner-only notices ride the same reload.
  const reload=async()=>{const result=await call('connections.list');put(r,ctx,{connections:result.connections,fields:result.fields??[],features:result.features??[],notices:result.notices??[],offerings:result.offerings??port.offerings,stale:false,confirm:null,picker:null,setup:null,candidates:null,error:null});};
  const change=async(operation,input)=>{put(r,ctx,{stale:true,confirm:null});await call(operation,input);put(r,ctx,{notice:'saved'});try{await reload();}catch{put(r,ctx,{error:'saved_stale'});}if(m.confirm)focus(r,'connections-title');};
  try{
   // The removal summary belongs to this console (clean removal availability, pending and recent removals), so every
   // reload carries it, however the console was opened (navigation, deep link or Refresh). An absent route is no error.
   if(a==='reload'){await reload();try{const removal=await checked(()=>r.api.get('/api/apps/removal'));put(r,ctx,{removals:removal.removals??[],cleanRemovalEnabled:removal.clean_enabled===true,cleanRemovalConnections:removal.clean_connections,removalError:null});}catch(error){if(error?.code==='connection_changed')throw error;if(error?.status!==404&&error?.code!=='not_found')put(r,ctx,{removalError:initial.locale==='es'?'No se pudo cargar el estado de las eliminaciones. Actualiza para intentarlo de nuevo.':'Removal status could not be loaded. Refresh to try again.'});}return;}
   if(a==='close'){const back=m.picker&&m.setup?'connections-setup':'connections-title';put(r,ctx,{confirm:null,external:null,...m.picker&&m.setup?{}:{setup:null},picker:null,error:null});focus(r,back);return;}
   if(m.stale)fail('reload_required');
   if(a==='connect-built-in'){const def=m.offerings.find(x=>x.id===d.id);if(!def)fail('connection_changed');put(r,ctx,{confirm:{kind:'connect',id:def.id}});focus(r,'connections-review');return;}
   if(a==='confirm-built-in'){const def=m.offerings.find(x=>x.id===m.confirm?.id);if(m.confirm?.kind!=='connect'||!def||v.confirm!==true)fail('review_required');await change('connections.connect-built-in',{integration:def.id});return;}
   if(a==='connect-external'){
    // Metadata resolution is a trusted SSRF-safe port. Navigation starts OAuth; it never creates a connection locally.
    const client=await checked(()=>port.external({clientId:String(v.clientId??'')},options)),url=connectionLink(client.initiate_login_uri,client.clientId,initial.config.origin);
    if(!url)fail('invalid_client');put(r,ctx,{external:{url,host:new URL(url).host}});focus(r,'connections-external');return;
   }
   if(a==='setup'){const c=m.connections.find(c=>c.id===d.id);if(!c||c.state==='disconnected')fail('connection_changed');const setup=await checked(()=>port.setup({connection:c.id,generation:c.generation},options));put(r,ctx,{setup:{...setup,connection:c.id,generation:c.generation},picker:null,confirm:null});focus(r,'connections-setup');return;}
   if(a==='save-setup'){
    const setup=m.setup,c=m.connections.find(c=>c.id===setup?.connection),fragment=setup?.fragments.find(f=>f.schema.id===d.fragment);if(!c||c.generation!==setup.generation||!fragment||v.confirm!==true)fail('review_required');
    // Conversion/validation belongs to the setup provider, including resource references and shared-value review.
    // Never accept a schema, digest, revision, consumer, or connection from submitted form data.
    put(r,ctx,{stale:true});await checked(()=>port.saveSetup({connection:c.id,generation:c.generation,fragment:fragment.schema.id,digest:fragment.digest,expectedRevision:fragment.revision,values:v.fields??{},resources:setup.resources??{}},options));put(r,ctx,{setup:null,notice:'saved'});try{await reload();}catch{put(r,ctx,{error:'saved_stale'});}focus(r,'connections-title');return;
   }
   if(a==='picker'){
    const setup=m.setup,fragment=setup?.fragments.find(f=>f.schema.id===d.fragment),field=fragment?.schema.fields[d.field];if(field?.type!=='resource'||!(field.contracts?.length))fail('invalid_field');
    const result=await r.api.request('/api/integrations/candidates',{contracts:field.contracts});put(r,ctx,{picker:{fragment:d.fragment,field:d.field,contracts:field.contracts,candidates:result.candidates,items:[],parents:[]}});focus(r,'connections-picker');return;
   }
   if(a==='discover'){
    const p=m.picker,c=p?.candidates.find(c=>c.connection===(d.connection??p.connection));if(!c)fail('connection_changed');
    if(d.next&&!p.cursor)fail('resource_changed');if(d.parent&&!p.items.some(i=>i.id===d.parent&&i.container))fail('resource_changed');
    const parent=d.root?undefined:d.parent??p.parent,text=d.next?p.text:String(v.text??'').slice(0,200),cursor=d.next?p.cursor:undefined;
    const result=await r.api.request('/api/integrations/discover',{connection:c.connection,contracts:p.contracts,text,limit:20,...parent?{parent}:{},...cursor?{cursor}:{}});
    put(r,ctx,{picker:{...p,connection:c.connection,text,parent,cursor:result.cursor??null,items:result.items.slice(0,100)}});return;
   }
   if(a==='pick'){
    const p=m.picker,item=p?.items.find(i=>i.id===d.resource),setup=m.setup,c=m.connections.find(c=>c.id===setup?.connection);if(!item?.assignable||!c)fail('resource_changed');
    // X7 re-reads the item under authenticated discovery. Labels and endpoint claims never cross this write boundary.
    const record=await r.api.request('/api/integrations/records',{connection:p.connection,resource:item.id,binding:{fragment:p.fragment,field:p.field},consumer:{clientId:c.clientId},contracts:p.contracts});
    const key=p.fragment+'#'+p.field;put(r,ctx,{setup:{...setup,resources:{...setup.resources,[key]:record}},picker:null,notice:'picked'});focus(r,'connections-setup');return;
   }
   // Extensions §5.1: candidates come only from the provider (recorded contracts), in neutral order, none preselected.
   if(a==='field-candidates'){const field=m.fields.find(f=>f.fragment===d.fragment);if(!field)fail('field_changed');const result=await call('connections.candidates',{fragment:field.fragment});put(r,ctx,{candidates:{fragment:field.fragment,list:result.candidates}});focus(r,'connections-fields');return;}
   if(a==='field-assign'){
    const field=m.fields.find(f=>f.fragment===d.fragment),pick=m.candidates?.fragment===field?.fragment?m.candidates.list.find(x=>x.id===v.candidate):null;
    if(!field||!pick)fail('field_changed');
    // §3.4: each consumer of the field is approved separately, unchecked by default; nothing is preselected.
    const approve=field.consumers.filter(f=>f.state==='active'&&v['approve.'+f.feature]===true).map(f=>f.feature);
    const input={fragment:field.fragment,connection:pick.connection,expectedRevision:field.revision,...pick.record?{resource:pick.record}:{},...approve.length?{approve}:{}};
    if((field.selection==='exclusive'||field.max===1)&&field.values.length){put(r,ctx,{confirm:{kind:'replace',input:{...input,replace:true},old:field.values[0].name,new:pick.label??pick.origin,consumers:field.consumers.map(f=>f.title)}});focus(r,'connections-review');return;}
    await change('connections.assign',input);return;
   }
   if(a==='confirm-replace'){if(m.confirm?.kind!=='replace'||v.confirm!==true)fail('review_required');await change('connections.assign',m.confirm.input);return;}
   if(a==='field-remove'||a==='field-up'){
    const field=m.fields.find(f=>f.fragment===d.fragment),at=field?.values.findIndex(o=>o.seat===d.seat);if(!field||at<0)fail('field_changed');
    if(a==='field-remove'){await change('connections.unassign',{fragment:field.fragment,seat:d.seat,expectedRevision:field.revision});return;}
    if(field.selection!=='ordered'||at===0)fail('invalid_order');const seats=field.values.map(o=>o.seat);[seats[at-1],seats[at]]=[seats[at],seats[at-1]];await change('connections.reorder',{fragment:field.fragment,seats,expectedRevision:field.revision});return;
   }
   // Extensions §4.2: enabling a provider feature is the owner's consent, shown with its descriptor text and host.
   if(a==='feature-enable'){const f=m.features.find(x=>x.feature===d.feature);if(!f||!f.declared||f.state==='active')fail('feature_changed');put(r,ctx,{confirm:{kind:'feature',feature:f.feature,title:f.title,description:f.description,host:f.host,methods:f.methods,field:m.fields.find(x=>x.fragment===f.fragment)?.values.map(x=>x.name)??[]}});focus(r,'connections-review');return;}
   if(a==='confirm-feature'){if(m.confirm?.kind!=='feature'||v.confirm!==true)fail('review_required');await change('connections.enable-feature',{feature:m.confirm.feature});return;}
   if(a==='feature-disable'){const f=m.features.find(x=>x.feature===d.feature);if(!f)fail('feature_changed');await change('connections.disable-feature',{feature:f.feature});return;}
   if(a==='notice-dismiss'){await change('connections.dismiss-notice',{id:String(d.notice??'')});return;}
   const c=m.connections.find(c=>c.id===d.id);if(!c)fail('connection_changed');
   if(a==='review-manifest'){if(!c.integration?.staged)fail('connection_changed');put(r,ctx,{confirm:{kind:'manifest',id:c.id,generation:c.generation,stagedRevision:c.integration.stagedRevision,name:c.name,manifest:c.integration.staged}});focus(r,'connections-review');return;}
   if(a==='confirm-manifest'){if(m.confirm?.kind!=='manifest'||m.confirm.id!==c.id||m.confirm.generation!==c.generation||m.confirm.stagedRevision!==c.integration?.stagedRevision||v.confirm!==true)fail('review_required');await change('connections.approve',{connection:c.id,expectedGeneration:c.generation,stagedRevision:m.confirm.stagedRevision});return;}
   if(a==='disconnect'){put(r,ctx,{confirm:{kind:'disconnect',id:c.id,generation:c.generation,name:c.name,fields:m.fields.filter(f=>f.values.some(o=>o.connection===c.id)).map(f=>f.title)}});focus(r,'connections-review');return;}
   if(a==='confirm-disconnect'){if(m.confirm?.kind!=='disconnect'||m.confirm.id!==c.id||m.confirm.generation!==c.generation||v.confirm!==true)fail('review_required');await change('connections.disconnect',{connection:c.id,expectedGeneration:c.generation});return;}
   if(a==='suspend'||a==='resume'){await change('connections.'+a,{connection:c.id,expectedGeneration:c.generation});return;}
   fail('invalid_request');
  }catch(error){put(r,ctx,{error:error.code??'unavailable'});}
 }
}
