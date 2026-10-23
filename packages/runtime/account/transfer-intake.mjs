// PORT-6 trusted edge intake RPC: only public verification and durable trust pins precede enrollment.
// In particular, no warm(), owner binding, key import or signing key generation runs here.
import {createAppEngine,perform} from '../../app/engine.mjs';
import {cryptoRandom,nullAudit} from '../../app/providers.mjs';
import {TransferInIntake,CheckTransferIn,ReserveTransferIn} from '../../identity/transfer-in.mjs';
import {verifyPackage} from '../../identity/succession.mjs';
import {portabilityClient,attestationPins} from '../../identity/successors.mjs';
import {attestationRoots,parseAttestationKeySet} from '../../identity/attestation-keys.mjs';
import {flagsFor} from './flags.mjs';
const fail=(code,message,status)=>{throw Object.assign(new Error(message),{code,status});};
export const methods={
 async transferIntakeAssess(owner,input,{reserve=false}={}){
  let pkg;try{pkg=await verifyPackage(input?.package);}catch{fail('package_invalid','This identity package cannot be used.',400);}
  if(pkg.sub!==owner)fail('forbidden','This package belongs to another identity.',403);
  const bound=await this.metadata.get('owner');if(bound!==undefined&&bound!==owner)fail('forbidden','Account owner mismatch.',403);
  const configured=this.config.TRANSFER_IN_PORTS;if(!configured?.identity||typeof configured.fetch!=='function')fail('temporarily_unavailable','Moving here is not configured.',503);
  const clock={now:()=>typeof this.config.LIFECYCLE_CLOCK==='function'?this.config.LIFECYCLE_CLOCK():Date.now()},client=portabilityClient({fetch:configured.fetch,clock:clock.now,...configured.limiter?{limiter:configured.limiter}:{}});
  const roots=await attestationRoots({issuer:this.config.APP_ORIGIN,set:parseAttestationKeySet(this.config.IDENTITY_ATTESTATION_KEYS??this.config.IDENTITY_ATTESTATION_KEY),configured:configured.roots??{}}),pins=attestationPins({store:this.store,client,roots,clock:clock.now});
  const lifecycle=new TransferInIntake({ports:{issuer:this.config.APP_ORIGIN,identity:configured.identity,client,pins},flags:{for:ctx=>flagsFor(this.config,ctx)},clock,random:cryptoRandom}),engine=createAppEngine({providers:{clock,random:cryptoRandom,audit:nullAudit,lifecycle}});
  try{return await perform(engine,new (reserve?ReserveTransferIn:CheckTransferIn)({actor:{kind:'intake'},input}));}finally{engine.dispose();}
 }
};
export const rpc={transferIntakeAssess:{lifecycle:'suspended'}};
