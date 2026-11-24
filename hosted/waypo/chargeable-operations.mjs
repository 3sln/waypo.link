// Server-only coordinator: the caller never supplies an intent sequence or an
// owner proof. Unknown remote effects stay in the shared ledger indefinitely.
import {createChargeableFinancialIntents} from '@3sln/waypo/engines/financial-intents';
import {createFinancialOwnerProofs} from './financial-owner-proofs.mjs';
import {createBillingVendorBudget} from './billing-controls.mjs';
const fail=code=>{throw Object.assign(Error(code),{code});};
export async function createChargeableOperations({store,issuer,installationId,binding,ports={},authorizeOwnerInTransaction,resolveOwner,qualifyVendorClosure=async()=>false,acceptResult=async()=>false,clock=Date.now,random, billingLimits}){
 if(typeof store?.transaction!=='function'||typeof resolveOwner!=='function'||typeof qualifyVendorClosure!=='function'||typeof acceptResult!=='function')throw TypeError('Private chargeable operation ports required');
 const owners=createFinancialOwnerProofs({issuer,authorizeOwnerInTransaction,clock,...random?{random}:{}}),budget=createBillingVendorBudget({store,issuer,environment:binding.environment,organizationId:binding.organizationId,limits:billingLimits,clock});
 const intents=await createChargeableFinancialIntents({...ports,store,issuer,installationId,binding,clock,authorizeOwner:(tx,input)=>owners.authorizeInTransaction(tx,input),consumeVendorWork:async(tx,{kind})=>{await budget.inTransaction(tx,kind==='trial'?'checkout':kind);return true;}});
 return Object.freeze({
  async execute({request,kind,offerDigest,capacityBytes,billingGeneration},post){
   if(!['checkout','trial','portal'].includes(kind)||typeof post!=='function')fail('billing_financial_unavailable');
   const owner=await resolveOwner(request);
   return owners.withOwner({request,owner},async({ownerProofHash})=>{
    const subject=owner.subject,selected=await store.transaction(async tx=>{
     // Closure includes the authority of the created vendor object, especially
     // portal capabilities; a short URL TTL is not evidence of closure.
     if(await qualifyVendorClosure(tx,{subject,kind,binding})!==true)fail('billing_financial_closure_unavailable');
     const status=await intents.inspectInTransaction(tx,{subject,ownerProofHash});
     if(status.intents.some(row=>['reserved','dispatching','open','unknown'].includes(row.state)))fail('billing_financial_pending');
     const requestId=crypto.randomUUID().replaceAll('-',''),row=await intents.reserveInTransaction(tx,{subject,kind,offerDigest,capacityBytes,billingGeneration,ownerProofHash,requestId,sequence:status.nextSequence});
     const dispatch=await intents.dispatchInTransaction(tx,{subject,intentId:row.id,ownerProofHash});if(!dispatch.dispatchAllowed)fail('billing_financial_pending');return row;
    });
    const input={subject,intentId:selected.id};
    try{
     const result=await post();
     // The trusted acceptor must durably retain a bounded canonical result
     // proof in this SAME transaction; a returned URL alone is not evidence.
     await store.transaction(async tx=>{const proofDigest=await acceptResult(tx,{subject,intent:selected,result});await intents.recordResultInTransaction(tx,{...input,proofDigest});});
     const current=await resolveOwner(request);
     await store.transaction(async tx=>{if(typeof ports.readBillingGeneration!=='function'||await ports.readBillingGeneration(tx,{subject,binding})!==billingGeneration)fail('financial_intent_generation_changed');if(await qualifyVendorClosure(tx,{subject,kind,binding})!==true)fail('billing_financial_closure_unavailable');if(!await owners.authorizeDisclosure(tx,{subject,ownerProofHash,request,owner:current}))fail('billing_owner_required');});
     return result;
    }catch(error){
     try{await intents.markUnknown(input);}catch{/* A committed dispatch already holds liability even if marking fails. */}
     throw error;
    }
   });
  },
  close(){owners.close();return intents.close();}
 });
}
