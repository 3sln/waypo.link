// Explicit server/operator action only. Never mount as HTTP or call at startup.
import {createNodeOperatorApplication} from '@3sln/waypo/node';
import {firstNodeFinancialMetadataKey} from '@3sln/waypo/adapters/node/sqlite';
import {createChargeableFinancialIntents} from '@3sln/waypo/engines/financial-intents';
import {createPolar} from '@polar-sh/sdk/2026-10';
import {createNodeFundedCapacity} from './node-funded-capacity.mjs';
import {createPolarFinancialAuthority,validatePolarFinancialAdmission,POLAR_REVIEWED_TERMINAL_CONTRACT} from './polar-financial-authority.mjs';
import {createEmptyBillingCapacityProvisioner,createBillingVendorBudget} from './billing-controls.mjs';
import {WAYPO_LINK_PERSONAL_PLAN} from './policy-preset.mjs';
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const hash=async value=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))).toString('hex');
export async function provisionNodeFinancialAuthority(input,ports={}){
 if(!exact(input,['configuration','merchant','accessToken'])||!exact(input.merchant,['environment','organizationId','productId','basePriceId','revision','vendorContract'])||Object.keys(ports).some(key=>key!=='sdk'))throw TypeError('Exact trusted Node financial provisioning data required');
 const merchant=input.merchant;
 if(!['sandbox','production'].includes(merchant.environment)||!['organizationId','productId','basePriceId'].every(key=>identifier(merchant[key]))||typeof merchant.revision!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(merchant.revision)||merchant.vendorContract!==POLAR_REVIEWED_TERMINAL_CONTRACT||typeof input.accessToken!=='string'||!input.accessToken.length||input.accessToken.length>1024)throw TypeError('Finite reviewed merchant identity required');
 let runtime,context,authority,resources,ledger,primary;const closers=[];
 const closeResources=async()=>{const failures=[];for(const close of[...closers].reverse())try{await close();}catch(error){failures.push(error);}if(failures.length)throw Object.assign(new AggregateError(failures,'Financial operator resource closure unconfirmed'),{code:'billing_financial_cleanup_unconfirmed'});};
 try{
  // This constructor holds the actual stopped-installation gate, verifies the
  // existing metadata/Native pair, and suppresses all periodic work/listeners.
  runtime=await createNodeOperatorApplication(input.configuration,{createProviderExtension:async selected=>{context=selected;return {close:closeResources};}});
  if(!context||typeof context.openExistingFundedStoragePool!=='function')throw Error('billing_capacity_node_unavailable');
  const pool=await context.openExistingFundedStoragePool(),description=await context.store.transaction(tx=>pool.inspectFundingProfile(tx)),binding={environment:merchant.environment,organizationId:merchant.organizationId,productId:merchant.productId,revision:merchant.revision,profileHash:await hash(JSON.stringify([description.scope,description.profileHash,description.objectBindingHash]))};
  const financialAdmission=validatePolarFinancialAdmission({v:1,backend:'node',vendorContract:merchant.vendorContract,binding},merchant);
  resources=await createNodeFundedCapacity({store:context.store,config:context.config,binding,logicalBytes:WAYPO_LINK_PERSONAL_PLAN.includedStorageBytes,openExistingFundedStoragePool:context.openExistingFundedStoragePool,readGeneration:(tx,value)=>authority?.ports.readBillingGeneration(tx,{subject:value.subject})??false,authorizeTransition:(...args)=>authority?.authorizeCapacityTransition(...args)??false});closers.push(()=>resources.close());
  // Real global metadata headroom precedes every financial counter/budget.
  await resources.prepareInstallationBudget();
  await createEmptyBillingCapacityProvisioner({store:context.store,firstBinding:firstNodeFinancialMetadataKey,issuer:context.config.issuer,environment:merchant.environment,organizationId:merchant.organizationId})();
  const sdk=ports.sdk??createPolar({accessToken:input.accessToken,environment:merchant.environment,organizationId:merchant.organizationId,timeout:5}),budget=createBillingVendorBudget({store:context.store,issuer:context.config.issuer,environment:merchant.environment,organizationId:merchant.organizationId});
  authority=await createPolarFinancialAuthority({store:context.store,config:context.config,binding,basePriceId:merchant.basePriceId,vendorContract:merchant.vendorContract,sdk,firstLocalBinding:firstNodeFinancialMetadataKey,assertInstallationBudget:resources.assertInstallationBudget,reserveAccountMetadata:resources.reserveAccountMetadata});closers.push(()=>authority.close());
  ledger=await createChargeableFinancialIntents({...authority.ports,store:context.store,issuer:context.config.issuer,installationId:context.config.installationId,binding,authorizeOwner:async()=>false,authorizePurchase:async()=>false,reserveCapacity:resources.reserveCapacity,checkCapacity:resources.checkCapacity,releaseCapacity:resources.releaseCapacity,releaseSupersededCapacity:resources.releaseSupersededCapacity,settleCapacity:resources.settleCapacity,consumeVendorWork:async(tx,{kind})=>{await budget.inTransaction(tx,kind==='trial'?'checkout':kind);return true;}});closers.push(()=>ledger.close());authority.bindLedger(ledger);
  // Only this explicit action makes prepaid bounded merchant GETs. The final
  // authority/core pair commits together; failure leaves real GET debits spent.
  const result=await authority.provisionFreshBaseline();
  return {provisioned:result.provisioned,financialAdmission,paidPlansEnabled:false};
 }catch(error){primary=error;throw error;}finally{
  if(runtime)try{await runtime.close();}catch(error){throw Object.assign(new AggregateError([primary,error].filter(Boolean),'Financial operator shutdown unconfirmed'),{code:'billing_financial_cleanup_unconfirmed'});}
 }
}
