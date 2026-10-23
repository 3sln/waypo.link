// PORT-6: owner review over PORT-5's registry in this account's single writer.
import {createAppEngine,perform,read} from '../../app/engine.mjs';
import {systemClock,cryptoRandom,nullAudit} from '../../app/providers.mjs';
import {SuccessorRegistry,portabilityClient,PendingSuccessors,ConfirmSuccessor,DismissSuccessor} from '../../identity/successors.mjs';
import {attestationRoots,parseAttestationKeySet} from '../../identity/attestation-keys.mjs';
import {flagsFor} from './flags.mjs';
const cache=new WeakMap();
async function engineFor(c,owner){
 if(await c.metadata.get('owner')!==owner)throw Object.assign(Error('Not found.'),{code:'not_found',status:404});
 if(!flagsFor(c.config,{subject:{kind:'account',owner}}).enabled('IDENTITY_SUCCESSOR_ADOPTION_ENABLED'))throw Object.assign(Error('Not found.'),{code:'not_found',status:404});
 let engine=cache.get(c);if(engine)return engine;
 const configured=c.config.TRANSFER_IN_PORTS,clock=typeof c.config.LIFECYCLE_CLOCK==='function'?c.config.LIFECYCLE_CLOCK:Date.now;
 // Pending review works without egress; adoption fails closed until a safe transport is configured.
 const client=portabilityClient({fetch:configured?.fetch??(async()=>{throw Error('Portability egress is unavailable.');}),clock});
 const roots=await attestationRoots({issuer:c.config.APP_ORIGIN,set:parseAttestationKeySet(c.config.IDENTITY_ATTESTATION_KEYS??c.config.IDENTITY_ATTESTATION_KEY),configured:configured?.roots??{}});
 const successors=new SuccessorRegistry({store:c.store,client,roots,clock,enabled:()=>flagsFor(c.config,{subject:{kind:'account',owner}}).enabled('IDENTITY_SUCCESSOR_ADOPTION_ENABLED')});
 engine=createAppEngine({providers:{clock:systemClock,random:cryptoRandom,audit:nullAudit,successors}});cache.set(c,engine);return engine;
}
export const methods={
 async transferSuccessorPending(owner,input){return {origin:input.origin,pending:await read(await engineFor(this,owner),new PendingSuccessors({actor:{kind:'system',reason:'owner-review'},input}))};},
 async transferSuccessorDecide(owner,input){if(input.confirm!==true)throw Object.assign(Error('Review the move before confirming.'),{code:'confirmation_required',status:400});const Operation=input.dismiss===true?DismissSuccessor:ConfirmSuccessor;return perform(await engineFor(this,owner),new Operation({actor:{kind:'operator',owner},input}));},
};
export const rpc={transferSuccessorPending:{},transferSuccessorDecide:{}};
