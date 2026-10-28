// AccountController slice: developer contact's billing-tier read (contacts spike §4.7, CR-C5). GET/POST
// /api/developer-contact (routes/developer-contact.mjs) read the requesting user's tier from the user's own account.
// Moved from the removed contact-links slice (account/contacts.mjs, contacts phase 4; provisional, unsigned).
// `methods` are installed on AccountController.prototype (`this` is the controller); `rpc` lists the methods `invoke`
// accepts (packages/runtime/account/index.mjs).
import {developerContactTier} from '../developer-contact.mjs';

export const methods={
  async developerContactTier(owner,options){return developerContactTier(this,owner,{fresh:options?.fresh!==false});},
};
export const rpc={developerContactTier:{}};
