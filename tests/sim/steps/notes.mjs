// Notes steps: what a person does in the Notes sample, through the real browser, real providers and real consent.
import {armedClick,islandClick,popupFrom} from '../browser.mjs';

const notesOrigin=ctx=>ctx.world.apps.notes.origin;
const moment=(ctx,actor,page,id,shots)=>shots?ctx.shots.moment(page,id,{scenario:ctx.scenario,step:ctx.step.id,actor:actor.name}):null;
/** "New note", then wait until the editor shows the new, empty note (the engine renders asynchronously). */
async function newNote(page){
 const before=await page.evaluate(()=>window.__notes.engine.read().notes.length);
 await page.locator('.new-note').click();
 await page.waitForFunction(n=>{const s=window.__notes.engine.read();return s.notes.length>n&&document.querySelector('.editor')?.classList&&document.querySelector('.title-input')?.value===''&&s.selected===s.notes.at(-1).id;},before);
}
const chipState=page=>page.locator('.sync-chip').getAttribute('data-sync');

export async function openNotes(ctx,actor,{shots=false}={}){
 const page=actor.pages.notes??=await actor.browser.page();
 await page.goto(notesOrigin(ctx)+'/');await page.locator('.workspace').waitFor();
 if(await page.locator('.empty').count())await moment(ctx,actor,page,'notes-empty-signed-out',shots);
 return page;
}

/** Writes notes while signed out: they live on the device only. */
export async function writeLocalNotes(ctx,actor,notes,{shots=false}={}){
 const page=actor.pages.notes;
 for(const note of notes){
  await newNote(page);await page.locator('.title-input').fill(note.title);
  await page.locator('.body-input').fill(note.body);
  ctx.ledger.record(actor.name,'note',note.title,{title:note.title,words:note.body.split(/\s+/).length});
 }
 await page.waitForFunction(count=>window.__notes.engine.read().notes.filter(n=>!n.deleted).length>=count,notes.length);
 if(await chipState(page)!=='local')throw new Error('Signed-out notes must stay local.');
 await moment(ctx,actor,page,'notes-editor',shots);
 await page.locator('.title-input').blur();
 await moment(ctx,actor,page,'notes-local-notes',shots);
}

async function consent(ctx,actor,popup,{shots,prefix='notes/'}){
 // Account choice (the provider's own page), then the consent walkthrough with the storage the person chooses.
 const choose=popup.getByRole('button',{name:/Continue as /});await choose.waitFor();
 await moment(ctx,actor,popup,'provider-entry-choose',shots);
 await armedClick(popup,choose.first());
 // An app the person already approved returns without a consent page ("already approved").
 const reviewing=await Promise.race([popup.getByRole('heading',{name:/Review what .+ can access/}).waitFor().then(()=>true),popup.waitForEvent('close').then(()=>false),popup.waitForURL(url=>url.origin===notesOrigin(ctx)).then(()=>false)]).catch(()=>false);
 if(!reviewing)return 'already-approved';
 await moment(ctx,actor,popup,'provider-consent',shots);
 const configure=popup.locator('summary',{hasText:'Configure this fragment'});
 if(await configure.count()){
  await configure.click();
  await popup.locator('input[name="resource:store"]').check();
  const scope=popup.locator('input[name^="prefix:store:"]');if(await scope.count())await scope.fill(prefix);
  const sort=popup.locator('details select[name="sort"]');if(await sort.count())await sort.selectOption('updated');
  await popup.getByRole('button',{name:'Save preferences and review'}).click();
  await popup.getByRole('checkbox',{name:'Create or replace files'}).waitFor();
 }
 const occupant=popup.getByRole('checkbox',{name:/^Account storage ·/});if(await occupant.count()&&!await occupant.first().isChecked())await occupant.first().check();
 for(const name of ['Inspect storage capabilities','Read file contents','Create or replace files','Permanently delete files']){const box=popup.getByRole('checkbox',{name});if(await box.count()&&await box.isEnabled()&&!await box.isChecked())await box.check();}
 await moment(ctx,actor,popup,'provider-consent-configured',shots);
 await armedClick(popup,popup.getByRole('button',{name:'Allow selected access'}));
 return 'approved';
}
async function waitSynced(page,count){
 await page.waitForFunction(()=>document.querySelector('.sync-chip')?.dataset.sync==='synced',null,{timeout:30000});
 if(count!==undefined)await page.waitForFunction(n=>window.__notes.engine.read().notes.filter(x=>!x.deleted).length>=n,count);
}

/** Sign-in through the featured provider's island (popup), then the merge of local notes into the account. */
export async function signInWithIsland(ctx,actor,{shots=false}={}){
 const page=actor.pages.notes;
 await page.locator('.signin-cta').click();
 const island=page.frameLocator('bindle-sign-in iframe:visible'),button=island.getByRole('button',{name:/Continue with/});await button.waitFor();
 await moment(ctx,actor,page,'notes-sign-in-island',shots);
 const popup=await popupFrom(actor.browser.context,()=>islandClick(page,island,button));
 await consent(ctx,actor,popup,{shots});
 if(!popup.isClosed())await popup.waitForEvent('close',{timeout:20000}).catch(()=>{});
 await page.bringToFront();await waitSynced(page,ctx.ledger.expected(actor.name,'note').length);
 ctx.ledger.record(actor.name,'connection','notes',{provider:'alpha',via:'island'});
 await moment(ctx,actor,page,'notes-synced',shots);
}

/** Sign-in at a provider the app does not feature: "Use a different provider", a full handle, a top-level redirect. */
export async function signInWithHandle(ctx,actor,provider,{shots=false,errorShot=false}={}){
 const page=actor.pages.notes,signIn=page.locator('bindle-sign-in');
 await page.locator('.signin-cta').click();
 await signIn.getByRole('button',{name:'Use a different provider'}).click();
 const input=signIn.getByLabel(/^(Your Bindle identity|Your handle)$/);await input.waitFor();
 if(errorShot){await input.fill('not a handle');await signIn.getByRole('button',{name:'Continue',exact:true}).click();await signIn.getByRole('alert').filter({hasText:/./}).waitFor().catch(()=>{});await moment(ctx,actor,page,'notes-sign-in-error',shots);}
 await input.fill(actor.accounts[provider.name].address);
 await moment(ctx,actor,page,'notes-sign-in-other-provider',shots);
 await signIn.getByRole('button',{name:'Continue',exact:true}).click();
 await page.waitForURL(url=>url.origin===provider.origin,{timeout:20000});
 await consent(ctx,actor,page,{shots});
 await page.waitForURL(url=>url.origin===notesOrigin(ctx)&&url.pathname==='/',{timeout:30000});
 await waitSynced(page,ctx.ledger.expected(actor.name,'note').length);
 ctx.ledger.record(actor.name,'connection','notes',{provider:provider.name,via:'redirect'});
 await moment(ctx,actor,page,'notes-synced',shots);
}

/** An edit after sign-in syncs on its own; the stored copy then matches every note the person wrote. */
export async function editAndVerify(ctx,actor,{title,body},{shots=false}={}){
 const page=actor.pages.notes;
 await newNote(page);await page.locator('.title-input').fill(title);await page.locator('.body-input').fill(body);
 ctx.ledger.record(actor.name,'note',title,{title,words:body.split(/\s+/).length});
 await page.waitForFunction(()=>document.querySelector('.sync-chip')?.dataset.sync==='pending'||document.querySelector('.sync-chip')?.dataset.sync==='syncing',null,{timeout:5000}).catch(()=>{});
 await waitSynced(page);
 // The preference chosen at consent (sort order) reaches the app through preferences.
 if(await page.evaluate(()=>window.__notes.engine.read().sort)!=='updated')throw new Error('The sort preference chosen at consent did not reach Notes.');
 const stored=await page.evaluate(()=>window.__notes.storedTitles()),expected=ctx.ledger.expected(actor.name,'note').map(e=>e.key).sort();
 if(JSON.stringify(stored)!==JSON.stringify(expected))throw new Error(`Stored notes ${JSON.stringify(stored)} differ from the ledger ${JSON.stringify(expected)}.`);
}

export async function accountMenu(ctx,actor,{shots=false}={}){
 const page=actor.pages.notes,account=page.locator('bindle-account');
 await account.locator('button').first().click();
 await page.waitForFunction(()=>document.querySelector('bindle-account')?.state?.open===true,null,{timeout:5000});
 await page.waitForTimeout(400);
 await moment(ctx,actor,page,'notes-account-menu',shots);
 await page.keyboard.press('Escape');
}

/** Reminders: an incremental request for app messages, made only when the person turns the feature on. */
export async function enableReminders(ctx,actor,{shots=false}={}){
 const page=actor.pages.notes;
 await page.getByRole('button',{name:'Settings'}).click();await page.locator('.settings-sheet[open]').waitFor();
 await moment(ctx,actor,page,'notes-settings',shots);
 const toggle=page.locator('.settings-sheet .switch input');
 const opened=actor.browser.context.waitForEvent('page',{timeout:8000}).catch(()=>null),navigated=page.waitForURL(url=>url.origin!==notesOrigin(ctx),{timeout:8000}).then(()=>page).catch(()=>null);
 await toggle.check();
 const target=await Promise.race([opened,navigated]);if(!target)throw new Error('Turning reminders on did not open the provider: '+JSON.stringify(await page.evaluate(()=>{const c=window.__notes.session.client,i=c.session?.issuer;return {grant:window.__notes.lastGrant,issuer:i,entryIntents:c.capabilities.declaration(i,{stale:true})?.authorizationEntry?.intents?.join(),manifest:!!c.capabilities.manifest(i),base:c.capabilitiesFor(i)?.entry};})));
 await target.waitForLoadState('domcontentloaded');
 // The provider's incremental walkthrough: choose where the access applies, save, allow, return.
 let shot=false;
 for(let i=0;i<12;i++){
  if(target.isClosed()||new URL(target.url()).origin===notesOrigin(ctx))break;
  const radios=target.getByRole('radio');if(await radios.count()&&!await radios.first().isChecked()){await radios.first().check();continue;}
  const includes=target.getByRole('switch');for(let j=0;j<await includes.count();j++)if(!await includes.nth(j).isChecked())await includes.nth(j).check();
  const actions=[['[data-consent-action="return"]',null],['[data-consent-action="allow"]','provider-grant-more'],['button:has-text("Save and continue")',null],['button:has-text("Continue as")',null]];
  let acted=false;
  for(const [selector,shotId] of actions){const control=target.locator(selector).first();if(await control.count()&&await control.isVisible()&&await control.getAttribute('aria-disabled')!=='true'){if(shotId&&!shot){shot=true;await moment(ctx,actor,target,shotId,shots);}const before=target.url();await armedClick(target,control);await target.waitForTimeout(600);acted=true;break;}}
  if(!acted)await target.waitForTimeout(500);
 }
 if(target!==page)await target.waitForEvent('close',{timeout:20000}).catch(()=>{});
 await page.bringToFront();
 return target===page?'redirect':'popup';
}

/** Reconnect through the island: no new consent needed. With persisted app sessions (W11) the session survives the
 * grant-more redirect, but an existing 3sln session does not gain grants approved later (they arrive in the incremental
 * `issuedSession`, which Notes does not adopt yet), so the person signs out of Notes and connects again. */
export async function reconnectWithIsland(ctx,actor){
 const page=actor.pages.notes;
 if(await page.evaluate(()=>window.__notes.session.state==='signed-in'))await page.evaluate(()=>window.__notes.session.signOut());
 await page.locator('.signin-cta').click();
 const island=page.frameLocator('bindle-sign-in iframe:visible'),button=island.getByRole('button',{name:/Continue with/});await button.waitFor();
 const popup=await popupFrom(actor.browser.context,()=>islandClick(page,island,button));
 const outcome=await consent(ctx,actor,popup,{shots:false});
 if(!popup.isClosed())await popup.waitForEvent('close',{timeout:20000}).catch(()=>{});
 await page.bringToFront();await waitSynced(page);return outcome;
}

/** A reminder for the open note: an app message delivered to the person's provider inbox. */
export async function sendReminder(ctx,actor,provider,{shots=false}={}){
 const page=actor.pages.notes;
 if(!await page.evaluate(()=>window.__notes.engine.read().reminders.enabled))throw new Error('Reminders are not enabled after the incremental grant: '+JSON.stringify(await page.evaluate(()=>window.__notes.lastGrant)));
 if(shots){await page.getByRole('button',{name:'Settings'}).click();await page.locator('.settings-sheet[open]').waitFor();await moment(ctx,actor,page,'notes-reminders-on',shots);await page.locator('.settings-sheet').getByRole('button',{name:'Done'}).click();await page.locator('.settings-sheet[open]').waitFor({state:'detached'}).catch(()=>{});}
 const title=await page.locator('.title-input').inputValue();
 await page.locator('.editor .remind').click();
 const toast=page.locator('.toast').filter({hasText:/Reminder sent|could not be sent/});await toast.first().waitFor();const toastText=await toast.first().textContent();
 if(!/Reminder sent/.test(toastText))throw new Error(`Reminder not sent: ${toastText} (${await page.evaluate(()=>window.__notes.engine.read().lastError)})`);
 ctx.ledger.record(actor.name,'app-message','reminder',{note:title});
 // The message arrives in the provider's inbox (the provider console's Messages view).
 const inbox=await actor.browser.page();
 await inbox.goto(provider.origin+'/console');await inbox.locator('.app-shell').waitFor();
 await inbox.getByRole('button',{name:'Messages',exact:true}).click();
 await inbox.locator('.message-row').filter({hasText:`Reminder: ${title}`}).first().waitFor();
 await moment(ctx,actor,inbox,'provider-messages',shots);
 await inbox.close();
}

/** Clean removal (app-removal §6): from the provider's connected apps, through Notes' own cleanup page, and back. */
export async function removeFromProvider(ctx,actor,provider,{choice='keep',shots=false}={}){
 const page=actor.pages.notes;
 // Opened the way a person does: the console, then "Apps & integrations" in its navigation. The removal summary loads
 // with the connections (clean removal needs it), not only after a deep link or Refresh.
 const row=page.locator('section,article,li,div').filter({hasText:/notes\.example/}).filter({has:page.getByRole('button',{name:'Remove app'})}).last();
 const ready=async()=>{for(let i=0;i<16;i++){if(await row.getByRole('button',{name:'Remove app'}).isEnabled().catch(()=>false))return true;await page.waitForTimeout(500);}return false;};
 const removalLoaded=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/apps/removal'&&r.ok(),{timeout:15000}).catch(()=>null);
 await page.goto(provider.origin+'/console');await page.locator('.app-shell').waitFor();
 await page.getByRole('button',{name:'Apps & integrations',exact:true}).click();
 if(!await removalLoaded)throw new Error('Opening Apps & integrations did not load the removal summary.');
 const shown=await row.waitFor({timeout:8000}).then(ready,()=>false);
 if(!shown)throw new Error('The provider did not offer Notes for removal.');
 await moment(ctx,actor,page,'provider-connected-apps',shots);
 await row.getByRole('button',{name:'Remove app'}).click();
 const cleanUp=page.getByRole('button',{name:'Clean up first'});
 if(!await cleanUp.waitFor({timeout:5000}).then(()=>true,()=>false)){const req=actor.browser.context.request,apps=await (await req.get(provider.origin+'/api/apps')).json(),rem=await (await req.get(provider.origin+'/api/apps/removal')).json().catch(e=>({e:String(e)}));throw new Error('No clean removal offered: '+JSON.stringify({apps:(apps.apps??[]).map(a=>({id:a.id,state:a.state,status:a.status,integration:a.integration&&{kind:a.integration.kind,manifest:a.integration.snapshot?.manifest??a.integration.manifest}})),removal:{clean_enabled:rem.clean_enabled,clean_connections:rem.clean_connections,error:rem.error}}));}
 await moment(ctx,actor,page,'provider-removal-confirm',shots);
 await page.locator('form').filter({has:cleanUp}).getByRole('checkbox',{name:'I have reviewed this change and its effects.'}).check();
 await cleanUp.click();
 await page.waitForURL(url=>url.origin===notesOrigin(ctx)&&url.pathname==='/bindle/remove',{timeout:20000});
 await page.locator('.removal .options').waitFor();
 await moment(ctx,actor,page,'notes-removal',shots);
 await page.locator(`.removal input[value="${choice}"]`).check();
 await page.getByRole('button',{name:'Finish and return'}).click();
 await page.waitForURL(url=>url.origin===provider.origin,{timeout:20000});
 await page.waitForLoadState('networkidle').catch(()=>{});
 // The console shows the result of the return (app-removal §6) on Apps & integrations, and the owner API agrees.
 await page.getByRole('heading',{name:'Removal result',exact:true}).waitFor({timeout:15000}).catch(async error=>{throw new Error('No removal result shown after the return: '+JSON.stringify({cause:String(error?.message??error).split('\n')[0],url:page.url(),heading:await page.locator('h1,h2').first().textContent().catch(()=>null)}));});
 await page.getByText('App removed after reported cleanup').waitFor({timeout:5000});
 const removals=(await (await actor.browser.context.request.get(provider.origin+'/api/apps/removal')).json()).removals??[];
 const done=removals.find(r=>r.client_id===notesOrigin(ctx)+'/bindle/client.json'&&r.mode==='clean');
 if(done?.state!=='completed'||done.outcome!=='completed'||done.result?.items?.[0]?.disposition!==(choice==='delete'?'deleted':'kept'))throw new Error('Clean removal did not complete as reported: '+JSON.stringify(done&&{state:done.state,outcome:done.outcome}));
 await moment(ctx,actor,page,'provider-removal-done',shots);
 ctx.ledger.record(actor.name,'removal','notes',{provider:provider.name,choice,outcome:'completed'});
 // Invariant: the provider no longer lists a Notes connection for this person.
 const apps=await (await actor.browser.context.request.get(provider.origin+'/api/apps')).json();
 const live=(apps.apps??[]).filter(app=>app.clientId===notesOrigin(ctx)+'/bindle/client.json'&&['active','configuring','degraded','suspended'].includes(app.state??app.status));if(live.length)throw new Error('Notes is still connected after removal: '+JSON.stringify(live.map(a=>({state:a.state,status:a.status}))));
 await page.goto(notesOrigin(ctx)+'/');await page.locator('.workspace').waitFor();
 await moment(ctx,actor,page,'notes-signed-out-after-removal',shots);
}

/** App sign-out from Notes' settings: the app session ends (revoked); notes stay on the device. */
export async function signOutOfNotes(ctx,actor,{shots=false}={}){
 const page=actor.pages.notes,count=await page.evaluate(()=>window.__notes.engine.read().notes.filter(n=>!n.deleted).length);
 await page.getByRole('button',{name:'Settings'}).click();await page.locator('.settings-sheet[open]').waitFor();
 await page.getByRole('button',{name:'Sign out of Notes'}).click();
 await page.waitForFunction(()=>!window.__notes.engine.read().account,null,{timeout:10000});
 if(await page.evaluate(()=>window.__notes.engine.read().notes.filter(n=>!n.deleted).length)!==count)throw new Error('Signing out changed the notes on this device.');
 ctx.ledger.record(actor.name,'sign-out','notes',{kept:count});
 await moment(ctx,actor,page,'notes-signed-out-app',shots);
}
