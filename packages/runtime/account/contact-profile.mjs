// AccountController slice: contact profile and saved contacts (docs/architecture/app-engine.md §12). The owner's
// contact profile, per-link profile sharing, contact-link redemption and saved contacts (packages/links/contact-profile.mjs),
// plus the `beam-retired-v1` storage step. Replaced the contact half of slice 11 (Beaming) when Beam left the core
// (DEVLOG 2026-10-26). `methods` are installed on AccountController.prototype (`this` is the controller); `rpc` lists
// the methods `invoke` accepts and the placement policy it applies to each (packages/runtime/account/index.mjs).
import {encryptSecret,decryptSecret} from '../secrets.mjs';
import {retireBeamStorage,BEAM_RETIRED_MARKER} from '../beam-retirement.mjs';
import {CloudflareTurnAdapter} from '../../rtc/turn.mjs';

export const methods={
  async accountProfile(owner,input){return this.contactProfiles.profile(owner,input);},
  async contactSharing(owner,id,input){return this.contactProfiles.sharing(owner,id,input);},
  async contactRedeem(owner,url,peer){return this.contactProfiles.redeem(owner,url,peer);},
  async savedContactRemember(owner,binding,url){return this.contactProfiles.remember(owner,binding,typeof url==='string'?{encryptedURL:await encryptSecret({url},this.config.KEY_ENCRYPTION_KEY)}:{});},
  async savedContacts(owner){return Promise.all((await this.contactProfiles.directory()).map(async ({encryptedURL,...row})=>({...row,...encryptedURL?await decryptSecret(encryptedURL,this.config.KEY_ENCRYPTION_KEY):{}})));},
  async savedContactForget(owner,peer){return this.contactProfiles.forget(owner,peer);},
  async contactInfo(owner,peer,input){return this.contactProfiles.contactInfo(owner,peer,input);},
  async contactProfile(owner,url){return this.contactProfiles.publicProfile(owner,url);},
  async contactDisclosed(owner,peer,input){return this.contactProfiles.disclosed(owner,peer,input);},
  /** One bounded `beam-retired-v1` pass. The warm path stops once the marker exists and never calls the TURN provider;
   * the alarm path always reconciles a slice (legacy rows may be rewritten by rolled-back code) and revokes TURN
   * usernames within the batch budget. Reschedules itself only while the marker is missing. */
  async retireBeamStorage({limit=64,alarm=false}={}){
    if(!alarm&&await this.metadata.get(BEAM_RETIRED_MARKER))return {done:true,moved:0,pruned:0,deleted:0,revoked:0};
    const {CLOUDFLARE_TURN_KEY_ID:keyId,CLOUDFLARE_TURN_API_TOKEN:apiToken}=this.config,adapter=keyId&&apiToken?new CloudflareTurnAdapter({keyId,apiToken}):null;
    const result=await retireBeamStorage(this.metadata,{limit,revoke:adapter?alarm?username=>adapter.revoke(username):'defer':null});
    if(!result.done)await this.scheduleAlarm(Date.now()+(alarm?1000:60000));
    return result;
  },
};

export const rpc={
 accountProfile:{},
 contactSharing:{},
 contactRedeem:{},
 savedContactRemember:{},
 savedContacts:{},
 savedContactForget:{},
 contactInfo:{},
 contactProfile:{},
 contactDisclosed:{},
};
