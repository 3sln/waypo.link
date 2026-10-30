// Scenario part 'board' (spike S5): Board needs sign-in (<bindle-gate>); a person keeps a live board (storage, a
// personal event bus, app messages for assignments); an organization on alpha invites members on alpha, beta and the
// clean-room issuer second.example; a member acts for the organization through a member certificate.
import * as board from '../steps/board.mjs';

export const name='board';
export const moments={
 'board-gate':{title:'Board: sign-in required (gate, signed out)',surface:'board',locale:'board',element:'<bindle-gate> signed out'},
 'board-gate-handle':{title:'Board: gate with a handle entered',surface:'board',locale:'board',element:'<bindle-gate> + <bindle-sign-in> handle form'},
 'board-consent':{title:'Provider: review what Board can access (storage, live feed, messages)',surface:'provider',locale:null,localeNote:'mid-flow page: a reload to switch language would restart the flow'},
 'board-populated':{title:'Board: a populated board, live',surface:'board',locale:'board',element:'<bindle-account> signed in (avatar trigger)'},
 'board-live-update':{title:'Board: a card moved in another tab arrives live',surface:'board',locale:'board'},
 'board-assigned':{title:'Board: card assigned to me (toast)',surface:'board',locale:'board'},
 'provider-messages-assigned':{title:'Provider: "Assigned to you" in Messages',surface:'provider',locale:'provider'}
,
 'org-create':{title:'Provider: create an organization',surface:'provider',locale:'provider'},
 'org-invitation':{title:'Provider: invitation link for a member on another provider',surface:'provider',locale:null,localeNote:'the invitation link is shown once; a reload to switch language would lose it'},
 'org-roster':{title:'Provider: organization roster with invitations',surface:'provider',locale:'provider'},
 'org-accept':{title:'Provider: accept an organization invitation',surface:'provider',locale:'provider'},
 'org-joined':{title:'Provider: membership after joining',surface:'provider',locale:'provider'},
 'org-accept-foreign':{title:'Provider (beta): joining an organization on alpha (refused today, expected-pending)',surface:'provider',locale:null,localeNote:'shows the result of a submitted form; a reload would clear it'},
 'board-org-found':{title:'Board: organization found by address',surface:'board',locale:'board'},
 'provider-member-certify':{title:'Provider: issue a member certificate to Board',surface:'provider',locale:null,localeNote:'popup opened by the app; a reload would restart the hand-off'},
 'board-org-sheet-pending':{title:'Board: certificate held, organization has not connected Board (pending)',surface:'board',locale:'board',element:'<bindle-account> composed person + organization'},
 'board-org-context':{title:'Board: header with the composed person and organization avatar',surface:'board',locale:'board',element:'<bindle-account entity> composed avatar'}
};

export function define(run,world,{alpha,beta}){
 // Two board findings depend on ARTEFACT_VERSIONS (versioned result shaping); the profile decides the expectation.
 const versioned=world.providers.alpha.config.ARTEFACT_VERSIONS_ENABLED==='true';
 const [owner,member]=alpha,[foreign]=beta;
 const cards=[{column:'todo',title:'Draft the launch announcement'},{column:'todo',title:'Book the venue walkthrough'},{column:'todo',title:'Order printed signage'},{column:'doing',title:'Finalize the guest list'},{column:'done',title:'Pick the launch date'}];
 run.step('board.gate.signed-out',{actor:owner.name},ctx=>board.openBoard(ctx,ctx.person(owner),{shots:true}));
 run.step('board.bus.create',{actor:owner.name,via:'api'},async ctx=>{
  // The console has no control for creating a feed yet (access view lists, purges and deletes); the owner API is the
  // person's own browser session, so this is the person's request, not a storage write.
  const api=await board.ownerApi(ctx.person(owner),world.providers.alpha),created=await api.post('/api/events/buses',{url:board.BUS_FRAGMENT});
  if(created.status!==200||!created.body?.bus?.id)throw new Error('Creating the board-changes bus failed: '+JSON.stringify(created).slice(0,300));
  ctx.ledger.record(owner.name,'bus','board-changes',{provider:'alpha'});
 });
 run.step('board.sign-in',{actor:owner.name},ctx=>board.signInToBoard(ctx,ctx.person(owner),world.providers.alpha,{shots:true}));
 run.step('board.cards.add',{actor:owner.name},ctx=>board.addCards(ctx,ctx.person(owner),cards,{shots:true}));
 run.step('board.live.second-tab',{actor:owner.name},ctx=>board.liveSecondTab(ctx,ctx.person(owner),world.providers.alpha,{card:cards[1].title,to:'doing',shots:true}));
 run.step('board.live.record-payload',{actor:owner.name,expect:!versioned?'pass':{pending:'With ARTEFACT_VERSIONS on, versioned result shaping (shapeContractResult) withholds every member of an object whose contract schema names no properties; event-bus/v1 declares record `data: {}`, so readers receive `data: {}`. Board treats records as hints and reloads the board, so live updates still work.',rule:'event-bus/v1 contract ($defs.record.data) vs packages/federation/integrations.mjs shapeContractResult'}},ctx=>board.recordPayload(ctx,ctx.person(owner)));
 run.step('board.assign.app-message',{actor:owner.name},ctx=>board.assignToMe(ctx,ctx.person(owner),world.providers.alpha,{card:cards[0].title,shots:true}));

 // Organization on alpha, members on alpha, beta and second.example.
 const orgs={};const secondSub='0c1e5d2a-7b3f-4e61-9a8d-2f4b6c8e1a37';
 run.step('board.org.create',{actor:owner.name},async ctx=>{orgs.harbor=await board.createOrg(ctx,ctx.person(owner),world.providers.alpha,{name:'Harbor Studio',shots:true});});
 const invites={};
 run.step('board.org.invite.alpha',{actor:owner.name},async ctx=>{invites.member=await board.inviteMember(ctx,ctx.person(owner),world.providers.alpha,orgs.harbor,{invitee:'@'+ctx.person(member).accounts.alpha.handle,label:'alpha member'});});
 run.step('board.org.accept.alpha',{actor:member.name},ctx=>board.acceptInvitation(ctx,ctx.person(member),invites.member,{org:orgs.harbor,shots:true}));
 run.step('board.org.invite.beta',{actor:owner.name},async ctx=>{invites.foreign=await board.inviteMember(ctx,ctx.person(owner),world.providers.alpha,orgs.harbor,{invitee:`${world.providers.beta.origin}/identity/${ctx.person(foreign).accounts.beta.id}`,label:'beta member',shots:true,rosterShot:true});});
 run.step('board.org.accept.beta',{actor:foreign.name,expect:{pending:'A member homed on beta cannot join an organization on alpha: POST /api/orgs/{id}/accept resolves the organization on the person\'s own host (accountHandle), and the certificate-based acceptance (input.admit, packages/orgs/certificates.mjs) has no route.',rule:'organizations rev 4.5 §5 foreign members; packages/runtime/routes/orgs.mjs accept'}},ctx=>board.acceptForeignInvitation(ctx,ctx.person(foreign),world.providers.beta,invites.foreign,{shots:true}));
 run.step('board.org.invite.second',{actor:owner.name,via:'api'},ctx=>board.inviteSecondMember(ctx,ctx.person(owner),world.providers.alpha,orgs.harbor,secondSub));
 run.step('board.org.second.member-token',{actor:owner.name,via:'api',expect:{pending:'The second.example member never joined (no foreign acceptance route) and the organization has no connection to Board (organizations have no app authorization flow), so the organization answers invalid_grant to a valid foreign member certificate.',rule:'organizations §5.3 member token; packages/runtime/account/member-certificates.mjs memberTokenAdmit'}},ctx=>board.secondMemberToken(ctx,world.providers.alpha,orgs.harbor,secondSub));
 // The alpha member uses the organization in Board.
 run.step('board.member.bus.create',{actor:member.name,via:'api'},async ctx=>{const api=await board.ownerApi(ctx.person(member),world.providers.alpha),created=await api.post('/api/events/buses',{url:board.BUS_FRAGMENT});if(created.status!==200)throw new Error('bus: '+JSON.stringify(created).slice(0,200));});
 run.step('board.member.sign-in',{actor:member.name},async ctx=>{await board.openBoard(ctx,ctx.person(member));await board.signInToBoard(ctx,ctx.person(member),world.providers.alpha);});
 run.step('board.org.certify',{actor:member.name},ctx=>board.useOrgInBoard(ctx,ctx.person(member),orgs.harbor,{shots:true}));
 run.step('board.org.member-token',{actor:member.name,expect:{pending:'The certificate exchange at the organization\'s token endpoint answers invalid_grant: the organization has no live app connection or grant for Board, and no flow creates one (tests seed both in storage).',rule:'organizations design §9; packages/runtime/account/member-certificates.mjs:83-85, packages/federation/member-access.mjs'}},ctx=>board.memberToken(ctx,ctx.person(member)));
 run.step('board.org.chooser',{actor:member.name,expect:{pending:'The organization chooser is designed, not built: Board asks for the organization\'s address instead (OC-5 fallback).',rule:'org-context spike OC-4, OC-11 (phase L2)'}},ctx=>board.orgChooser(ctx,ctx.person(member)));
 // Relations: a counterparty on the same provider resolves; one on another provider does not.
 run.step('board.org.relation.local',{actor:owner.name,via:'api'},async ctx=>{orgs.northwind=await board.createOrg(ctx,ctx.person(member),world.providers.alpha,{name:'Northwind Supply'});await board.relationCounterparty(ctx,ctx.person(owner),world.providers.alpha,orgs.harbor,orgs.northwind);ctx.ledger.record(owner.name,'relation-counterparty','Northwind Supply',{provider:'alpha'});});
 run.step('board.org.relation.foreign',{actor:owner.name,via:'api',expect:{pending:'Relations between organizations on different providers are refused: counterparty lookup resolves local organizations only and the ORG-11 relation transport is unimplemented (relation_foreign_unavailable).',rule:'organizations design §8b; packages/orgs/relation-instances.mjs requireLocal'}},async ctx=>{orgs.tidewater=orgs.tidewater??await board.createOrg(ctx,ctx.person(foreign),world.providers.beta,{name:'Tidewater Contractors'});await board.relationCounterparty(ctx,ctx.person(owner),world.providers.alpha,orgs.harbor,orgs.tidewater);});
 run.step('invariant.board',{via:'api',kind:'invariant'},async ctx=>{
  const api=await board.ownerApi(ctx.person(owner),world.providers.alpha),roster=await api.get(`/api/orgs/${orgs.harbor.id}/members`),members=roster.body?.members??[];
  const subs=members.map(m=>m.principal?.sub).sort(),want=[ctx.person(owner).accounts.alpha.id,ctx.person(member).accounts.alpha.id].sort();
  if(JSON.stringify(subs)!==JSON.stringify(want))throw new Error(`Harbor Studio's roster ${JSON.stringify(subs)} differs from the members who joined ${JSON.stringify(want)}.`);
 });
}
