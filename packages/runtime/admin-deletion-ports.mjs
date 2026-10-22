// DX-7 deletion port for AdminService (`config.deletion`), composed identically by the Worker and Node adapters.
// Account mutations reach the owner's account object through internal RPCs (packages/runtime/account/deletion.mjs);
// mail goes only to the account's own verified address. Acceptance means a provider accepted, not delivery.
const accepted=result=>typeof result?.messageId==='string'&&result.messageId.length>0;
export function adminDeletionPorts({accounts,repository,mailer}){
 if(typeof accounts?.get!=='function'||typeof repository?.get!=='function')throw new TypeError('Admin deletion ports need accounts and the identity repository.');
 const call=async(owner,method,args=[])=>{const result=await accounts.get(owner).invoke({method,args:[owner,...args]});if(result?.$fault)throw Object.assign(new Error(result.$fault.message??'Account unavailable.'),{code:result.$fault.code,status:result.$fault.status});return result;};
 const mail=async(method,input)=>{if(typeof mailer?.[method]!=='function')return false;try{return accepted(await mailer[method](input));}catch{return false;}};
 return Object.freeze({
  // Restricted closure-export sessions are issued and enforced by IdentityService and the HTTP router.
  closureSessionsReady:true,
  schedule:(owner,input)=>call(owner,'deletionSchedule',[input]),
  cancel:owner=>call(owner,'deletionSystemCancel',[{reason:'admin'}]),
  status:owner=>call(owner,'deletionSystemStatus'),
  async sendConfirmation(input){return {accepted:await mail('sendAdminDeletionConfirmation',input)};},
  // The executor's own scheduled notice already went to the email and push snapshot; this adds the export window.
  async notifyClosure({owner,handle,exportUntil,executeAfter}){
   const account=await repository.get(owner),email=account?.verifiedEmail&&Number.isSafeInteger(account.emailVerifiedAt)?account.verifiedEmail:null;
   const mailed=email?await mail('sendClosureNotice',{email,handle,exportUntil,executeAfter}):false;
   let scheduledNotice=false;try{scheduledNotice=(await call(owner,'deletionSystemStatus'))?.notice?.accepted===true;}catch{}
   return {accepted:mailed||scheduledNotice};
  },
  // Reopening is the safe direction: with no address on file there is nothing to send, and it never strands the owner.
  async notifyReopen({owner,handle}){const account=await repository.get(owner),email=account?.verifiedEmail&&Number.isSafeInteger(account.emailVerifiedAt)?account.verifiedEmail:null;return {accepted:email?await mail('sendReopenNotice',{email,handle}):true,...email?{}:{channel:'none'}};},
 });
}
