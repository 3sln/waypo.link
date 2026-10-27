// Store keys shared by the relation modules (packages/orgs/relation-*.mjs), so the ORG-10d/10e method modules and the
// ORG-10b/10c service use one layout without importing each other. Organization account store; see
// packages/orgs/relation-instances.mjs for the record shapes.
import {principalKey} from '../core/principals.mjs';

export const pad=n=>String(Math.max(0,Math.min(Math.floor(n),999999999999999))).padStart(15,'0');
export const ik=instance=>encodeURIComponent(instance);
const pk=principalKey;
export const party=p=>({iss:p.iss,sub:p.sub});
export const K=Object.freeze({state:'rel/state',instance:i=>'rel/instance/'+ik(i),cpPrefix:i=>'rel/cp/'+ik(i)+'/',cp:(i,p)=>'rel/cp/'+ik(i)+'/'+pk(p),inv:j=>'rel/inv/'+j,pair:p=>'rel/pair/'+pk(p),
 inbound:j=>'rel/inbound/'+j,accepting:j=>'rel/accepting/'+j,mute:p=>'rel/mute/'+pk(p),doc:d=>'rel/doc/'+d,used:id=>'rel/used/'+encodeURIComponent(id),seen:p=>'rel/seen/'+pk(p),
 outbox:(at,s)=>'rel/outbox/'+String(at).padStart(15,'0')+'/'+String(s).padStart(15,'0'),outboxSeq:'rel/outbox-seq',jti:(p,j)=>'rel/jti/'+pk(p)+'/'+encodeURIComponent(j),
 jtiAt:(at,p,j)=>'rel/jti-at/'+pad(at)+'/'+pk(p)+'/'+encodeURIComponent(j),aep:p=>'rel/aep/'+pk(p),
 // Open-invitation indexes (review L3, M1): by instance (leaving), by issuing admin (removal or hold), by expiry
 // (sweep), and closed invitations by close time (retention).
 invOpen:(i,j)=>'rel/inv-open/'+ik(i)+'/'+j,invBy:(p,j)=>'rel/inv-by/'+pk(p)+'/'+j,invDue:(at,j)=>'rel/inv-due/'+pad(at)+'/'+j,invDone:(at,j)=>'rel/inv-done/'+pad(at)+'/'+j,sweep:'rel/sweep-cursor',
 // ORG-10d/10e.
 hold:p=>'rel/hold/'+pk(p),                       // RL-4 hold on a counterpart {principal, kind:'full'|'write', aep, cause, since, until}
 confirmed:p=>'rel/confirmed/'+pk(p),             // the last admin confirmation {aep, at, by}
 successor:p=>'rel/successor/'+pk(p),             // origin principal -> {current, attested, at} (the counterpart moved)
 origin:p=>'rel/origin/'+pk(p),                   // current principal -> {origin} (reverse of successor)
 reach:p=>'rel/reach/'+pk(p),                     // delivery failures {since, last, flagged}
 billing:'rel/billing',                           // {stage:'active'|'read-only'|'export-only', at}
 closing:'rel/closing',                           // the deletion pre-purge step {at, cursor}
 left:(at,i)=>'rel/left/'+pad(at)+'/'+ik(i),       // left participations by leave time (retention, review M1)
 tick:'rel/tick',                                 // the alarm state {resyncAt, cursor}
 intro:id=>'rel/intro/'+id,                       // an inbound introduction item for my admins
 introDay:(p,day)=>'rel/intro-day/'+pk(p)+'/'+day, // RL-11 introductions per (proposer, receiver) per UTC day
 introduced:id=>'rel/introduced/'+id,             // an introduction I sent (recognition notices are matched against it)
 proof:h=>'rel/proof/'+h,                         // entity-certificate DPoP replay rows {expiresAt}
 proofAt:(at,h)=>'rel/proof-at/'+pad(at)+'/'+h,
});
