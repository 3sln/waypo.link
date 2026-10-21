// DX-4, account-deletion-export.md §2/§6. Unmounted: account/route registration
// belongs to the coordinator. The executor persists returned evidence before advancing.
import {BillingError,assertOwner} from './catalog.mjs';
import {AppAction} from '../app/engine.mjs';
const PREFIX='billing/closure-cancel/',EVIDENCE='billing/closure-evidence-v1',FLAG='ACCOUNT_DELETION_ENABLED',MAX=200;
const bounded=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(value);
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const fail=(code='billing_provider_unavailable',message='Billing closure could not be verified. Please retry later.',status=503)=>{throw new BillingError(code,message,status);};
const missing=error=>error?.statusCode===404&&error?.error?.error==='ResourceNotFound';
const inactive=error=>['AlreadyCanceledSubscription','InactiveSubscription'].includes(error?.error?.error);
const states=new Set(['incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused']);
const paidEvents=new Set(['subscription.created','subscription.active','order.paid']);

export class BillingClosure {
 // §6 port: cancelAtPeriodEnd returns {set:[{subscriptionId,canceledAt}],uncertain,evidence};
 // uncancel(owner,set) returns {restored:[id],unrestored:[{subscriptionId,reason}],evidence}.
 // A transport passed as alert must reject unless it accepted the operator notice.
 constructor({billing,metadata=billing?.metadata,client,clock,flags,alert}={}){Object.assign(this,{billing,metadata,clientOverride:client,clock,flags,alert});}
 async guard(owner,mode='background',deleted=false){
  assertOwner(owner);const bound=await this.metadata.get('owner');if(bound!==owner)fail('forbidden','Account owner mismatch.',403);
  if(mode==='undo')return;
  const request=await this.metadata.get('deletion/request-v1'),existing=deleted||['scheduled','executing','held'].includes(request?.state)||Boolean(await this.metadata.get('deletion/fence-v1'));
  let allowed=false;try{const port=this.flags.for({subject:{kind:'account',owner}});allowed=mode==='new'||!existing?port.enabled(FLAG):port.background(FLAG);}catch{}
  if(!allowed)fail('account_deletion_disabled','Account deletion is not enabled.',503);
 }
 now(){const now=this.clock.now();if(!Number.isSafeInteger(now)||now<0)fail();return now;}
 async client(){try{return this.clientOverride??await this.billing.client();}catch{fail();}}
 async call(fn){try{return await fn();}catch(error){if(error instanceof BillingError)throw error;fail();}}
 async customer(client,owner){
  let customer;try{customer=await client.customers.getStateExternal(owner);}catch(error){if(missing(error))return null;fail();}
  if(!bounded(customer?.id)||customer.external_id!==owner||!bounded(customer.organization_id)||this.billing.config.POLAR_ORGANIZATION_ID&&customer.organization_id!==this.billing.config.POLAR_ORGANIZATION_ID||!Array.isArray(customer.active_subscriptions)||customer.active_subscriptions.length>MAX)fail();
  return customer;
 }
 subscription(value,owner,customer,id=value?.id){
  if(!customer||!bounded(id)||value?.id!==id||value.customer_id!==customer.id||value.customer?.id!==customer.id||value.customer.external_id!==owner||value.customer.organization_id!==customer.organization_id||!states.has(value.status)||typeof value.cancel_at_period_end!=='boolean'||value.ended_at!==null&&!date(value.ended_at)||value.canceled_at!==null&&!date(value.canceled_at)||!date(value.current_period_end))fail();
  return value;
 }
 live(value){return value.status!=='incomplete_expired'&&(value.status!=='canceled'||value.cancel_at_period_end)&&!(value.ended_at&&Date.parse(value.ended_at)<=this.now());}
 async list(fn){
  const items=[],seen=new Set();let count;
  for(let page=1;page<=2;page++){
   const result=await this.call(()=>fn({page,limit:100})),total=result?.pagination?.total_count;
   if(!Array.isArray(result?.items)||result.items.length>100||!Number.isSafeInteger(total)||total<0||total>MAX||count!==undefined&&count!==total)fail();count=total;
   for(const value of result.items){if(!bounded(value?.id)||seen.has(value.id))fail();seen.add(value.id);items.push(value);}
   if(items.length===count)return items;if(items.length>count||result.items.length!==100)fail();
  }fail();
 }
 async subscriptions(client,owner,customer){const values=await this.list(query=>client.subscriptions.list({...query,external_customer_id:owner}));return values.map(value=>this.subscription(value,owner,customer));}
 async checkouts(client,owner){
  const values=await this.list(query=>client.checkouts.list({...query,external_customer_id:owner,status:'open'}));
  for(const value of values)if(value.external_customer_id!==owner||value.status!=='open'||!date(value.expires_at)||this.billing.config.POLAR_ORGANIZATION_ID&&value.organization_id!==this.billing.config.POLAR_ORGANIZATION_ID)fail();
  if(values.length)fail('billing_checkout_open','An open checkout must expire before deletion can continue.',409);
 }
 binding(owner,customer){return {v:1,owner,server:this.billing.config.POLAR_SERVER,origin:this.billing.config.APP_ORIGIN,customerId:customer.id,organizationId:customer.organization_id};}
 matches(row,owner,customer){return row?.v===1&&row.owner===owner&&row.server===this.billing.config.POLAR_SERVER&&row.origin===this.billing.config.APP_ORIGIN&&row.customerId===customer.id&&row.organizationId===customer.organization_id;}
 async rows(){const rows=await this.metadata.list({prefix:PREFIX,limit:MAX+1});if(rows.size>MAX)fail();return [...rows.values()];}
 async evidence(owner,kind,input){const value={v:1,owner,kind,at:this.now(),...input};await this.metadata.put(EVIDENCE,value);return value;}
 async cancelAtPeriodEnd(owner){
  // New calls are targeted. Retries of an already scheduled request follow only the kill switch.
  const request=await this.metadata.get('deletion/request-v1');await this.guard(owner,request?.state==='scheduled'?'background':'new');
  const client=await this.client(),customer=await this.customer(client,owner),subscriptions=await this.subscriptions(client,owner,customer);
  const set=[],uncertain=[];
  for(const value of subscriptions){
   const key=PREFIX+value.id,prior=await this.metadata.get(key);if(prior&&!this.matches(prior,owner,customer))fail();
   if(prior?.state==='confirmed'&&value.cancel_at_period_end&&value.canceled_at===prior.canceledAt){set.push({subscriptionId:value.id,canceledAt:prior.canceledAt});continue;}
   if(prior&&['reserved','unknown'].includes(prior.state)&&value.cancel_at_period_end){uncertain.push(value.id);continue;}
   if(!this.live(value)||value.cancel_at_period_end)continue;
   const reserved=await this.metadata.transaction(async tx=>{const row=await tx.get(key);if(row?.state==='reserved'&&row.at+60000>this.now())return false;if((await tx.list({prefix:PREFIX,limit:MAX+1})).size>=MAX&&!row)fail();await tx.put(key,{...this.binding(owner,customer),subscriptionId:value.id,state:'reserved',at:this.now()});return true;});
   if(!reserved)fail('billing_closure_pending','A billing cancellation needs reconciliation.',503);
   try{
    const returned=this.subscription(await client.subscriptions.update(value.id,{cancel_at_period_end:true}),owner,customer,value.id);
    if(!returned.cancel_at_period_end||!date(returned.canceled_at))fail();
    await this.metadata.transaction(async tx=>{const row=await tx.get(key);if(!this.matches(row,owner,customer)||row.state!=='reserved')fail();await tx.put(key,{...row,state:'confirmed',canceledAt:returned.canceled_at});});
    set.push({subscriptionId:value.id,canceledAt:returned.canceled_at});
   }catch{
    // Never infer ownership from a provider timestamp after a lost response: a
    // portal cancellation could have raced it. A committed receipt remains ours.
    await this.metadata.transaction(async tx=>{const row=await tx.get(key);if(row?.state==='reserved')await tx.put(key,{...row,state:'unknown'});});fail();
   }
  }
  const evidence=await this.evidence(owner,'cancel-at-period-end',{set,uncertain});return {set,uncertain,evidence};
 }
 async uncancel(owner,ids=[]){
  await this.guard(owner,'undo');if(!Array.isArray(ids)||ids.length>MAX||ids.some(value=>!bounded(value?.subscriptionId)||!date(value.canceledAt)))fail('invalid_request','Cancellation evidence is required.',400);
  const client=await this.client(),customer=await this.customer(client,owner),restored=[],unrestored=[];
  // The journal also recovers a successful cancellation whose account reply was lost.
  const rows=await this.rows();for(const item of ids)if(!rows.some(row=>row.subscriptionId===item.subscriptionId&&row.canceledAt===item.canceledAt))fail('invalid_request','Cancellation evidence does not belong to this request.',400);
  for(const row of rows){
   if(!['confirmed','reserved','unknown'].includes(row.state))continue;
   if(!customer){unrestored.push({subscriptionId:row.subscriptionId,reason:'ended'});continue;}
   if(!this.matches(row,owner,customer))fail();
   const value=this.subscription(await this.call(()=>client.subscriptions.get(row.subscriptionId)),owner,customer,row.subscriptionId);
   let reason;if(row.state!=='confirmed')reason='uncertain';else if(!this.live(value)||Date.parse(value.current_period_end)<=this.now())reason='ended';else if(!value.cancel_at_period_end||value.canceled_at!==row.canceledAt)reason='changed';
   if(reason){unrestored.push({subscriptionId:row.subscriptionId,reason});await this.metadata.put(PREFIX+row.subscriptionId,{...row,state:'skipped',reason});continue;}
   const returned=this.subscription(await this.call(()=>client.subscriptions.update(value.id,{cancel_at_period_end:false})),owner,customer,value.id);if(returned.cancel_at_period_end)fail();
   await this.metadata.put(PREFIX+row.subscriptionId,{...row,state:'restored'});restored.push(value.id);
  }
  return {restored,unrestored,evidence:await this.evidence(owner,'uncancel',{restored,unrestored})};
 }
 async revokeAll(owner,{deleted=false}={}){
  await this.guard(owner,'background',deleted);
  // A late webhook must not rematerialize billing metadata on a wiped account.
  if(!deleted)await this.call(()=>this.billing.reconcile(owner));
  const client=await this.client(),customer=await this.customer(client,owner),subscriptions=await this.subscriptions(client,owner,customer),revoked=[];
  for(const value of subscriptions){if(!this.live(value))continue;
   try{this.subscription(await client.subscriptions.revoke(value.id),owner,customer,value.id);}catch(error){if(!inactive(error))fail();}
   const checked=this.subscription(await this.call(()=>client.subscriptions.get(value.id)),owner,customer,value.id);if(this.live(checked))fail();revoked.push(value.id);
  }
  await this.checkouts(client,owner);
  const checked=await this.customer(client,owner);if(checked?.active_subscriptions.length||(await this.subscriptions(client,owner,checked)).some(value=>this.live(value)))fail();
  const evidence={revoked,customerId:checked?.id??null,activeSubscriptions:0,openCheckouts:0};
  return deleted?{v:1,owner,kind:'revoke',at:this.now(),...evidence}:this.evidence(owner,'revoke',evidence);
 }
 async anonymize(owner){
  await this.guard(owner);const stopped=await this.revokeAll(owner),client=await this.client();
  try{await client.customers.deleteExternal(owner,{anonymize:true});}catch(error){if(!missing(error))fail();}
  if(await this.customer(client,owner))fail();
  return this.evidence(owner,'anonymize',{customerId:stopped.customerId,anonymized:true});
 }
 async webhook(owner,verified,{deleted=false}={}){
  await this.guard(owner,'background',deleted);if(verified?.owner!==owner||!bounded(verified.id)||typeof verified.type!=='string')fail('invalid_webhook','Verified webhook descriptor is invalid.',400);
  if(!paidEvents.has(verified.type)||!deleted&&!await this.metadata.get('deletion/fence-v1'))return {accepted:true,ignored:true};
  // Attempt the alert even when cleanup fails. A failed transport never prevents
  // revocation, but the webhook stays retryable until both effects are accepted.
  let alerted=false;try{if(typeof this.alert==='function'){await this.alert({type:'billing-after-deletion',owner,eventId:verified.id,eventType:verified.type,at:this.now()});alerted=true;}}catch{}
  const evidence=await this.revokeAll(owner,{deleted});if(!alerted)fail('billing_alert_unavailable','Billing closure alert transport is unavailable.',503);
  return {accepted:true,revoked:true,evidence};
 }
}

// Internal system Actions, never owner-callable RPCs. They use existing catalogue
// providers so this owned-file slice needs no shared registry edits. billingProvider
// is the SDK client; billing is the existing BillingService used for reconciliation.
// The composition must supply billing.closureAlert(entry) for an operator alert;
// the engine's audit interceptor alone is not an alert transport.
class ClosureAction extends AppAction {
 static deps=['accountStore','billing','billingProvider','clock','flags'];static lifecycle='purging';static termsGate='exempt';
 run({accountStore,billing,billingProvider,clock,flags}){
  if(this.actor?.kind!=='system'||typeof this.actor.reason!=='string'||!this.actor.reason)fail('forbidden','Billing closure requires a system actor.',403);
  const closure=new BillingClosure({billing,metadata:accountStore,client:billingProvider,clock,flags,alert:typeof billing.closureAlert==='function'?entry=>billing.closureAlert(entry):undefined});
  return this.apply(closure,assertOwner(this.actor.owner));
 }
}
export class CancelBillingAtPeriodEnd extends ClosureAction {static operation='billing.closure-cancel';apply(closure,owner){return closure.cancelAtPeriodEnd(owner);}}
export class UncancelBillingClosure extends ClosureAction {static operation='billing.closure-uncancel';apply(closure,owner){return closure.uncancel(owner,this.input?.set);}}
export class RevokeBillingClosure extends ClosureAction {static operation='billing.closure-revoke';apply(closure,owner){return closure.revokeAll(owner);}}
export class AnonymizeBillingClosure extends ClosureAction {static operation='billing.closure-anonymize';apply(closure,owner){return closure.anonymize(owner);}}
export class ClosureBillingWebhook extends ClosureAction {static operation='billing.closure-webhook';apply(closure,owner){return closure.webhook(owner,this.input?.verified,{deleted:this.input?.deleted===true});}}
export const BILLING_CLOSURE_OPERATIONS=Object.freeze([CancelBillingAtPeriodEnd,UncancelBillingClosure,RevokeBillingClosure,AnonymizeBillingClosure,ClosureBillingWebhook]);
