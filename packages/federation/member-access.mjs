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

/** `input`: {clientId, jkt, expiresAt, epoch, connection:{id, generation}, member:{principal, membership_id, generation,
 * aep, client, addedUnder?}}. Returns {access_token, token_type:'DPoP', expires_in}. Every refusal is `invalid_grant`. */
export async function issueMemberAccess(service,input){
 const refuse=()=>fail('invalid_grant','invalid_grant');
 if(!plain(input)||typeof input.clientId!=='string'||!JKT.test(input.jkt??'')||!Number.isSafeInteger(input.expiresAt)||typeof input.epoch!=='string'||!plain(input.connection)||typeof input.connection.id!=='string'||!Number.isSafeInteger(input.connection.generation))refuse();
 const m=input.member;
 if(!plain(m)||!plain(m.principal)||typeof m.principal.sub!=='string'||!UUID.test(m.principal.sub)||!ID.test(m.membership_id??'')||!Number.isSafeInteger(m.generation)||!Number.isSafeInteger(m.aep)||m.aep<0||m.client!==input.clientId)refuse();
 if(!service.routingKey||!service.clients.has(input.clientId))refuse();
 const subject=`${service.issuer}/entities/${service.routingKey}`,now=service.clock(),expiresAt=Math.min(input.expiresAt,now+MEMBER_ACCESS_MAX_MS),expires_in=Math.floor((expiresAt-now)/1000);
 if(expires_in<1)refuse();
 return service.store.transaction(async tx=>{
  try{await service.active(subject,input.epoch);}catch{refuse();}
  if(service.connections){let live=false;try{live=await service.connections.check(input.connection,input.clientId)===true;}catch{live=false;}if(!live)refuse();}
  const grants=[];for(const {value} of await tx.list(key('grant','')))if(value?.active&&value.subject===subject&&value.clientId===input.clientId&&value.epoch===input.epoch)grants.push(value.id);
  if(!grants.length)refuse();
  await service.bounded(tx,'token',256);
  const access_token=service.random(),id=await boundTokenId(service,access_token);
  const member={principal:{iss:m.principal.iss??null,sub:m.principal.sub},membership_id:m.membership_id,generation:m.generation,aep:m.aep,...plain(m.addedUnder)?{addedUnder:structuredClone(m.addedUnder)}:{}};
  await tx.set(key('token',id),{issuer:service.issuer,audience:service.audience,subject,epoch:input.epoch,connection:{id:input.connection.id,generation:input.connection.generation},clientId:input.clientId,grants,expiresAt,jkt:input.jkt,member});
  return {access_token,token_type:'DPoP',expires_in};
 });
}
