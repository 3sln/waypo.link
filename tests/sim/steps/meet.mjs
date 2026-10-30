// Meet steps: a host on one provider creates a meeting; a guest on another provider opens the join link signed out,
// signs in, and calls. Every provider decision (consent, the call-kind approval, connection privacy) is made on the
// provider's own pages in the browser.
import {armedClick,popupFrom} from '../browser.mjs';

const meetOrigin=ctx=>ctx.world.services.meet.origin;
const moment=(ctx,actor,page,id,shots)=>shots?ctx.shots.moment(page,id,{scenario:ctx.scenario,step:ctx.step.id,actor:actor.name}):null;
const meetState=page=>page.evaluate(()=>({...window.__meet.engine.read(),lastError:window.__meet.lastError}));
const waitPhase=(page,phases,timeout=30000)=>page.waitForFunction(list=>list.includes(window.__meet?.engine.read().phase),[].concat(phases),{timeout}).catch(async error=>{const s=await meetState(page).catch(()=>null);throw new Error(`Meet did not reach ${[].concat(phases).join('|')}: ${JSON.stringify(s&&{phase:s.phase,error:s.error,connection:s.connection,incoming:s.incoming,lastError:s.lastError})}`);});

/** Drives the provider's pages until the browser is back on Meet: account choice, then consent with the built-in
 * signaling service assigned to the signaling field. `shot` is captured at the consent decision. */
async function providerFlow(ctx,actor,page,{shots,shot}){
 let captured=false;
 for(let i=0;i<24;i++){
  await page.waitForLoadState('domcontentloaded').catch(()=>{});
  if(new URL(page.url()).origin===meetOrigin(ctx))return;
  const configure=page.locator('summary',{hasText:'Configure this fragment'});
  if(await configure.count()&&await configure.first().isVisible()&&!await configure.first().evaluate(s=>s.parentElement.open)){
   await configure.first().click();const resource=page.locator('input[name^="resource:"]');await resource.first().waitFor({timeout:5000}).catch(()=>{});
   if(await resource.count()&&!await resource.first().isChecked())await resource.first().check();
   await page.getByRole('button',{name:'Save preferences and review'}).click();await page.waitForTimeout(400);continue;
  }
  for(const box of await page.getByRole('checkbox').all())if(await box.isVisible()&&await box.isEnabled()&&!await box.isChecked()&&!/remember|review|Stop/i.test(await box.getAttribute('name')??''))await box.check().catch(()=>{});
  const actions=['button:has-text("Allow selected access")','[data-consent-action="allow"]','[data-consent-action="return"]','button:has-text("Continue as")'];
  let acted=false;
  for(const selector of actions){const control=page.locator(selector).first();if(await control.count()&&await control.isVisible()&&await control.getAttribute('aria-disabled')!=='true'&&!await control.isDisabled()){if(shot&&!captured&&/Allow/i.test(selector)){captured=true;await moment(ctx,actor,page,shot,shots);}await armedClick(page,control);await page.waitForTimeout(500);acted=true;break;}}
  if(!acted)await page.waitForTimeout(500);
 }
 throw new Error(`The provider flow did not return to Meet (at ${new URL(page.url()).pathname}: ${await page.locator('h1,h2').first().textContent().catch(()=>'?')}).`);
}

async function signIn(ctx,actor,page,provider,{shots,sheetShot}){
 await page.locator('.signin-cta').first().click();
 const form=page.locator('dialog[open] bindle-sign-in'),input=form.getByLabel(/^(Your handle|Your Bindle identity)$/);await input.waitFor();
 await input.fill(actor.accounts[provider.name].address);
 if(sheetShot)await moment(ctx,actor,page,sheetShot,shots);
 await form.getByRole('button',{name:'Continue',exact:true}).click();
 await page.waitForURL(url=>url.origin===provider.origin,{timeout:20000});
 await providerFlow(ctx,actor,page,{shots,shot:'meet-provider-consent'});
 await page.waitForFunction(()=>!!window.__meet?.engine.read().account,null,{timeout:20000});
 ctx.ledger.record(actor.name,'connection','meet',{provider:provider.name,via:'redirect'});
}

/** The host signs in to Meet from its home page (sign-in sheet, the handle form, a full-page redirect). */
export async function hostSignIn(ctx,actor,provider,{shots=false}={}){
 const page=actor.pages.meet??=await actor.browser.page();
 await page.goto(meetOrigin(ctx)+'/');await page.locator('.hero').waitFor();
 await moment(ctx,actor,page,'meet-home-signed-out',shots);
 await signIn(ctx,actor,page,provider,{shots,sheetShot:'meet-sign-in'});
 await page.locator('.create-card').waitFor();
}

/** Account & security → Direct connections → "With other people": allow the public address. Without a relay (the
 * hosted relay needs an operator spend authority, signaling §16.7) this is what lets a call connect directly. */
export async function allowDirect(ctx,actor,provider,{shots=false}={}){
 const page=await actor.browser.page();
 await page.goto(provider.origin+'/console?view=security');await page.locator('.app-shell').waitFor();
 const option=page.getByRole('radio',{name:/^Allow your public address/});await option.first().waitFor({timeout:15000}).catch(async error=>{const session=await (await actor.browser.context.request.get(provider.origin+'/api/session')).json().catch(()=>null);throw new Error(`No connection privacy panel (features: ${JSON.stringify(session?.account?.consoleFeatures??session?.features??null)}; headings: ${(await page.locator('h2').allTextContents()).join(' | ')})`);});
 await option.first().check();
 await moment(ctx,actor,page,'provider-signaling-privacy',shots);
 const saved=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/signaling/set-policy',{timeout:15000});
 await armedClick(page,page.getByRole('button',{name:'Save connection privacy'}));
 const response=await saved;if(!response.ok())throw new Error(`Saving connection privacy answered ${response.status()}.`);
 const settings=await (await actor.browser.context.request.get(provider.origin+'/api/signaling/settings')).json();
 if(settings.policy?.other!=='public')throw new Error('The connection privacy did not change: '+JSON.stringify(settings.policy));
 ctx.ledger.record(actor.name,'signaling-policy',provider.name,{other:'public'});
 await page.close();
}

/** Meet asks for the provider's approval of its call kind: the provider page opens in a new tab, the person approves. */
async function approveCallKind(ctx,actor,page,provider,{shots,appShot}){
 await waitPhase(page,'approval');
 await moment(ctx,actor,page,appShot,shots);
 const href=await page.locator('.approve-link').getAttribute('href');
 if(new URL(href).origin!==provider.origin)throw new Error(`The approval page is not on the person's provider: ${href}`);
 const tab=await popupFrom(actor.browser.context,()=>page.locator('.approve-link').click());
 await tab.getByRole('heading',{name:'Approve a connection type'}).first().waitFor({timeout:15000});await tab.getByRole('button',{name:'Approve',exact:true}).waitFor({timeout:15000});
 await moment(ctx,actor,tab,'provider-signaling-approve',shots);
 await armedClick(tab,tab.getByRole('button',{name:'Approve',exact:true}),{rest:1400});
 await tab.getByText('Connection type approved').first().waitFor({timeout:15000});
 await tab.close();await page.bringToFront();
 ctx.ledger.record(actor.name,'session-approval','meet',{provider:provider.name});
 await page.locator('.approval-done').click();
}

/** The host names a meeting and creates it: Meet registers an endpoint and mints an offer (after the approval). */
export async function createMeeting(ctx,actor,provider,title,{shots=false}={}){
 const page=actor.pages.meet;
 await page.locator('#your-name').fill(actor.name);await page.locator('#meeting-title').fill(title);
 await moment(ctx,actor,page,'meet-home',shots);
 await page.locator('.create-card button[type=submit]').click();
 await waitPhase(page,['approval','lobby']);
 if((await meetState(page)).phase==='approval')await approveCallKind(ctx,actor,page,provider,{shots,appShot:'meet-approval'});
 await waitPhase(page,'lobby',20000).catch(async()=>{const s=await meetState(page);throw new Error(`Meeting not created: ${JSON.stringify({phase:s.phase,error:s.error,account:s.account})}`);});await page.locator('.side .link').waitFor();
 const link=await page.locator('.side .link').inputValue();
 if(!/^https:\/\/meet\.example\/j\/[a-z0-9]{10}$/.test(link))throw new Error(`Unexpected join link ${link}`);
 ctx.ledger.record(actor.name,'meeting',title,{host:provider.name});
 await moment(ctx,actor,page,'meet-lobby-host',shots);
 return link;
}

/** The guest opens the link signed out (the guest view), then signs in with their own provider. */
export async function guestOpensLink(ctx,actor,provider,link,{shots=false}={}){
 const page=actor.pages.meet??=await actor.browser.page();
 await page.goto(link);await page.locator('.guest-card').waitFor();
 if((await meetState(page)).account)throw new Error('The guest is already signed in to Meet.');
 if(await page.locator('.side .link').count())throw new Error('The guest view shows the host controls.');
 await moment(ctx,actor,page,'meet-guest',shots);
 await signIn(ctx,actor,page,provider,{shots,sheetShot:'meet-sign-in-join'});
 await page.waitForURL(url=>url.pathname===new URL(link).pathname,{timeout:15000});
 await waitPhase(page,'lobby');await page.locator('.side .join').waitFor();
 await page.locator('#your-name').fill(actor.name);
 await moment(ctx,actor,page,'meet-lobby-guest',shots);
}

/** The guest asks to join (approval first, if needed): Meet opens a signaling session with the host's offer. */
export async function guestJoins(ctx,guest,host,provider,{shots=false}={}){
 const page=guest.pages.meet;
 await page.locator('.side .join').click();
 await waitPhase(page,['approval','ringing']);
 if((await meetState(page)).phase==='approval')await approveCallKind(ctx,guest,page,provider,{shots:false,appShot:'meet-approval'});
 await waitPhase(page,'ringing',30000);
 await moment(ctx,guest,page,'meet-joining',shots);
 // The invite crosses providers (guest's provider → host's provider) and rings the host's open lobby.
 const hostPage=host.pages.meet;await hostPage.bringToFront();
 await waitPhase(hostPage,'ringing',45000).catch(async error=>{throw new Error('The host was not rung: '+JSON.stringify({guest:await meetState(page).then(s=>({phase:s.phase,error:s.error})),host:await meetState(hostPage).then(s=>({phase:s.phase,error:s.error}))}));});
 await hostPage.locator('.ringing-card').waitFor();
 await moment(ctx,host,hostPage,'meet-ringing',shots);
}

/** The host lets the guest in; both reach the call (data channel open) and exchange a message over it. */
export async function connectCall(ctx,host,guest,{shots=false}={}){
 const hostPage=host.pages.meet,guestPage=guest.pages.meet;
 await hostPage.locator('.ringing-card .accept').click();
 const inCall=async page=>waitPhase(page,'in-call',45000).catch(async()=>{const s=await meetState(page);throw new Error(`No call: ${JSON.stringify({phase:s.phase,connection:s.connection,error:s.error})}`);});
 await Promise.all([inCall(hostPage),inCall(guestPage)]);
 // The data channel greeting carries each side's label; then the guest says something and the host sees it.
 await guestPage.locator('.say input').fill('Hi! Can you see me?');await guestPage.locator('.say button').click();
 await hostPage.locator('.chat .theirs',{hasText:'Hi! Can you see me?'}).waitFor({timeout:15000});
 await hostPage.locator('.chat .system',{hasText:guest.name}).waitFor({timeout:10000});
 await hostPage.locator('.say input').fill('Loud and clear.');await hostPage.locator('.say button').click();
 await guestPage.locator('.chat .theirs',{hasText:'Loud and clear.'}).waitFor({timeout:15000});
 // Media flows too: the remote video renders frames on both sides.
 for(const page of [hostPage,guestPage])await page.waitForFunction(()=>{const v=document.querySelector('video.remote');return v&&v.videoWidth>0&&v.currentTime>0;},null,{timeout:20000});
 const route=await guestPage.evaluate(()=>window.__meet.route());
 if(route&&route.local!=='host')throw new Error(`Unexpected candidate route ${JSON.stringify(route)}.`);
 ctx.ledger.record(guest.name,'call','meet',{peer:host.name,route:'direct host candidates (mDNS)',dataChannel:true});
 await moment(ctx,host,hostPage,'meet-in-call',shots);
 await moment(ctx,guest,guestPage,'meet-in-call-guest',shots);
}

/** Owner view: each owner's provider lists the live session (GET /api/signaling/settings, the JSON behind the
 * direct-connections pages; no console page renders live sessions yet). */
export async function ownersSeeSession(ctx,people){
 for(const [actor,provider] of people){
  const settings=await (await actor.browser.context.request.get(provider.origin+'/api/signaling/settings')).json();
  const sessions=(settings.sessions??[]).filter(s=>!['ended','closed','expired'].includes(s.state));
  if(!sessions.length)throw new Error(`${provider.name} shows no live signaling session for ${actor.name}: ${JSON.stringify(Object.keys(settings))}`);
 }
}

/** The guest leaves; both sides show the call ended. */
export async function endCall(ctx,guest,host,{shots=false}={}){
 const guestPage=guest.pages.meet,hostPage=host.pages.meet;
 await guestPage.locator('.hang-up').click();
 await Promise.all([waitPhase(guestPage,'ended',15000),waitPhase(hostPage,'ended',30000)]);
 ctx.ledger.record(guest.name,'call-ended','meet',{by:'guest'});
 await moment(ctx,guest,guestPage,'meet-ended',shots);
}

/** Invariant (G4): no live signaling session is left on either provider after the call. */
export async function sessionsClosed(ctx,people){
 for(const [actor,provider] of people){
  for(let i=0;i<20;i++){
   const settings=await (await actor.browser.context.request.get(provider.origin+'/api/signaling/settings')).json();
   const live=(settings.sessions??[]).filter(s=>!['ended','closed','expired'].includes(s.state));
   if(!live.length)break;if(i===19)throw new Error(`${provider.name} still lists ${live.length} live signaling sessions after the call.`);
   await new Promise(r=>setTimeout(r,500));
  }
 }
}
