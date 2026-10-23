// PORT-6 edge composition. All package validation stays in the PORT-4 engine; account RPC owns key custody.
import {verifyPackage} from '../identity/succession.mjs';
import {TransferInIntake,transferInIdentityPort} from '../identity/transfer-in.mjs';
import {portabilityClient,attestationPins} from '../identity/successors.mjs';
import {attestationRoots,parseAttestationKeySet} from '../identity/attestation-keys.mjs';
import {createAppEngine,perform} from '../app/engine.mjs';
import {CheckTransferIn,ReserveTransferIn} from '../identity/transfer-in.mjs';
import {cryptoRandom,nullAudit} from '../app/providers.mjs';
import {flagGlobal} from './routes/shared.mjs';
export const transferInFeature=env=>flagGlobal(env,'IDENTITY_TRANSFER_IN_ENABLED');
export function transferIntakeConfig({env,repository,accounts,store=env.TRANSFER_IN_PIN_STORE,fetch=env.TRANSFER_IN_PORTS?.fetch}){
 if(!repository||!accounts||typeof fetch!=='function')return null;
 const clock={now:()=>typeof env.LIFECYCLE_CLOCK==='function'?env.LIFECYCLE_CLOCK():Date.now()},client=portabilityClient({fetch,clock:clock.now});let ports;
 const load=async()=>ports??=(async()=>{
  const roots=await attestationRoots({issuer:env.APP_ORIGIN,set:parseAttestationKeySet(env.IDENTITY_ATTESTATION_KEYS??env.IDENTITY_ATTESTATION_KEY),configured:env.TRANSFER_IN_PORTS?.roots??{}});
  const pins=attestationPins({store,client,roots,clock:clock.now});
  return {issuer:env.APP_ORIGIN,identity:env.TRANSFER_IN_PORTS?.identity??transferInIdentityPort(repository,{clock:clock.now}),client,pins};
 })();
 const run=async(Operation,input)=>{const lifecycle=new TransferInIntake({ports:await load(),flags:{for:()=>({enabled:name=>flagGlobal(env,name)})},clock,random:cryptoRandom}),engine=createAppEngine({providers:{clock,random:cryptoRandom,audit:nullAudit,lifecycle}});try{return await perform(engine,new Operation({actor:{kind:'intake'},input}));}finally{engine.dispose();}};
 const call=async(owner,method,args)=>{const result=await accounts.get(owner).invoke({method,args:[owner,...args]});if(result?.$fault)throw Object.assign(new Error(result.$fault.message),result.$fault);return result;};
 const assess=async(input,reserve)=>{if(store)return run(reserve?ReserveTransferIn:CheckTransferIn,input);let pkg;try{pkg=await verifyPackage(input?.package);}catch{throw Object.assign(new Error('This identity package cannot be used.'),{code:'package_invalid',status:400});}return call(pkg.sub,'transferIntakeAssess',[input,{reserve}]);};
 return {check:input=>assess(input,false),reserve:input=>assess(input,true),begin:(owner,input)=>call(owner,'transferInBegin',[input,{kind:'intake'}]),status:owner=>call(owner,'transferInStatus',[]),cancel:owner=>call(owner,'transferInCancel',[])};
}
