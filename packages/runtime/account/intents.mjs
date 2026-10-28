// INT-4/5 durable account adapter. Operations use the same ngin engine on Worker and Node.
import {createAppEngine,perform,read,operations,AppQuery} from '../../app/engine.mjs';
import {systemClock,cryptoRandom,nullAudit} from '../../app/providers.mjs';
import {INTENT_OPERATIONS,ReconcileIntentDefaults} from '../../intents/router.mjs';
import {StorageError} from '../../storage/policy.mjs';
const registry=operations(...INTENT_OPERATIONS);
export const methods={async intentsOwner(owner,{operation,input}={}){
 const Operation=registry[operation];if(!Operation||operation==='intents.receive')throw new StorageError('not_found','Not found.',404);
 await this.warm(owner);
 // No built-in handlers (contacts phase 4, CR-C3): candidates are only connected apps that declare the kind.
 const engine=createAppEngine({providers:{accountStore:this.metadata,config:this.config,clock:systemClock,random:cryptoRandom,audit:nullAudit}});
 try{await perform(engine,new ReconcileIntentDefaults({actor:{kind:'owner',owner}}));const action=new Operation({actor:{kind:'owner',owner},input:input===undefined?{}:structuredClone(input)});return action instanceof AppQuery?await read(engine,action):await perform(engine,action);}finally{await engine.dispose();}
}};
export const rpc={intentsOwner:{warm:true}};
