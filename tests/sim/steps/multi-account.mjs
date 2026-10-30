// Multi-account steps (integration pattern P5): one person with two accounts on the same provider holds both in Notes
// and switches between them; each account keeps its own notes. Real provider pages, real consent, real elements.
import {armedClick,islandClick,popupFrom} from '../browser.mjs';

const notesOrigin=ctx=>ctx.world.apps.notes.origin;
const moment=(ctx,actor,page,id,shots)=>shots?ctx.shots.moment(page,id,{scenario:ctx.scenario,step:ctx.step.id,actor:actor.name}):null;
const visibleTitles=page=>page.evaluate(()=>window.__notes.engine.read().notes.filter(n=>!n.deleted).map(n=>n.title).sort());
const current=page=>page.evaluate(()=>{const s=window.__notes.session.session;return s?{issuer:s.issuer,subject:s.subject}:null;});
const pause=(page,ms)=>page.isClosed()?null:page.waitForTimeout(ms).catch(()=>{});
const held=page=>page.evaluate(()=>(window.__notes.session.sessions??[]).length);

/** The provider's pages after a sign-in or account switch started from Notes: choose `account` by handle, consent to
 * storage the first time, return. Works for a popup (closes itself) and for a redirect (returns to Notes). */
const visited=[];
async function providerChoose(ctx,actor,page,account,{shots=false,shot}={}){
 for(let i=0;i<24;i++){
  if(page.isClosed())return;
  visited.push(page.url().split('?')[0]+' '+(await page.locator('h1,h2').first().textContent({timeout:1000}).catch(()=>'')).trim().slice(0,60)+' | '+(await page.getByRole('button').allTextContents().catch(()=>[])).map(t=>t.trim().slice(0,30)).join(','));
  await page.waitForLoadState('domcontentloaded').catch(()=>{});
  if(page.isClosed()||new URL(page.url()).origin===notesOrigin(ctx))return;
  const choose=page.getByRole('button',{name:new RegExp(`Continue as .*${account.handle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`)});
  if(await choose.count()&&await choose.first().isVisible()){if(shot){await moment(ctx,actor,page,shot,shots);shot=null;}await armedClick(page,choose.first());await pause(page,600);continue;}
  const configure=page.locator('summary',{hasText:'Configure this fragment'});
  if(await configure.count()&&await configure.isVisible()&&!await page.locator('details').first().evaluate(d=>d.open).catch(()=>true)){
   await configure.click();await page.locator('input[name="resource:store"]').check();const scope=page.locator('input[name^="prefix:store:"]');if(await scope.count())await scope.fill('notes/');
   const sort=page.locator('details select[name="sort"]');if(await sort.count())await sort.selectOption('updated');
   await page.getByRole('button',{name:'Save preferences and review'}).click();await page.getByRole('checkbox',{name:'Create or replace files'}).waitFor();continue;
  }
  for(const name of ['Inspect storage capabilities','Read file contents','Create or replace files','Permanently delete files']){const box=page.getByRole('checkbox',{name});if(await box.count()&&await box.isEnabled()&&!await box.isChecked())await box.check();}
  const occupant=page.getByRole('checkbox',{name:/^Account storage ·/});if(await occupant.count()&&!await occupant.first().isChecked())await occupant.first().check();
  const allow=page.getByRole('button',{name:'Allow selected access'});
  if(await allow.count()&&await allow.isVisible()){await armedClick(page,allow);await pause(page,600);continue;}
  await pause(page,500);
 }
 if(!page.isClosed()&&new URL(page.url()).origin!==notesOrigin(ctx))throw new Error(`The provider flow did not return to Notes (at ${new URL(page.url()).pathname}).`);
}
async function openMenu(page){
 const account=page.locator('bindle-account'),isOpen=()=>page.evaluate(()=>document.querySelector('bindle-account')?.state?.open===true);
 await account.locator('button').first().click();
 if(!await page.waitForFunction(()=>document.querySelector('bindle-account')?.state?.open===true,null,{timeout:2500}).then(()=>true,()=>false))await account.locator('button').first().click();
 await page.waitForFunction(()=>document.querySelector('bindle-account')?.state?.open===true,null,{timeout:5000});
 await page.waitForTimeout(300);
 return account;
}
/** Clicks a menu control by accessible name: inside the provider's account-switcher island when it is live (pointer
 * arming applies), else in the element's own panel. Returns 'island' or 'element'. */
async function menuClick(page,name){
 const island=await islandFrameWith(page,name);
 if(island){await islandClick(page,null,island);return 'island';}
 const own=page.locator('bindle-account').getByRole('button',{name});
 if(!await own.count()){const frames=[];for(const f of page.frames())frames.push({url:f.url().split('?')[0],buttons:await f.locator('button,a,[role=button]').evaluateAll(els=>els.map(e=>(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,40))).catch(()=>[])});throw new Error(`No "${name}" control in the account menu: ${JSON.stringify(frames)}`);}
 await own.first().click();return 'element';
}
/** The visible control named `name` inside one of the provider's embed frames (islands), or null. */
async function islandFrameWith(page,name){
 for(const frame of page.frames()){
  if(frame===page.mainFrame()||!/^https:\/\/embed\./.test(frame.url()))continue;
  const control=frame.getByRole('button',{name});
  if(await control.count().catch(()=>0)&&await control.first().isVisible().catch(()=>false))return control.first();
 }
 return null;
}
async function waitAccount(page,account){
 await page.waitForFunction(id=>window.__notes.session.session?.subject&&window.__notes.engine.read().account?.subject===window.__notes.session.session.subject&&document.querySelector('.sync-chip')?.dataset.sync==='synced',null,{timeout:30000});
 void account;
}
async function writeNote(ctx,actor,page,{title,body},owner){
 // Let the account's first sync settle (it re-renders the list and editor) before typing.
 await page.waitForFunction(()=>document.querySelector('.sync-chip')?.dataset.sync==='synced',null,{timeout:30000});await page.waitForTimeout(400);
 const before=await page.evaluate(()=>window.__notes.engine.read().notes.length);
 await page.locator('.new-note').click();
 await page.waitForFunction(n=>window.__notes.engine.read().notes.length>n&&document.querySelector('.title-input')?.value==='',before);
 await page.locator('.title-input').fill(title);await page.locator('.body-input').fill(body);await page.locator('.title-input').blur();
 const typed=await page.evaluate(()=>({title:document.querySelector('.title-input')?.value,body:document.querySelector('.body-input')?.value}));
 if(typed.title!==title||typed.body!==body)throw new Error(`The editor holds ${JSON.stringify(typed)} after typing the note.`);
 await page.waitForFunction(()=>document.querySelector('.sync-chip')?.dataset.sync==='synced',null,{timeout:30000});
 ctx.ledger.record(actor.name,'note',title,{title,account:owner});
}

/** Signs in to Notes with the first account (island, popup) and writes a work note. */
export async function firstAccount(ctx,actor,{work,shots=false}){
 const page=actor.pages.notesMulti=await actor.browser.page(),account=actor.accounts.alpha;
 await page.goto(notesOrigin(ctx)+'/');await page.locator('.workspace').waitFor();
 await page.locator('.signin-cta').click();
 const island=page.frameLocator('bindle-sign-in iframe:visible'),button=island.getByRole('button',{name:/Continue with/});await button.waitFor();
 const popup=await popupFrom(actor.browser.context,()=>islandClick(page,island,button));
 await providerChoose(ctx,actor,popup,account,{shots,shot:'provider-entry-two-accounts'});
 if(!popup.isClosed())await popup.waitForEvent('close',{timeout:20000}).catch(()=>{});
 await page.bringToFront();await waitAccount(page,account);
 await writeNote(ctx,actor,page,work,'alpha');
 ctx.ledger.record(actor.name,'connection','notes-multi',{account:'alpha'});
}

/** "Use another account" from the account menu: the provider's chooser, the second account, its own first consent. */
export async function addSecondAccount(ctx,actor,{personal,shots=false}){
 const page=actor.pages.notesMulti,account=actor.accounts.alpha2,first=await current(page);
 await openMenu(page);
 const opened=actor.browser.context.waitForEvent('page',{timeout:10000}).catch(()=>null),navigated=page.waitForURL(url=>url.origin!==notesOrigin(ctx),{timeout:10000}).then(()=>page).catch(()=>null);
 const via=await menuClick(page,'Use another account');ctx.ledger.record(actor.name,'menu','use-another-account',{via});
 const target=await Promise.race([opened,navigated]);if(!target)throw new Error('"Use another account" opened no provider page.');
 await providerChoose(ctx,actor,target,account,{shots});
 if(target!==page&&!target.isClosed())await target.waitForEvent('close',{timeout:20000}).catch(()=>{});
 await page.bringToFront();
 await page.waitForFunction(old=>window.__notes.session.session?.subject&&window.__notes.session.session.subject!==old,first.subject,{timeout:20000}).catch(()=>{});
 await waitAccount(page,account);
 const now=await current(page);if(!now||now.subject===first.subject)throw new Error('The second account did not become current: '+JSON.stringify(visited.slice(-8)));
 if(JSON.stringify(await visibleTitles(page))!=='[]')throw new Error(`The second account shows the first account's notes: ${JSON.stringify(await visibleTitles(page))}`);
 await writeNote(ctx,actor,page,personal,'alpha2');
 if(await held(page)!==2)throw new Error(`Notes holds ${await held(page)} sessions, expected 2.`);
 ctx.ledger.record(actor.name,'connection','notes-multi',{account:'alpha2'});
 await openMenu(page);await moment(ctx,actor,page,'notes-account-menu-two',shots);await page.keyboard.press('Escape');await page.waitForFunction(()=>document.querySelector('bindle-account')?.state?.open!==true,null,{timeout:3000}).catch(()=>{});
}

/** Switch back to the first account from the menu; its notes come back, the second account's do not show. */
export async function switchBack(ctx,actor,{work,shots=false}){
 const page=actor.pages.notesMulti;
 await openMenu(page);
 const switchTo=actor.accounts.alpha.handle,pattern=new RegExp(switchTo.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
 // The switcher island (when live) lists the accounts bound on this site; else the element lists held sessions.
 const island=await islandFrameWith(page,pattern);
 if(island){await islandClick(page,null,island);ctx.ledger.record(actor.name,'menu','switch',{via:'island'});}
 else{
  const row=page.locator('bindle-account').getByRole('button',{name:/^Switch to /});
  if(!await row.count())throw new Error('The account menu lists no other held account to switch to.');
  await row.first().click();ctx.ledger.record(actor.name,'menu','switch',{via:'element'});
 }
 await page.waitForFunction(t=>window.__notes.engine.read().notes.some(n=>n.title===t&&!n.deleted),work.title,{timeout:20000});
 const titles=await visibleTitles(page);if(JSON.stringify(titles)!==JSON.stringify([work.title]))throw new Error(`After switching back Notes shows ${JSON.stringify(titles)}.`);
 ctx.ledger.record(actor.name,'switch','notes-multi',{to:'alpha'});
 await moment(ctx,actor,page,'notes-switched-account',shots);
}

/** Per-account sign-out: "Sign out of this account" ends only the current one; the other account stays signed in. */
export async function signOutOne(ctx,actor,{personal}){
 const page=actor.pages.notesMulti;
 await openMenu(page);
 await page.locator('bindle-account').getByRole('button',{name:'Sign out of this account'}).click();
 await page.waitForFunction(()=>(window.__notes.session.sessions??[]).length===1,null,{timeout:10000});
 await page.waitForFunction(t=>window.__notes.engine.read().account&&window.__notes.engine.read().notes.some(n=>n.title===t&&!n.deleted),personal.title,{timeout:20000});
 ctx.ledger.record(actor.name,'sign-out','notes-multi',{account:'alpha',remaining:'alpha2'});
}

/** Wanted: an account on another provider joins the same app session list (redirect sign-in keeps held sessions). */
export async function crossProviderHold(ctx,actor){
 const page=actor.pages.notesMulti,account=actor.accounts.beta;
 await openMenu(page);
 await menuClick(page,'Use a different provider');
 const input=page.locator('bindle-account').getByLabel(/^(Your handle|Your Bindle identity)$/);await input.waitFor({timeout:8000});
 await input.fill(account.address);
 const opened=actor.browser.context.waitForEvent('page',{timeout:10000}).catch(()=>null),navigated=page.waitForURL(url=>url.origin!==notesOrigin(ctx),{timeout:10000}).then(()=>page).catch(()=>null);
 await page.locator('bindle-account').getByRole('button',{name:'Continue',exact:true}).click();
 const target=await Promise.race([opened,navigated]);if(!target)throw new Error('No provider page opened for the beta account.');
 await providerChoose(ctx,actor,target,account,{});
 if(target!==page&&!target.isClosed())await target.waitForEvent('close',{timeout:20000}).catch(()=>{});
 await page.bringToFront();
 if(target===page){await page.waitForURL(url=>url.origin===notesOrigin(ctx),{timeout:20000});await page.locator('.workspace').waitFor();}
 await page.waitForFunction(()=>(window.__notes?.session?.sessions??[]).length===2,null,{timeout:8000}).catch(async()=>{throw new Error(`After a sign-in at beta Notes holds ${await held(page).catch(()=>'?')} sessions (wanted the alpha and beta accounts).`);});
}
