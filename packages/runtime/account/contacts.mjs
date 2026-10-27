// AccountController slice 3, contact links (docs/architecture/app-engine.md §12): the owner's contact parents, the
// opener's audience response and developer contact. Legacy contact grants, intake, delivery bearers, envelope
// authoring and quarantine left the core with messaging on 2026-10-27 (DEVLOG "Messaging removed from core; Parlay
// rename; BB-CUT reset"); contacts and saved contacts belong to the messaging app (SQ-2, provisional).
// `methods` are installed on AccountController.prototype (`this` is the controller); `rpc` lists the methods
// `invoke` accepts and the placement policy it applies to each (packages/runtime/account/index.mjs).
import {developerContactTier,developerContactLink} from '../developer-contact.mjs';
import {signOwnLinkResponse} from '../../links/audience.mjs';
import {contactParents} from '../../links/parents.mjs';

export const methods={
  /** The owner's contact parents (packages/links/parents.mjs): every issued link record, live or retained, with the
   * profile fields it shares. The snapshot and the RTC owner routes (contact-link configuration) read this list. */
  async contacts(owner){const sharing=await this.contactProfiles.sharingRows();return (await contactParents(options=>this.metadata.list(options),owner,Date.now())).map(parent=>({...parent,profileFields:sharing.get(parent.id)?.profileFields??[],discloseProfile:Boolean(sharing.get(parent.id)?.profileFields?.length)}));},
  async developerContactTier(owner){return developerContactTier(this,owner);},
  async developerContactLink(owner,handle){return developerContactLink(this,owner,handle);},
  async signLinkResponse(owner,handle,link){return signOwnLinkResponse(this,owner,handle,link);},
};

export const rpc={
 contacts:{},
 signLinkResponse:{},
 developerContactTier:{},
 developerContactLink:{gate:'none'},
};
