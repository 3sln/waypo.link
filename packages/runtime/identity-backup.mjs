import {createIdentityBackup,verifyIdentityBackup,createNameAssignment} from '../recovery/identity-backup.mjs';

/** Provider authority is an injected, independent key; never derive it from
 * the credential-encryption key or trust an authority embedded in a file. */
const WARNING='Keep this encrypted identity backup private. It contains your signing and encryption keys. Recovery replaces login credentials; revoked permissions stay revoked. A name assignment does not override a newer assignment or recreate deleted data.';
export function identityBackupPort({config,accounts}){
  let authority;
  const load=()=>{
    if(authority)return authority;
    if(!config.RECOVERY_SIGNING_KEY)throw Object.assign(new Error('Identity backup signing is not configured.'),{code:'recovery_unavailable',status:503});
    const value=JSON.parse(config.RECOVERY_SIGNING_KEY);
    if(!value||typeof value.kid!=='string'||!value.privateJWK?.d)throw new Error('Invalid recovery authority configuration');
    const {d,key_ops,...publicJWK}=value.privateJWK;
    return authority={kid:value.kid,privateKey:value.privateJWK,publicKey:publicJWK};
  };
  const call=async (owner,method,args)=>{
    const result=await accounts.get(owner).invoke({method,args:[owner,...args]});
    if(result?.$fault)throw Object.assign(new Error(result.$fault.message),result.$fault);
    return result;
  };
  return {
    /** Issues a v2 file (PORT-10, P15). `rotation` ({rotateIf} | {always:true} | null) asks the account to rotate the
     * signing key with continuity first, and `keep` names the kids the identity still binds to a credential. Resolves
     * {backup, rotation}; the authority is loaded before any account write, so a missing authority changes nothing. */
    async issue(account,recoveryToken,{rotation=null,keep=[]}={}){const authority=load();const issued=await call(account.id,'recoveryKeychain',[{rotation,keep}]);return {backup:await createIdentityBackup({issuer:config.APP_ORIGIN,entity:account.id,keychain:issued.keychain,recoveryToken,warning:WARNING},authority),rotation:issued.rotation};},
    /** Active-account reissue, phase 1 (recovery-identity spec "Active-account reissue"): the account single writer
     * refuses during a deletion, a move or a transfer-out contest, then rotates exactly as `issue`. `actor`
     * {credentialId, sessionId} is the requesting session (P17 contest window). Resolves {backup, rotation,
     * transferPending}; the authority is loaded first, so a missing authority changes nothing. */
    async reissue(account,recoveryToken,{rotation=null,keep=[],actor}={}){const authority=load();const issued=await call(account.id,'recoveryReissuePrepare',[{rotation,keep,actor}]);return {backup:await createIdentityBackup({issuer:config.APP_ORIGIN,entity:account.id,keychain:issued.keychain,recoveryToken,warning:WARNING},authority),rotation:issued.rotation,transferPending:issued.transferPending===true};},
    /** Phase 2's account gate, just before the identity commit: re-checks and cancels a live transfer-out. */
    async reissueCommit(owner,{actor,kids}={}){load();return call(owner,'recoveryReissueCommit',[{actor,kids}]);},
    /** Cancelling a committed reissue (cooling-off window): the account single writer rotates the signing key away from
     * the voided file's kid and keeps the restored file's kid bound (P15). Resolves {rotation}. */
    async reissueCancel(owner,{voided,restored=null}={}){return call(owner,'recoveryReissueCancel',[{voided,restored}]);},
    async certificate(account,handle,issuedAt){return createNameAssignment({issuer:config.APP_ORIGIN,entity:account.id,handle,assignmentId:account.assignmentId||account.nameAssignmentId,issuedAt},load());},
    /** `expectedKid`: the signing kid the identity record bound to this credential at issuance, when it recorded one.
     * The file must hold the current keys, or a retired signing key still bound to an issued file (P15: the identity
     * commit can lose its race after the account rotated). Never writes. */
    async verify(backup,account,recoveryToken,{expectedKid}={}){
      const result=await verifyIdentityBackup(backup,load(),{issuer:config.APP_ORIGIN,entity:account.id});
      if(result.recoveryToken!==recoveryToken)throw new Error('Recovery proof does not match');
      if(expectedKid!==undefined&&expectedKid!==result.keychain.signing.kid)throw new Error('Identity key has changed');
      if(await call(account.id,'recoveryKeysMatch',[result.keychain])!==true)throw new Error('Identity key has changed');
      return result;
    }
  };
}

export function recoveryAuthorityPublic(config){
  if(!config.RECOVERY_SIGNING_KEY)throw Object.assign(new Error('Identity backup signing is not configured.'),{code:'recovery_unavailable',status:503});
  const {kid,privateJWK}=JSON.parse(config.RECOVERY_SIGNING_KEY);
  if(typeof kid!=='string'||!privateJWK?.d||privateJWK.kty!=='EC'||privateJWK.crv!=='P-256')throw new Error('Invalid recovery authority configuration');
  return {kid,publicKey:{kty:'EC',crv:'P-256',x:privateJWK.x,y:privateJWK.y}};
}
