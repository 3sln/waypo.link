// AccountController slice: the owner's contact profile and per-link profile sharing (packages/links/contact-profile.mjs).
// Saved contacts, contact-link redemption and the `beam-retired-v1` step were removed with core messaging on
// 2026-10-27 (DEVLOG "Messaging removed from core; Parlay rename; BB-CUT reset"; SQ-2, provisional).
// `methods` are installed on AccountController.prototype (`this` is the controller); `rpc` lists the methods `invoke`
// accepts and the placement policy it applies to each (packages/runtime/account/index.mjs).
export const methods={
  async accountProfile(owner,input){return this.contactProfiles.profile(owner,input);},
  async contactSharing(owner,id,input){return this.contactProfiles.sharing(owner,id,input);},
  async contactProfile(owner,url){return this.contactProfiles.publicProfile(owner,url);},
};

export const rpc={
 accountProfile:{},
 contactSharing:{},
 contactProfile:{},
};
