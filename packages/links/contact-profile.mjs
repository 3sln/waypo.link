// Core links: the account's contact profile and per-link profile sharing.
//
// History: moved out of packages/beaming/contacts.mjs when Beam left the core (DEVLOG 2026-10-26). When messaging
// left the core (DEVLOG 2026-10-27 "Messaging removed from core; Parlay rename; BB-CUT reset"):
// - sharing binds to the type-neutral contact parent (./parents.mjs, the LinkService `link/<jti>` record) instead of
//   the legacy messaging `contact-grant/<id>` parent and its cap;
// - saved contacts and contact-link redemption bindings moved with the messaging app (SQ-2, provisional);
// - the `beam-retired-v1` dual write to the legacy `beam/*` keys was removed; the BB-CUT reset deleted those rows.
//
// Storage families (account-local):
//   profile                     the owner's contact profile {displayName, bio, avatar, discloseToContacts, updatedAt}
//   contact-sharing/<jti>       profile fields one contact parent discloses {profileFields, updatedAt}; a row whose
//                               parent is gone is removed by the link-state alarm sweep (links/audience.mjs)
import {StorageError} from '../storage/policy.mjs';
import {PROFILE_FIELDS,effectiveSharingFields} from './sharing-fields.mjs';
import {liveParent,readParent,scanAll} from './parents.mjs';
export {PROFILE_FIELDS};

export const CONTACT_KEYS=Object.freeze({profile:'profile',sharing:'contact-sharing/'});
/** A sharing row reduced to its known fields. */
export const sharingRow=row=>({profileFields:Array.isArray(row?.profileFields)?row.profileFields.filter(field=>PROFILE_FIELDS.includes(field)):[]});
const fail=(code,message,status=400)=>{throw new StorageError(code,message,status);};
const unauthorized=()=>{throw Object.assign(new Error('Invalid contact capability.'),{code:'unauthorized'});};
const EMPTY_PROFILE=Object.freeze({displayName:'',bio:'',avatar:'',discloseToContacts:false});
const profileView=row=>{const {displayName,bio,avatar,discloseToContacts}=row||EMPTY_PROFILE;return {displayName,bio,avatar,discloseToContacts};};
const sameProfile=(a,b)=>a.displayName===b.displayName&&a.bio===b.bio&&a.avatar===b.avatar&&a.discloseToContacts===b.discloseToContacts;
/** Opaque content revision of the owner's profile (bug hunt F1): GET returns it, and a PUT naming `expectedRevision`
 * is refused with `profile_stale` (409) when the stored profile no longer has that content. Derived from the content,
 * so no stored counter is needed; an ABA change back to identical content is harmless by construction. */
export async function profileRevision(profile){
 const bytes=new TextEncoder().encode(JSON.stringify([profile.displayName,profile.bio,profile.avatar,profile.discloseToContacts]));
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].slice(0,16).map(b=>b.toString(16).padStart(2,'0')).join('');
}
export class ContactProfiles {
 /** `metadata`: the account store. `links.verify(url)` -> {record}: owner-host link verification (LinkService.verify). */
 constructor({metadata,links,clock=()=>Date.now()}){Object.assign(this,{metadata,links,clock});}
 async profile(owner,input){
  if(input!==undefined){
   if(input&&typeof input==='object'&&Object.hasOwn(input,'expectedRevision')&&(typeof input.expectedRevision!=='string'||!/^[a-f0-9]{32}$/.test(input.expectedRevision)))fail('profile_invalid','The profile revision is invalid.');
   if(!input||typeof input!=='object'||Object.keys(input).some(k=>![...PROFILE_FIELDS,'discloseToContacts','expectedRevision'].includes(k))||typeof input.displayName!=='string'||input.displayName.length>100||typeof input.bio!=='string'||input.bio.length>500||typeof input.avatar!=='string'||input.avatar.length>2048||typeof input.discloseToContacts!=='boolean'||/[\u0000-\u001f\u007f]/.test(input.displayName+input.bio))fail('profile_invalid','The profile fields are invalid.');
   if(input.avatar){let url;try{url=new URL(input.avatar);}catch{fail('profile_invalid','Use an HTTPS avatar URL.');}if(url.protocol!=='https:'||url.username||url.password)fail('profile_invalid','Use an HTTPS avatar URL.');}
   const {displayName,bio,avatar,discloseToContacts,expectedRevision}=input,row={displayName,bio,avatar,discloseToContacts,owner,updatedAt:this.clock()};
   const stale=()=>fail('profile_stale','Your contact profile changed in another session. Reload it and try again.',409);
   // The digest is computed outside the transaction; inside it the stored content must still equal what was hashed.
   // Withdrawing disclosure is protective and is never refused as stale: on a stale revision only the withdrawal is
   // applied to the stored profile, so the stale tab cannot overwrite newer fields but the privacy action still lands.
   const withdraw=discloseToContacts===false;let expected=null,diverged=false;
   // Only an actual withdrawal is exempt: when the stored profile already discloses nothing, a stale save with the
   // switch off would otherwise be answered 200 while silently dropping the stale tab's edits (bug hunt round 3, B1).
   if(expectedRevision!==undefined){expected=profileView(await this.metadata.get(CONTACT_KEYS.profile));if(await profileRevision(expected)!==expectedRevision){if(!withdraw||!expected.discloseToContacts)stale();diverged=true;}}
   await this.metadata.transaction(async tx=>{
    const current=profileView(await tx.get(CONTACT_KEYS.profile));
    if(expected&&(diverged||!sameProfile(current,expected))){if(!withdraw||!current.discloseToContacts)stale();await tx.put(CONTACT_KEYS.profile,{...current,discloseToContacts:false,owner,updatedAt:this.clock()});return;}
    await tx.put(CONTACT_KEYS.profile,row);
   });
  }
  const profile=profileView(await this.metadata.get(CONTACT_KEYS.profile));return {...profile,revision:await profileRevision(profile)};
 }
 /** Which profile fields one of the owner's live contact parents discloses. A body naming both keys is refused (review R3). */
 async sharing(owner,id,input){
  if(!input||typeof input!=='object'||Array.isArray(input)||!Object.keys(input).length||Object.keys(input).some(k=>!['profileFields','discloseProfile'].includes(k))||input.discloseProfile!==undefined&&typeof input.discloseProfile!=='boolean'||input.profileFields!==undefined&&input.discloseProfile!==undefined)fail('contact_sharing_invalid','Choose the profile fields this contact link shares.');
  if(input.profileFields!==undefined&&(!Array.isArray(input.profileFields)||input.profileFields.length>3||new Set(input.profileFields).size!==input.profileFields.length||input.profileFields.some(k=>!PROFILE_FIELDS.includes(k))))fail('profile_fields_invalid','Choose display name, bio or avatar fields to share.');
  return this.metadata.transaction(async tx=>{
   const parent=await readParent(k=>tx.get(k),id);if(!liveParent(parent,owner,this.clock()))fail('contact_not_found','The contact link is inactive.',404);
   const prior=sharingRow(await tx.get(CONTACT_KEYS.sharing+id)),profileFields=effectiveSharingFields(input,prior.profileFields);
   await tx.put(CONTACT_KEYS.sharing+id,{profileFields,updatedAt:this.clock()});
   return {id,profileFields,discloseProfile:profileFields.length>0};
  });
 }
 async selectedProfile(owner,sharing){const profile=await this.profile(owner);if(!profile.discloseToContacts||!sharing?.profileFields?.length)return null;return Object.fromEntries(sharing.profileFields.filter(field=>PROFILE_FIELDS.includes(field)).map(field=>[field,profile[field]]));}
 /** The contact-profile representation of a verified link (links §6.4 previews): only what the owner chose to disclose for it. */
 async publicProfile(owner,url){
  let record;try{({record}=await this.links.verify(url));}catch(error){if(error?.code==='link_malformed')throw error;unauthorized();}
  if(!liveParent(record,owner,this.clock()))unauthorized();
  const sharing=sharingRow(await this.metadata.get(CONTACT_KEYS.sharing+record.jti)),identity=new URL(record.claims.aud);identity.pathname=identity.pathname.replace(/\/contact\/[^/]+$/,'');identity.search='';identity.hash='';
  return {identityURI:identity.href,profile:await this.selectedProfile(owner,sharing)};
 }
 /** Sharing rows for the owner's contact parents, keyed by jti. */
 async sharingRows(){const out=new Map();for(const [path,row]of await scanAll(options=>this.metadata.list(options),CONTACT_KEYS.sharing))out.set(path.slice(CONTACT_KEYS.sharing.length),sharingRow(row));return out;}
}
