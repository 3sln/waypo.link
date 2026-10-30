// Photos steps: a guest browses the public gallery, signs in with a full-page redirect, and is asked for storage only
// when adding a first photo (incremental authorization), then adds photos as bytes to the storage they chose.
import {armedClick} from '../browser.mjs';
import {landscapePng} from '../png.mjs';

const photosOrigin=ctx=>ctx.world.apps.photos.origin;
const moment=(ctx,actor,page,id,shots)=>shots?ctx.shots.moment(page,id,{scenario:ctx.scenario,step:ctx.step.id,actor:actor.name}):null;

/** Drives the provider's pages until the browser is back on Photos: account choice, consent, the incremental
 * walkthrough (choose a resource, save, allow, return). `shot` names the moment captured at the allow control. */
async function providerFlow(ctx,actor,page,{shots,shot}){
 let captured=false;
 for(let i=0;i<20;i++){
  await page.waitForLoadState('domcontentloaded').catch(()=>{});
  if(new URL(page.url()).origin===photosOrigin(ctx))return;
  const radios=page.getByRole('radio');if(await radios.count()&&await radios.first().isVisible()&&!await radios.first().isChecked()){await radios.first().check();continue;}
  const configure=page.locator('summary',{hasText:'Configure this fragment'});
  if(await configure.count()&&await configure.isVisible()&&!await page.locator('details').first().evaluate(d=>d.open)){await configure.click();await page.locator('input[name^="resource:"]').first().check();const prefix=page.locator('input[name^="prefix:"]');if(await prefix.count())await prefix.first().fill('photos/');await page.getByRole('button',{name:'Save preferences and review'}).click();continue;}
  for(const box of await page.getByRole('checkbox').all())if(await box.isVisible()&&await box.isEnabled()&&!await box.isChecked()&&!/remember|review|Stop/i.test(await box.getAttribute('name')??''))await box.check().catch(()=>{});
  const actions=['[data-consent-action="return"]','[data-consent-action="allow"]','button:has-text("Allow selected access")','button:has-text("Save and continue")','button:has-text("Continue as")'];
  let acted=false;
  for(const selector of actions){const control=page.locator(selector).first();if(await control.count()&&await control.isVisible()&&await control.getAttribute('aria-disabled')!=='true'&&!await control.isDisabled()){if(shot&&!captured&&/allow/i.test(selector)){captured=true;await moment(ctx,actor,page,shot,shots);}await armedClick(page,control);await page.waitForTimeout(500);acted=true;break;}}
  if(!acted)await page.waitForTimeout(500);
 }
 throw new Error(`The provider flow did not return to Photos (at ${new URL(page.url()).pathname}).`);
}
async function signIn(ctx,actor,page,provider,{shots=false}={}){
 await page.locator('.signin-cta, .empty .btn.primary').first().click();
 const form=page.locator('bindle-sign-in');const input=form.getByLabel(/^(Your Bindle identity|Your handle)$/);await input.waitFor();
 await input.fill(actor.accounts[provider.name].address);
 await moment(ctx,actor,page,'photos-sign-in',shots);
 await form.getByRole('button',{name:'Continue',exact:true}).click();
 await page.waitForURL(url=>url.origin===provider.origin,{timeout:20000});
 await providerFlow(ctx,actor,page,{shots});
 await page.waitForFunction(()=>!!window.__photos?.engine.read().account,null,{timeout:20000});
}

export async function browseAsGuest(ctx,actor,{shots=false}={}){
 const page=actor.pages.photos??=await actor.browser.page();
 await page.goto(photosOrigin(ctx)+'/');await page.locator('.explore .grid .tile').first().waitFor();
 if(await page.locator('.tab',{hasText:'Your library'}).count())throw new Error('A guest sees the personal library tab.');
 await moment(ctx,actor,page,'photos-explore-signed-out',shots);
 await page.locator('.explore .tile').nth(1).click();await page.locator('.viewer').waitFor();
 await moment(ctx,actor,page,'photos-viewer-public',shots);
 await page.keyboard.press('Escape');await page.locator('.viewer').waitFor({state:'detached'});
}

export async function signInAndUnlock(ctx,actor,provider,{shots=false}={}){
 const page=actor.pages.photos;
 await signIn(ctx,actor,page,provider,{shots});
 // Signing in shared nothing: the library asks for storage only now.
 await page.locator('.tab',{hasText:'Your library'}).click();await page.locator('.library .empty').waitFor();
 await moment(ctx,actor,page,'photos-library-locked',shots);
 await page.getByRole('button',{name:'Choose storage'}).click();
 await page.waitForURL(url=>url.origin===provider.origin,{timeout:20000});
 await providerFlow(ctx,actor,page,{shots,shot:'provider-grant-more-storage'});
 ctx.ledger.record(actor.name,'grant','photos-library',{via:'incremental'});
 await page.locator('.library').waitFor();
 // The redirect returns to a new document. A persisted app session (W11) normally survives it; where it does not
 // (memory-only session), finishing needs one more sign-in.
 if(await page.getByRole('button',{name:'Continue'}).count()){
  await moment(ctx,actor,page,'photos-library-reconnect',shots);
  await page.getByRole('button',{name:'Continue'}).click();
  const form=page.locator('bindle-sign-in'),input=form.getByLabel(/^(Your Bindle identity|Your handle)$/);await input.waitFor();await input.fill(actor.accounts[provider.name].address);
  await form.getByRole('button',{name:'Continue',exact:true}).click();await page.waitForURL(url=>url.origin===provider.origin,{timeout:20000});
  await providerFlow(ctx,actor,page,{shots:false});
 }
 await page.waitForFunction(()=>window.__photos.engine.read().storage==='granted',null,{timeout:20000});
 await page.locator('.library .toolbar').waitFor();
}

export async function addPhotos(ctx,actor,count,{shots=false}={}){
 const page=actor.pages.photos,names=['harbour-walk','morning-ridge','lake-evening','city-roofs'];
 const files=[...Array(count)].map((_,i)=>({name:`${names[i%names.length]}.png`,mimeType:'image/png',buffer:landscapePng(ctx.random)}));
 for(const file of files){await page.locator('.library .add input[type=file]').setInputFiles(file);const raw=file.name.replace('.png','').replace(/-/g,' '),title=raw.charAt(0).toUpperCase()+raw.slice(1);ctx.ledger.record(actor.name,'photo',title,{bytes:file.buffer.length});await page.locator('.library .tile.own img[alt="'+title+'"]').waitFor({timeout:20000});}
 await moment(ctx,actor,page,'photos-library',shots);
 await page.locator('.library .tile.own').first().click();await page.locator('.viewer img').waitFor();
 await moment(ctx,actor,page,'photos-viewer-own',shots);
 await page.keyboard.press('Escape');
 // Invariant: the stored index lists exactly the photos the ledger says this person added.
 const stored=await page.evaluate(()=>window.__photos.engine.read().photos.map(p=>p.title).sort());
 const expected=ctx.ledger.expected(actor.name,'photo').map(e=>e.key).sort();
 if(JSON.stringify(stored)!==JSON.stringify(expected))throw new Error(`Stored photos ${JSON.stringify(stored)} differ from the ledger ${JSON.stringify(expected)}.`);
}
