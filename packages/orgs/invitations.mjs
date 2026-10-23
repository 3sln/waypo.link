// ORG-2 invitation proposal; the random bearer is consumed in the membership transaction, never a public lookup.
import {normalizeMemberGrants} from './grants.mjs';
export const ORG_INVITATION_TYPE='https://spec.bindle.example/links/org-invitation/v1',ORG_INVITATION_MAX_MS=30*86400000;
export function invitationProposal(input,now){
 const grants=normalizeMemberGrants(input.grants??[]),invitee=input.invitee??null,expiresAt=input.expiresAt??now+7*86400000;
 if(invitee!==null&&(!invitee||typeof invitee.iss!=='string'||!/^https?:\/\/[^/\s]+$/.test(invitee.iss)||typeof invitee.sub!=='string'||!/^[a-f0-9-]{36}$/.test(invitee.sub))||grants.some(g=>g.power)&&!invitee||!Number.isSafeInteger(expiresAt)||expiresAt<=now||Math.floor(expiresAt/1000)<=Math.floor(now/1000)||expiresAt>now+ORG_INVITATION_MAX_MS||input.expires_at!==undefined&&(!Number.isSafeInteger(input.expires_at)||input.expires_at<=now/1000))throw new TypeError('Invalid invitation.');
 return {type:ORG_INVITATION_TYPE,invitee,grants,expiresAt,...input.expires_at!==undefined?{expires_at:input.expires_at}:{}};
}

// Link payloads follow the shared envelope parser/signer, with no inviter-supplied display text.
export async function signOrganizationInvitation({row,record,issuer,signer}){
 const {signLinkJWS,LINK_META_TYP}=await import('../links/envelope.mjs');
 const claims={bindle:'link-meta',v:1,type:ORG_INVITATION_TYPE,iss:issuer,aud:`${issuer}/identity/${record.id}`,jti:row.id,iat:Math.floor(row.createdAt/1000),exp:Math.floor(row.expiresAt/1000),...row.invitee?{invitee:row.invitee}:{}};
 const meta=await signLinkJWS({header:{alg:signer.alg??'ES256',kid:signer.kid,typ:LINK_META_TYP},claims,privateKey:signer.privateKey});
 return {meta,url:`${issuer}/orgs/${record.id}/invitation?bindle_meta=${meta}`};
}
