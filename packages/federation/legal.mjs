// RFC 7591 §2 policy_uri/tos_uri are presentation links, never fetched. Keep the same-origin HTTPS profile
// used by client-id-metadata.v1 presentation URLs; a link is no evidence of policy review or provider approval.
export function clientPolicyLinks(client){
 const result={};for(const [name,wire] of [['policyUri','policy_uri'],['tosUri','tos_uri']]){const value=client?.[name]??client?.[wire];let url;try{url=typeof value==='string'&&value.length<=2048?new URL(value):null;}catch{url=null;}if(url&&url.href===value&&url.protocol==='https:'&&!url.username&&!url.password&&!url.hash&&url.origin===client.origin)result[name]=value;}return result;
}
/** Normalize operator-reviewed registrations too; invalid optional links are omitted without breaking sign-in. */
export function withClientPolicies(client){const {policyUri,policy_uri,tosUri,tos_uri,...rest}=client;return {...rest,...clientPolicyLinks(client)};}
export const providerLegalMetadata=issuer=>({op_policy_uri:`${issuer}/privacy`,op_tos_uri:`${issuer}/terms`});
