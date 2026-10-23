// ORG-3 adapter over an account single writer. ORG-4 stores the verified origin principal, opaque membership id,
// generation and epoch in `token.member`; certificates and holder proofs remain ORG-4's responsibility.
import {organizationFederationPort} from './grants.mjs';
export function organizationAccountAuthority({account,owner,enabled}){
 return organizationFederationPort({enabled,resolve:(context,token)=>account.orgsMemberSnapshot(owner,{
  principal:context.principal,membership_id:context.membership_id??context.membership?.id,
  generation:context.generation??context.membership?.generation,aep:context.aep,client:token.clientId,
 })});
}
