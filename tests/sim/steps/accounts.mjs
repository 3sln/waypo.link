// Account steps on a 3sln.me provider, through its real pages: signup with a soft passkey, the recovery file, the console.
import {readFile} from 'node:fs/promises';

/** Signs `actor` up on `provider` through the browser. Returns {handle, address}. With `add`, the person already has
 * an account on this provider in this browser and adds another one (console → Switch account → Add account); the
 * new account is stored under `key` (default: the provider's name). */
export async function signUp(ctx,actor,provider,{shots=false,add=false,key=provider.name,addShots=false}={}){
 const page=await actor.browser.page(),scenario=ctx.scenario,moment=(id)=>shots&&ctx.shots.moment(page,id,{scenario,step:ctx.step.id,actor:actor.name});
 if(add){
  await page.goto(provider.origin+'/console');await page.locator('.app-shell').waitFor();
  await page.getByRole('button',{name:'Switch account'}).first().click();
  await page.getByRole('heading',{name:'Accounts in this browser'}).waitFor();
  if(addShots)await ctx.shots.moment(page,'provider-accounts-one',{scenario,step:ctx.step.id,actor:actor.name});
  await page.getByRole('button',{name:'Add account'}).click();
  // The signed-out landing for the added account offers signup from its header (a button in this tab state).
  const create=page.getByRole('link',{name:'Create an account'}).or(page.getByRole('button',{name:'Create an account'})).first();
  await create.waitFor();await create.click();
 }else{await page.goto(provider.origin+'/');await page.getByRole('link',{name:'Create an account'}).first().waitFor();}
 if(!add){await moment('provider-home');await page.getByRole('link',{name:'Create an account'}).first().click();}
 let questionsShot=false;
 for(let i=0;i<8;i++){
  const card=page.locator('.signup-wizard');await card.waitFor();const heading=await card.locator('.wizard-heading').textContent();
  if(await card.getByRole('button',{name:'Create my account'}).count())break;
  if(await card.locator('input[name=termsAccepted]').count()){await card.locator('input[name=ageConfirmed]').check();await card.locator('input[name=termsAccepted]').check();if(!questionsShot){questionsShot=true;await moment('signup-questions');}}
  await card.getByRole('button',{name:'Continue',exact:true}).click();
  await page.waitForFunction(previous=>document.querySelector('.signup-wizard .wizard-heading')?.textContent!==previous,heading);
 }
 await page.getByRole('button',{name:'Create my account'}).click();
 await page.getByRole('heading',{name:'Keep a way back in.'}).waitFor();
 await moment('signup-recovery');
 const passphrase=actor.passphrase;
 await page.getByLabel('What is my private recovery passphrase?',{exact:true}).fill(passphrase);
 await page.getByRole('button',{name:'Encrypt recovery file',exact:true}).click();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download recovery file',exact:true}).click();
 const file=JSON.parse(await readFile(await (await download).path(),'utf8'));if(file.format!=='3sln-recovery')throw new Error('The recovery download is not a recovery file.');
 await page.getByRole('heading',{name:'Test your recovery answers.'}).waitFor();
 await page.getByLabel('What is my private recovery passphrase?',{exact:true}).fill(passphrase);await page.getByRole('button',{name:'Test unlock'}).click();
 await page.getByRole('heading',{name:'Your way back in is ready.'}).waitFor();
 await moment('signup-ready');
 await page.getByLabel('I saved my recovery file in a safe place.').check();await page.getByRole('button',{name:'Open my space'}).click();
 await page.waitForURL(url=>url.pathname==='/console');await page.locator('.app-shell').waitFor();
 const session=await (await actor.browser.context.request.get(provider.origin+'/api/session')).json();
 if(!session.authenticated||!session.account?.handle)throw new Error('The provider session is not signed in after signup.');
 await moment('provider-console');
 await page.close();
 const account={provider:provider.name,handle:session.account.handle,address:`${session.account.handle}@${provider.host}`,id:session.account.id};
 actor.accounts[key]=account;
 ctx.ledger.record(actor.name,'account',key,{provider:provider.name,passkeys:1,recoveryFile:true,...add?{added:true}:{}});
 return account;
}
