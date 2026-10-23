import {capability} from './flags.mjs';
// AccountController slice 7, Billing (docs/architecture/app-engine.md §12): entitlement, plan changes, checkout and verified webhooks.
// `methods` are installed on AccountController.prototype (`this` is the controller); `rpc` lists the methods
// `invoke` accepts and the placement policy it applies to each (packages/runtime/account/index.mjs).
import {rememberEverPaid,everPaidEvent} from '../../identity/lifecycle-protection.mjs';
import {PaidSignupBilling} from '../../billing/setup.mjs';
import {StorageError} from '../../storage/policy.mjs';
import {BillingClosure,paidEvents} from '../../billing/closure.mjs';
import {flagsFor} from './flags.mjs';
import {lifecycleLog} from '../lifecycle-runner.mjs';
// DX-4 guard: no new purchase or upgrade while an account deletion is scheduled or executing (§2.1).
async function refuseWhileDeleting(c){if(['scheduled','executing'].includes((await c.metadata.get('deletion/request-v1'))?.state))throw new StorageError('deletion_scheduled','Account deletion is scheduled. Cancel it to change your plan.',409);}

export const methods={
  async paidHandleEligibility(owner){return this.billing.paidHandleEligibility(owner);},
  async billingRefresh(owner,{force=false}={}){if(typeof owner!=='string'||!/^[a-f0-9-]{36}$/.test(owner)||await this.metadata.get('owner')!==owner)throw new StorageError('forbidden','Account owner mismatch.',403);if(!capability(this.config,'BILLING_ENABLED'))return {checked:false,disabled:true};const previous=await this.metadata.get('billing/state'),pending=await this.metadata.get('billing/pending'),now=this.billing.now();if(!force&&(!previous||previous.owner!==owner||previous.plan==='free')&&(!pending||pending.owner!==owner||pending.expiresAt<=now))return {checked:false};const attempted=await this.metadata.get('billing/sync-attempt');if(Number.isSafeInteger(attempted)&&attempted>now-(force?15000:300000))return await this.metadata.get('billing/sync')??{checked:false};if(this.billingSyncPending)return this.billingSyncPending;this.billingSyncPending=(async()=>{await this.metadata.put('billing/sync-attempt',now);let result;try{const entitlement=await this.billing.reconcile(owner);result={checked:true,checkedAt:now,...entitlement};}catch(error){result={checked:false,checkedAt:now,error:error.code||'billing_provider_unavailable',validUntil:(await this.billing.entitlement(owner)).validUntil};}await this.metadata.put('billing/sync',result);return result;})().finally(()=>this.billingSyncPending=null);return this.billingSyncPending;},
  async billingStatus(owner,options){await this.billingRefresh(owner,{force:true});const result=await this.billing.status(owner,options);return {...result,plans:result.plans.map(plan=>({...plan,...this.workBudget?{dailyActivityUnits:plan.id==='free'?this.workBudget.limits.freeDay:(plan.activityDay??this.workBudget.limits.paidDay),hourlyActivityUnits:plan.id==='free'?this.workBudget.limits.freeHour:(plan.activityHour??this.workBudget.limits.paidHour)}:{}}))};},
  async billingCancelChange(owner,input){await this.warm(owner);return this.billing.changes.cancel(owner,input);},
  async billingChangePlan(owner,input){await this.warm(owner);await refuseWhileDeleting(this);return this.billing.changes.change(owner,input);},
  async billingCheckout(owner,plan,options){await refuseWhileDeleting(this);return this.billing.checkout(owner,plan,options);},
  async setupBillingCheckout(owner,admission,input){await this.warm(owner);return new PaidSignupBilling(this.billing).checkout(owner,admission,input);},
  async setupBillingStatus(owner,admission){await this.warm(owner);return new PaidSignupBilling(this.billing).status(owner,admission);},
  async billingPortal(owner){return this.billing.portal(owner);},
  async billingWebhookVerified(owner,event){if(event.owner!==owner)throw new StorageError('forbidden','Billing account mismatch.',403);if(await this.metadata.get('owner')!==owner)return {accepted:true,ignored:true};
    // An organization's account is the Polar customer for organization plans: its writer reconciles them (packages/orgs/ownership.mjs).
    if((await this.metadata.get('org/record-v1'))?.kind==='organization')return this.orgsBillingWebhook(owner,event);
    // DX-4: a new paid event while a committed deletion runs triggers revokeAll and an operator alert (R1-L2).
    if(paidEvents.has(event.type)&&await this.metadata.get('deletion/fence-v1')!==undefined)return new BillingClosure({billing:this.billing,metadata:this.metadata,clock:{now:()=>Date.now()},flags:{for:ctx=>flagsFor(this.config,ctx)},alert:async entry=>lifecycleLog(this.config,{kind:'account-deletion',action:'operator-alert',...entry})}).webhook(owner,{owner,id:event.id,type:event.type});if(everPaidEvent(event))await rememberEverPaid(this.metadata,owner,{source:'webhook',evidence:event.type});/* Lifecycle protection: any order/refund/subscription for any product, before relevance filtering. */const prior=await this.metadata.get('billing/state'),retained=prior?.owner===owner&&prior.source==='polar'&&(prior.catalogVersion!==3||prior.origin===this.config.APP_ORIGIN&&prior.server===this.config.POLAR_SERVER&&prior.metadataPrefix===(this.config.POLAR_METADATA_PREFIX??'3sln_me_')&&prior.catalogMode===(this.config.POLAR_CATALOG_MODE??'static'))&&(!event.organizationId||prior.organizationId===event.organizationId)&&prior.customerId===event.customerId&&(event.customerEvent?Boolean(prior.productId&&prior.subscriptionId):prior.productId===event.productId&&(!event.subscriptionId||prior.subscriptionId===event.subscriptionId));if(!event.relevant&&!retained)return {accepted:true,ignored:true};return this.billing.applyWebhook(event);},
};

export const rpc={
 paidHandleEligibility:{lifecycle:'suspended'},
 billingRefresh:{lifecycle:'purging'},
 billingStatus:{lifecycle:'purging'},
 billingChangePlan:{lifecycle:'suspended'},
 billingCancelChange:{lifecycle:'suspended'},
 billingCheckout:{lifecycle:'suspended'},
 setupBillingCheckout:{},
 setupBillingStatus:{lifecycle:'suspended'},
 billingPortal:{},
 billingWebhookVerified:{lifecycle:'purging'},
};
