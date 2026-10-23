// ORG-7: active-only, gated public document read, reusing PORT-4's public serializer.
// `published` is the edge Query's repository snapshot, never a request body. The live identity port rechecks status;
// Node's transfer-out port omits id/moves, so only these public members travel from the edge.
import {AppQuery,createAppEngine,read} from '../../app/engine.mjs';
import {IdentityKeyRegistry} from '../../identity/keys.mjs';
import {identityDocument,certificationKeys} from '../../identity/transfer-in.mjs';
import {siteGlobal} from '../../flags/read.mjs';
import {lifecycleBlocked} from '../lifecycle-runner.mjs';
import {systemClock,cryptoRandom,nullAudit} from '../../app/providers.mjs';
class PublishedDirectoryDocument extends AppQuery {
 static operation='directory.published-document';static deps=['federation'];
 fetch({federation}){return federation.document();}
}
export const methods={async directoryDocument(owner,published){
 if(!siteGlobal(this.config,'DIRECTORY_ENABLED'))return null;const blocked=await lifecycleBlocked(this,'directoryDocument',{},owner);if(blocked)throw Object.assign(new Error(blocked.message),blocked);
 const engine=createAppEngine({providers:{clock:systemClock,random:cryptoRandom,audit:nullAudit,federation:{document:async()=>{if(await this.metadata.get('owner')!==owner)return null;const port=this.config.TRANSFER_IN_PORTS?.identity??this.config.TRANSFER_OUT_PORTS?.identity;const current=await port?.get(owner);if(current?.status!=='active'||published?.id!==owner)return null;const identity={...published,...current,id:owner};return identityDocument({issuer:this.config.APP_ORIGIN,identity,signing:await new IdentityKeyRegistry({store:this.store}).history(owner,{purpose:'signing'}),certification:await certificationKeys(this.metadata,owner)});}}}});
 try{return await read(engine,new PublishedDirectoryDocument());}finally{engine.dispose();}
}};
export const rpc={directoryDocument:{}};
