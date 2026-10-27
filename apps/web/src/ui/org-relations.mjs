// ORG-10g Relationships tab (docs/architecture/organizations-design.md §8b.10 "Console surfaces"). Render-only: every
// intent goes through OrganizationsIntent (`rel-*` actions, apps/web/src/bl/org-relations.mjs). Admins see relations,
// counterparts, holds and imports; any other member sees only the imported resources they hold grants on (RL-13).
// Server strings are untrusted text (plain()/bdi); codes are mapped to words, never shown. `ctx`: {s, t, h, form,
// input, check, panel, plain, when, btn} from the console.
import {fire} from './release-primitives.mjs';
import {organizationAdmin} from '../bl/organizations.mjs';
import {RELATION_STEPS,INVITATION_DAYS,fits,principalKey,identityURI,rebindGives} from '../bl/org-relations.mjs';
import {orgRelationError,orgRelationNotice} from './org-messages.mjs';

const STORAGE='https://3sln.me/artefacts/contracts/object-storage/v1';
const METHODS={capabilities:['see what the storage supports','ver qué admite el almacenamiento'],get:['read files','leer archivos'],put:['add or replace files','añadir o reemplazar archivos'],delete:['delete files','eliminar archivos'],list:['list files','listar archivos']};
const FIELDS={files:['Files','Archivos']};
const CONTRACTS={[STORAGE]:['File storage','Almacenamiento de archivos']};
const STEP_LABELS={relation:['Relation','Relación'],slot:['Your role','Tu papel'],counterparty:['Organization','Organización'],values:['What you give','Lo que das'],review:['Review','Revisión']};
const HALF={pending:['being set up','en preparación'],live:['active','activo'],suspended:['paused','en pausa'],ended:['ended','terminado']};
const INSTANCE={pending:['Waiting for the other organization','Esperando a la otra organización'],live:['Active','Activa'],left:['You left','Saliste']};
const HOLD_CAUSE={'aep-increase':['The other organization’s authority was reset, for example after a recovery or an ownership claim took effect.','La autoridad de la otra organización se restableció, por ejemplo tras una recuperación o una reclamación de propiedad.'],
 'key-reset':['The other organization’s identity key was reset without a verifiable handover.','La clave de identidad de la otra organización se restableció sin un traspaso verificable.'],
 contested:['The other organization’s identity is contested.','La identidad de la otra organización está en disputa.'],
 move:['The other organization moved to another provider without an attested handover.','La otra organización se trasladó a otro proveedor sin un traspaso certificado.'],
 'attested-move':['The other organization moved to another provider with an attested handover.','La otra organización se trasladó a otro proveedor con un traspaso certificado.']};
const WARNINGS={'new-counterparty':['You have never dealt with this organization before. Check its identity link and origin carefully: a lookalike handle can imitate a real organization.','Nunca has tratado con esta organización. Comprueba con cuidado su enlace de identidad y su origen: un identificador parecido puede imitar a una organización real.'],
 'new-relation':['Your organization has never used this relation before.','Tu organización nunca ha usado esta relación.'],
 'same-title-different-relation':['This relation has the same or a similar title as one you already use, but it is a different relation. It may be a lookalike.','Esta relación tiene el mismo título, o uno parecido, que otra que ya usas, pero es una relación distinta. Puede ser una imitación.']};
const CAVEATS={'counterparty-sees-actor-chain':['The other organization’s provider sees the chain of who acts for you: your organization, the app, and a code or the identity of the person.','El proveedor de la otra organización ve la cadena de quién actúa por ti: tu organización, la app y un código o la identidad de la persona.'],
 'copies-cannot-be-recalled':['Copies the other organization has already read can’t be recalled, even after the sharing ends.','Las copias que la otra organización ya haya leído no se pueden recuperar, aunque termine el uso compartido.'],
 'proxying-undetectable':['If the other organization relays requests for someone else under its own name, you can’t detect it. That breaks the rules, but nothing technical prevents it.','Si la otra organización transmite solicitudes de otra persona en su propio nombre, no lo puedes detectar. Eso incumple las normas, pero nada técnico lo impide.']};
const ACTOR={pairwise:['They see a separate code for each person who acts, not who they are.','Ven un código distinto para cada persona que actúa, no quién es.'],named:['They see who acts: each person’s verified identity.','Ven quién actúa: la identidad verificada de cada persona.']};
const host=iss=>{try{return new URL(iss).host;}catch{return String(iss??'');}};
const shortId=value=>{const v=String(value??'');return v.length>13?v.slice(0,8)+'…':v;};
export const relStyle=`.org-console .org-rel-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.org-console .org-rel-tabs button[aria-current]{border-color:var(--org-accent);border-width:2px;background:var(--org-soft)}
.org-console .org-rel-resource{border-top:1px solid var(--org-line);padding:4px 0}.org-console .org-rel-resource:first-of-type{border-top:0}.org-console .org-rel-warn{border:1px solid var(--org-line);border-left:5px solid var(--org-warn);border-radius:8px;padding:12px;margin:12px 0}.org-console .org-rel-warn h4{margin:0 0 4px}
.org-console .org-rel-list{list-style:none;padding:0;margin:8px 0;display:grid;gap:12px}.org-console .org-rel-list>li{border:1px solid var(--org-line);border-radius:8px;padding:12px}.org-console .org-rel-code{font-family:ui-monospace,monospace}`;

function helpers(ctx){
 const {s,t,h,plain,when,btn}=ctx,tt=pair=>t(pair[0],pair[1]),busy=!!s.busy;
 const box=(name,label,{checked=false,required=false}={})=>h('label',h('input').props({type:'checkbox',name,checked,required}),h('span',label)).classes('org-check').key(name);
 const radio=(name,value,label,checked=false)=>h('label',h('input').props({type:'radio',name,value,required:true,checked}),h('span',label)).classes('org-check').key(name+':'+value);
 const method=m=>METHODS[m]?tt(METHODS[m]):plain(m);
 const contract=c=>CONTRACTS[c]?tt(CONTRACTS[c]):plain(c);
 const field=f=>FIELDS[f]?tt(FIELDS[f]):plain(f);
 const join=(items,sep=', ')=>items.flatMap((x,i)=>i?[sep,x]:[x]);
 const contractMethods=methods=>join(Object.entries(methods??{}).map(([c,ms])=>[contract(c),': ',join((Array.isArray(ms)?ms:[]).map(method))]),'; ');
 const entryFields=e=>{const names=Object.keys(e.methods??{});return names.length?join(names.map(field)):t('Nothing to choose','Nada que elegir');};
 const entryMethods=e=>join(Object.entries(e.methods??{}).map(([,contracts])=>contractMethods(contracts)),'; ');
 const required=e=>e.required?h('strong',t('required','obligatorio')):t('optional','opcional');
 const actor=e=>tt(ACTOR[e.actor_disclosure]??ACTOR.pairwise);
 const name=(p,{handle,name:n}={})=>[n?plain(n):null,n&&handle?' ':null,handle?plain('@'+handle):null,!n&&!handle?[plain(host(p?.iss)),' · ',plain(shortId(p?.sub))]:null,' · ',h('span',t('origin ','origen '),plain(host(p?.iss))).classes('org-help')];
 const half=(x,dir)=>{if(!x?.state)return t('nothing','nada');const base=tt(HALF[x.state]);if(x.state==='suspended'&&x.cause==='billing')return [base,t(' (the organization’s payment lapsed)',' (el pago de la organización está vencido)')];if(x.state==='suspended'&&x.cause==='moved')return [base,t(' (choose new resources after the move)',' (elige nuevos recursos tras el traslado)')];return base;};
 const scope=x=>[x.scope?.readOnly?t(' · read only',' · solo lectura'):null,x.scope?.prefix?[t(' · only inside ',' · solo dentro de '),plain(x.scope.prefix)]:null,x.expires_at?[t(' · until ',' · hasta '),when(x.expires_at*1000)]:null];
 return {tt,busy,box,radio,method,contract,field,join,contractMethods,entryFields,entryMethods,required,actor,name,half,scope};
}
const status=(code,ctx,kind)=>code?ctx.h('p',kind==='error'?orgRelationError(ctx.s.locale,code):orgRelationNotice(ctx.s.locale,code)).classes(...kind==='error'?[]:['org-status']).attrs(kind==='error'?{role:'alert'}:{role:'status','aria-live':'polite'}):null;
const canWiden=rel=>!!rel&&rel.enabled&&!rel.closing&&rel.billing==='active';
const cpOf=(rel,instance,key)=>{const i=rel?.instances.find(x=>x.instance===instance);return {i,c:i?.counterparts.find(x=>principalKey(x.principal)===key)};};
const cpName=(rel,p)=>{for(const i of rel?.instances??[])for(const c of i.counterparts)if(principalKey(c.principal)===principalKey(p))return {handle:c.handle,name:c.name};return {};};

/** What a list of matrix entries gives or receives, in plain words; `values` adds the chosen resources. */
function matrixList(list,ctx,{values,pool=[]}={}){
 const {t,h,plain}=ctx,x=helpers(ctx);if(!list.length)return h('p',t('Nothing.','Nada.'));
 return h('ul',...list.map(e=>h('li',h('strong',x.entryFields(e)),' · ',x.required(e),h('br'),x.entryMethods(e),h('br'),h('span',x.actor(e)).classes('org-help'),
  values?h('ul',...(values[e.index]??[]).map(v=>h('li',plain(pool.find(p=>p.id===v.resource)?.label??v.resource),x.scope(v)).key(v.resource)),(values[e.index]??[]).length?null:h('li',t('Not shared','No se comparte'))):null).key(String(e.index))));
}
/** Inline values for the entries this organization gives (resources from its own pool, optional scoping and expiry). */
function valuesFields(gives,pool,ctx){
 const {t,h,plain,input}=ctx,x=helpers(ctx);
 if(!gives.length)return [h('p',t('Your organization gives nothing here.','Tu organización no da nada aquí.')).classes('org-help')];
 return gives.map(e=>{const fields=Object.keys(e.methods??{});
  return h('fieldset',h('legend',t('You give: ','Das: '),x.entryFields(e),' (',x.required(e),')'),h('p',x.entryMethods(e)).classes('org-help'),h('p',x.actor(e)).classes('org-help'),
   fields.length?fields.map((f,fi)=>{const options=pool.map((res,n)=>[res,n]).filter(([res])=>fits(res,e.methods[f]));
    if(!options.length)return h('p',t('This organization has no resource that fits this yet.','Esta organización aún no tiene ningún recurso que encaje.'),e.required?t(' It is required, so add one before continuing.',' Es obligatorio, así que añade uno antes de continuar.'):null).classes('org-note','org-warning').key('none:'+fi);
    return options.map(([res,n])=>{const key=`${e.index}:${fi}:${n}`,sc=res.scoping?.fields??{};return h('div',x.box('res:'+key,[t('Share ','Compartir '),plain(res.label??res.id)]),sc.readOnly?x.box('ro:'+key,t('Read only for them','Solo lectura para ellos')):null,sc.prefix?input('px:'+key,t('Only inside this folder (optional)','Solo dentro de esta carpeta (opcional)'),'',{autoComplete:'off',spellcheck:false,...Number.isSafeInteger(sc.prefix.maxLength)?{maxLength:sc.prefix.maxLength}:{}}):null).classes('org-rel-resource').key(key);});}):
    x.box('inc:'+e.index,t('Include this','Incluir esto'),{checked:e.required,required:e.required}),
   input('exp:'+e.index,t('Access ends (optional)','El acceso termina (opcional)'),'',{type:'date'})).key('give:'+e.index);});
}
const caveatList=(caveats,ctx)=>{const {t,h}=ctx,x=helpers(ctx),all=[...new Set([...caveats,'counterparty-sees-actor-chain','copies-cannot-be-recalled','proxying-undetectable'])].filter(c=>CAVEATS[c]);return h('ul',...all.map(c=>h('li',x.tt(CAVEATS[c])).key(c)));};
const warningBox=(warnings,ctx,extra=[])=>{const {t,h}=ctx,x=helpers(ctx),list=[...warnings.filter(w=>WARNINGS[w]).map(w=>x.tt(WARNINGS[w])),...extra];return list.length?h('div',h('h4',t('Check before you continue','Comprueba antes de continuar')),h('ul',...list.map((w,i)=>h('li',h('strong',w)).key(String(i))))).classes('org-rel-warn'):null;};

function wizardView(m,ctx){
 const {t,h,form,input,check,btn,plain}=ctx,x=helpers(ctx),w=m.relationWizard,index=RELATION_STEPS.indexOf(w.step);
 const nav=h('div',btn(t('Back','Atrás'),'rel-wizard-back',{},false,'rel-wizard-back'),btn(t('Cancel','Cancelar'),'rel-wizard-cancel',{},false,'rel-wizard-cancel')).classes('org-actions');
 const progress=h('ol',...RELATION_STEPS.map((id,i)=>h('li',x.tt(STEP_LABELS[id])).classes(...i<index?['org-step-done']:[]).attrs(i===index?{'aria-current':'step'}:{}).key(id))).classes('org-steps').attrs({'aria-label':t('Progress','Progreso')});
 const heading=text=>h('h3',text).props({id:'org-rel-step',tabIndex:-1});
 const listed=r=>[t('Listed by 3sln.me. Publisher not verified: ','Listada por 3sln.me. Editor no verificado: '),plain(r.publisher??'')];
 const who=c=>h('dl',h('dt',t('Handle','Identificador')),h('dd',c.handle?plain('@'+c.handle):'—'),h('dt',t('Name','Nombre')),h('dd',c.name?plain(c.name):'—'),h('dt',t('Identity link','Enlace de identidad')),h('dd',plain(c.identity)).classes('org-rel-code'),h('dt',t('Origin','Origen')),h('dd',plain(host(c.origin))));
 let body;
 if(w.step==='relation')body=[heading(t('Which relation?','¿Qué relación?')),h('p',t('A relation says what each side may share. You choose what you actually give in a later step.','Una relación indica qué puede compartir cada parte. Lo que realmente das lo eliges en un paso posterior.')).classes('org-help'),
  w.catalogue.length?form([h('fieldset',h('legend',t('Relation','Relación')),...w.catalogue.map(r=>h('label',h('input').props({type:'radio',name:'relation',value:r.key,required:true,checked:w.relation?.key===r.key}),h('span',h('strong',plain(r.title??r.key)),r.description?[h('br'),plain(r.description)]:null,h('br'),h('small',listed(r)).classes('org-help'))).classes('org-check').key(r.key)))],'rel-wizard-relation',t('Continue','Continuar'),{},'rel-wizard-relation'):h('p',t('No relations are listed on this host.','No hay relaciones en la lista de este servidor.')).classes('org-status'),form([input('relationUrl',t('Or enter a relation URL','O escribe la URL de una relación'),'',{type:'url',required:true,maxLength:2048},t('This host currently supports the listed relations only.','Este servidor solo admite por ahora las relaciones de la lista.'))],'rel-wizard-relation',t('Use relation URL','Usar URL de relación'),{},'rel-wizard-url'),nav];
 else if(w.step==='slot')body=[heading(t('What is your organization’s role?','¿Cuál es el papel de tu organización?')),h('p',h('strong',plain(w.relation.title??'')),' · ',listed(w.relation)).classes('org-help'),
  form([h('fieldset',h('legend',t('Your role','Tu papel')),...w.relation.slots.map(sl=>x.radio('slot',sl.name,[plain(sl.title??sl.name)],w.slot===sl.name)))],'rel-wizard-slot',t('Continue','Continuar'),{},'rel-wizard-slot'),h('p',t('The other organization takes the other role.','La otra organización ocupa el otro papel.')).classes('org-help'),nav];
 else if(w.step==='counterparty')body=[heading(t('Which organization?','¿Qué organización?')),
  w.found?[h('p',t('Check that this is the organization you mean. Everything is tied to its identity link, not its name.','Comprueba que es la organización que buscas. Todo queda ligado a su enlace de identidad, no a su nombre.')),who(w.found),warningBox(w.found.seen?[]:['new-counterparty'],ctx),
   h('div',btn(t('Use this organization','Usar esta organización'),'rel-wizard-counterparty',{},false,'rel-wizard-counterparty','org-primary'),btn(t('Look up another','Buscar otra'),'rel-wizard-unfind',{},false,'rel-wizard-unfind')).classes('org-actions')]:
   form([input('handle',t('Organization handle','Identificador de la organización'),'',{required:true,autoComplete:'off',spellcheck:false,maxLength:80},t('For example @acme.','Por ejemplo @acme.'))],'rel-wizard-find',t('Find organization','Buscar organización'),{},'rel-wizard-find'),nav];
 else if(w.step==='values')body=[heading(t('What will you give?','¿Qué vas a dar?')),h('p',t('Choose your organization’s resources for each entry. Imported resources are never offered. You can limit each one and set an end date.','Elige los recursos de tu organización para cada apartado. Los recursos importados nunca se ofrecen. Puedes limitar cada uno y fijar una fecha de fin.')).classes('org-help'),
  form(valuesFields(w.matrix.gives,w.pool??[],ctx),'rel-wizard-values',t('Continue to review','Continuar a la revisión'),{},'rel-wizard-values'),nav];
 else body=[heading(t('Review everything before sending','Revisa todo antes de enviar')),
  warningBox(w.warnings??[],ctx,w.counterparty?.seen?[]:[x.tt(WARNINGS['new-counterparty'])]),
  h('dl',h('dt',t('Relation','Relación')),h('dd',plain(w.relation.title??''),h('br'),h('small',listed(w.relation)).classes('org-help')),h('dt',t('Your role','Tu papel')),h('dd',plain(w.slot)),h('dt',t('Their role','Su papel')),h('dd',plain(w.invite)),
   h('dt',t('Organization','Organización')),h('dd',w.counterparty.name?plain(w.counterparty.name):null,w.counterparty.handle?[' ',plain('@'+w.counterparty.handle)]:null,h('br'),h('span',plain(w.counterparty.identity)).classes('org-rel-code'),h('br'),t('origin ','origen '),plain(host(w.counterparty.origin)))),
  h('h4',t('What you give','Lo que das')),matrixList(w.matrix.gives,ctx,{values:w.values,pool:w.pool??[]}),
  h('h4',t('What you would receive','Lo que recibirías')),matrixList(w.matrix.receives,ctx),
  h('h4',t('Keep in mind','Ten en cuenta')),caveatList([],ctx),
  form([w.matrix.receives.length?x.box('receive',t('Also accept what they give us (it brings their data into this organization)','Aceptar también lo que nos den (trae sus datos a esta organización)')):null,
   h('label',h('span',t('Invitation expires after','La invitación caduca tras')),h('select',...INVITATION_DAYS.map(d=>h('option',t(d+' days',d+' días')).props({value:String(d),selected:d===7}))).props({name:'expiresInDays'})),
   check('confirm',t('I reviewed what we give and receive, and want to send this invitation','Revisé lo que damos y recibimos, y quiero enviar esta invitación')),
   h('p',t('Every admin is told at once. You’ll be asked to confirm it’s you.','Se avisa al momento a todos los administradores. Se te pedirá que confirmes que eres tú.')).classes('org-help')],'rel-wizard-create',t('Create and send invitation','Crear y enviar invitación'),{},'rel-wizard-create'),nav];
 return h('article',progress,...body).key('rel-wizard');
}

function acceptView(m,ctx){
 const {t,h,form,check,btn,plain,when}=ctx,x=helpers(ctx),acc=m.relationAccept,dis=acc?.disclosure;
 const heading=h('h3',t('Relationship invitation','Invitación a una relación')).props({id:'org-rel-accept',tabIndex:-1});
 const close=h('div',btn(t('Close','Cerrar'),'rel-accept-close',{},false,'rel-accept-close')).classes('org-actions');
 if(!acc)return null;
 if(acc.invalid)return h('article',heading,h('p',orgRelationError(ctx.s.locale,acc.reason==='not_found'?'not_found':'invitation_invalid')).attrs({role:'alert'}),close).key('rel-accept');
 if(!dis)return h('article',heading,h('p',t('Checking the invitation…','Comprobando la invitación…')).classes('org-status').attrs({role:'status'}),close).key('rel-accept');
 const i=dis.inviter;
 return h('article',heading,warningBox(dis.warnings,ctx),
  h('dl',h('dt',t('From','De')),h('dd',i.handle?plain('@'+i.handle):t('No handle','Sin identificador')),h('dt',t('Identity link','Enlace de identidad')),h('dd',plain(i.identity)).classes('org-rel-code'),h('dt',t('Verified origin','Origen verificado')),h('dd',plain(host(i.origin))),
   h('dt',t('Relation','Relación')),h('dd',plain(dis.relation.title??''),h('br'),h('small',t('Publisher not verified: ','Editor no verificado: '),plain(dis.relation.publisher??'')).classes('org-help')),
   h('dt',t('Your role','Tu papel')),h('dd',plain(dis.slot)),h('dt',t('Their role','Su papel')),h('dd',plain(dis.counterpartySlot)),dis.expiresAt?[h('dt',t('Expires','Caduca')),h('dd',when(dis.expiresAt))]:null),
  h('p',t('Several organizations can share one origin, so the handle and identity link identify the inviter, not the origin.','Varias organizaciones pueden compartir un origen, así que el identificador y el enlace de identidad identifican a quien invita, no el origen.')).classes('org-help'),
  h('h4',t('What you would receive','Lo que recibirías')),matrixList(dis.receives,ctx),
  h('h4',t('Keep in mind','Ten en cuenta')),caveatList(dis.caveats,ctx),
  form([h('h4',t('What you would give','Lo que darías')),...valuesFields(dis.gives,m.relationPool??[],ctx),
   dis.receives.length?x.box('receive',t('Accept what they give us (it brings their data into this organization)','Aceptar lo que nos den (trae sus datos a esta organización)')):null,
   check('confirm',t('I reviewed what we give and receive, and want to accept','Revisé lo que damos y recibimos, y quiero aceptar')),
   h('p',t('Every admin is told at once. You’ll be asked to confirm it’s you.','Se avisa al momento a todos los administradores. Se te pedirá que confirmes que eres tú.')).classes('org-help')],'rel-accept',t('Accept','Aceptar'),{},'rel-accept'),
  h('div',btn(t('Decline','Rechazar'),'rel-accept-decline',{},false,'rel-accept-decline'),btn(t('Not now','Ahora no'),'rel-accept-close',{},false,'rel-accept-close')).classes('org-actions'),
  h('p',t('Declining tells the other organization nothing about why.','Rechazar no le dice a la otra organización el motivo.')).classes('org-help')).key('rel-accept');
}

function holdText(hold,ctx){const {t,h,when}=ctx,x=helpers(ctx);return [h('p',hold.cause?x.tt(HOLD_CAUSE[hold.cause]):t('The other organization had a security change.','La otra organización tuvo un cambio de seguridad.')),
 h('p',hold.kind==='write'?[t('Only adding, replacing and deleting are paused','Solo se pausan añadir, reemplazar y eliminar'),hold.until?[t(' until ',' hasta el '),when(hold.until)]:null,t(', or until an admin confirms. Reading continues.',', o hasta que un administrador lo confirme. La lectura continúa.')]:t('Everything you share with it is paused until an admin confirms. Nothing it sends changes that.','Todo lo que compartes con ella está en pausa hasta que un administrador lo confirme. Nada de lo que envíe cambia eso.')),
 hold.since?h('p',t('Since ','Desde el '),when(hold.since)).classes('org-help'):null];}
function holdForm(rel,hold,ctx){const {t,h,form,check}=ctx;if(!canWiden(rel))return null;return form([check('confirm',t('I checked with the other organization that this change is genuine','Comprobé con la otra organización que este cambio es auténtico'))],'rel-hold-confirm',t('Confirm and release','Confirmar y levantar'),{counterpart:principalKey(hold.counterpart)},'rel-hold-confirm');}

function edgeView(m,ctx){
 const {t,h,form,check,btn,plain,when}=ctx,x=helpers(ctx),rel=m.relations,pane=m.relationPane,{i,c}=cpOf(rel,pane.instance,pane.counterpart);
 const back=h('div',btn(t('Back to relationships','Volver a las relaciones'),'rel-back',{},false,'rel-back')).classes('org-actions');
 if(!i||!c)return h('article',h('h3',t('Not available','No disponible')).props({id:'org-rel-edge',tabIndex:-1}),h('p',orgRelationError(ctx.s.locale,'not_found')),back).key('rel-edge');
 const key=principalKey(c.principal),detail={instance:i.instance,counterpart:key},out=c.outgoing,inc=c.incoming,widen=canWiden(rel);
 const received=(rel.imports??[]).filter(r=>principalKey(r.grantor)===key&&r.instance===i.instance);
 const rebind=m.relationRebind&&m.relationRebind.instance===i.instance&&m.relationRebind.counterpart===key;
 const gives=rebind?rebindGives(out,m.relationPool??[]):[];
 return h('article',h('h3',x.name(c.principal,c)).props({id:'org-rel-edge',tabIndex:-1}),
  h('dl',h('dt',t('Relation','Relación')),h('dd',plain(i.title??t('Untitled relation','Relación sin título'))),h('dt',t('Your role','Tu papel')),h('dd',plain(c.as??i.slots.join(', '))),h('dt',t('Their role','Su papel')),h('dd',plain(c.slot??'')),h('dt',t('Identity link','Enlace de identidad')),h('dd',plain(identityURI(c.principal))).classes('org-rel-code')),
  c.hold?h('div',h('h4',t('Paused for safety','En pausa por seguridad')),...holdText(c.hold,ctx),holdForm(rel,{...c.hold,counterpart:c.principal},ctx)).classes('org-rel-warn'):null,
  c.unreachable?h('p',t('This organization can’t be reached since ','No se puede contactar con esta organización desde el '),when(c.unreachable.since),'.',c.unreachable.flagged?t(' That is over 30 days: consider ending what you share with it.',' Son más de 30 días: plantéate terminar lo que compartes con ella.'):null).classes('org-note','org-warning'):null,
  h('h4',t('What you give: ','Lo que das: '),x.half(out)),
  out.entries.length?h('ul',...out.entries.map(e=>h('li',t('Entry ','Apartado '),String(e.index+1),e.required?[' (',t('required','obligatorio'),')']:null,h('ul',...e.resources.map(r=>h('li',plain(r.resource),' · ',x.field(r.field),': ',x.contractMethods(r.methods),x.scope(r)).key(r.resource)))).key(String(e.index)))):h('p',t('Nothing.','Nada.')),
  h('p',t('Who acts: ','Quién actúa: '),out.entries.some(e=>e.actor_disclosure==='named')?x.tt(ACTOR.named):x.tt(ACTOR.pairwise)).classes('org-help'),
  h('div',out.state==='live'?btn(t('Pause what you give','Pausar lo que das'),'rel-suspend',{...detail,direction:'outgoing'},false,'rel-suspend'):null,
   out.state==='suspended'&&out.cause!=='moved'&&widen?btn(t('Resume what you give','Reanudar lo que das'),'rel-resume',{...detail,direction:'outgoing'},false,'rel-resume'):null,
   out.cause==='moved'&&widen&&!rebind?btn(t('Choose new resources','Elegir nuevos recursos'),'rel-rebind-open',detail,false,'rel-rebind-open','org-primary'):null).classes('org-actions'),
  rebind?h('div',h('h4',t('Choose new resources after the move','Elige nuevos recursos tras el traslado')).props({id:'org-rel-rebind',tabIndex:-1}),h('p',t('Your organization moved, so its resources have new addresses. Choose what to keep sharing; the other organization is told you moved.','Tu organización se trasladó, así que sus recursos tienen nuevas direcciones. Elige qué seguir compartiendo; se avisa a la otra organización del traslado.')).classes('org-help'),
   form([...valuesFields(gives,m.relationPool??[],ctx),check('confirm',t('Share these resources in place of the old ones','Compartir estos recursos en lugar de los anteriores'))],'rel-rebind',t('Save new resources','Guardar nuevos recursos'),{},'rel-rebind')):null,
  ['live','suspended'].includes(out.state)&&out.entries.length?h('details',h('summary',t('Share less','Compartir menos')),
   form([h('p',t('Untick what to stop sharing. Required entries can’t be dropped; end the sharing instead.','Desmarca lo que quieras dejar de compartir. Los apartados obligatorios no se pueden quitar; termina el uso compartido en su lugar.')).classes('org-help'),
    ...out.entries.map(e=>h('fieldset',h('legend',t('Entry ','Apartado '),String(e.index+1)),x.box('keep:'+e.index,[t('Keep this entry','Mantener este apartado'),e.required?[' (',t('required','obligatorio'),')']:null],{checked:true,required:!!e.required}),...e.resources.map((r,k)=>x.box(`keepr:${e.index}:${k}`,[t('Keep ','Mantener '),plain(r.resource)],{checked:true}))).key('n'+e.index)),
    check('confirm',t('Stop sharing what I unticked','Dejar de compartir lo que desmarqué'))],'rel-narrow',t('Share less','Compartir menos'),detail,'rel-narrow')):null,
  out.state&&out.state!=='ended'?h('details',h('summary',t('End what you give','Terminar lo que das')),form([h('p',t('Ending is final. Sharing again needs a new invitation.','Terminar es definitivo. Volver a compartir requiere una nueva invitación.')).classes('org-help'),check('confirm',t('End what we give to this organization','Terminar lo que damos a esta organización'))],'rel-end',t('End','Terminar'),{...detail,direction:'outgoing'},'rel-end')):null,
  h('h4',t('What you receive: ','Lo que recibes: '),x.half(inc)),
  received.length?h('ul',...received.flatMap(r=>r.resources.map(res=>h('li',plain(res.resource??res.id),' · ',res.status==='available'?t('available','disponible'):t('unavailable','no disponible'),r.held?t(' · held until an admin confirms',' · retenido hasta que un administrador confirme'):null).key(String(res.id??res.resource))))):h('p',t('Nothing received yet.','Aún no se recibe nada.')),
  h('div',inc.state==='live'?btn(t('Pause what you receive','Pausar lo que recibes'),'rel-suspend',{...detail,direction:'incoming'},false,'rel-suspend-incoming'):null,inc.state==='suspended'&&widen?btn(t('Resume what you receive','Reanudar lo que recibes'),'rel-resume',{...detail,direction:'incoming'},false,'rel-resume-incoming'):null).classes('org-actions'),
  inc.state&&inc.state!=='ended'?h('details',h('summary',t('Stop receiving for good','Dejar de recibir definitivamente')),form([check('confirm',t('End what this organization gives us','Terminar lo que esta organización nos da'))],'rel-end',t('End','Terminar'),{...detail,direction:'incoming'},'rel-end-incoming')):null,
  (out.live||inc.live)&&rel.enabled&&i.counterparts.length>1?h('details',h('summary',t('Introduce to the others','Presentar a las demás')),form([h('p',t('Tells the other organizations in this relationship that you deal with this one. It gives nobody anything.','Indica a las demás organizaciones de esta relación que tratas con esta. No da nada a nadie.')).classes('org-help'),check('confirm',t('Introduce this organization','Presentar a esta organización'))],'rel-introduce',t('Introduce','Presentar'),detail,'rel-introduce')):null,
  h('details',h('summary',t('Mute this organization','Silenciar a esta organización')),form([h('p',t('Its future invitations and introductions are declined silently. It isn’t told.','Sus futuras invitaciones y presentaciones se rechazan en silencio. No se le avisa.')).classes('org-help'),check('confirm',t('Mute this organization','Silenciar a esta organización'))],'rel-mute',t('Mute','Silenciar'),{organization:key},'rel-mute')),
  h('div',btn(t('See the activity log','Ver el registro de actividad'),'rel-audit',{},false,'rel-audit')).classes('org-actions'),back).key('rel-edge:'+i.instance+key);
}

function admitView(m,ctx){
 const {t,h,form,check,btn,plain}=ctx,x=helpers(ctx),ad=m.relationAdmit,intro=m.relations?.inbound.introductions.find(y=>y.introduction===ad?.introduction);if(!ad)return null;
 return h('article',h('h3',t('Admit ','Admitir a '),intro?.candidateHandle?plain('@'+intro.candidateHandle):plain(host(intro?.candidate?.iss))).props({id:'org-rel-admit',tabIndex:-1}),
  h('p',t('Admitting sends this organization an invitation with what you choose to give. Nothing is shared until it accepts.','Admitir envía a esta organización una invitación con lo que elijas dar. No se comparte nada hasta que acepte.')),
  h('h4',t('What you would receive','Lo que recibirías')),matrixList(ad.receives,ctx),h('h4',t('Keep in mind','Ten en cuenta')),caveatList([],ctx),
  form([...valuesFields(ad.gives,m.relationPool??[],ctx),ad.receives.length?x.box('receive',t('Also accept what they give us','Aceptar también lo que nos den')):null,check('confirm',t('Send this organization an invitation','Enviar una invitación a esta organización'))],'rel-admit',t('Send invitation','Enviar invitación'),{},'rel-admit'),
  h('div',btn(t('Back','Atrás'),'rel-back',{},false,'rel-back')).classes('org-actions')).key('rel-admit');
}

function importsView(m,ctx){
 const {t,h,btn,plain,when}=ctx,x=helpers(ctx),rows=m.relations?.imports??[];
 return h('article',h('h3',t('Imports','Importaciones')).props({id:'org-rel-imports',tabIndex:-1}),
  h('p',t('Resources other organizations share with yours. Apps you assign an imported resource to learn which organization shares it and through which relationship.','Recursos que otras organizaciones comparten con la tuya. Las apps a las que asignas un recurso importado saben qué organización lo comparte y mediante qué relación.')).classes('org-note'),
  rows.length?h('ul',...rows.map((r,n)=>h('li',h('strong',x.name(r.grantor,{handle:r.grantorHandle,name:r.grantorName})),h('br'),r.status==='available'?t('Available','Disponible'):t('Unavailable','No disponible'),r.held?[' · ',h('strong',t('held until an admin confirms','retenido hasta que un administrador confirme'))]:null,r.preAccepted?[' · ',h('strong',t('accepted in advance','aceptado por adelantado'))]:null,
   h('ul',...r.resources.map(res=>h('li',plain(res.resource??res.id),' · ',x.contractMethods(res.methods),res.expires_at?[t(' · until ',' · hasta '),when(res.expires_at*1000)]:null).key(String(res.id??res.resource))))).key(String(n)))).classes('org-rel-list'):h('p',t('Nothing is shared with this organization yet.','Aún no se comparte nada con esta organización.')),
  h('div',btn(t('Back to relationships','Volver a las relaciones'),'rel-back',{},false,'rel-back')).classes('org-actions')).key('rel-imports');
}

function issuedView(m,ctx){
 const {t,h,btn,plain,when}=ctx,inv=m.relationIssued;if(!inv)return null;
 return h('article',h('h3',t('Invitation ready','Invitación lista')).props({id:'org-rel-issued',tabIndex:-1}),
  inv.counterparty?.handle?h('p',t('Same-host organizations see it in their console. Otherwise, send this code privately to ','Las organizaciones del mismo servidor la ven en su consola. Si no, envía este código en privado a '),plain('@'+inv.counterparty.handle),'.'):h('p',t('Send this code privately to the other organization.','Envía este código en privado a la otra organización.')),
  inv.invitation?h('label',h('span',t('Invitation code','Código de invitación')),h('input').props({value:inv.invitation,readOnly:true,type:'text'}).attrs({translate:'no'}).on({focus:e=>e.currentTarget.select()}).key('rel-issued:'+(inv.jti??''))):null,
  inv.accept?h('p',t('An admin there opens it at ','Un administrador de allí la abre en '),h('span',plain(inv.accept)).classes('org-rel-code'),t(', or pastes it under Relationships in their console.',', o la pega en Relaciones en su consola.')).classes('org-help'):null,
  inv.expiresAt?h('p',t('Expires ','Caduca el '),when(inv.expiresAt),t('. It works once, only for that organization.','. Funciona una vez y solo para esa organización.')).classes('org-help'):null,
  h('div',inv.invitation?btn(t('Copy code','Copiar código'),'rel-copy',{},false,'rel-copy','org-primary'):null,inv.jti?btn(t('Withdraw','Retirar'),'rel-withdraw',{invitation:inv.jti},false,'rel-withdraw-issued'):null,btn(t('Done','Listo'),'rel-issued-dismiss',{},false,'rel-issued-dismiss')).classes('org-actions')).key('rel-issued');
}

function overview(m,ctx){
 const {t,h,form,input,check,btn,plain,when}=ctx,x=helpers(ctx),rel=m.relations,widen=canWiden(rel);
 const items=rel.inbound.items,intros=rel.inbound.introductions,holds=rel.holds.holds,unreachable=rel.holds.unreachable;
 const moved=rel.instances.flatMap(i=>i.counterparts.filter(c=>c.outgoing.cause==='moved'&&c.outgoing.state!=='ended').map(c=>({i,c})));
 const title=i=>i?.title?plain(i.title):t('Untitled relation','Relación sin título');
 const byInstance=id=>rel.instances.find(i=>i.instance===id);
 const edgesOf=p=>rel.instances.flatMap(i=>i.counterparts.filter(c=>principalKey(c.principal)===principalKey(p)&&c.state!=='ended').map(c=>({i,c})));
 const muteForm=(p,data)=>h('details',h('summary',t('Mute this organization','Silenciar a esta organización')),form([check('confirm',t('Decline its invitations and introductions silently from now on','Rechazar en silencio sus invitaciones y presentaciones a partir de ahora'))],'rel-mute',t('Mute','Silenciar'),{organization:principalKey(p)},data));
 const attention=[
  ...items.map(it=>h('li',h('strong',t('Invitation from ','Invitación de '),x.name(it.from,{handle:it.fromHandle,name:it.fromName})),h('br'),t('Offers you the role ','Te ofrece el papel '),plain(it.slot??''),it.receivedAt?[t(' · received ',' · recibida el '),when(it.receivedAt)]:null,it.expiresAt?[t(' · expires ',' · caduca el '),when(it.expiresAt)]:null,
   h('div',btn(t('Review','Revisar'),'rel-inbound',{invitation:it.invitation},false,'rel-inbound','org-primary'),btn(t('Decline','Rechazar'),'rel-decline',{item:it.invitation},false,'rel-decline')).classes('org-actions'),it.from?muteForm(it.from,'rel-mute-inbound'):null).key('inv:'+it.invitation)),
  ...intros.map(it=>h('li',h('strong',t('Introduction: ','Presentación: '),it.candidateHandle?plain('@'+it.candidateHandle):plain(host(it.candidate.iss))),h('br'),it.proposerHandle?[plain('@'+it.proposerHandle),t(' suggests it for the role ',' la propone para el papel ')]:t('Suggested for the role ','Propuesta para el papel '),plain(it.slot??''),t(' in ',' en '),title(byInstance(it.instance)),'.',
   it.expiresAt?h('p',t('Expires ','Caduca el '),when(it.expiresAt),t(' (introductions expire after 30 days). It gives nobody anything by itself.',' (las presentaciones caducan a los 30 días). Por sí sola no da nada a nadie.')).classes('org-help'):null,
   h('div',widen?btn(t('Admit','Admitir'),'rel-admit-open',{introduction:it.introduction},false,'rel-admit-open','org-primary'):null,btn(t('Decline','Rechazar'),'rel-decline',{item:it.introduction},false,'rel-decline-intro')).classes('org-actions')).key('intro:'+it.introduction)),
  ...holds.map(hd=>{const n=cpName(rel,hd.counterpart),edges=edgesOf(hd.counterpart);return h('li',h('strong',t('Paused for safety: ','En pausa por seguridad: '),x.name(hd.counterpart,n)),...holdText(hd,ctx),holdForm(rel,hd,ctx),
   edges.length?h('div',btn(t('Review and end instead','Revisar y terminar en su lugar'),'rel-edge',{instance:edges[0].i.instance,counterpart:principalKey(hd.counterpart)},false,'rel-hold-end')).classes('org-actions'):null).key('hold:'+principalKey(hd.counterpart));}),
  ...unreachable.map(u=>{const edges=edgesOf(u.counterpart);return h('li',h('strong',t('Can’t be reached: ','Sin contacto: '),x.name(u.counterpart,cpName(rel,u.counterpart))),h('br'),t('Since ','Desde el '),when(u.since),'.',u.flagged?t(' Over 30 days: consider ending what you share with it.',' Más de 30 días: plantéate terminar lo que compartes con ella.'):t(' This isn’t treated as an end; what you share stays until you end it or it expires.',' No se trata como un final; lo que compartes sigue hasta que lo termines o caduque.'),
   edges.length?h('div',btn(t('Review','Revisar'),'rel-edge',{instance:edges[0].i.instance,counterpart:principalKey(u.counterpart)},false,'rel-unreachable')).classes('org-actions'):null).key('reach:'+principalKey(u.counterpart));}),
  ...moved.map(({i,c})=>h('li',h('strong',t('Choose new resources: ','Elige nuevos recursos: '),x.name(c.principal,c)),h('br'),t('Your organization moved, so what you give in ','Tu organización se trasladó, así que lo que das en '),title(i),t(' is paused until you choose new resources.',' está en pausa hasta que elijas nuevos recursos.'),
   widen?h('div',btn(t('Choose new resources','Elegir nuevos recursos'),'rel-rebind-open',{instance:i.instance,counterpart:principalKey(c.principal)},false,'rel-rebind-open','org-primary')).classes('org-actions'):null).key('moved:'+i.instance+principalKey(c.principal)))];
 const expiry=c=>{const ends=c.outgoing.entries.flatMap(e=>e.resources.map(r=>r.expires_at)).filter(Boolean);return ends.length?[t(' · until ',' · hasta el '),when(Math.min(...ends)*1000)]:null;};
 return [issuedView(m,ctx),
  h('div',widen?btn(t('Share with an organization','Compartir con una organización'),'rel-wizard-open',{},false,'rel-wizard-open','org-primary'):null,btn([t('Imports','Importaciones'),' (',String(rel.imports.length),')'],'rel-pane',{pane:'imports'},false,'rel-imports'),btn(t('Export relationships','Exportar relaciones'),'rel-export',{},false,'rel-export')).classes('org-actions'),
  h('h3',t('Needs your attention','Requiere tu atención'),' (',String(attention.length),')').props({id:'org-rel-attention',tabIndex:-1}),attention.length?h('ul',...attention).classes('org-rel-list'):h('p',t('Nothing is waiting for you.','Nada está pendiente para ti.')),
  h('h3',t('Relationships','Relaciones'),' (',String(rel.instances.length),')'),
  rel.instances.length?h('ul',...rel.instances.map(i=>h('li',h('h4',title(i)),h('p',t('Your role: ','Tu papel: '),plain(i.slots.join(', ')),' · ',x.tt(INSTANCE[i.state])),
   i.counterparts.length?h('ul',...i.counterparts.map(c=>{const key=principalKey(c.principal);return h('li',h('strong',x.name(c.principal,c)),h('br'),t('Their role: ','Su papel: '),plain(c.slot??''),h('br'),t('You give: ','Das: '),x.half(c.outgoing),expiry(c),' · ',t('You receive: ','Recibes: '),x.half(c.incoming),
    c.hold?[h('br'),h('strong',t('Paused for safety','En pausa por seguridad'))]:null,c.unreachable?.flagged?[h('br'),h('strong',t('Unreachable for over 30 days','Sin contacto desde hace más de 30 días'))]:null,
    h('div',btn(t('Details','Detalles'),'rel-edge',{instance:i.instance,counterpart:key},false,'rel-edge')).classes('org-actions')).key(key);})):h('p',t('No other organization has joined yet.','Ninguna otra organización se ha unido todavía.')),
   i.state!=='left'?h('details',h('summary',t('Leave this relationship','Salir de esta relación')),form([h('p',t('Ends everything you give and receive in it, with every organization. This can’t be undone.','Termina todo lo que das y recibes en ella, con todas las organizaciones. No se puede deshacer.')).classes('org-help'),check('confirm',t('Leave this relationship','Salir de esta relación'))],'rel-leave',t('Leave','Salir'),{instance:i.instance},'rel-leave')):null).key(i.instance))).classes('org-rel-list'):h('p',t('Your organization has no relationships yet.','Tu organización aún no tiene relaciones.')),
  h('h3',t('Invitations you sent','Invitaciones que enviaste'),' (',String(rel.invitations.length),')'),
  rel.invitations.length?h('ul',...rel.invitations.map(inv=>h('li',inv.inviteeHandle?plain('@'+inv.inviteeHandle):plain(host(inv.invitee?.iss)),' · ',t('role ','papel '),plain(inv.slot??''),' · ',title(byInstance(inv.instance)),inv.expiresAt?[t(' · expires ',' · caduca el '),when(inv.expiresAt)]:null,h('div',btn(t('Withdraw','Retirar'),'rel-withdraw',{invitation:inv.invitation},false,'rel-withdraw')).classes('org-actions')).key(inv.invitation))).classes('org-rel-list'):h('p',t('No open invitations.','No hay invitaciones abiertas.')),
  h('details',h('summary',t('Have a relationship invitation code?','¿Tienes un código de invitación a una relación?')),form([input('invitation',t('Invitation code','Código de invitación'),'',{required:true,autoComplete:'off',spellcheck:false,maxLength:8192})],'rel-paste',t('Review invitation','Revisar invitación'),{},'rel-paste'))];
}

/** The member view (RL-13): only the imported resources this member holds grants on; never relations or counterparts. */
function memberView(m,ctx){
 const {t,h,panel,plain}=ctx,x=helpers(ctx),rows=m.relationImports??[];
 return panel('org-relations',t('Shared with this organization','Compartido con esta organización'),
  h('p',t('Resources other organizations share that you have access to here.','Recursos que comparten otras organizaciones y a los que tienes acceso aquí.')).classes('org-help'),
  rows.length?h('ul',...rows.map((r,n)=>h('li',h('strong',x.name(r.grantor,{handle:r.grantorHandle,name:r.grantorName})),h('br'),r.status==='available'?t('Available','Disponible'):t('Unavailable','No disponible'),r.contracts.length?[' · ',x.join(r.contracts.map(x.contract))]:null).key(r.id??String(n)))).classes('org-rel-list'):h('p',t('Nothing is shared with you here.','Aquí no se comparte nada contigo.')),
  m.relationPane?.kind==='accept'&&m.relationAccept?.invalid?h('p',orgRelationError(ctx.s.locale,'not_found')).attrs({role:'alert'}):null);
}

/** The Relationships tab body (admin views, or the member view). */
export function relationsPanel(m,ctx){
 const {t,h,panel}=ctx;if(!organizationAdmin(m))return memberView(m,ctx);
 const rel=m.relations,kind=m.relationPane?.kind;
 const banner=!rel?null:!rel.enabled?t('Sharing with other organizations is off for this organization on this host. You can still review, pause, narrow and end what exists.','Compartir con otras organizaciones está desactivado para esta organización en este servidor. Aún puedes revisar, pausar, reducir y terminar lo que existe.'):rel.closing?t('The organization is being deleted, so nothing new can be shared.','La organización se está eliminando, así que no se puede compartir nada nuevo.'):rel.billing!=='active'?(rel.billing==='export-only'?t('The organization’s payment has lapsed: what you give is paused and nothing new can be shared. Ending and leaving stay available.','El pago de la organización está vencido: lo que das está en pausa y no se puede compartir nada nuevo. Terminar y salir siguen disponibles.'):t('The organization’s payment has lapsed: others can only read what you give, and nothing new can be shared.','El pago de la organización está vencido: los demás solo pueden leer lo que das y no se puede compartir nada nuevo.')):null;
 return panel('org-relations',t('Relationships','Relaciones'),
  h('p',t('What your organization shares with other organizations, and what they share with it. Only admins see this.','Lo que tu organización comparte con otras organizaciones y lo que ellas comparten con la tuya. Solo lo ven los administradores.')).classes('org-help'),
  status(m.relationError,ctx,'error'),status(m.relationNotice,ctx,'notice'),
  banner?h('p',banner).classes('org-status').attrs({role:'status'}):null,
  !rel&&kind!=='accept'?h('p',m.relationsUnavailable?t('Relationships aren’t available for this organization right now.','Las relaciones no están disponibles para esta organización ahora.'):t('Loading…','Cargando…')).classes('org-status').attrs({role:'status'}):
  kind==='wizard'&&m.relationWizard?wizardView(m,ctx):kind==='accept'?acceptView(m,ctx):kind==='edge'?edgeView(m,ctx):kind==='imports'?importsView(m,ctx):kind==='admit'?admitView(m,ctx):overview(m,ctx));
}

/** Count of items waiting for an admin (shown on the tab). */
export function relationsAttention(m){const rel=m?.relations;if(!rel||!organizationAdmin(m))return 0;return rel.inbound.items.length+rel.inbound.introductions.length+rel.holds.holds.length+rel.holds.unreachable.filter(u=>u.flagged).length+rel.instances.reduce((n,i)=>n+i.counterparts.filter(c=>c.outgoing.cause==='moved'&&c.outgoing.state!=='ended').length,0);}

/** The section switch between the organization's own panels and the Relationships tab. */
export function relationsTabs(m,ctx){
 const {s,t,h}=ctx,admin=organizationAdmin(m);if(!m?.organization||!admin&&!(m.relationImports??[]).length)return null;
 const on=m.relationsTab===true,count=relationsAttention(m);
 const tab=(label,id,current)=>h('button',label).props({type:'button',disabled:!!s.busy}).attrs(current?{'aria-current':'page'}:{}).data({orgAction:'rel-tab-'+id}).on({click:e=>fire(e.currentTarget,'organizations',{action:'rel-tab',tab:id})});
 return h('nav',h('style',relStyle),tab(t('Organization','Organización'),'organization',!on),tab([admin?t('Relationships','Relaciones'):t('Shared with us','Compartido con nosotros'),count?[' (',String(count),')']:null],'relationships',on)).classes('org-rel-tabs').attrs({'aria-label':t('Organization sections','Secciones de la organización')});
}

/** Change-of-control and deletion checklists: every relationship, its counterparts and what is given. */
export function relationsChecklist(m,ctx,kind){
 const {t,h,panel,plain}=ctx,x=helpers(ctx),rel=m?.relations;if(!rel||!organizationAdmin(m))return null;
 const live=rel.instances.filter(i=>i.state!=='left');
 const body=[h('p',kind==='deletion'?t('When the deletion takes effect, the organization leaves every relationship and the other organizations are told. Nothing is sent while it is only scheduled.','Cuando la eliminación surta efecto, la organización saldrá de todas sus relaciones y se avisará a las demás organizaciones. No se envía nada mientras solo esté programada.'):t('An ownership change doesn’t change any relationship, and the other organizations aren’t told. Review what the organization shares before a sale.','Un cambio de propiedad no cambia ninguna relación y no se avisa a las demás organizaciones. Revisa lo que comparte la organización antes de una venta.')).classes('org-help'),
  live.length?h('ul',...live.map(i=>h('li',h('strong',i.title?plain(i.title):t('Untitled relation','Relación sin título')),' · ',t('your role ','tu papel '),plain(i.slots.join(', ')),
   i.counterparts.length?h('ul',...i.counterparts.map(c=>{const given=c.outgoing.entries.flatMap(e=>e.resources);return h('li',x.name(c.principal,c),h('br'),t('You give: ','Das: '),given.length&&c.outgoing.state!=='ended'?x.join(given.map(r=>plain(r.resource))):t('nothing','nada')).key(principalKey(c.principal));})):h('p',t('No other organization has joined.','Ninguna otra organización se ha unido.'))).key(i.instance))):h('p',t('This organization has no relationships.','Esta organización no tiene relaciones.'))];
 if(kind==='deletion')return h('details',h('summary',t('Relationships to review before deletion','Relaciones que revisar antes de la eliminación'),' (',String(live.length),')'),...body).key('rel-check-deletion');
 return panel('org-rel-transfer-check',t('Before a sale: relationships to review','Antes de una venta: relaciones que revisar'),...body);
}
