// Organization plans and billing (docs/architecture/organizations-design.md ORG-D18, ORG-D21, §12a, §12b.1, §12b.3,
// §12b.3a). SANDBOX ONLY: `organizationBillingConfiguration` refuses every server but Polar's sandbox, so nothing here
// can take a live payment. Offline tests prove local behaviour; they do not prove provider conformance or delivery.
//
// The organization is the Polar customer (`external_customer_id` = the organization's account UUID). Each checkout is
// created by one 3sln.me person account. Its metadata names that person (`<prefix>org_owner`), the purpose
// (`create` | `transfer` | `claim` | `renew`) and a binding (the creation request, transfer or claim id). Polar copies
// checkout metadata onto the subscription and its orders (pinned @polar-sh/sdk 1.0.2, CheckoutCreate). The owner of
// record (§12b.1 item 1) is therefore read from the verified subscription, never from the customer email or the card.
//
// This module only talks to Polar. It holds no state. The organization's account writer (packages/orgs/ownership.mjs)
// owns every decision, and stores the verified snapshot this module returns.
import {BillingError,billingEnabled,metadataPrefix} from './catalog.mjs';
import {POLAR_CURRENCIES,priceExponent} from './currencies.mjs';

/**
 * PROVISIONAL PRODUCT DATA (coordinator, 2026-10-23; not signed off by the user, not reviewed pricing). Tiers first,
 * metering later (ORG-D18). Storage runs up to 100 TB at the top tier (§12a). Raw R2 Standard storage alone is about
 * $180, $1,800 and $18,000 a year for these three sizes. Prices keep a contribution margin of at least 50% in the
 * worst case (full occupancy, every AI credit spent, international cards, support): `organizationEconomics` in
 * scripts/cost-model.mjs and unit-economics.md. A second stored copy (backup) is not covered by these prices. `aiCreditsMonthly` are units of the semantic-spend work budget; `members` counts members, foreign members included.
 * Amounts are USD cents a year. Every figure is a placeholder for the sandbox and stays revisable.
 */
export const ORGANIZATION_PLANS=Object.freeze({
 'org-team':Object.freeze({id:'org-team',name:'Team',storageBytes:1_000_000_000_000,aiCreditsMonthly:20_000,members:50,annualAmount:120_000,currency:'usd',provisional:true}),
 'org-business':Object.freeze({id:'org-business',name:'Business',storageBytes:10_000_000_000_000,aiCreditsMonthly:200_000,members:500,annualAmount:720_000,currency:'usd',provisional:true}),
 'org-scale':Object.freeze({id:'org-scale',name:'Scale',storageBytes:100_000_000_000_000,aiCreditsMonthly:2_000_000,members:5_000,annualAmount:6_000_000,currency:'usd',provisional:true})
});
export const ORGANIZATION_PLAN_IDS=Object.freeze(Object.keys(ORGANIZATION_PLANS));
export const ORGANIZATION_PURPOSES=Object.freeze(['create','transfer','claim','renew']);
/** Product metadata value marking an organization product in metadata catalog mode. The person catalog skips these. */
export const ORGANIZATION_CATALOG_MARK='organization';
const MAX_STORAGE=100_000_000_000_000,BOUNDED=/^[A-Za-z0-9_-]{1,200}$/,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const bounded=value=>typeof value==='string'&&BOUNDED.test(value);
const unavailable=(message='Organization billing could not be verified. Please retry later.')=>new BillingError('billing_provider_unavailable',message,503);
const timestamp=value=>typeof value==='string'?Date.parse(value):NaN;
const KEYS={owner:'org_owner',purpose:'org_purpose',binding:'org_binding',org:'org'};
export const organizationProductIds=config=>({'org-team':config.POLAR_PRODUCT_ID_ORG_TEAM,'org-business':config.POLAR_PRODUCT_ID_ORG_BUSINESS,'org-scale':config.POLAR_PRODUCT_ID_ORG_SCALE});

/** Throws unless organization billing may run: billing on, the Polar SANDBOX, credentials and a complete catalog. */
export function organizationBillingConfiguration(config){
 const prefix=metadataPrefix(config);
 if(!billingEnabled(config))throw new BillingError('billing_disabled','Billing is not enabled.',503);
 if(config.POLAR_SERVER!=='sandbox')throw new BillingError('billing_unconfigured','Organization billing is available only in the Polar sandbox.',503);
 if(!config.POLAR_ACCESS_TOKEN||!config.POLAR_WEBHOOK_SECRET)throw new BillingError('billing_unconfigured','Organization billing configuration is incomplete.',503);
 if(config.POLAR_CATALOG_MODE==='metadata'){if(!bounded(config.POLAR_ORGANIZATION_ID))throw new BillingError('billing_unconfigured','Organization billing configuration is incomplete.',503);return {mode:'metadata',prefix};}
 const ids=Object.values(organizationProductIds(config));
 if(ids.some(id=>!bounded(id))||new Set(ids).size!==ids.length)throw new BillingError('billing_unconfigured','Organization billing configuration is incomplete.',503);
 return {mode:'static',prefix};
}
export function organizationBillingConfigured(config){try{organizationBillingConfiguration(config);return true;}catch{return false;}}
export function validOrganizationPlanParameters(p){
 return p&&ORGANIZATION_PLAN_IDS.includes(p.id)&&typeof p.name==='string'&&p.name.length>0&&p.name.length<=100&&!/[\u0000-\u001f\u007f]/.test(p.name)
  &&Number.isSafeInteger(p.storageBytes)&&p.storageBytes>0&&p.storageBytes<=MAX_STORAGE&&Number.isSafeInteger(p.aiCreditsMonthly)&&p.aiCreditsMonthly>=0&&p.aiCreditsMonthly<=1_000_000_000
  &&Number.isSafeInteger(p.members)&&p.members>0&&p.members<=1_000_000;
}
/** Whether a verified Polar event concerns an organization product (routing hint only; the writer re-verifies). */
export function organizationProductEvent(event,config){
 if(!organizationBillingConfigured(config))return false;
 const prefix=metadataPrefix(config),ids=Object.values(organizationProductIds(config)).filter(Boolean);
 return Boolean(event?.productId&&ids.includes(event.productId)||event?.productMetadata?.[prefix+'catalog']===ORGANIZATION_CATALOG_MARK||(event?.productIds??[]).some(id=>ids.includes(id)));
}

export class OrganizationBilling{
 constructor({config,client,now=Date.now}){Object.assign(this,{config,clientOverride:client,now});this.cache=null;}
 configured(){return organizationBillingConfigured(this.config);}
 async client(){organizationBillingConfiguration(this.config);if(this.clientOverride)return this.clientOverride;if(!this.sdk){const {createPolar}=await import('@polar-sh/sdk/2026-10');this.sdk=createPolar({accessToken:this.config.POLAR_ACCESS_TOKEN,environment:'sandbox',timeout:5});}return this.sdk;}
 key(name){return metadataPrefix(this.config)+KEYS[name];}
 /** The verified organization catalog: three annual, fixed-price products in one Polar organization. Cached 5 min. */
 async catalog(){
  const {mode,prefix}=organizationBillingConfiguration(this.config);
  if(this.cache&&this.cache.expiresAt>this.now())return this.cache;
  const client=await this.client(),ids=organizationProductIds(this.config);let products;
  try{
   if(mode==='metadata'){
    const found=new Map();let total;
    for(let page=1;page<=2;page++){const result=await client.products.list({organization_id:this.config.POLAR_ORGANIZATION_ID,limit:100,page});if(!Array.isArray(result?.items)||!Number.isSafeInteger(result.pagination?.total_count)||result.pagination.total_count>200)throw unavailable();total=result.pagination.total_count;
     for(const product of result.items){const meta=product?.metadata;if(product?.organization_id!==this.config.POLAR_ORGANIZATION_ID)throw unavailable();if(meta?.[prefix+'service']!==this.config.APP_ORIGIN||meta?.[prefix+'catalog']!==ORGANIZATION_CATALOG_MARK||product.is_archived===true)continue;const plan=meta[prefix+'plan'];if(!ORGANIZATION_PLAN_IDS.includes(plan)||found.has(plan))throw new BillingError('billing_catalog_mismatch','Organization product metadata is invalid.',503);found.set(plan,product);}
     if(page*100>=total)break;}
    products=ORGANIZATION_PLAN_IDS.map(plan=>found.get(plan));
   }else products=await Promise.all(ORGANIZATION_PLAN_IDS.map(plan=>client.products.get(ids[plan])));
  }catch(error){if(error instanceof BillingError)throw error;throw unavailable();}
  const entries={};let organizationId;
  for(const [i,plan] of ORGANIZATION_PLAN_IDS.entries()){
   const product=products[i],expected=ORGANIZATION_PLANS[plan],mismatch=reason=>{throw new BillingError('billing_catalog_mismatch',`${expected.name} organization plan: ${reason}`,503);};
   if(!product)mismatch('No active product is configured.');
   if(!bounded(product.id)||mode==='static'&&product.id!==ids[plan])mismatch('The product identifier does not match the configured catalog.');
   if(product.is_archived!==false||product.is_recurring!==true||product.recurring_interval!=='year'||product.recurring_interval_count!==1)mismatch('The product must be active with one annual recurring price.');
   if(!bounded(product.organization_id)||organizationId&&organizationId!==product.organization_id)mismatch('The product organization does not match.');
   let parameters={id:plan,name:expected.name,storageBytes:expected.storageBytes,aiCreditsMonthly:expected.aiCreditsMonthly,members:expected.members};
   if(mode==='metadata'){const n=v=>typeof v==='string'&&/^\d{1,16}$/.test(v)?Number(v):v,m=product.metadata;parameters={id:plan,name:product.name,storageBytes:n(m[prefix+'storage_bytes']),aiCreditsMonthly:n(m[prefix+'ai_credits']),members:n(m[prefix+'members'])};}
   if(!validOrganizationPlanParameters(parameters))mismatch('Plan parameters are outside the documented bounds.');
   const prices=Object.create(null);
   if(!Array.isArray(product.prices)||product.prices.length<1||product.prices.length>256)mismatch('The product needs a bounded set of fixed prices.');
   for(const price of product.prices){if(price?.is_archived===true)continue;const currency=price?.price_currency;
    if(price?.is_archived!==false||price.source!=='catalog'||price.amount_type!=='fixed'||price.product_id!==product.id||!bounded(price.id)||!POLAR_CURRENCIES.includes(currency)||Object.hasOwn(prices,currency)||!Number.isSafeInteger(price.price_amount)||price.price_amount<1||price.price_amount>1_000_000_000)mismatch('Every active price must be one fixed catalog price per currency.');
    prices[currency]={priceId:price.id,currency,amount:price.price_amount,exponent:priceExponent(currency)};}
   if(!prices.usd)mismatch('A fixed USD price is required.');
   if(mode==='static'&&prices.usd.amount!==expected.annualAmount)mismatch('The USD price does not match the provisional catalog amount.');
   organizationId=product.organization_id;entries[plan]={id:product.id,prices,parameters};
  }
  this.cache={organizationId,entries,server:'sandbox',provisional:true,expiresAt:this.now()+300000};return this.cache;
 }
 /** The plans as the console shows them, priced in one currency (USD unless every plan has the requested one). */
 async plans(currency='usd'){const catalog=await this.catalog(),selected=Object.values(catalog.entries).every(e=>Object.hasOwn(e.prices,currency))?currency:'usd';return {server:'sandbox',provisional:true,currency:selected,plans:ORGANIZATION_PLAN_IDS.map(id=>({...catalog.entries[id].parameters,provisional:true,price:{...catalog.entries[id].prices[selected],taxBehavior:'checkout'}}))};}
 returnURL(path){
  let url;try{url=new URL(this.config.APP_ORIGIN);}catch{throw new BillingError('billing_unconfigured','The app origin is unavailable.',503);}
  if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||url.protocol!=='https:'&&!(this.config.LOCAL_DEVELOPMENT==='true'&&url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new BillingError('billing_unconfigured','The app origin is invalid.',503);
  if(typeof path!=='string'||!/^\/console\?[A-Za-z0-9_=&%.-]{1,300}$/.test(path))throw new BillingError('invalid_request','Unsupported return path.',400);
  return url.origin+path;
 }
 /**
  * A checkout for organization `org`, created by person `owner` for `purpose`/`binding`. The session is verified
  * against the displayed price and the metadata binding before its URL is returned. Never proof of payment.
  */
 async checkout(org,{owner,plan,currency='usd',purpose,binding,returnPath,locale}={}){
  if(!UUID.test(org??'')||!UUID.test(owner??'')||org===owner||!ORGANIZATION_PURPOSES.includes(purpose)||!bounded(binding))throw new BillingError('invalid_request','Unsupported organization checkout.',400);
  if(!ORGANIZATION_PLAN_IDS.includes(plan))throw new BillingError('invalid_plan','Choose an organization plan.',400);
  const catalog=await this.catalog(),entry=catalog.entries[plan],price=entry.prices[currency];if(!price)throw new BillingError('invalid_currency','Choose an available billing currency.',400);
  const url=this.returnURL(returnPath),client=await this.client(),metadata={[this.key('owner')]:owner,[this.key('purpose')]:purpose,[this.key('binding')]:binding,[this.key('org')]:org};
  let hints={};if(locale!==undefined){try{const value=Intl.getCanonicalLocales(locale)[0];if(value&&value.length<=100)hints={locale:value};}catch{}}
  let session;try{session=await client.checkouts.create({products:[entry.id],external_customer_id:org,currency,metadata,success_url:url,return_url:url,allow_trial:false,allow_discount_codes:false,...hints});}catch{throw unavailable();}
  if(!bounded(session?.id)||session.product_id!==entry.id||session.organization_id!==catalog.organizationId||session.external_customer_id!==org||session.currency!==currency||session.amount!==price.amount||session.allow_discount_codes!==false||session.discount_amount!==0
   ||!Number.isSafeInteger(session.net_amount)||!Number.isSafeInteger(session.total_amount)||session.tax_amount!==null&&(!Number.isSafeInteger(session.tax_amount)||session.tax_amount<0)||![null,'inclusive','exclusive'].includes(session.tax_behavior)
   ||session.total_amount!==session.net_amount+(session.tax_amount??0)||(session.tax_behavior==='inclusive'?session.total_amount:session.net_amount)!==price.amount||Object.entries(metadata).some(([k,v])=>session.metadata?.[k]!==v))throw new BillingError('billing_checkout_mismatch','Checkout does not match the displayed organization price.',503);
  let target;try{target=new URL(session.url);}catch{throw unavailable();}
  if(target.protocol!=='https:'||target.hostname!=='sandbox.polar.sh'||target.username||target.password||target.port)throw unavailable();
  return {checkoutId:session.id,url:target.href,server:'sandbox',plan,currency,amount:price.amount,expiresAt:Number.isFinite(timestamp(session.expires_at))?timestamp(session.expires_at):this.now()+86400000};
 }
 /**
  * The organization's verified subscriptions. `known` names the subscriptions the writer already tracks, so a revoked
  * or ended one is still observed after it leaves the customer's active list: an id list, or `{[id]: {amount, currency}}`
  * with the terms from each one's first verification. A known subscription is checked against the price it was bought
  * at, never against today's catalog, so archiving or repricing a catalog price cannot drop a paying subscription.
  * A subscription failing any check is never trusted; a KNOWN one that is gone (404) or fails a check is reported in
  * `unverified` ({id, reason:'missing'|'unverifiable'}) so the writer can hold it for an operator instead of reading it
  * as unpaid. A NEW subscription to an organization product that fails a check is reported too, with `unknown: true`
  * (review item 3), instead of being dropped. `paid` means a signature-independent provider read shows a captured
  * order for the current period that is not fully refunded.
  * Capacity (F-05): at most 16 subscriptions that still count (new ones and known ones not marked `settled`, i.e. not
  * revoked or refunded by the writer), and at most 64 in all; the writer forgets settled, ended ones.
  */
 async state(org,{known=[]}={}){
  if(!UUID.test(org??''))throw new BillingError('invalid_request','Unsupported organization.',400);
  const terms=new Map(Array.isArray(known)?known.filter(bounded).map(id=>[id,null]):Object.entries(known??{}).filter(([id])=>bounded(id)).map(([id,t])=>[id,typeof t?.currency==='string'&&Number.isSafeInteger(t?.amount)?{currency:t.currency,amount:t.amount}:null]));
  const settled=new Set(Array.isArray(known)?[]:Object.entries(known??{}).filter(([id,t])=>bounded(id)&&t?.settled===true).map(([id])=>id));
  const catalog=await this.catalog(),client=await this.client();let customer;
  try{customer=await client.customers.getStateExternal(org);}catch(error){if(error?.statusCode===404)return {customerId:null,subscriptions:[],unverified:[...terms.keys()].sort().map(id=>({id,reason:'missing'})),reconciledAt:this.now(),server:'sandbox'};throw unavailable();}
  if(customer?.external_id!==org||customer.organization_id!==catalog.organizationId||!bounded(customer.id)||!Array.isArray(customer.active_subscriptions)||customer.active_subscriptions.length>100)throw unavailable();
  const ids=new Set([...customer.active_subscriptions.map(s=>s?.id),...terms.keys()]);if([...ids].some(id=>!bounded(id)))throw unavailable();
  if([...ids].filter(id=>!settled.has(id)).length>16||ids.size>64)throw new BillingError('billing_subscription_capacity','Organization subscriptions need operator reconciliation.',503);
  const subscriptions=[],unverified=[];
  for(const id of ids){
   let s;try{s=await client.subscriptions.get(id);}catch(error){if(error?.statusCode===404){if(terms.has(id))unverified.push({id,reason:'missing'});continue;}throw unavailable();}
   const verified=await this.verify(org,s,customer,catalog,terms.get(id)??null);if(verified)subscriptions.push(verified);else if(terms.has(id))unverified.push({id,reason:'unverifiable'});
   else if(ORGANIZATION_PLAN_IDS.some(plan=>catalog.entries[plan].id===s?.product_id))unverified.push({id,reason:'unverifiable',unknown:true});
  }
  subscriptions.sort((a,b)=>a.id.localeCompare(b.id));unverified.sort((a,b)=>a.id.localeCompare(b.id));
  return {customerId:customer.id,subscriptions,unverified,reconciledAt:this.now(),server:'sandbox'};
 }
 /** `pinned`: the {amount, currency} of the subscription's first verification (then today's catalog is not consulted). */
 async verify(org,s,customer,catalog,pinned=null){
  if(!s||!bounded(s.id)||s.customer_id!==customer.id||s.customer?.external_id!==org||s.customer?.organization_id!==catalog.organizationId)return null;
  const plan=ORGANIZATION_PLAN_IDS.find(id=>catalog.entries[id].id===s.product_id),meta=s.metadata??{};if(!plan)return null;
  const owner=meta[this.key('owner')],purpose=meta[this.key('purpose')],binding=meta[this.key('binding')];
  if(!UUID.test(owner??'')||!ORGANIZATION_PURPOSES.includes(purpose)||!bounded(binding)||meta[this.key('org')]!==org)return null;
  if(s.recurring_interval!=='year'||s.recurring_interval_count!==1||!Number.isSafeInteger(s.amount)||s.amount<1)return null;
  if(pinned?s.currency!==pinned.currency||s.amount!==pinned.amount:catalog.entries[plan].prices[s.currency]?.amount!==s.amount)return null;
  const start=timestamp(s.current_period_start),end=timestamp(s.current_period_end),ends=s.ends_at?timestamp(s.ends_at):end,ended=s.ended_at?timestamp(s.ended_at):null;
  if(!Number.isFinite(start)||!Number.isFinite(end)||!Number.isFinite(ends)||end<=start||ended!==null&&!Number.isFinite(ended))return null;
  const order=await this.periodPayment(s,catalog,start);
  return {id:s.id,plan,productId:s.product_id,owner,purpose,binding,status:String(s.status),currency:s.currency,amount:s.amount,periodStart:start,periodEnd:end,validUntil:Math.min(end,ends),
   cancelAtPeriodEnd:s.cancel_at_period_end===true,endedAt:ended,paid:order.paid,orderId:order.orderId??null,refunded:order.refunded,netAmount:order.netAmount??null};
 }
 /** The order paying for the subscription's current period: the latest order created at or after `periodStart` (with a
  * day's tolerance), else the latest order. Only a void, a full refund or a refund of at least that order's net amount
  * marks it refunded; a partial (goodwill) refund leaves it paid. A refund of an EARLIER period's order does not mark
  * the current period refunded (review item 4). Amounts must be self-consistent across every order. */
 async periodPayment(s,catalog,periodStart){
  let result;try{result=await (await this.client()).orders.list({organization_id:catalog.organizationId,subscription_id:s.id,limit:20,page:1,sorting:['created_at']});}catch{throw unavailable();}
  if(!Array.isArray(result?.items)||result.items.length>20)throw unavailable();
  const orders=[];
  for(const o of result.items){
   if(!bounded(o?.id)||o.subscription_id!==s.id||o.product_id!==s.product_id||o.customer_id!==s.customer_id||o.currency!==s.currency)continue;
   const money=['net_amount','tax_amount','total_amount','refunded_amount'];if(!money.every(k=>Number.isSafeInteger(o[k])&&o[k]>=0)||o.net_amount+o.tax_amount!==o.total_amount)throw unavailable();
   orders.push(o);
  }
  const at=o=>{const t=timestamp(o.created_at);return Number.isFinite(t)?t:-Infinity;},sorted=orders.map((o,i)=>[o,i]).sort((a,b)=>at(a[0])-at(b[0])||a[1]-b[1]).map(([o])=>o);
  const inPeriod=sorted.filter(o=>at(o)>=periodStart-86400000),o=(inPeriod.length?inPeriod:sorted).at(-1);
  if(!o)return {paid:false,orderId:undefined,refunded:false,netAmount:undefined};
  const refunded=['refunded','void'].includes(o.status)||o.refunded_amount>0&&o.refunded_amount>=o.net_amount;
  const paid=!refunded&&['paid','partially_refunded'].includes(o.status)&&o.paid===true&&o.net_amount>0;
  return {paid,orderId:o.id,refunded,netAmount:o.net_amount};
 }
 /** A full refund of EVERY order of a subscription (review follow-up 6: a claim or transfer refund covers every order
  * bound to it, renewals included, not only the first). Idempotent: each order is refunded only for what is not yet
  * refunded, re-read from the provider. */
 async refundAll(org,{subscriptionId,reason='other',comment}={}){
  if(!bounded(subscriptionId))throw new BillingError('invalid_request','Unsupported refund.',400);
  const catalog=await this.catalog(),client=await this.client();let result;
  try{result=await client.orders.list({organization_id:catalog.organizationId,subscription_id:subscriptionId,limit:20,page:1,sorting:['created_at']});}catch{throw unavailable();}
  if(!Array.isArray(result?.items)||result.items.length>20)throw unavailable();
  let amount=0;
  for(const listed of result.items){
   if(!bounded(listed?.id)||listed.subscription_id!==subscriptionId||listed.paid!==true||['refunded','void'].includes(listed.status))continue;
   const out=await this.refund(org,{subscriptionId,orderId:listed.id,reason,comment});amount+=out.already?0:out.amount??0;
  }
  return {refunded:true,amount};
 }
 /** Cancels a subscription at once (not at period end). Idempotent: an already ended subscription is left alone. */
 async revoke(org,subscriptionId){
  if(!bounded(subscriptionId))throw new BillingError('invalid_request','Unsupported subscription.',400);
  const client=await this.client();let s;try{s=await client.subscriptions.get(subscriptionId);}catch(error){if(error?.statusCode===404)return {revoked:true,missing:true};throw unavailable();}
  if(s?.customer?.external_id!==org)throw unavailable('The subscription does not belong to this organization.');
  if(s.ended_at&&timestamp(s.ended_at)<=this.now()||['canceled','revoked'].includes(s.status)&&s.cancel_at_period_end!==true)return {revoked:true,already:true};
  let r;try{r=await client.subscriptions.revoke(subscriptionId);}catch{throw unavailable();}
  if(r?.id!==subscriptionId||r.customer?.external_id!==org)throw unavailable();return {revoked:true};
 }
 /** A full refund of a subscription's first order (the failed-transfer rule, §12b.3a): whatever of the net amount is not
  * yet refunded. Idempotent by re-reading the order. */
 async refund(org,{subscriptionId,orderId,reason='other',comment}={}){
  if(!bounded(orderId)||!bounded(subscriptionId))throw new BillingError('invalid_request','Unsupported refund.',400);
  const client=await this.client();let o;try{o=await client.orders.get(orderId);}catch{throw unavailable();}
  if(o?.id!==orderId||o.subscription_id!==subscriptionId||o.customer?.external_id!==org||!Number.isSafeInteger(o.net_amount)||!Number.isSafeInteger(o.refunded_amount))throw unavailable();
  if(o.status==='refunded'||o.refunded_amount>=o.net_amount)return {refunded:true,already:true,amount:o.refunded_amount};
  const amount=o.net_amount-Math.max(0,o.refunded_amount);
  let r;try{r=await client.refunds.create({order_id:orderId,reason,amount,...comment?{comment:String(comment).slice(0,400)}:{}});}catch{throw unavailable();}
  if(r?.order_id!==orderId)throw unavailable();return {refunded:true,amount};
 }
}
