// Provisional installation-wide vendor-attempt safety caps, not pricing terms.
// All deployments sharing this budget must share the same transactional store.
export const DEFAULT_BILLING_LIMITS=Object.freeze({checkout:256,portal:512,refresh:4096,cancel:2048,reconcile:10000,maxBindings:4096});
export function billingLimits(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!Object.hasOwn(DEFAULT_BILLING_LIMITS,key)))throw TypeError('Closed billing limit fields required');
 const result={...DEFAULT_BILLING_LIMITS,...input};
 if(Object.values(result).some(value=>!Number.isSafeInteger(value)||value<1||value>1000000))throw TypeError('Finite positive billing limits required');
 return Object.freeze(result);
}
export function createBillingVendorBudget({store,issuer,environment,organizationId,limits,clock=Date.now}){
 const {maxBindings,...selected}=billingLimits(limits),key='hosted/polar/vendor-attempts-v1',dayMs=86400000;
 return async function prepay(kind){
  if(!Object.hasOwn(selected,kind))throw Error('billing_unknown_vendor_operation');
  return store.transaction(async tx=>{
   const observed=clock();if(!Number.isSafeInteger(observed)||observed<0)throw Error('billing_clock_unavailable');
   const anchorKey=key+'/anchor',anchor=await tx.get(anchorKey);let row=await tx.get(key);
   if(Boolean(anchor)!==Boolean(row)||anchor&&(anchor.v!==1||anchor.issuer!==issuer||anchor.environment!==environment||anchor.organizationId!==organizationId))throw Error('billing_budget_unavailable');
   if(row&&(row.v!==1||row.issuer!==issuer||row.environment!==environment||row.organizationId!==organizationId||!Number.isSafeInteger(row.highWater)||row.highWater<0||!Number.isSafeInteger(row.day)||row.day<0||!row.counts||Object.keys(row.counts).length!==Object.keys(selected).length||Object.keys(selected).some(name=>!Number.isSafeInteger(row.counts[name])||row.counts[name]<0)))throw Error('billing_budget_unavailable');
   const at=Math.max(observed,row?.highWater??observed),day=Math.floor(at/dayMs);
   if(!row||day>row.day)row={v:1,issuer,environment,organizationId,day,highWater:at,counts:Object.fromEntries(Object.keys(selected).map(name=>[name,0]))};
   row.highWater=at;
   if(row.counts[kind]>=selected[kind])throw Object.assign(Error(kind==='cancel'?'billing_cancellation_budget':'billing_vendor_budget'),{retryAfter:Math.max(1,Math.ceil(((day+1)*dayMs-at)/1000))});
   row.counts[kind]++;if(!anchor)await tx.put(anchorKey,{v:1,issuer,environment,organizationId});await tx.put(key,row);
  });
 };
}

// Retained financial bindings have a separate lifetime stock ceiling. No
// automatic erasure/refund is inferred from account deletion or elapsed time.
export function createBillingBindingCapacity({issuer,environment,organizationId,limits}){
 const {maxBindings}=billingLimits(limits),anchorKey='hosted/polar/bindings-anchor-v1',counterKey='hosted/polar/bindings-stock-v1';
 return async function reserve(tx){
  const anchor=await tx.get(anchorKey),counter=await tx.get(counterKey);
  if(!anchor||!counter||anchor&&(anchor.v!==1||anchor.issuer!==issuer||anchor.environment!==environment||anchor.organizationId!==organizationId||counter.v!==1||!Number.isSafeInteger(counter.count)||counter.count<0))throw Error('billing_capacity_unavailable');
  const count=counter?.count??0;if(count>=maxBindings)throw Error('billing_capacity_budget');
  await tx.put(counterKey,{v:1,count:count+1});
 };
}

// Trusted operator composition only. The adapter must execute the exact bounded
// prefix probe inside this SAME transaction; never accept a caller's count/proof.
export function createEmptyBillingCapacityProvisioner({store,firstBinding,issuer,environment,organizationId}){
 if(typeof store?.transaction!=='function'||typeof firstBinding!=='function')throw TypeError('Transactional operator catalog probe required');
 return ()=>store.transaction(async tx=>{
  const anchorKey='hosted/polar/bindings-anchor-v1',counterKey='hosted/polar/bindings-stock-v1',anchor=await tx.get(anchorKey),counter=await tx.get(counterKey);
  if(anchor||counter){if(!anchor||!counter||anchor.v!==1||anchor.issuer!==issuer||anchor.environment!==environment||anchor.organizationId!==organizationId||counter.v!==1||!Number.isSafeInteger(counter.count)||counter.count<0)throw Error('billing_capacity_unavailable');return {provisioned:false,count:counter.count};}
  const found=await firstBinding(tx,{prefix:'hosted/polar/waypo_',limit:1});
  if(found!==null)throw Error('billing_existing_catalog_requires_migration');
  await tx.put(anchorKey,{v:1,issuer,environment,organizationId});await tx.put(counterKey,{v:1,count:0});return {provisioned:true,count:0};
 });
}
