import {createNameAssignment} from '../recovery/identity-backup.mjs';
import {createRecoveryPayload} from '../recovery/index.mjs';
import {IdentityCrypto} from '../identity/crypto.mjs';

/** The recovery-file port (historical name: identity-backup port). Recovery file v3 (option C, owner approval
 * 2026-10-28) is an opaque credential: issuing it needs no signature and touches no keys. The port keeps the account
 * single writer's reissue gates and the provider name-certificate authority. The authority is an injected, independent
 * key; never derive it from the credential-encryption key or trust an authority embedded in a file. */
export function identityBackupPort({config,accounts,crypto=new IdentityCrypto()}){
  let authority;
  const load=()=>{
    if(authority)return authority;
    if(!config.RECOVERY_SIGNING_KEY)throw Object.assign(new Error('Name certificate signing is not configured.'),{code:'recovery_unavailable',status:503});
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
    /** A v3 payload for `account` (organization files; person files are built by IdentityService#downloadRecovery the
     * same way). Resolves {file, fileId}; the caller binds the token's hash and the file id in its own identity write. */
    async issue(account,recoveryToken,{issuedAt=Date.now()}={}){const fileId=crypto.random(16);return {file:createRecoveryPayload({issuer:config.APP_ORIGIN,entity:account.id,recoveryToken,fileId,issuedAt}),fileId};},
    /** Account setup: the identity signing key exists from the first file on (directory documents, signaling and
     * delegations expect it), as before v3. Idempotent and never rotates; the file itself names no key. */
    async provision(account){return call(account.id,'provisionIdentityKey',[]);},
    /** Active-account reissue, phase 1's account gate (recovery-identity "Active-account reissue"): the account single
     * writer refuses during a deletion, a move or a transfer-out contest. `actor` {credentialId, stepUpCredentialId,
     * sessionId} is the requesting session (P17 contest window). Resolves {transferPending}. No key changes (P15 withdrawn). */
    async reissue(account,{actor}={}){const gate=await call(account.id,'recoveryReissuePrepare',[{actor}]);return {transferPending:gate?.transferPending===true};},
    /** Phase 2's account gate, just before the identity commit: re-checks and cancels a live transfer-out. */
    async reissueCommit(owner,{actor}={}){return call(owner,'recoveryReissueCommit',[{actor}]);},
    async certificate(account,handle,issuedAt){return createNameAssignment({issuer:config.APP_ORIGIN,entity:account.id,handle,assignmentId:account.assignmentId||account.nameAssignmentId,issuedAt},load());},
  };
}

export function recoveryAuthorityPublic(config){
  if(!config.RECOVERY_SIGNING_KEY)throw Object.assign(new Error('Name certificate signing is not configured.'),{code:'recovery_unavailable',status:503});
  const {kid,privateJWK}=JSON.parse(config.RECOVERY_SIGNING_KEY);
  if(typeof kid!=='string'||!privateJWK?.d||privateJWK.kty!=='EC'||privateJWK.crv!=='P-256')throw new Error('Invalid recovery authority configuration');
  return {kid,publicKey:{kty:'EC',crv:'P-256',x:privateJWK.x,y:privateJWK.y}};
}
