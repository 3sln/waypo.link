// ORG-12e break-glass surfaces in the organization console (design §12d.12 "UI surfaces"). Render-only: every intent
// goes through OrganizationsIntent (`bg-*` actions, apps/web/src/bl/org-break-glass.mjs) and only decisions the server
// advertises are offered. Admins and members never see owner channels, proof tiers or Track S causes; the owner's own
// view lists channel kinds only. `ctx`: {s, t, h, form, input, check, panel, plain, when, btn} from the console.
import {bgOpen,claimDecisions,viewDecisions,adminItems,contestItems,breakGlassItems,BG_CATEGORIES,BG_STEPS,LOST_DAYS} from '../bl/org-break-glass.mjs';
import {createLocalization} from '../../../../packages/i18n/index.mjs';
import {price} from './org-ownership.mjs';

export const CATEGORY_LABELS=Object.freeze({'owner-deceased':['The owner has died','El propietario ha fallecido'],'owner-unreachable':['The owner cannot be reached','No se puede contactar con el propietario'],'owner-credentials-lost':['The owner lost every way to sign in and the recovery file','El propietario perdió todas sus formas de acceso y el archivo de recuperación'],other:['Another reason','Otro motivo']});
const STATE_LABELS={gathering:['Collecting signatures and payment','Reuniendo firmas y pago'],waiting:['Waiting period: the owner is being notified','Periodo de espera: se está avisando al propietario'],'held-for-support':['Held for support review','En revisión por el soporte'],final:['Final notice period after a support decision','Periodo de aviso final tras una decisión del soporte'],effective:['Took effect','Surtió efecto'],closed:['Closed','Cerrada'],aborted:['Stopped by you','Detenida por ti'],withdrawn:['Withdrawn','Retirada']};
const CHANNEL_LABELS={email:['{#} email addresses','{#} email address'],push:['{#} notification devices','{#} notification device'],session:['{#} signed-in sessions','{#} signed-in session'],credential:['{#} passkeys or passwords','{#} passkey or password']};
const STEP_LABELS={alternatives:['Other options','Otras opciones'],candidate:['Candidate','Candidato'],category:['Reason','Motivo'],statement:['Statement','Declaración'],review:['Review','Revisión']};
const shortId=value=>{const v=String(value??'');return v.length>13?v.slice(0,8)+'…':v;};
const paidAge=s=>s?.config?.ageRequirement?.paidMinimumAge??18;

function helpers(ctx){
 const {s,t,h,plain}=ctx,me=s.session?.account?.id,tt=pair=>t(pair[0],pair[1]);
 const who=p=>p?.handle?plain('@'+p.handle):p?.sub===me?t('you','tú'):p?.sub?plain(shortId(p.sub)):t('someone','alguien');
 const state=c=>tt(STATE_LABELS[c?.state]??['Status unavailable','Estado no disponible']);
 const textarea=(name,label,value='',help=null)=>h('label',h('span',label),h('textarea').props({name,required:true,rows:6,value}).attrs({maxlength:'2000'}).key(name),help?h('span',help).classes('org-help'):null);
 const reason=(name,label,max)=>h('label',h('span',label),h('textarea').props({name,rows:4}).attrs({maxlength:String(max)}).on({input:event=>{event.currentTarget.nextElementSibling.textContent=`${[...event.currentTarget.value].length} / ${max}`;}}).key(name),h('span',`0 / ${max}`).classes('org-help')).on({$update:node=>{node.lastElementChild.textContent=`${[...node.querySelector('textarea').value].length} / ${max}`;}});
 const radio=(name,value,label,checked=false)=>h('label',h('input').props({type:'radio',name,value,required:true,checked}),h('span',label)).classes('org-check').key(name+':'+value);
 return {me,tt,who,state,textarea,radio,reason};
}

/** The claim timeline: state, dates and who signed. Channel details only for the owner (kinds and counts). */
export function claimTimeline(claim,ctx){
 const {t,h,when}=ctx,{tt,who,state}=helpers(ctx),localization=createLocalization({locale:ctx.s.locale});if(!claim)return null;
 const rows=[[t('Status','Estado'),state(claim)],[t('Started','Iniciada'),when(claim.createdAt)]];
 if(claim.initiator)rows.push([t('Started by','Iniciada por'),who(claim.initiator)]);
 if(claim.candidate)rows.push([t('Candidate owner','Propietario candidato'),[who(claim.candidate),claim.candidacyAccepted?t(' (accepted)',' (aceptado)'):t(' (not accepted yet)',' (aún no aceptado)')]]);
 if(Array.isArray(claim.cosigners))rows.push([t('Co-signed by','Cofirmada por'),claim.cosigners.length?claim.cosigners.map((c,i)=>[i?', ':'',who(c.principal)]):t('nobody yet','nadie todavía')]);
 if(claim.category)rows.push([t('Reason','Motivo'),tt(CATEGORY_LABELS[claim.category]??CATEGORY_LABELS.other)]);
 if(typeof claim.paid==='boolean')rows.push([t('Paid by the candidate','Pagada por el candidato'),claim.paid?t('yes','sí'):t('not yet','todavía no')]);
 if(Number.isSafeInteger(claim.objections)&&claim.objections>0)rows.push([t('Objections','Objeciones'),String(claim.objections)]);
 if(claim.waitEndsAt&&claim.state==='waiting')rows.push([t('Waiting period ends','El periodo de espera termina'),when(claim.waitEndsAt)]);
 if(claim.finalEndsAt&&claim.state==='final')rows.push([t('Final notice ends','El aviso final termina'),when(claim.finalEndsAt)]);
 if(claim.earliestEffectAt)rows.push([t('Earliest effect','Efecto más temprano'),when(claim.earliestEffectAt)]);
 if(claim.frozen)rows.push([t('Paused','En pausa'),t('A recovery with the organization file is pending.','Hay una recuperación con el archivo de la organización pendiente.')]);
 const channels=Array.isArray(claim.channels)?Object.entries(claim.channels.reduce((acc,c)=>{acc[c.kind]=(acc[c.kind]??0)+1;return acc;},{})):[];
 return h('div',h('dl',...rows.map(([k,v])=>[h('dt',k),h('dd',v)]).flat()),
  claim.state==='held-for-support'?h('p',t('3sln.me support is reviewing this claim. It cannot take effect by itself while it is held.','El soporte de 3sln.me está revisando esta reclamación. No puede surtir efecto por sí sola mientras está en revisión.')).classes('org-note'):null,
  claim.statement?h('details',h('summary',t('Statement from the admins','Declaración de los administradores')),h('p',ctx.plain(claim.statement))):null,
  channels.length?h('p',t('Notices about this claim go to your ','Los avisos de esta reclamación van a tus '),channels.map(([kind,n],i)=>[i?', ':'',localization.t.plural(...(CHANNEL_LABELS[kind]??['{#} channels','{#} channel']),n)]),'.').classes('org-help'):null).classes('org-bg-timeline');
}

/** Banners at the top of an organization context: open claim (members), co-signature request, missing recovery file. */
export function breakGlassBanners(m,ctx){
 const {t,h,when}=ctx,claim=m?.breakGlass?.claim,decisions=claimDecisions(claim),out=[];
 if(bgOpen(claim)&&!Array.isArray(claim.decisions))out.push(h('p',h('strong',t('An ownership claim is open. ','Hay una reclamación de propiedad abierta. ')),t('Admins started it on ','Los administradores la iniciaron el '),when(claim.createdAt),claim.earliestEffectAt?[t('. It cannot take effect before ','. No puede surtir efecto antes del '),when(claim.earliestEffectAt)]:claim.state==='held-for-support'?t('. 3sln.me support is reviewing it','. El soporte de 3sln.me la está revisando'):null,t('. Your membership and access do not change.','. Tu membresía y tu acceso no cambian.')).classes('org-status','org-warning').attrs({role:'status'}).key('bg-member'));
 if(bgOpen(claim)&&(decisions.includes('cosign')||decisions.includes('accept')))out.push(h('p',decisions.includes('accept')?t('You are named as the candidate owner in an ownership claim. Review it under “The owner is gone?” below.','Se te nombra propietario candidato en una reclamación de propiedad. Revísala en «¿El propietario no está?» más abajo.'):t('Another admin asked you to co-sign an ownership claim. Review it under “The owner is gone?” below.','Otro administrador te pidió cofirmar una reclamación de propiedad. Revísala en «¿El propietario no está?» más abajo.')).classes('org-status').attrs({role:'status'}).key('bg-cosign'));
 const recovery=m?.ownership?.recovery;
 if(recovery?.state==='missing'){const owner=(m.ownership.decisions??[]).includes('reissue-recovery');
  out.push(h('p',h('strong',t('No current recovery file. ','No hay archivo de recuperación vigente. ')),owner?t('Get a new organization recovery file under “Billing and ownership” below. Moves stay impossible until a file exists and is 7 days old.','Obtén un nuevo archivo de recuperación de la organización en «Facturación y propiedad» más abajo. Los traslados no son posibles hasta que exista un archivo con 7 días de antigüedad.'):t('Only the owner of record can issue one.','Solo el propietario registrado puede emitirlo.')).classes('org-status','org-warning').attrs({role:'alert'}).key('bg-recovery'));}
 return out;
}

function disclosure(claim,ctx){
 const {s,t,h,form,check}=ctx,options=Array.isArray(claim.disclosure)?claim.disclosure:[],locale=s.locale==='es'?'es':'en';if(!options.length)return h('p',t('The plan price is unavailable right now.','El precio del plan no está disponible ahora.')).attrs({role:'status'});
 return h('article',h('h3',t('Pay to continue the claim','Paga para continuar la reclamación')),
  h('p',t('As the candidate, you pay first. Payments use the Polar sandbox: no real payment is taken. Prices are provisional.','Como candidato, pagas primero. Los pagos usan el entorno de pruebas de Polar: no se cobra ningún pago real. Los precios son provisionales.')).classes('org-note'),
  h('ul',...options.map(o=>h('li',ctx.plain(o.plan),' · ',price(o.price,locale),t(' a year',' al año')).key(o.plan))),
  h('ul',h('li',t('Billing starts a fresh period at checkout. The owner’s payment does not count, and there is no proration.','La facturación empieza un periodo nuevo al pagar. El pago del propietario no cuenta y no hay prorrateo.')),
   h('li',t(`The paid period runs from checkout, so ${LOST_DAYS.min} to ${LOST_DAYS.max} days of it pass before the claim can take effect.`,`El periodo pagado corre desde el pago, así que pasan de ${LOST_DAYS.min} a ${LOST_DAYS.max} días antes de que la reclamación pueda surtir efecto.`)),
   h('li',t('After payment the owner is notified and has at least 30 days to answer (60 days if support reviews the claim).','Tras el pago se avisa al propietario, que tiene al menos 30 días para responder (60 si el soporte revisa la reclamación).')),
   h('li',t('The owner can stop the claim at any time before it takes effect. After it takes effect, the former owner can contest it for 90 days.','El propietario puede detener la reclamación en cualquier momento antes de que surta efecto. Después, el propietario anterior puede impugnarla durante 90 días.')),
   h('li',t('If the claim does not take effect, you are refunded in full. If you withdraw voluntarily, the processing fee is kept.','Si la reclamación no surte efecto, se te reembolsa todo. Si la retiras voluntariamente, se retiene la comisión de procesamiento.'))),
  form([options.length>1?h('label',h('span',t('Plan','Plan')),h('select',...options.map(o=>h('option',`${o.plan} · ${price(o.price,locale)}`).props({value:o.plan}))).props({name:'plan'})):null,
   check('confirm',t('I reviewed these terms and want to pay for a fresh period','Revisé estas condiciones y quiero pagar un periodo nuevo')),check('ageConfirmed',t(`I am ${paidAge(s)} or older`,`Tengo ${paidAge(s)} años o más`))],'bg-checkout',t('Continue to checkout','Continuar al pago'),{},'bg-checkout'));
}

function claimActions(claim,ctx,detail={}){
 const {t,h,form,input,check,btn}=ctx,d=claimDecisions(claim);
 return [
  d.includes('abort')?h('div',h('p',t('If you are the owner and you did not ask for this, stop it. Stopping needs no reason and is never refused.','Si eres el propietario y no lo pediste, detenla. Detenerla no requiere motivo y nunca se rechaza.')),btn(t('Stop this claim','Detener esta reclamación'),'bg-abort',detail,false,'bg-abort','org-primary')).classes('org-note','org-warning'):null,
  d.includes('accept')?h('div',h('p',t('You are named as the candidate owner. Accepting counts as a signature and needs a passkey or password you have had for at least 7 days.','Se te nombra propietario candidato. Aceptar cuenta como firma y requiere una llave de acceso o contraseña que tengas desde hace al menos 7 días.')),btn(t('Accept the candidacy','Aceptar la candidatura'),'bg-accept',detail,false,'bg-accept','org-primary')).classes('org-actions'):null,
  d.includes('pay')?disclosure(claim,ctx):null,
  d.includes('cosign')?h('div',h('p',t('Co-sign only if you believe the owner is truly gone. The owner is notified and can stop the claim at any time.','Cofirma solo si crees que el propietario realmente no está. Se avisa al propietario, que puede detener la reclamación en cualquier momento.')),btn(t('Co-sign','Cofirmar'),'bg-cosign',detail,false,'bg-cosign','org-primary')).classes('org-actions'):null,
  d.includes('uncosign')?form([check('confirm',t('Withdraw my co-signature','Retirar mi cofirma'))],'bg-uncosign',t('Withdraw co-signature','Retirar cofirma'),detail,'bg-uncosign'):null,
  d.includes('object')?h('details',h('summary',t('Object to this claim','Objetar esta reclamación')),form([helpers(ctx).reason('reason',t('Reason (optional)','Motivo (opcional)'),280),check('confirm',t('Object and send this claim to 3sln.me support','Objetar y enviar esta reclamación al soporte de 3sln.me'))],'bg-object',t('Object','Objetar'),detail,'bg-object')):null,
  d.includes('withdraw')?h('details',h('summary',t('Withdraw this claim','Retirar esta reclamación')),form([check('confirm',t('Withdraw this claim (if you paid, the refund keeps the processing fee)','Retirar esta reclamación (si pagaste, el reembolso retiene la comisión de procesamiento)'))],'bg-withdraw',t('Withdraw','Retirar'),detail,'bg-withdraw')):null];
}

function contestForm(ctx,detail={}){
 const {t,h,form,input,check}=ctx;
 return h('article',h('h3',t('Contest the ownership change','Impugnar el cambio de propiedad')),
  h('p',t('Ownership of this organization changed through a claim. If that was wrong, you can contest it during the 90-day window. You will be asked to confirm with a passkey or password you had at least 7 days before the claim began. Support reviews every contest.','La propiedad de esta organización cambió mediante una reclamación. Si fue un error, puedes impugnarla durante los 90 días. Se te pedirá confirmar con una llave de acceso o contraseña que tuvieras al menos 7 días antes de que empezara la reclamación. El soporte revisa cada impugnación.')),
  form([helpers(ctx).reason('reason',t('What happened (optional)','Qué pasó (opcional)'),2000),check('confirm',t('Contest this ownership change','Impugnar este cambio de propiedad'))],'bg-contest',t('Contest','Impugnar'),detail,'bg-contest'));
}

function wizardView(m,ctx){
 const {s,t,h,form,input,check,btn,when}=ctx,{tt,who,textarea,radio}=helpers(ctx),w=m.breakGlassWizard,index=BG_STEPS.indexOf(w.step),own=m.ownership,lapse=(own?.decisions??[]).includes('claim')||own?.billing?.standing==='read-only';
 const nav=h('div',btn(t('Back','Atrás'),'bg-wizard-back',{},false,'bg-wizard-back'),btn(t('Cancel','Cancelar'),'bg-wizard-cancel',{},false,'bg-wizard-cancel')).classes('org-actions');
 const progress=h('ol',...BG_STEPS.map((id,i)=>h('li',tt(STEP_LABELS[id])).classes(...i<index?['org-step-done']:[]).attrs(i===index?{'aria-current':'step'}:{}).key(id))).classes('org-steps').attrs({'aria-label':t('Progress','Progreso')});
 const heading=text=>h('h3',text).props({id:'org-bg-step',tabIndex:-1});
 let body;
 if(w.step==='alternatives')body=[heading(t('Before you claim ownership','Antes de reclamar la propiedad')),
  h('p',t('A claim is slow and costly on purpose: the owner always wins if they answer. Try these first:','Una reclamación es lenta y costosa a propósito: el propietario siempre gana si responde. Prueba esto primero:')),
  h('ul',h('li',t('Contact the owner directly, by every means you have. If they can act, they can offer you ownership with a transfer.','Contacta directamente con el propietario por todos los medios que tengas. Si puede actuar, puede ofrecerte la propiedad con una transferencia.')),
   lapse?h('li',t('The organization’s payment has lapsed. The billing-lapse claim under “Billing and ownership” is faster.','El pago de la organización está vencido. La reclamación por impago en «Facturación y propiedad» es más rápida.')):null,
   h('li',t('If someone holds the organization’s recovery file, recovering with the file is stronger evidence. Ask them.','Si alguien tiene el archivo de recuperación de la organización, recuperar con el archivo es una prueba más fuerte. Pídeselo.'))),
  h('div',btn(t('None of these work; continue','Nada de esto funciona; continuar'),'bg-wizard-next',{},false,'bg-wizard-next','org-primary'),btn(t('Cancel','Cancelar'),'bg-wizard-cancel',{},false,'bg-wizard-cancel')).classes('org-actions')];
 else if(w.step==='candidate')body=[heading(t('Who would become the owner?','¿Quién pasaría a ser el propietario?')),
  h('p',t('The candidate must be an admin of at least 30 days, pays for the organization first, and confirms with a passkey or password they have had for at least 7 days.','El candidato debe ser administrador desde hace al menos 30 días, paga primero la organización y confirma con una llave de acceso o contraseña que tenga desde hace al menos 7 días.')),
  h('div',btn(t('I will be the candidate','Seré el candidato'),'bg-candidate',{values:{who:'self'}},false,'bg-candidate-self','org-primary')).classes('org-actions'),
  form([input('handle',t('Or another admin’s handle','O el identificador de otro administrador'),'',{required:true,autoComplete:'off',maxLength:64})],'bg-candidate',t('Use this admin','Usar este administrador'),{},'bg-candidate'),nav];
 else if(w.step==='category')body=[heading(t('Why is the owner gone?','¿Por qué no está el propietario?')),
  form([h('fieldset',h('legend',t('Reason','Motivo')),...BG_CATEGORIES.map(c=>radio('category',c,tt(CATEGORY_LABELS[c]),w.category===c)))],'bg-category',t('Continue','Continuar'),{},'bg-category'),nav];
 else if(w.step==='statement')body=[heading(t('Explain what happened','Explica qué pasó')),
  h('p',t('Every admin, the candidate and the owner can read this statement. Never include medical details or documents: support collects evidence separately if needed.','Todos los administradores, el candidato y el propietario pueden leer esta declaración. No incluyas datos médicos ni documentos: el soporte reúne pruebas por separado si hace falta.')).classes('org-help'),
  form([textarea('statement',t('Statement (up to 2,000 characters)','Declaración (hasta 2000 caracteres)'),w.statement??'')],'bg-statement',t('Continue','Continuar'),{},'bg-statement'),nav];
 else body=[heading(t('Review and start the claim','Revisa e inicia la reclamación')),
  h('dl',h('dt',t('Candidate owner','Propietario candidato')),h('dd',w.candidate?.self?t('you','tú'):who(w.candidate)),h('dt',t('Reason','Motivo')),h('dd',tt(CATEGORY_LABELS[w.category]??CATEGORY_LABELS.other)),h('dt',t('Statement','Declaración')),h('dd',ctx.plain(w.statement))),
  h('ul',h('li',t('The owner is notified at once on every email address and device they had before the claim, and again during the wait.','Se avisa al propietario al momento en cada dirección de correo y dispositivo que tenía antes de la reclamación, y de nuevo durante la espera.')),
   h('li',t('The owner can stop the claim at any time before it takes effect, with no reason. Signing in also pauses it for support review.','El propietario puede detener la reclamación en cualquier momento antes de que surta efecto, sin dar motivo. Iniciar sesión también la pausa para revisión del soporte.')),
   h('li',t('A second eligible admin must co-sign within 7 days, and the candidate must pay within 7 days after that.','Un segundo administrador elegible debe cofirmar en 7 días, y el candidato debe pagar en los 7 días siguientes.')),
   h('li',t('After payment there is a wait of at least 30 days. Some claims go to 3sln.me support, which takes at least 60 days. Admins only see “held for support”.','Tras el pago hay una espera de al menos 30 días. Algunas reclamaciones pasan al soporte de 3sln.me, que tarda al menos 60 días. Los administradores solo ven «en revisión por el soporte».')),
   h('li',t('After the change, the former owner can contest it for 90 days, and the new owner cannot transfer, move or delete the organization meanwhile.','Tras el cambio, el propietario anterior puede impugnarlo durante 90 días, y mientras tanto el nuevo propietario no puede transferir, trasladar ni eliminar la organización.')),
   h('li',t('If the claim does not take effect, the candidate is refunded in full; a voluntary withdrawal keeps the processing fee.','Si la reclamación no surte efecto, se reembolsa todo al candidato; una retirada voluntaria retiene la comisión de procesamiento.'))),
  form([check('confirm',t('I understand, and I want to start this claim','Lo entiendo y quiero iniciar esta reclamación'))],'bg-start',t('Start the claim','Iniciar la reclamación'),{},'bg-start'),nav];
 return h('article',progress,...body).classes('org-bg-wizard').key('bg-wizard');
}

/** The "owner is gone?" panel in an organization context: timeline, decisions, the start wizard and the contest entry. */
export function breakGlassPanel(m,ctx){
 const {t,h,btn,panel}=ctx,view=m?.breakGlass;if(!view||typeof view!=='object')return null;
 const claim=view.claim,decisions=viewDecisions(view),shown=claim&&(bgOpen(claim)||claim.state==='effective');
 if(!shown&&!decisions.length)return null;
 return panel('org-break-glass',bgOpen(claim)?t('Ownership claim','Reclamación de propiedad'):t('The owner is gone?','¿El propietario no está?'),
  shown?claimTimeline(claim,ctx):null,
  shown&&bgOpen(claim)?claimActions(claim,ctx):null,
  decisions.includes('start')&&!m.breakGlassWizard?h('article',h('h3',t('Start an ownership claim','Iniciar una reclamación de propiedad')),h('p',t('If the owner has died or can no longer be reached, two admins can ask to install a new owner without the recovery file. The owner is told and can always stop it.','Si el propietario ha fallecido o ya no se le puede contactar, dos administradores pueden pedir instalar un nuevo propietario sin el archivo de recuperación. Se avisa al propietario, que siempre puede detenerlo.')),btn(t('See the options','Ver las opciones'),'bg-wizard-open',{},false,'bg-wizard-open')):null,
  decisions.includes('start')&&m.breakGlassWizard?wizardView(m,ctx):null,
  decisions.includes('contest')&&view.contest?contestForm(ctx):null);
}

/** Personal view: claims waiting for this person across organizations (co-signatures, contests, owner claims). */
export function breakGlassWaiting(m,ctx){
 const {t,h,panel,plain,when,btn}=ctx;if(!m||m.context)return null;
 const owner=breakGlassItems(m).filter(i=>i.role==='owner'&&bgOpen(i.claim)),admin=adminItems(m),contest=contestItems(m);if(!owner.length&&!admin.length&&!contest.length)return null;
 const name=i=>plain(i.name??(i.handle?'@'+i.handle:shortId(i.org)));
 return panel('org-bg-waiting',t('Ownership claims waiting for you','Reclamaciones de propiedad pendientes para ti'),
  ...owner.map(i=>h('article',h('h3',t('Someone is claiming ownership of ','Alguien reclama la propiedad de '),name(i)),claimTimeline(i.claim,ctx),...claimActions(i.claim,ctx,{org:i.org,claim:i.claim.id})).key('o:'+i.org)),
  ...admin.map(i=>h('article',h('h3',t('Ownership claim in ','Reclamación de propiedad en '),name(i)),h('p',t('Admins started it on ','Los administradores la iniciaron el '),when(i.claim.createdAt),'.'),...claimActions({...i.claim,decisions:claimDecisions(i.claim).filter(d=>['cosign','object'].includes(d))},ctx,{org:i.org,claim:i.claim.id}),btn(t('Open organization','Abrir organización'),'select',{org:i.org},false,'bg-open-org')).key('a:'+i.org)),
  ...contest.map(i=>h('div',h('p',t('Organization: ','Organización: '),name(i),i.contest?.until?[t(' · contest until ',' · impugnable hasta el '),when(i.contest.until)]:null),contestForm(ctx,{org:i.org,claim:i.contest.claim})).key('c:'+i.org)));
}
