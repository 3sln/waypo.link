// Scenario part `parlay` (spike S4): two people on alpha connect through a Parlay invitation (the `connect` intent's
// one-time link), talk, and a person on beta tries an invitation from alpha (cross-provider: expected-pending, CL-24).
import * as parlay from '../steps/parlay.mjs';

export const name='parlay';

export const moments={
 'parlay-sign-in':{title:'Parlay: sign-in (app credential; Bindle sign-in not built yet)',surface:'parlay',locale:null,localeNote:'the sign-in form has no language menu (it is English only today)'},
 'parlay-invite-link':{title:'Parlay: one-time invitation link created',surface:'parlay',locale:'parlay'},
 'parlay-connect-check':{localeNote:'the invitation screen has no language menu; it follows the document language at load',title:'Parlay: accept an invitation (check)',surface:'parlay',locale:null},
 'parlay-connect-allow':{localeNote:'the invitation screen has no language menu; it follows the document language at load',title:'Parlay: allow the verified inviter to message you',surface:'parlay',locale:null},
 'parlay-contacts':{title:'Parlay: contacts after the invitation',surface:'parlay',locale:'parlay'},
 'parlay-conversation-started':{title:'Parlay: conversation started',surface:'parlay',locale:'parlay'},
 'parlay-request':{title:'Parlay: a new conversation from a verified contact, in Requests',surface:'parlay',locale:'parlay'},
 'parlay-conversation-list':{title:'Parlay: conversation list with a new message',surface:'parlay',locale:'parlay'},
 'parlay-conversation':{title:'Parlay: conversation with a reply',surface:'parlay',locale:'parlay'},
 'parlay-connect-refused':{localeNote:'the invitation screen has no language menu; it follows the document language at load',title:'Parlay: cross-provider invitation refused (expected-pending, CL-24)',surface:'parlay',locale:null}
};

export function define(run,world,{alpha,beta,scale={}}){
 // alpha[1] invites alpha[2]; beta[2] tries an alpha invitation (cross-provider).
 const [,inviter,invitee]=alpha,foreign=beta[2]??beta[0],A=world.providers.alpha,B=world.providers.beta;
 const opening={subject:'Saturday tram ride',text:'Hi! Are we still on for the tram 28 ride on Saturday morning?',reply:'Yes — 8:30 at Martim Moniz, I will bring coffee.'};
 let invitation=null,foreignInvitation=null;

 run.step('parlay.enrol.1',{actor:inviter.name,via:'api'},ctx=>parlay.enrol(ctx,ctx.person(inviter),A));
 run.step('parlay.enrol.2',{actor:invitee.name,via:'api'},ctx=>parlay.enrol(ctx,ctx.person(invitee),A));
 run.step('parlay.invite.create',{actor:inviter.name},async ctx=>{await parlay.signIn(ctx,ctx.person(inviter),A,{shots:true});invitation=await parlay.createInvitation(ctx,ctx.person(inviter),{name:'for '+invitee.name.split(' ')[0],shots:true});});
 run.step('parlay.invite.accept',{actor:invitee.name},ctx=>parlay.acceptInvitation(ctx,ctx.person(invitee),A,invitation.bintent,{inviter:ctx.person(inviter),shots:true}));
 run.step('parlay.contacts.both',{actor:inviter.name},async ctx=>{await parlay.expectContact(ctx,ctx.person(invitee),ctx.person(inviter),A,{shots:true});await parlay.expectContact(ctx,ctx.person(inviter),ctx.person(invitee),A);});
 run.step('parlay.message.send',{actor:inviter.name},ctx=>parlay.startConversation(ctx,ctx.person(inviter),ctx.person(invitee),A,{subject:opening.subject,text:opening.text,shots:true}));
 run.step('parlay.message.reply',{actor:invitee.name},ctx=>parlay.receiveAndReply(ctx,ctx.person(invitee),{subject:opening.subject,text:opening.text,reply:opening.reply,shots:true}));
 run.step('parlay.message.received',{actor:inviter.name},ctx=>parlay.expectMessage(ctx,ctx.person(inviter),{subject:opening.subject,text:opening.reply}));
 // Load phase (spike §3.3): same-provider messages between beta people through Parlay's own HTTP surface. The
 // scale sets the volume (`scale.messages`, default 40 at small scale: one pair delivers about 1.5 messages a second
 // through its mailbox's drain alarm, so the spike's 200 would add minutes to the gate); only counts reach the ledger.
 run.step('parlay.load',{via:'api',kind:'load'},async ctx=>{
  const owners=beta.slice(0,2).map(p=>({issuer:B.origin,subject:ctx.person(p).accounts.beta.id}));
  const result=await parlay.loadMessages(ctx.world,{owners,count:scale.messages??40,concurrency:scale.messageConcurrency??8,log:line=>process.stdout.write(line+'\n')});
  if(result.delivered!==result.sent)throw new Error(`Parlay load delivered ${result.delivered} of ${result.sent} messages.`);
  ctx.ledger.record('load','parlay-messages',String(result.sent),{pairs:result.pairs,delivered:result.delivered});
  process.stdout.write(`  parlay load: ${result.sent} messages over ${result.pairs} pair(s), all delivered, ${result.ms} ms (send ${result.perSecond}/s, p95 ${result.stats.p95Ms} ms)\n`);
 });
 run.step('invariant.parlay-delegations',{via:'api',kind:'invariant'},async ctx=>{
  // Every certificate came from the provider (in-process issue entry), every key check from its public routes.
  const calls=ctx.world.services.parlay.adapter.calls;
  for(const kind of ['certify','resolve-key','delegation-status'])if(!calls.some(c=>c.kind===kind))throw new Error(`Parlay made no ${kind} call.`);
  if(!calls.some(c=>c.kind==='egress'&&c.path==='/bindle/ingress'))throw new Error('No mailbox-to-mailbox delivery went through egress.');
 });

 // Expected-pending: behaviour we want, which today's implementation does not provide. Each must fail now.
 run.step('parlay.cross-provider.invite',{actor:foreign.name,expect:{pending:'Messaging is same-host only in this version: a foreign inviter is refused without any fetch (connectUnverifiable).',rule:'messaging CL-24 (packages/messaging-engine/domains/invites.mjs verifyInviter)'}},async ctx=>{
  if(!foreignInvitation){await parlay.enrol(ctx,ctx.person(foreign),B);foreignInvitation=await parlay.createInvitation(ctx,ctx.person(inviter),{name:'for '+foreign.name.split(' ')[0]});}
  await parlay.acceptForeignInvitation(ctx,ctx.person(foreign),B,foreignInvitation.bintent,{shots:true});
 });
 run.step('parlay.signs-in-with-bindle',{via:'api',expect:{pending:'Parlay\'s client metadata advertises /bindle/start and /bindle/callback, but its HTTP surface routes neither, so a person cannot sign in to Parlay with their provider (the simulation signs in with an adapter-issued app credential).',rule:'apps/parlay/worker/metadata.mjs vs apps/parlay/worker/http.mjs createHTTP'}},async ctx=>{
  for(const path of ['/bindle/start','/bindle/callback']){const response=await ctx.world.network.fetch(ctx.world.services.parlay.origin+path);if(response.status===404)throw new Error(`${path} answers 404.`);}
 });
 run.step('parlay.installs-through-consent',{via:'api',expect:{pending:'Parlay\'s delegate certificates need it to be the person\'s messaging-mailbox occupant through provider consent, and an app-facing issue/renew route; neither exists (the simulation answers the occupant port and calls the provider\'s internal issue entry).',rule:'key-delegation.v1 / packages/runtime/account/identity.mjs delegationOperation (internal)'}},async ctx=>{
  // Wanted: the provider's key-delegation declaration names an app-facing issue/renew endpoint. Today it carries only
  // lifetime options (packages/runtime/routes/directory.mjs), and certificates come from an internal entry.
  const manifest=await (await ctx.world.network.fetch(world.providers.alpha.origin+'/.well-known/bindle/manifest.json')).json();
  const declared=(manifest.extensions??[]).find(e=>e?.spec==='https://spec.bindle.example/extensions/key-delegation/v1');
  const endpoints=Object.keys(declared?.options??{}).filter(k=>k.endsWith('_endpoint'));
  if(!endpoints.length)throw new Error(`The key-delegation declaration names no app-facing endpoint (options: ${Object.keys(declared?.options??{}).join(', ')||'none'}).`);
 });
}
