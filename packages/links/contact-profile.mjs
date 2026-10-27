// Core links: the account's contact profile, per-link profile sharing, contact-link redemption bindings and saved
// contacts. Moved out of packages/beaming/contacts.mjs when Beam left the core (DEVLOG 2026-10-26 "Beam removed from
// core"); the file-transfer permission (`beamEnabled`) and nearby pairing were removed with it.
//
// Storage families (account-local): the neutral keys and the legacy Beam-era keys they replace.
//   profile                                   <-> beam/profile                        the owner's contact profile
//   contact-sharing/<grantId>                 <-> beam/grant/<grantId>                profile fields a link discloses
//   contact-redeemed/<grantId>                <-> beam/redeemed/<grantId>             which account redeemed my link
//   contact-redeemed-peer/<peer>/<grantId>    <-> beam/redeemed-peer/<peer>/<grantId> peer-keyed index of those bindings
//   saved-contact/<linkOwner>                 <-> beam/directory/<linkOwner>          links I redeemed (saved contacts)
//
// Release v1 (`beam-retired-v1`, review follow-up R1): the code must stay correct under a rollback to, or a mixed
// deployment with, the pre-removal code, which reads and writes only the legacy keys. So for one release:
// - every write goes to BOTH keys in one transaction, stamped with the same `updatedAt`; every delete removes both;
// - `beam-retired-v1` copies legacy rows to the neutral keys and never deletes a legacy row;
// - reads resolve the pair with pickRow(): the legacy row stays authoritative for presence, and its content wins
//   unless both rows are stamped and the neutral one is strictly newer. A legacy row without a stamp was written by
//   pre-removal code, either as the migration's source or later (a rollback write), so it is never older than a
//   stamped copy. A neutral row whose legacy twin is missing was deleted by pre-removal code (v1 never creates one
//   without the other) and reads as absent.
// Deleting the legacy rows and reading the neutral keys alone is the follow-up `beam-retired-v2`, after a release.
import {isUUID as uuid} from '../core/primitives.mjs';
import {StorageError} from '../storage/policy.mjs';
import {key} from '../core/records.mjs';
import {MAX_STORED_GRANTS} from '../messaging/contact-tokens.mjs';
import {PROFILE_FIELDS,effectiveSharingFields} from './sharing-fields.mjs';
export {PROFILE_FIELDS};

export const CONTACT_KEYS=Object.freeze({profile:'profile',sharing:'contact-sharing/',redeemed:'contact-redeemed/',redeemedPeer:'contact-redeemed-peer/',saved:'saved-contact/'});
export const LEGACY_CONTACT_KEYS=Object.freeze({profile:'beam/profile',sharing:'beam/grant/',redeemed:'beam/redeemed/',redeemedPeer:'beam/redeemed-peer/',saved:'beam/directory/'});
export const CONTACT_FAMILIES=Object.freeze(Object.keys(CONTACT_KEYS));
export const MAX_SAVED_CONTACTS=1000;
export const redeemedPeerKey=(peer,grantId)=>`${CONTACT_KEYS.redeemedPeer}${peer}/${grantId}`;
const legacyRedeemedPeerKey=(peer,grantId)=>`${LEGACY_CONTACT_KEYS.redeemedPeer}${peer}/${grantId}`;
/** Every key (new and legacy) a contact grant owns in these families; revocation cleanup deletes them all. */
export function contactGrantKeys(grantId,peer){
 const keys=[CONTACT_KEYS.sharing+grantId,LEGACY_CONTACT_KEYS.sharing+grantId,CONTACT_KEYS.redeemed+grantId,LEGACY_CONTACT_KEYS.redeemed+grantId];
 if(uuid(peer))keys.push(redeemedPeerKey(peer,grantId),legacyRedeemedPeerKey(peer,grantId));return keys;
}
/** A sharing row in either shape (the legacy one also carries `beamEnabled`, which is ignored). */
export const sharingRow=row=>({profileFields:Array.isArray(row?.profileFields)?row.profileFields.filter(field=>PROFILE_FIELDS.includes(field)):[]});
const present=row=>row!==undefined&&row!==null;
const stamped=row=>Number.isSafeInteger(row?.updatedAt);
/** Resolves a neutral/legacy pair under the v1 rule above; returns the winning row or null. */
export function pickRow(current,legacy){
 if(!present(legacy))return null;
 if(present(current)&&stamped(current)&&stamped(legacy)&&current.updatedAt>legacy.updatedAt)return current;
 return legacy;
}
const fail=(code,message,status=400)=>{throw new StorageError(code,message,status);};
const unauthorized=()=>{throw Object.assign(new Error('Invalid contact capability.'),{code:'unauthorized'});};
const EMPTY_PROFILE=Object.freeze({displayName:'',bio:'',avatar:'',discloseToContacts:false});
const readPair=async(db,name,id='')=>pickRow(await db.get(CONTACT_KEYS[name]+id),await db.get(LEGACY_CONTACT_KEYS[name]+id));
/** Rows of one family, keyed by suffix, resolved pairwise; the legacy prefix decides which rows exist. */
async function listRows(db,name,{suffix='',limit}){
 const [current,legacy]=await Promise.all([db.list({prefix:CONTACT_KEYS[name]+suffix,limit}),db.list({prefix:LEGACY_CONTACT_KEYS[name]+suffix,limit})]),rows=new Map();
 for(const [path,row]of legacy){const id=path.slice(LEGACY_CONTACT_KEYS[name].length);rows.set(id.slice(suffix.length),pickRow(current.get(CONTACT_KEYS[name]+id)??await db.get(CONTACT_KEYS[name]+id),row));}
 return rows;
}
/** Writes both keys of a pair with one stamp (inside a transaction). */
async function putPair(tx,name,id,current,legacy=current){await tx.put(CONTACT_KEYS[name]+id,current);await tx.put(LEGACY_CONTACT_KEYS[name]+id,legacy);}
const live=(grant,owner,now)=>grant&&grant.owner===owner&&grant.active&&grant.claims.exp*1000>now;
const profileView=row=>{const {displayName,bio,avatar,discloseToContacts}=row||EMPTY_PROFILE;return {displayName,bio,avatar,discloseToContacts};};
const sameProfile=(a,b)=>a.displayName===b.displayName&&a.bio===b.bio&&a.avatar===b.avatar&&a.discloseToContacts===b.discloseToContacts;
/** Opaque content revision of the owner's profile (bug hunt F1): GET returns it, and a PUT naming `expectedRevision`
 * is refused with `profile_stale` (409) when the stored profile no longer has that content. Derived from the content,
 * so no stored counter or migration is needed; an ABA change back to identical content is harmless by construction. */
export async function profileRevision(profile){
 const bytes=new TextEncoder().encode(JSON.stringify([profile.displayName,profile.bio,profile.avatar,profile.discloseToContacts]));
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].slice(0,16).map(b=>b.toString(16).padStart(2,'0')).join('');
}
export class ContactProfiles {
 constructor({metadata,endpoints,clock=()=>Date.now()}){Object.assign(this,{metadata,endpoints,clock});}
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
   if(expectedRevision!==undefined){expected=profileView(await readPair(this.metadata,'profile'));if(await profileRevision(expected)!==expectedRevision){if(!withdraw||!expected.discloseToContacts)stale();diverged=true;}}
   await this.metadata.transaction(async tx=>{
    const current=profileView(await readPair(tx,'profile'));
    if(expected&&(diverged||!sameProfile(current,expected))){if(!withdraw||!current.discloseToContacts)stale();await putPair(tx,'profile','',{...current,discloseToContacts:false,owner,updatedAt:this.clock()});return;}
    await putPair(tx,'profile','',row);
   });
  }
  const profile=profileView(await readPair(this.metadata,'profile'));return {...profile,revision:await profileRevision(profile)};
 }
 /** Which profile fields one of the owner's contact links discloses. A body naming both keys is refused (review R3). */
 async sharing(owner,id,input){
  if(!input||typeof input!=='object'||Array.isArray(input)||!Object.keys(input).length||Object.keys(input).some(k=>!['profileFields','discloseProfile'].includes(k))||input.discloseProfile!==undefined&&typeof input.discloseProfile!=='boolean'||input.profileFields!==undefined&&input.discloseProfile!==undefined)fail('contact_sharing_invalid','Choose the profile fields this contact link shares.');
  if(input.profileFields!==undefined&&(!Array.isArray(input.profileFields)||input.profileFields.length>3||new Set(input.profileFields).size!==input.profileFields.length||input.profileFields.some(k=>!PROFILE_FIELDS.includes(k))))fail('profile_fields_invalid','Choose display name, bio or avatar fields to share.');
  return this.metadata.transaction(async tx=>{
   const grant=await tx.get(key('contact-grant',id));if(!live(grant,owner,this.clock())||grant.quarantined)fail('contact_not_found','The contact invitation is inactive.',404);
   const legacy=await tx.get(LEGACY_CONTACT_KEYS.sharing+id),prior=sharingRow(pickRow(await tx.get(CONTACT_KEYS.sharing+id),legacy)),profileFields=effectiveSharingFields(input,prior.profileFields),updatedAt=this.clock();
   // The legacy twin keeps the pre-removal shape, including any stored `beamEnabled`, so a rollback reads it unchanged.
   await putPair(tx,'sharing',id,{profileFields,updatedAt},{beamEnabled:legacy?.beamEnabled===true,profileFields,updatedAt});
   return {id,profileFields,discloseProfile:profileFields.length>0};
  });
 }
 // Wargame round 3 L3: every binding also writes a peer-keyed index row, so peerBindings() reads only this peer's
 // bindings instead of scanning a capped prefix of every owner binding. Quarantine is read inside the transaction
 // (round 3 plausible finding), so a link quarantined after inspection is never persisted. Quarantine is silent to
 // link holders (contact-tokens.md): redemption answers as for an active link. While quarantined the binding is not
 // persisted (review #2), so a leaked paused link cannot take the single redemption slot; the holder redeems again
 // after release.
 async redeem(owner,url,peer){
  const {grant}=await this.endpoints.inspect(url);if(grant.owner!==owner||!uuid(peer)||peer===owner)fail('contact_invalid_redemption','Redeem another account’s signed contact link.');
  return this.metadata.transaction(async tx=>{
   const current=await tx.get(key('contact-grant',grant.id));if(!live(current,owner,this.clock()))unauthorized();
   const prior=pickRow(await tx.get(CONTACT_KEYS.redeemed+grant.id),await tx.get(LEGACY_CONTACT_KEYS.redeemed+grant.id));if(prior&&prior.peer!==peer)fail('contact_already_redeemed','This invitation has already been bound to another account.',409);
   const binding={peer,grantId:grant.id,owner,expiresAt:current.claims.exp*1000};
   if(!current.quarantined){const updatedAt=this.clock();await putPair(tx,'redeemed',grant.id,{...binding,updatedAt});await putPair(tx,'redeemedPeer',`${peer}/${grant.id}`,{grantId:grant.id,updatedAt});}
   return binding;
  });
 }
 /** Active redemption bindings of the owner's links held by one peer (bounded by the stored-grant cap). */
 async peerBindings(owner,peer){
  if(!uuid(peer)||peer===owner)return [];const out=[];
  for(const row of (await listRows(this.metadata,'redeemedPeer',{suffix:peer+'/',limit:MAX_STORED_GRANTS})).values()){
   const grantId=row?.grantId,binding=uuid(grantId)?await readPair(this.metadata,'redeemed',grantId):null;if(binding?.owner!==owner||binding.peer!==peer)continue;
   const grant=await this.metadata.get(key('contact-grant',grantId));if(live(grant,owner,this.clock())&&!grant.quarantined)out.push({grantId,expiresAt:binding.expiresAt});
  }
  return out;
 }
 /** Saves a contact link this account redeemed: `binding` is the link owner's redemption answer. */
 async remember(owner,binding,{encryptedURL}={}){
  if(!uuid(binding?.owner)||!uuid(binding.peer)||binding.peer!==owner||!uuid(binding.grantId))fail('contact_invalid_redemption','Invalid contact binding.');
  return this.metadata.transaction(async tx=>{
   const rows=await listRows(tx,'saved',{limit:MAX_SAVED_CONTACTS+1}),kept=[...rows].filter(([,row])=>row);
   if(kept.length>=MAX_SAVED_CONTACTS&&!rows.get(binding.owner))fail('contact_directory_full','The contact directory is full.',429);
   const {peer,grantId,owner:linkOwner,expiresAt}=binding;
   await putPair(tx,'saved',linkOwner,{peer,grantId,owner:linkOwner,expiresAt,...encryptedURL?{encryptedURL}:{},updatedAt:this.clock()});
   return {peer:linkOwner,grantId};
  });
 }
 async forget(owner,peer){if(!uuid(peer))fail('contact_invalid','Choose a contact.');await this.metadata.transaction(tx=>tx.delete([CONTACT_KEYS.saved+peer,LEGACY_CONTACT_KEYS.saved+peer]));return {removed:true,peer};}
 /** Unexpired saved contacts: {peer, grantId, encryptedURL?}; the caller decrypts and strips encryptedURL. */
 async directory(){return [...(await listRows(this.metadata,'saved',{limit:MAX_SAVED_CONTACTS})).values()].filter(r=>r&&r.expiresAt>this.clock()).map(r=>({peer:r.owner,grantId:r.grantId,...r.encryptedURL?{encryptedURL:r.encryptedURL}:{}}));}
 async relationship(owner,peer,{grantId}={}){
  if(!uuid(grantId))fail('contact_inactive','Use an imported signed contact link.',403);
  const binding=await readPair(this.metadata,'redeemed',grantId),grant=await this.metadata.get(key('contact-grant',grantId));
  if(!binding||binding.owner!==owner||binding.peer!==peer||!live(grant,owner,this.clock()))fail('contact_inactive','This contact link is no longer active.',403);
  return {grant,sharing:sharingRow(await readPair(this.metadata,'sharing',grantId))};
 }
 async selectedProfile(owner,sharing){const profile=await this.profile(owner);if(!profile.discloseToContacts||!sharing?.profileFields?.length)return null;return Object.fromEntries(sharing.profileFields.filter(field=>PROFILE_FIELDS.includes(field)).map(field=>[field,profile[field]]));}
 async contactInfo(owner,peer,input){const {sharing}=await this.relationship(owner,peer,input);return {profile:await this.selectedProfile(owner,sharing)};}
 async disclosed(owner,peer,{grantId}={}){if(!uuid(grantId))return null;return (await this.contactInfo(owner,peer,{grantId})).profile;}
 // Quarantine is silent: a quarantined link's profile answers exactly as an active link's (contact-tokens.md, links §6.4).
 async publicProfile(owner,url){
  const {grant,endpoint}=await this.endpoints.inspect(url);if(grant.owner!==owner)unauthorized();
  const sharing=sharingRow(await readPair(this.metadata,'sharing',grant.id)),identity=new URL(endpoint);identity.pathname=identity.pathname.replace(/\/contact\/[^/]+$/,'');identity.search='';identity.hash='';
  return {identityURI:identity.href,profile:await this.selectedProfile(owner,sharing)};
 }
 /** Sharing rows for the owner's contact list, keyed by grant ID. */
 async sharingRows(){const out=new Map();for(const [id,row]of await listRows(this.metadata,'sharing',{limit:MAX_STORED_GRANTS}))if(row)out.set(id,sharingRow(row));return out;}
}
