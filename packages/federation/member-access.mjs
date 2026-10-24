// ORG-4 bridge into ORG-3 (docs/spec/organizations.md §7.2; packages/orgs/federation.mjs): the member-context access
// token as a FEDERATION access token of the organization's shard, DPoP-bound to the certified holder key, carrying the
// verified `member` context that ORG-3's `tokenRecord` hook resolves live on every call (§6.2 intersection).
//
// The organization's account writer has already verified the certificate, the proof, the membership, the epoch and the
// connection (packages/orgs/certificates.mjs `admitToken`); this shard re-checks what it owns: the client is known, the
// organization's live grants to that client exist at the current authority epoch, the connection generation is live.
// `expiresAt` (ms) is the certificate-bounded expiry; it is never extended and there is no refresh token or family.
import {boundTokenId} from './app-sessions.mjs';
import {fail} from './schema.mjs';

const key=(kind,id)=>`federation/${kind}/${id}`;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const JKT=/^[A-Za-z0-9_-]{43}$/,ID=/^[A-Za-z0-9_-]{16,64}$/,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Max lifetime of a member-context federation token, whatever the certificate says (DPoP-bound tokens' ceiling). */
export const MEMBER_ACCESS_MAX_MS=3600000;
/** Live member-context tokens per (membership, client): a new one evicts that membership's oldest for the client
 * (wargame F-06). Member tokens are counted apart from the organization's app tokens. */
/** Review follow-up 5: at most MEMBER_ACCESS_PER_MEMBERSHIP live tokens per membership across all its clients (the
 * membership's oldest is evicted), so one member can hold at most that share of the organization-wide bound. */
export const MEMBER_ACCESS_PER_CLIENT=8,MEMBER_ACCESS_PER_MEMBERSHIP=16,MEMBER_ACCESS_DEFAULT_CAPACITY=256,MEMBER_ACCESS_MAX_CAPACITY=131072;
/** The organization-wide bound on live member tokens for a plan selling `members` members: every member can hold their
 * full per-membership share at once. */
export const memberAccessCapacity=members=>Math.min(MEMBER_ACCESS_MAX_CAPACITY,Math.max(MEMBER_ACCESS_DEFAULT_CAPACITY,(Number.isSafeInteger(members)&&members>0?members:0)*MEMBER_ACCESS_PER_MEMBERSHIP));

/** `input`: {clientId, jkt, expiresAt, epoch, connection:{id, generation}, member:{principal, membership_id, generation,
 * aep, client, addedUnder?}, capacity?} (`capacity`: the organization-wide live member-token bound, from the plan). Returns {access_token, token_type:'DPoP', expires_in}. Every refusal is `invalid_grant`. */
export async function issueMemberAccess(service,input){
 const refuse=()=>fail('invalid_grant','invalid_grant');
 if(!plain(input)||typeof input.clientId!=='string'||!JKT.test(input.jkt??'')||!Number.isSafeInteger(input.expiresAt)||typeof input.epoch!=='string'||!plain(input.connection)||typeof input.connection.id!=='string'||!Number.isSafeInteger(input.connection.generation))refuse();
 const m=input.member;
 if(!plain(m)||!plain(m.principal)||typeof m.principal.sub!=='string'||!UUID.test(m.principal.sub)||!ID.test(m.membership_id??'')||!Number.isSafeInteger(m.generation)||!Number.isSafeInteger(m.aep)||m.aep<0||m.client!==input.clientId)refuse();
 if(!service.routingKey||!service.clients.has(input.clientId))refuse();
 const subject=`${service.issuer}/entities/${service.routingKey}`,now=service.clock(),expiresAt=Math.min(input.expiresAt,now+MEMBER_ACCESS_MAX_MS),expires_in=Math.floor((expiresAt-now)/1000);
 if(expires_in<1)refuse();
 const issued=await service.store.transaction(async tx=>{
  try{await service.active(subject,input.epoch);}catch{refuse();}
  if(service.connections){let live=false;try{live=await service.connections.check(input.connection,input.clientId)===true;}catch{live=false;}if(!live)refuse();}
  const grants=[];for(const {value} of await tx.list(key('grant','')))if(value?.active&&value.subject===subject&&value.clientId===input.clientId&&value.epoch===input.epoch)grants.push(value.id);
  if(!grants.length)refuse();
  // Member tokens only: prune expired rows, evict this membership's oldest for this client beyond the per-client cap,
  // and refuse only when the organization-wide member bound is reached (app tokens are bounded separately).
  const capacity=Number.isSafeInteger(input.capacity)?Math.min(MEMBER_ACCESS_MAX_CAPACITY,Math.max(1,input.capacity)):MEMBER_ACCESS_DEFAULT_CAPACITY;
  const mine=[];let live=0;
  for(const row of await tx.list(key('token',''))){const value=row.value;if(!value?.member)continue;if(!(value.expiresAt>now)){await tx.delete(row.key);continue;}
   if(value.member.membership_id===m.membership_id)mine.push(row);else live++;}
  const age=(a,b)=>(a.value.issuedAt??0)-(b.value.issuedAt??0)||(a.value.expiresAt-b.value.expiresAt);mine.sort(age);
  // Evict this membership's oldest for this client beyond the per-client cap, then its oldest overall beyond the
  // per-membership total.
  const forClient=mine.filter(row=>row.value.clientId===input.clientId),evict=new Set(forClient.slice(0,Math.max(0,forClient.length+1-MEMBER_ACCESS_PER_CLIENT)));
  const kept=mine.filter(row=>!evict.has(row));for(const row of kept.slice(0,Math.max(0,kept.length+1-MEMBER_ACCESS_PER_MEMBERSHIP)))evict.add(row);
  // A refusal still commits the pruning above: the transaction returns, and the refusal is thrown after it.
  if(live+mine.length-evict.size>=capacity)return null;
  for(const row of evict)await tx.delete(row.key);
  const access_token=service.random(),id=await boundTokenId(service,access_token);
  const member={principal:{iss:m.principal.iss??null,sub:m.principal.sub},membership_id:m.membership_id,generation:m.generation,aep:m.aep,...plain(m.addedUnder)?{addedUnder:structuredClone(m.addedUnder)}:{}};
  await tx.set(key('token',id),{issuer:service.issuer,audience:service.audience,subject,epoch:input.epoch,connection:{id:input.connection.id,generation:input.connection.generation},clientId:input.clientId,grants,expiresAt,issuedAt:now,jkt:input.jkt,member});
  return {access_token,token_type:'DPoP',expires_in};
 });
 return issued??refuse();
}
