// Scenario `small` (P0): people on alpha and beta sign up through the providers' pages, use Notes signed out, connect
// Notes (island on alpha, "different provider" redirect on beta), consent to storage, sync, ask for reminders through
// incremental authorization, receive an app message, and remove Notes cleanly from the provider.
import {signUp} from '../steps/accounts.mjs';
import * as notes from '../steps/notes.mjs';
import * as photos from '../steps/photos.mjs';
import {PEOPLE,NOTES,PASSPHRASES} from '../content.mjs';
import {PARTS} from '../parts/index.mjs';

export const name='small';
export const scale={alphaUsers:3,betaUsers:3,localNotesPerUser:2,name:'small'};
/** Scenario parts after the core (Notes, Photos). `parts` (CLI --parts, comma separated) narrows a run to some of
 * them while a part is being developed; the gate always runs every part. Signups always run. */
export const PART_NAMES=['core',...PARTS.map(p=>p.name)];

export function define(run,world,{parts=PART_NAMES}={}){
 const random=run.random,names=random.shuffle(PEOPLE),pool=random.shuffle(NOTES),passphrases=random.shuffle(PASSPHRASES);
 const people=[...Array(scale.alphaUsers)].map((_,i)=>({name:names[i],home:'alpha'})).concat([...Array(scale.betaUsers)].map((_,i)=>({name:names[scale.alphaUsers+i],home:'beta'})));
 // Core roles keep their P0 order: two people on alpha, two on beta (a3 and b3 join for Board, Meet and Parlay).
 people.forEach((p,i)=>{p.passphrase=passphrases[i%passphrases.length];p.notes=[pool[(i*3)%pool.length],pool[(i*3+1)%pool.length]];p.later=pool[(i*3+2)%pool.length];p.accounts={};p.pages={};});
 const alpha=people.filter(p=>p.home==='alpha'),beta=people.filter(p=>p.home==='beta'),[a1,a2]=alpha,[b1,b2]=beta,core=[a1,a2,b1,b2];
 run.people=people;

 for(const [i,p] of people.entries())run.step(`accounts.signup.${p.home}.${i+1}`,{actor:p.name},ctx=>signUp(ctx,ctx.person(p),world.providers[p.home],{shots:i===0}));
 const has=name=>parts.includes(name);
 run.group('core');
 if(has('core')){
 for(const [i,p] of core.entries())run.step(`notes.local.${i+1}`,{actor:p.name},async ctx=>{const person=ctx.person(p);await notes.openNotes(ctx,person,{shots:i===0});await notes.writeLocalNotes(ctx,person,p.notes,{shots:i===0});});
 run.step('notes.sign-in.island.1',{actor:a1.name},ctx=>notes.signInWithIsland(ctx,ctx.person(a1),{shots:true}));
 run.step('notes.sign-in.island.2',{actor:a2.name},ctx=>notes.signInWithIsland(ctx,ctx.person(a2)));
 run.step('notes.sign-in.redirect.1',{actor:b1.name},ctx=>notes.signInWithHandle(ctx,ctx.person(b1),world.providers.beta,{shots:true,errorShot:true}));
 run.step('notes.sign-in.redirect.2',{actor:b2.name},ctx=>notes.signInWithHandle(ctx,ctx.person(b2),world.providers.beta));
 for(const [i,p] of core.entries())run.step(`notes.sync.${i+1}`,{actor:p.name},ctx=>notes.editAndVerify(ctx,ctx.person(p),p.later));
 run.step('notes.reminders.grant-more',{actor:a1.name},async ctx=>{const mode=await notes.enableReminders(ctx,ctx.person(a1),{shots:true});ctx.ledger.record(a1.name,'grant','app-messages',{via:'incremental',mode});});
 run.step('notes.reminders.redirect-exchange',{actor:a1.name},async ctx=>{
  const result=await ctx.person(a1).pages.notes.evaluate(()=>window.__notes.lastGrant);if(result?.outcome!=='completed')throw new Error('grant-more exchange: '+JSON.stringify(result));
 });
 run.step('notes.reconnect.1',{actor:a1.name},async ctx=>{const outcome=await notes.reconnectWithIsland(ctx,ctx.person(a1));if(outcome!=='already-approved')throw new Error('Reconnecting asked for consent again.');});
 run.step('notes.reminder.app-message',{actor:a1.name},ctx=>notes.sendReminder(ctx,ctx.person(a1),world.providers.alpha,{shots:true}));
 run.step('notes.removal.clean.1',{actor:b1.name},ctx=>notes.removeFromProvider(ctx,ctx.person(b1),world.providers.beta,{choice:'keep',shots:true}));
 // Photos: public gallery as a guest, full-page redirect sign-in, storage asked for only when adding a photo.
 run.step('photos.guest.1',{actor:b2.name},ctx=>photos.browseAsGuest(ctx,ctx.person(b2),{shots:true}));
 run.step('photos.unlock.1',{actor:b2.name},ctx=>photos.signInAndUnlock(ctx,ctx.person(b2),world.providers.beta,{shots:true}));
 run.step('photos.add.1',{actor:b2.name},ctx=>photos.addPhotos(ctx,ctx.person(b2),2,{shots:true}));
 run.step('photos.guest.2',{actor:a2.name},ctx=>photos.browseAsGuest(ctx,ctx.person(a2)));
 run.step('photos.unlock.2',{actor:a2.name},ctx=>photos.signInAndUnlock(ctx,ctx.person(a2),world.providers.alpha));
 run.step('photos.add.2',{actor:a2.name},ctx=>photos.addPhotos(ctx,ctx.person(a2),1));
 run.step('notes.account-menu',{actor:a1.name},ctx=>notes.accountMenu(ctx,ctx.person(a1),{shots:true}));

 run.step('notes.sign-out.2',{actor:a2.name},ctx=>notes.signOutOfNotes(ctx,ctx.person(a2),{shots:true}));

 // Expected-pending: behaviour we want, which today's implementation does not provide. Each must fail now.
 run.step('notes.islands-for-metadata-clients',{actor:null,via:'api',expect:{pending:'The embed shell resolves frame-ancestors from reviewed registrations (FEDERATION_CLIENTS) only, so a client-id-metadata app gets an inert island.',rule:'components profile §3 / client-id-metadata.v1'}},async ctx=>{
  const response=await ctx.world.network.fetch(`${world.providers.beta.embedOrigin}/?client=${encodeURIComponent(world.apps.notes.origin+'/bindle/client.json')}`);
  const policy=response.headers.get('content-security-policy')??'';if(!policy.includes('frame-ancestors https://notes.example'))throw new Error(`frame-ancestors for Notes on beta: ${/frame-ancestors[^;]*/.exec(policy)?.[0]}`);
 });
 // W11 persisted app sessions (DPoP-bound, in the app's own IndexedDB): a reload keeps Notes signed in and syncing.
 run.step('notes.session-survives-reload',{actor:a1.name},async ctx=>{
  const page=ctx.person(a1).pages.notes;await page.reload();await page.locator('.workspace').waitFor();
  await page.waitForFunction(()=>document.querySelector('.sync-chip')?.dataset.sync==='synced',null,{timeout:4000});
 });

 }
 for(const part of PARTS)if(has(part.name)){run.group(part.name);part.define(run,world,{people,alpha,beta,scale,random});}
 run.group('invariant');

 // Post-run invariants (G4).
 run.step('invariant.accounts',{via:'api',kind:'invariant'},async ctx=>{
  // A person may hold several accounts on their home provider (the multi-account part adds one): the provider's
  // current account must be one this person created.
  for(const p of people){const mine=Object.values(ctx.person(p).accounts).filter(a=>a.provider===p.home).map(a=>a.id),session=await (await ctx.person(p).browser.context.request.get(world.providers[p.home].origin+'/api/session')).json();
   if(!session.authenticated||!mine.includes(session.account?.id))throw new Error(`${p.name}'s provider session does not match an account they created.`);}
  const homed=people.filter(p=>ctx.ledger.entries.some(e=>e.actor===p.name&&e.kind==='account'&&e.key===p.home&&!e.value.added)).length;if(homed!==people.length)throw new Error(`Ledger has home accounts for ${homed} of ${people.length} people.`);
 });
 run.step('invariant.server-to-server',{via:'api',kind:'invariant'},async ctx=>{
  // Both providers fetched Notes' client metadata through their own egress code (the seams replace only DNS and socket).
  if(!has('core'))return;
  const dials=ctx.world.network.events.filter(e=>e.kind==='socket'&&e.target==='notes.example'&&e.path==='/bindle/client.json');
  if(!dials.length)throw new Error('No provider fetched the Notes client metadata over the network.');
  if(ctx.world.network.events.some(e=>e.kind==='socket'&&e.target!=='notes.example'))return;
 });
 return people;
}
