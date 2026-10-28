// AU-S3 remote-store cascade. Called only by an internal adapter, scoped to the owner's federation shard.
// Repeats are harmless; later connection generations and approvals remain intact.
import {revokeFamily,endLineage} from '../federation/app-sessions.mjs';
import {syncEventReaders} from '../federation/event-readers.mjs';
const key=(kind,id)=>`federation/${kind}/${id}`;
export async function revokeRemovalFederation(service,input){
 const {owner,clientId,connection,generation,committed_at}=input??{};
 if(owner!==service.routingKey||typeof clientId!=='string'||typeof connection!=='string'||!Number.isSafeInteger(generation)||generation<1||!Number.isSafeInteger(committed_at)||committed_at<0)throw Object.assign(new Error('Invalid removal cascade.'),{code:'invalid_request',status:400});
 const subject=`${service.issuer}/entities/${owner}`,ended=[];
 const out=await service.store.transaction(async tx=>{
  const old=r=>r?.clientId===clientId&&(r.subject===undefined||r.subject===subject)&&(r.connection?.id===connection&&Number.isSafeInteger(r.connection.generation)?r.connection.generation<generation:Number.isSafeInteger(r.createdAt??r.approvedAt)?(r.createdAt??r.approvedAt)<=committed_at:true);
  const counts={grants:0,families:0,credentials:0,requests:0};const revokedGrants=new Set(),revokedFamilies=new Set(),credentialHashes=new Set(),sessionHashes=new Set();
  for(const row of await tx.list(key('grant','')))if(old(row.value)){row.value.active=false;await tx.set(row.key,row.value);revokedGrants.add(row.value.id);counts.grants++;}
  for(const row of await tx.list(key('family','')))if(old(row.value)){await revokeFamily(service,tx,row.value);ended.push(row.value);revokedFamilies.add(row.value.familyId);counts.families++;}
  for(const kind of ['code','request','token','refresh','claim','embed','embed-session','embed-stream'])for(const row of await tx.list(key(kind,''))){
   const r=row.value;let match=revokedFamilies.has(r.familyId)||r.grants?.some(id=>revokedGrants.has(id))||credentialHashes.has(r.credentialHash)||sessionHashes.has(r.sessionHash);
   if(kind==='request')match=r.clientId===clientId&&(r.connectionBinding?.generation!==undefined?r.connectionBinding.generation<generation:r.expiresAt-600000<=committed_at);
   else if(!match&&kind!=='embed-stream'&&kind!=='refresh')match=old(r);
   if(match&&kind==='request'){await tx.set(row.key,{...r,status:'denied',removalGeneration:generation});counts.requests++;continue;}
   if(match){if(kind==='embed')credentialHashes.add(row.key.slice(key('embed','').length));if(kind==='embed-session')sessionHashes.add(row.key.slice(key('embed-session','').length));await tx.delete(row.key);counts[kind==='request'?'requests':'credentials']++;}
  }
  // Family revocation already removed its paired sessions; remove their inert stream leases too.
  for(const row of await tx.list(key('embed-stream','')))if(!await tx.get(key('embed-session',row.value.sessionHash))){await tx.delete(row.key);counts.credentials++;}
  // Brokered JTIs name the HOST connection; their consumer's grants/family identify the revoked authority.
  for(const row of await tx.list(key('brokered-jti',''))){const r=row.value;if(r.clientId!==clientId||r.invalidated||!(revokedFamilies.has(r.familyId)||r.grants?.some(id=>revokedGrants.has(id))))continue;r.invalidated=true;await tx.set(row.key,r);if(r.connection&&r.grant){const source=service.random();await tx.set(key('brokered-event',source),{source,event:{type:'credential-revoked',connection:r.connection,grants:[r.grant],until:Math.ceil((committed_at+360000)/1000)}});}}
  return counts;
 });
 await endLineage(service,ended);await syncEventReaders(service,subject);await service.grantSync?.(subject,clientId);await service.drainBrokeredEvents();return out;
}
