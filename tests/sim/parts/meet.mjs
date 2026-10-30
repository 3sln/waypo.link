// Scenario part `meet` (spike S6, the call half): a host on beta creates a meeting in the Meet sample; a guest on alpha
// opens the join link signed out (guest view), signs in with their own provider, and calls the host. The call is a
// real RTCPeerConnection carried over cross-provider Bindle signaling (alpha ↔ beta), with mDNS host candidates only.
import * as meet from '../steps/meet.mjs';

export const name='meet';
const provider=(meta,localeNote='mid-flow page: a reload to switch language would restart the flow')=>({...meta,surface:'provider',locale:null,localeNote});
export const moments=Object.freeze({
 'meet-home-signed-out':{title:'Meet: home, signed out',surface:'meet',locale:'meet',element:'<bindle-account> signed out (avatar placeholder)'},
 'meet-sign-in':{title:'Meet: sign in to host (handle form, redirect)',surface:'meet',locale:'meet',element:'<bindle-sign-in> identity-required, islands off'},
 'meet-provider-consent':provider({title:'Provider: Meet asks for the signaling service'}),
 'meet-home':{title:'Meet: start a meeting',surface:'meet',locale:'meet',element:'<bindle-account> signed in'},
 'meet-approval':{title:'Meet: approve calls at your provider',surface:'meet',locale:'meet'},
 'provider-signaling-approve':provider({title:'Provider: approve Meet’s call kind'},'mid-flow page (a review armed for this decision); a reload starts a new review'),
 'provider-signaling-privacy':provider({title:'Provider: direct connections privacy (allow public address)'},'unsaved choice on the page; a reload would discard it'),
 'meet-lobby-host':{title:'Meet: host lobby with the join link',surface:'meet',locale:'meet'},
 'meet-guest':{title:'Meet: join link, guest view (signed out)',surface:'meet',locale:'meet',element:'signed out (guest)'},
 'meet-sign-in-join':{title:'Meet: sign in to join',surface:'meet',locale:'meet',element:'<bindle-sign-in> handle form'},
 'meet-lobby-guest':{title:'Meet: pre-call, ready to join',surface:'meet',locale:'meet'},
 'meet-joining':{title:'Meet: asking to join (guest)',surface:'meet',locale:'meet'},
 'meet-ringing':{title:'Meet: someone wants to join (host)',surface:'meet',locale:'meet'},
 'meet-in-call':{title:'Meet: in call (host, beta)',surface:'meet',locale:'meet'},
 'meet-in-call-guest':{title:'Meet: in call (guest, alpha)',surface:'meet',locale:'meet'},
 'meet-ended':{title:'Meet: call ended',surface:'meet',locale:'meet'}
});

export function define(run,world,{alpha,beta}){
 // Dedicated people (the third on each provider) so Meet does not depend on the core part's Notes and Photos state.
 const host=beta[2]??beta[0],guest=alpha[2]??alpha[0],shared={link:null};
 const p=ctx=>({host:ctx.person(host),guest:ctx.person(guest),alpha:ctx.world.providers.alpha,beta:ctx.world.providers.beta});
 // SIGNALING_ENABLED and SESSION_KINDS_ENABLED require ARTEFACT_VERSIONS_ENABLED (packages/flags/registry.mjs). While a
 // profile override turns artefact versions off, the whole call is one expected-pending step: it must fail today and
 // fails the run (G1) as soon as it passes, so the override cannot hide a working call.
 const versioned=['alpha','beta'].every(n=>world.providers[n]?.config?.ARTEFACT_VERSIONS_ENABLED==='true');
 if(!versioned){
  run.step('meet.call.cross-provider',{actor:guest.name,expect:{pending:'Signaling and session kinds require artefact versions, which this run\'s profile override turns off (world.mjs PROFILE_OVERRIDES), so Meet cannot register an endpoint.',rule:'packages/flags/registry.mjs SIGNALING_ENABLED requires ARTEFACT_VERSIONS_ENABLED; signaling §3.1'}},async ctx=>{
   const {host:h,guest:g,alpha:a,beta:b}=p(ctx);
   await meet.hostSignIn(ctx,h,b);await meet.allowDirect(ctx,h,b);const link=await meet.createMeeting(ctx,h,b,'Design review');
   await meet.guestOpensLink(ctx,g,a,link);await meet.allowDirect(ctx,g,a);await meet.guestJoins(ctx,g,h,a);await meet.connectCall(ctx,h,g);await meet.endCall(ctx,g,h);
  });
  return;
 }
 run.step('meet.host.sign-in',{actor:host.name},ctx=>meet.hostSignIn(ctx,p(ctx).host,p(ctx).beta,{shots:true}));
 run.step('meet.host.direct-connections',{actor:host.name},ctx=>meet.allowDirect(ctx,p(ctx).host,p(ctx).beta,{shots:true}));
 run.step('meet.host.create',{actor:host.name},async ctx=>{shared.link=await meet.createMeeting(ctx,p(ctx).host,p(ctx).beta,'Design review',{shots:true});});
 run.step('meet.guest.open-link',{actor:guest.name},ctx=>meet.guestOpensLink(ctx,p(ctx).guest,p(ctx).alpha,shared.link,{shots:true}));
 run.step('meet.guest.direct-connections',{actor:guest.name},ctx=>meet.allowDirect(ctx,p(ctx).guest,p(ctx).alpha));
 run.step('meet.guest.join',{actor:guest.name},ctx=>meet.guestJoins(ctx,p(ctx).guest,p(ctx).host,p(ctx).alpha,{shots:true}));
 run.step('meet.call.connect',{actor:guest.name},ctx=>meet.connectCall(ctx,p(ctx).host,p(ctx).guest,{shots:true}));
 run.step('meet.call.owner-view',{actor:host.name,via:'api'},ctx=>meet.ownersSeeSession(ctx,[[p(ctx).host,p(ctx).beta],[p(ctx).guest,p(ctx).alpha]]));
 run.step('meet.call.end',{actor:guest.name},ctx=>meet.endCall(ctx,p(ctx).guest,p(ctx).host,{shots:true}));
 run.step('invariant.signaling-closed',{actor:host.name,via:'api',kind:'invariant'},ctx=>meet.sessionsClosed(ctx,[[p(ctx).host,p(ctx).beta],[p(ctx).guest,p(ctx).alpha]]));
}
