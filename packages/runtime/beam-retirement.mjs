// `beam-retired-v1`: the account step that retires Beam's `beam/` storage after Beam left the core (DEVLOG 2026-10-26
// "Beam removed from core", review follow-ups R1 and R3).
//
// Release v1 must stay correct under a rollback to, or a mixed deployment with, the pre-removal code, which uses only
// the legacy keys (see packages/links/contact-profile.mjs). So this step:
// 1. Deletes the Beam-only families (transfer offers, monthly usage, the recipient mailbox, nearby invitations and
//    pairings); no rollback needs them to be correct. On the alarm path only, unexpired TURN usernames held by an offer
//    are revoked first (best effort; each revocation counts against the batch budget; credentials lived at most 300 s).
// 2. Reconciles the generic contact families without deleting any legacy row: a legacy row whose neutral copy is
//    missing or differs (and wins under pickRow) is copied to the neutral key, marked `migrated`; a neutral row whose
//    legacy twin is missing (deleted by pre-removal code) is removed.
// It runs one bounded slice per call from a stored cursor. The marker `migration/beam-retired-v1` is written once the
// Beam-only families are empty and a full reconciliation cycle changed nothing. The marker only stops the warm-path
// calls; the alarm path keeps reconciling a slice per alarm while legacy rows exist, so rows written by rolled-back
// code after the marker are still copied.
// Follow-up `beam-retired-v2` (after a release, not implemented): reconcile once more, delete the legacy rows, and read
// the neutral keys alone.
import {CONTACT_KEYS,LEGACY_CONTACT_KEYS,CONTACT_FAMILIES,sharingRow,pickRow} from '../links/contact-profile.mjs';
import {relaySlot} from '../rtc/relay-credentials.mjs';

export const BEAM_RETIRED_MARKER='migration/beam-retired-v1';
export const BEAM_RETIRED_CURSOR='migration/beam-retired-v1-cursor';
export const BEAM_ONLY_PREFIXES=Object.freeze(['beam/offer/','beam/usage','beam/mailbox/','beam/invite/','beam/nearby/']);
const offerUsernames=offer=>Object.values(offer?.iceIssued??{}).flatMap(slot=>relaySlot(slot).usernames);
const present=row=>row!==undefined&&row!==null;
/** The neutral copy of a legacy row (sharing drops `beamEnabled`); keeps the legacy stamp, if any. */
const copyOf=(name,row)=>({...(name==='sharing'?sharingRow(row):row),...Number.isSafeInteger(row?.updatedAt)?{updatedAt:row.updatedAt}:{},migrated:true});
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object'){const out={};for(const k of Object.keys(value).sort())if(k!=='migrated')out[k]=canonical(value[k]);return out;}return value;}
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));

/** Reconciles one neutral/legacy pair; returns 'copied', 'pruned' or null. */
async function reconcile(tx,name,id){
 const current=await tx.get(CONTACT_KEYS[name]+id),legacy=await tx.get(LEGACY_CONTACT_KEYS[name]+id);
 if(!present(legacy)){if(present(current)){await tx.delete([CONTACT_KEYS[name]+id]);return 'pruned';}return null;}
 if(pickRow(current,legacy)===current)return null;
 const copy=copyOf(name,legacy);if(present(current)&&same(current,copy))return null;
 await tx.put(CONTACT_KEYS[name]+id,copy);return 'copied';
}

/** One bounded pass. `revoke` is a TURN revoker (alarm path), 'defer' (warm path with TURN configured) or null
 * (no TURN configured: nothing can be revoked, every offer is deleted). Returns {done, moved, pruned, deleted, revoked}; `done` is true once the marker exists. */
export async function retireBeamStorage(store,{limit=64,revoke=null,now=()=>Date.now()}={}){
 let budget=limit,moved=0,pruned=0,deleted=0,revoked=0;
 for(const prefix of BEAM_ONLY_PREFIXES){
  if(budget<=0)break;
  let rows=[...await store.list({prefix,limit:budget})];if(!rows.length)continue;
  // `revoke: 'defer'` (warm path with TURN configured): offers still holding unexpired usernames wait for the alarm.
  if(prefix==='beam/offer/'&&revoke==='defer')rows=rows.filter(([,offer])=>!offerUsernames(offer).some(entry=>entry.expiresAt>now()));
  if(prefix==='beam/offer/'&&typeof revoke==='function'){
   const kept=[];
   for(const row of rows){const pending=offerUsernames(row[1]).filter(entry=>entry.expiresAt>now());if(pending.length>=budget&&kept.length)break;for(const {username} of pending){budget--;try{await revoke(username);revoked++;}catch{/* Expires within 300 s regardless. */}}kept.push(row);}
   rows=kept;
  }
  if(rows.length)await store.transaction(tx=>tx.delete(rows.map(([path])=>path)));deleted+=rows.length;budget-=Math.max(1,rows.length);
 }
 const beamOnlyLeft=async()=>{for(const prefix of BEAM_ONLY_PREFIXES)if((await store.list({prefix,limit:1})).size)return true;return false;};
 let cursor=await store.get(BEAM_RETIRED_CURSOR)??{family:0,phase:'legacy',after:'',dirty:false};
 while(budget>0){
  const name=CONTACT_FAMILIES[cursor.family];
  if(name===undefined){
   // A full cycle ended: write the marker when it changed nothing and no Beam-only row is left, then start over.
   if(!cursor.dirty&&!await beamOnlyLeft()&&!await store.get(BEAM_RETIRED_MARKER))await store.put(BEAM_RETIRED_MARKER,{at:now()});
   cursor={family:0,phase:'legacy',after:'',dirty:false};await store.put(BEAM_RETIRED_CURSOR,cursor);break;
  }
  const prefix=(cursor.phase==='legacy'?LEGACY_CONTACT_KEYS:CONTACT_KEYS)[name];
  await store.transaction(async tx=>{
   const take=budget,rows=name==='profile'?(present(await tx.get(prefix))?[[prefix]]:[]):[...await tx.list({prefix,startAfter:cursor.after?prefix+cursor.after:'',limit:take})];
   for(const [path] of rows){const outcome=await reconcile(tx,name,path.slice(prefix.length));if(outcome==='copied')moved++;if(outcome==='pruned')pruned++;if(outcome)cursor.dirty=true;}
   budget-=Math.max(1,rows.length);
   if(name!=='profile'&&rows.length===take)cursor={...cursor,after:rows.at(-1)[0].slice(prefix.length)};
   else cursor={...cursor,after:'',...cursor.phase==='legacy'?{phase:'current'}:{phase:'legacy',family:cursor.family+1}};
   await tx.put(BEAM_RETIRED_CURSOR,cursor);
  });
 }
 return {done:Boolean(await store.get(BEAM_RETIRED_MARKER)),moved,pruned,deleted,revoked};
}
