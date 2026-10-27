// The profile fields a contact-link sharing change would disclose (PUT /api/contacts/{id}/sharing). Shared by the
// service (packages/links/contact-profile.mjs), the capacity-admission protective rule and the terms gate, so all three
// classify a body the same way. A body carrying both `profileFields` and `discloseProfile` is invalid and rejected.
export const PROFILE_FIELDS=Object.freeze(['displayName','bio','avatar']);
/** The effective field list, `null` when the body is not a well-formed sharing change, or `prior` when it names neither key. */
export function effectiveSharingFields(input,prior=[]){
 if(!input||typeof input!=='object'||Array.isArray(input))return null;
 const hasFields=input.profileFields!==undefined,hasDisclose=input.discloseProfile!==undefined;
 if(hasFields&&hasDisclose)return null;
 if(hasFields)return Array.isArray(input.profileFields)?[...input.profileFields]:null;
 if(hasDisclose)return typeof input.discloseProfile==='boolean'?input.discloseProfile?[...PROFILE_FIELDS]:[]:null;
 return Array.isArray(prior)?[...prior]:null;
}
/** True only for a well-formed change that discloses no field (withdrawal); anything else is treated as a grant. */
export const withdrawsSharing=input=>{const fields=effectiveSharingFields(input,null);return Array.isArray(fields)&&fields.length===0;};
