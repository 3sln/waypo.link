// AccountController slice: the owner's profile preference, `{displayName, avatar}` (contacts spike §4.8, CL-14, CR-C4;
// contacts phase 4, provisional, unsigned). It is an account preference read by the embed view and by apps the owner
// grants the identity profile resource (runtime/federation.mjs); contacts see nothing of it. Per-link sharing, `bio` and `discloseToContacts`
// were deleted with contact links; the `contact-links-retired-v1` reset strips those members from stored rows, and this
// slice never reads them. What contacts see is a Parlay peer profile record, which is deferred (CR-M9).
//
// Storage: `profile` {displayName, avatar, owner, updatedAt}. `methods` are installed on AccountController.prototype
// (`this` is the controller); `rpc` lists the methods `invoke` accepts (packages/runtime/account/index.mjs).
import {StorageError} from '../../storage/policy.mjs';
import {resetContactLinks,CONTACT_LINKS_RESET_MARKER} from '../contact-links-reset.mjs';

export const PROFILE_KEY='profile';
export const PROFILE_FIELDS=Object.freeze(['displayName','avatar']);
const fail=(code,message,status=400)=>{throw new StorageError(code,message,status);};
const profileView=row=>({displayName:typeof row?.displayName==='string'?row.displayName:'',avatar:typeof row?.avatar==='string'?row.avatar:''});
const same=(a,b)=>a.displayName===b.displayName&&a.avatar===b.avatar;
/** Opaque content revision (bug hunt F1): GET returns it, and a PUT naming `expectedRevision` is refused with
 * `profile_stale` (409) when the stored profile no longer has that content. Derived from the content, so an ABA change
 * back to identical content is harmless by construction. */
export async function profileRevision(profile){
 const bytes=new TextEncoder().encode(JSON.stringify([profile.displayName,profile.avatar]));
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].slice(0,16).map(b=>b.toString(16).padStart(2,'0')).join('');
}
/** Validates a PUT body: exactly the profile fields plus an optional `expectedRevision`; anything else is refused. */
export function profileInput(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>![...PROFILE_FIELDS,'expectedRevision'].includes(k)))fail('profile_invalid','The profile fields are invalid.');
 if(Object.hasOwn(input,'expectedRevision')&&(typeof input.expectedRevision!=='string'||!/^[a-f0-9]{32}$/.test(input.expectedRevision)))fail('profile_invalid','The profile revision is invalid.');
 if(typeof input.displayName!=='string'||input.displayName.length>100||/[\u0000-\u001f\u007f]/.test(input.displayName)||typeof input.avatar!=='string'||input.avatar.length>2048)fail('profile_invalid','The profile fields are invalid.');
 if(input.avatar){let url;try{url=new URL(input.avatar);}catch{fail('profile_invalid','Use an HTTPS avatar URL.');}if(url.protocol!=='https:'||url.username||url.password)fail('profile_invalid','Use an HTTPS avatar URL.');}
 return {displayName:input.displayName,avatar:input.avatar,expectedRevision:input.expectedRevision};
}

export const methods={
  /** GET (input undefined) or PUT the profile; returns {displayName, avatar, revision}. */
  async accountProfile(owner,input){
   if(input!==undefined){
    const {displayName,avatar,expectedRevision}=profileInput(input),stale=()=>fail('profile_stale','Your profile changed in another session. Reload it and try again.',409);
    // The digest is computed outside the transaction; inside it the stored content must still equal what was hashed.
    let expected=null;if(expectedRevision!==undefined){expected=profileView(await this.metadata.get(PROFILE_KEY));if(await profileRevision(expected)!==expectedRevision)stale();}
    await this.metadata.transaction(async tx=>{
     const current=profileView(await tx.get(PROFILE_KEY));if(expected&&!same(current,expected))stale();
     await tx.put(PROFILE_KEY,{displayName,avatar,owner,updatedAt:Date.now()});
    });
   }
   const profile=profileView(await this.metadata.get(PROFILE_KEY));return {...profile,revision:await profileRevision(profile)};
  },
  /** One bounded slice of the contacts phase 4 reset (../contact-links-reset.mjs), which also strips the retired profile
   * members. Called from `warm` and the account alarm (accounts.mjs); reschedules itself until the marker exists. */
  async resetContactLinks(owner,{alarm=false,limit=256}={}){
   if(await this.metadata.get(CONTACT_LINKS_RESET_MARKER)!==undefined)return {done:true,deleted:0};
   const result=await resetContactLinks(this.metadata,{limit});
   if(!result.done)await this.scheduleAlarm(Date.now()+(alarm?1000:60000));
   return result;
  },
};

export const rpc={accountProfile:{}};
