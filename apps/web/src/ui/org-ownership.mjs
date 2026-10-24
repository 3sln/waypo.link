// Organization billing and ownership transfer panels (ORG-D18, ORG-D21, §12b.3a). Render-only: every intent goes
// through OrganizationsIntent, and only server-advertised decisions are offered. Billing is the Polar SANDBOX; nothing
// here claims a live payment. Plan figures are provisional product data.
import {ownershipDecisions} from '../bl/organizations.mjs';
const PLAN_IDS=['org-team','org-business','org-scale'];
const bytes=(n,locale)=>new Intl.NumberFormat(locale,{maximumFractionDigits:0}).format(n/1e12)+' TB';
export function price(p,locale){if(!p||!Number.isSafeInteger(p.amount))return '';try{return new Intl.NumberFormat(locale,{style:'currency',currency:p.currency.toUpperCase()}).format(p.amount/10**(p.exponent??2));}catch{return `${p.amount} ${p.currency}`;}}
/** Shared pieces. `ctx`: {s, t, h, form, input, check, panel, plain, when} from the organization console. */
export function ownershipPanels(m,{s,t,plain}){
 const locale=s.locale==='es'?'es':'en';
 const planLine=p=>[plain(p.name),' · ',bytes(p.storageBytes,locale),' · ',t(`${p.members} members`,`${p.members} miembros`),' · ',t(`${p.aiCreditsMonthly} AI credits a month`,`${p.aiCreditsMonthly} créditos de IA al mes`),p.price?[' · ',price(p.price,locale),t(' a year',' al año')]:null];
 const sandbox=h=>h('p',t('Payments use the Polar sandbox: no real payment is taken. Plans and prices are provisional.','Los pagos usan el entorno de pruebas de Polar: no se cobra ningún pago real. Los planes y precios son provisionales.')).classes('org-note');
 return {sandbox,planLine};
}
export function offersPanel(m,ctx){
 const {t,form,check,panel,plain,when,h}=ctx,offers=(m?.offers??[]).filter(o=>o.offer);if(!offers.length)return null;
 const {planLine,sandbox}=ownershipPanels(m,ctx);
 return panel('org-offers',t('Ownership offers for you','Ofertas de propiedad para ti'),sandbox(h),...offers.map(row=>{const o=row.offer,plans=o.plans??[];return h('article',
  h('h3',plain(row.name??o.organization?.name??row.id)),h('p',plain(row.handle??o.organization?.handle??row.id)),
  h('p',t('You are offered ownership of this organization. If you accept, you become its owner of record: you pay for it, decide elevated requests, and hold its recovery file.','Se te ofrece la propiedad de esta organización. Si aceptas, pasas a ser su propietario registrado: la pagas, decides las solicitudes elevadas y guardas su archivo de recuperación.')),
  h('ul',h('li',t('Billing starts a fresh period when you pay. The previous owner’s payment does not count, and there is no proration.','La facturación empieza un periodo nuevo cuando pagas. El pago del propietario anterior no cuenta y no hay prorrateo.')),
   h('li',t('The transfer takes effect only after your payment is verified, and no earlier than ','La transferencia surte efecto solo tras verificar tu pago, y no antes del '),when(o.notBefore),'.'),
   h('li',t('If the transfer cannot take effect after you pay, your payment is refunded in full.','Si la transferencia no puede surtir efecto después de pagar, se te reembolsa el pago completo.')),
   h('li',t('The offer lapses on ','La oferta caduca el '),when(o.expiresAt),'.'),
   o.admin?h('li',t('The offer includes the admin power, active 72 hours after the transfer.','La oferta incluye el poder de administración, activo 72 horas después de la transferencia.')):null),
  plans.length?h('ul',...plans.map(p=>h('li',...planLine({...p,id:p.plan})).key(p.plan))):h('p',t('The plan price is unavailable right now.','El precio del plan no está disponible ahora.')).attrs({role:'status'}),
  o.decisions?.includes('accept')&&plans.length?form([o.choosePlan?h('label',h('span',t('Plan','Plan')),h('select',...plans.map(p=>h('option',p.name).props({value:p.plan}))).props({name:'plan'})):null,check('confirm',t('I reviewed this disclosure and want to pay for a fresh period','Revisé esta información y quiero pagar un periodo nuevo'))],'accept-offer',t('Accept and continue to checkout','Aceptar y continuar al pago'),{org:row.id},'accept-offer'):null,
  o.decisions?.includes('decline')?form([check('confirm',t('Decline this offer','Rechazar esta oferta'))],'decline-offer',t('Decline','Rechazar'),{org:row.id},'decline-offer'):null).key(row.id);}));
}
export function creationPaymentPanel(m,ctx){
 const {t,form,panel,plain,h}=ctx;if(!m?.creation)return null;const {sandbox}=ownershipPanels(m,ctx),plans=m.plans?.plans??[];
 return panel('org-creation-payment',t('Pay for the new organization','Paga la nueva organización'),
  h('p',t('Organizations are always paid. ','Las organizaciones siempre son de pago. '),m.creation.name?plain(m.creation.name):null,t(' is reserved; it is created after the payment is verified.',' está reservada; se crea cuando se verifica el pago.')),sandbox(h),
  plans.length?form([h('label',h('span',t('Plan','Plan')),h('select',...plans.map(p=>h('option',`${p.name} · ${bytes(p.storageBytes,s(ctx))} · ${price(p.price,s(ctx))}`).props({value:p.id,selected:p.id===m.creation.plan}))).props({name:'plan'}))],'creation-checkout',t('Continue to checkout','Continuar al pago'),{},'creation-checkout'):h('p',t('Organization billing is not available on this host.','La facturación de organizaciones no está disponible en este servidor.')).attrs({role:'status'}),
  form([],'creation-recheck',t('I paid; check again','Ya pagué; comprobar de nuevo'),{},'creation-recheck'),
  form([],'creation-forget',t('Cancel','Cancelar'),{},'creation-forget'));
}
const s=ctx=>ctx.s.locale==='es'?'es':'en';
const STANDING={paid:['Paid','Pagada'],pending:['Checking billing','Comprobando la facturación'],grace:['Payment lapsed: grace period','Pago vencido: periodo de gracia'],'read-only':['Read-only: payment lapsed','Solo lectura: pago vencido']};
const TRANSFER={offered:['Offered','Ofrecida'],paid:['Paid; waiting for the notice period','Pagada; esperando el plazo de aviso'],effective:['Completed','Completada'],withdrawn:['Withdrawn','Retirada'],lapsed:['Lapsed','Caducada'],blocked:['Blocked by an admin','Bloqueada por un administrador'],declined:['Declined','Rechazada'],failed:['Could not take effect; refunded','No pudo surtir efecto; reembolsada']};
export function ownershipPanel(m,ctx){
 const {t,form,input,check,panel,plain,when,h}=ctx,own=m?.ownership;if(!own)return null;
 const tt=pair=>t(pair[0],pair[1]),b=own.billing??{},decisions=ownershipDecisions(m),x=own.transfer,locale=s(ctx),plans=(m.plans?.plans??[]).filter(p=>PLAN_IDS.includes(p.id));
 const plan=plans.find(p=>p.id===b.plan);const {sandbox}=ownershipPanels(m,ctx);
 const select=selected=>h('label',h('span',t('Plan','Plan')),h('select',...plans.map(p=>h('option',`${p.name} · ${bytes(p.storageBytes,locale)} · ${price(p.price,locale)}`).props({value:p.id,selected:p.id===selected}))).props({name:'plan'}));
 const open=x&&['offered','paid'].includes(x.state);
 return panel('org-ownership',t('Billing and ownership','Facturación y propiedad'),
  h('p',t('Status: ','Estado: '),tt(STANDING[b.standing]??['not available right now','no disponible ahora']),b.plan?[' · ',plan?plain(plan.name):plain(b.plan)]:null,b.paidUntil?[' · ',t('paid through ','pagada hasta '),when(b.paidUntil)]:null,b.source==='override'?t(' (operator allowlist)',' (lista autorizada del operador)'):null).attrs({role:'status'}),
  b.standing==='grace'?h('p',t('The organization becomes read-only on ','La organización pasará a solo lectura el '),when(b.readOnlyAt),t('. Leaving, removing members and export always stay available.','. Salir, eliminar miembros y exportar siempre siguen disponibles.')):null,
  b.standing==='read-only'?h('p',t('Changes are paused until the organization is paid again. Leaving, removing members, decisions and export stay available. From ','Los cambios están en pausa hasta que se vuelva a pagar. Salir, eliminar miembros, las decisiones y exportar siguen disponibles. Desde el '),when(b.claimableAt),t(', an admin may claim ownership by paying; the claim takes effect 72 hours after notice unless the owner pays.',', un administrador puede reclamar la propiedad pagando; la reclamación surte efecto 72 horas después del aviso salvo que el propietario pague.')).attrs({role:'alert'}):null,
  b.configured?sandbox(h):null,
  own.claim&&['awaiting-payment','pending'].includes(own.claim.state)?h('p',own.claim.state==='pending'?[t('A billing-lapse claim by ','Una reclamación por impago de '),plain(own.claim.by?.sub),t(' takes effect on ',' surte efecto el '),when(own.claim.notBefore),t(' unless the owner pays.',' salvo que el propietario pague.')]:t('An admin started a billing-lapse claim checkout.','Un administrador inició el pago de una reclamación por impago.')).attrs({role:'status'}):null,
  decisions.includes('renew')&&plans.length?form([select(b.plan)],'renew',t('Pay for the organization','Pagar la organización'),{},'renew'):null,
  decisions.includes('claim')&&plans.length?form([select('org-team'),check('confirm',t('Start a subscription and propose myself as owner (takes effect after 72 hours unless the owner pays)','Iniciar una suscripción y proponerme como propietario (surte efecto en 72 horas salvo que el propietario pague)'))],'claim',t('Claim ownership','Reclamar la propiedad'),{},'claim'):null,
  x?h('article',h('h3',t('Ownership transfer','Transferencia de propiedad')),
   h('p',t('To ','A '),plain(x.toHandle??x.to?.sub),' · ',tt(TRANSFER[x.state]??['Status unavailable','Estado no disponible'])),
   open?h('p',t('Takes effect no earlier than ','Surte efecto no antes del '),when(x.notBefore),t(' and only after the recipient’s payment is verified. Lapses on ',' y solo tras verificar el pago del destinatario. Caduca el '),when(x.expiresAt),'.'):null,
   x.blockableUntil&&open?h('p',t('The owner’s account had a recent security change, so any admin may block this offer until ','La cuenta del propietario tuvo un cambio de seguridad reciente, así que cualquier administrador puede bloquear esta oferta hasta el '),when(x.blockableUntil),'.').classes('org-note'):null,
   own.transfer?.objections?.length?h('ul',...own.transfer.objections.map((o,i)=>h('li',t('Objection by ','Objeción de '),plain(o.by?.sub),o.reason?[': ',plain(o.reason)]:null).key(String(i)))):null,
   decisions.includes('withdraw')?form([input('reason',t('Reason (optional)','Motivo (opcional)')),check('confirm',t('Withdraw this offer','Retirar esta oferta'))],'withdraw',t('Withdraw offer','Retirar oferta'),{},'withdraw'):null,
   decisions.includes('object')?form([input('reason',t('Objection','Objeción'),'',{required:true}),check('confirm',t('Record my objection and notify the owner and every admin','Registrar mi objeción y avisar al propietario y a cada administrador'))],'object',t('Object','Objetar'),{},'object'):null,
   decisions.includes('block')?form([input('reason',t('Reason','Motivo'),'',{required:true}),check('confirm',t('Block this offer','Bloquear esta oferta'))],'block',t('Block offer','Bloquear oferta'),{},'block'):null):null,
  decisions.includes('offer')?h('article',h('h3',t('Offer ownership','Ofrecer la propiedad')),
   h('p',t('Name one 3sln.me account. The recipient pays for a fresh period; your current subscription is then cancelled at once, and any refund is at 3sln.me’s discretion on request. You stay a member. Admins are notified and may object.','Indica una cuenta de 3sln.me. El destinatario paga un periodo nuevo; tu suscripción actual se cancela al momento y cualquier reembolso queda a criterio de 3sln.me si lo pides. Sigues siendo miembro. Se avisa a los administradores, que pueden objetar.')),
   m.offerDraft?null:form([input('handle',t('Recipient handle','Identificador del destinatario'),'',{required:true,autoComplete:'off',maxLength:40})],'offer-resolve',t('Find account','Buscar cuenta'),{},'offer-resolve'),
   m.offerDraft?form([h('p',t('Recipient: ','Destinatario: '),h('strong',plain('@'+m.offerDraft.handle))),h('label',h('input').props({name:'admin',type:'checkbox'}),h('span',t('Also offer the admin power (active 72 hours after the transfer)','Ofrecer también el poder de administración (activo 72 horas después de la transferencia)'))).classes('org-check'),check('confirm',t('Offer ownership to this account','Ofrecer la propiedad a esta cuenta'))],'offer',t('Send offer','Enviar oferta'),{},'offer'):null):null,
  own.recovery&&own.recovery.state!=='issued'?h('article',h('h3',t('Organization recovery file','Archivo de recuperación de la organización')),
   h('p',own.recovery.state==='rotation-pending'?t('The previous owner’s recovery file is being invalidated.','Se está invalidando el archivo de recuperación del propietario anterior.'):t('The previous owner’s file no longer works. Download a new one now.','El archivo del propietario anterior ya no funciona. Descarga uno nuevo ahora.')),
   decisions.includes('reissue-recovery')?form([check('confirm',t('Issue a new organization recovery file','Emitir un nuevo archivo de recuperación de la organización'))],'reissue-recovery',t('Get new recovery file','Obtener nuevo archivo'),{},'reissue-recovery'):null):null,
  own.moveCoolingUntil&&own.moveCoolingUntil>Date.now()?h('p',t('Organization moves are paused until ','Los traslados de la organización están en pausa hasta el '),when(own.moveCoolingUntil),t(' after the ownership change.',' tras el cambio de propiedad.')):null);
}
