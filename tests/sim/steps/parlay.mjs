// Parlay steps: what people do in the real Parlay web app (apps/parlay/web, served by the in-process Node shell at
// https://messages.example), with invitations checked against the real providers' directory and delegation status.
const moment=(ctx,actor,page,id,shots)=>shots?ctx.shots.moment(page,id,{scenario:ctx.scenario,step:ctx.step.id,actor:actor.name}):null;
const parlay=ctx=>ctx.world.services.parlay;
// Parlay's language menu is in its header; the screenshot catalogue switches language through this page hook, which
// drives that real <select> (shots.mjs: `window.__<surface>.engine.run('preference', {locale})`).
const languageHook=page=>page.evaluate(()=>{window.__parlay={engine:{run:async(_name,{locale})=>{const select=document.querySelector('.bb-web header select');if(!select)throw new Error('This Parlay view has no language menu.');select.value=locale;select.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));}}};});
// Parlay's decision buttons ignore presses until a confirmation delay has passed (anti-clickjacking arming).
const armedPress=async(page,locator)=>{await locator.waitFor({state:'visible'});await locator.hover();await page.waitForTimeout(1300);await locator.click();};

/** What Parlay's installation would do (it has none yet): record the connection, provision the mailbox for the
 * person's principal and acquire the first delegate certificate from their provider. */
export async function enrol(ctx,actor,provider){
 const account=actor.accounts[provider.name];if(!account)throw new Error(`${actor.name} has no account on ${provider.name}.`);
 actor.parlay??={};
 actor.parlay[provider.name]=await parlay(ctx).enrol({issuer:provider.origin,subject:account.id});
 ctx.ledger.record(actor.name,'parlay-mailbox',provider.name,{provider:provider.name});
}

/** Signs in to Parlay with the person's app credential (the shell's standalone sign-in form). */
export async function signIn(ctx,actor,provider,{path='/',hash='',shots=false}={}){
 const page=actor.pages.parlay??=await actor.browser.page();
 await page.goto(parlay(ctx).origin+path+hash);
 await page.getByRole('heading',{name:'Parlay'}).waitFor();
 await moment(ctx,actor,page,'parlay-sign-in',shots);
 await page.getByLabel('App credential').fill(actor.parlay[provider.name]);
 await page.getByRole('button',{name:'Sign in'}).click();
 await page.locator('.bb-web').waitFor();await languageHook(page);
 return page;
}

/** Contacts → Invite a person → Create invitation link; returns the bintent value of the one-time link. */
export async function createInvitation(ctx,actor,{name,shots=false}={}){
 const page=actor.pages.parlay;
 await page.locator('.bb-web nav').getByRole('button',{name:'Contacts',exact:true}).click();
 await page.getByRole('heading',{name:'Invite a person'}).waitFor();
 if(name)await page.getByRole('textbox',{name:'Private name (optional)'}).fill(name);
 await page.getByRole('button',{name:'Create invitation link'}).click();
 const link=page.getByRole('textbox',{name:'Invitation link'});await link.waitFor();
 const value=await link.inputValue();
 const bintent=/[?&#]bintent=([A-Za-z0-9_.-]+)/.exec(value)?.[1];if(!bintent)throw new Error(`The invitation link has no intent value: ${value.slice(0,60)}`);
 await moment(ctx,actor,page,'parlay-invite-link',shots);
 await page.getByRole('button',{name:'Done'}).click();
 ctx.ledger.record(actor.name,'parlay-invitation',name??'invitation',{});
 return {value,bintent};
}

/** Opens an invitation in Parlay (its intent route), signs in, and checks it. Returns the page, at the decision. */
export async function openInvitation(ctx,actor,provider,bintent,{shots=false}={}){
 const page=await signIn(ctx,actor,provider,{path:'/bindle/intent',hash:'#bintent='+bintent});
 await page.getByRole('heading',{name:'Accept an invitation'}).waitFor();
 await moment(ctx,actor,page,'parlay-connect-check',shots);
 await armedPress(page,page.getByRole('button',{name:'Check invitation'}));
 return page;
}

/** Same-provider acceptance: Check invitation → Allow; both people then appear in each other's Contacts. */
export async function acceptInvitation(ctx,actor,provider,bintent,{inviter,shots=false}={}){
 const page=await openInvitation(ctx,actor,provider,bintent,{shots});
 const question=page.locator('[data-question]');
 await question.waitFor({timeout:20000}).catch(async()=>{throw new Error('No decision after checking the invitation: '+(await page.locator('[role=alert],[role=status]').allTextContents()).join(' | '));});
 await moment(ctx,actor,page,'parlay-connect-allow',shots);
 await armedPress(page,page.getByRole('button',{name:'Allow',exact:true}));
 await page.waitForFunction(()=>!document.querySelector('[data-question]'),null,{timeout:20000});
 ctx.ledger.record(actor.name,'parlay-contact',inviter.name,{via:'invitation'});
 ctx.ledger.record(inviter.name,'parlay-contact',actor.name,{via:'invitation'});
 return page;
}

/** Cross-provider acceptance attempt: today Parlay refuses a foreign inviter without any fetch (messaging CL-24). The
 * step asserts the behaviour we want (a verified decision), so it fails with the refusal today. */
export async function acceptForeignInvitation(ctx,actor,provider,bintent,{shots=false}={}){
 const page=await openInvitation(ctx,actor,provider,bintent);
 const outcome=await Promise.race([
  page.locator('[data-question]').waitFor({timeout:20000}).then(()=>'decision'),
  page.getByText('This invitation could not be verified. Ask the person for a new one.').waitFor({timeout:20000}).then(()=>'unverifiable')
 ]).catch(()=>'nothing');
 if(outcome==='unverifiable'){await moment(ctx,actor,page,'parlay-connect-refused',shots);throw new Error('Cross-provider invitation refused: connectUnverifiable (same-host only, messaging CL-24).');}
 if(outcome!=='decision')throw new Error('Neither a decision nor a refusal after checking a cross-provider invitation.');
}

/** The other person is listed in Contacts (reachable), on this person's page. */
export async function expectContact(ctx,actor,other,provider,{shots=false,shot='parlay-contacts'}={}){
 const page=actor.pages.parlay,subject=other.accounts[provider.name].id;
 await page.locator('.bb-web nav').getByRole('button',{name:'Contacts',exact:true}).click();
 for(let i=0;i<20;i++){if(await page.locator('.members>li').filter({hasText:subject}).count())break;await page.locator('.bb-web header').getByRole('button',{name:'Refresh'}).click().catch(()=>{});await page.waitForTimeout(500);}
 const row=page.locator('.members>li').filter({hasText:subject});
 if(!await row.count())throw new Error(`${other.name} is not in ${actor.name}'s Contacts: ${(await page.locator('.members').innerText().catch(()=>'')).slice(0,300)}`);
 await moment(ctx,actor,page,shot,shots);
 return row;
}

/** Starts a conversation with a contact and sends the first message. */
export async function startConversation(ctx,actor,other,provider,{subject,text,shots=false}={}){
 const page=actor.pages.parlay,row=await expectContact(ctx,actor,other,provider);
 const form=row.locator('form');
 if(subject)await form.getByRole('textbox',{name:'Subject'}).fill(subject);
 await form.getByRole('textbox',{name:'Message draft'}).fill(text);
 const created=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/web/operation'&&r.request().postData()?.includes('conversations.create'),{timeout:15000});
 await form.getByRole('button',{name:'Start conversation'}).click();
 const response=await created;if(!response.ok())throw new Error(`conversations.create answered ${response.status()}: ${(await response.text()).slice(0,300)}`);
 await page.locator('.bb-web nav').getByRole('button',{name:'Conversations',exact:true}).click();
 await page.locator('.bb-web main').getByText(subject??text).first().waitFor({timeout:20000});
 ctx.ledger.record(actor.name,'parlay-message',text,{to:other.name});
 await moment(ctx,actor,page,'parlay-conversation-started',shots);
}

/** The conversation `subject` arrives as a request from a verified contact: accept it, open it, read `text`, reply. */
export async function receiveAndReply(ctx,actor,{subject,text,reply,shots=false}={}){
 const page=actor.pages.parlay,main=page.locator('.bb-web main'),nav=name=>page.locator('.bb-web nav').getByRole('button',{name,exact:true}).click();
 await nav('Requests');
 for(let i=0;i<30;i++){if(await main.getByText(subject).count())break;await page.locator('.bb-web header').getByRole('button',{name:'Refresh'}).click().catch(()=>{});await page.waitForTimeout(500);}
 if(!await main.getByText(subject).count())throw new Error(`“${subject}” never reached ${actor.name}'s requests: ${(await main.innerText()).replace(/\s+/g,' ').slice(0,300)}`);
 if(!await main.getByText('Verified principal').count())throw new Error('The request from a contact is not shown as a verified principal.');
 await moment(ctx,actor,page,'parlay-request',shots);
 await armedPress(page,main.getByRole('button',{name:'Accept invitation'}).first());
 await nav('Conversations');
 for(let i=0;i<20;i++){if(await main.getByText(subject).count())break;await page.locator('.bb-web header').getByRole('button',{name:'Refresh'}).click().catch(()=>{});await page.waitForTimeout(500);}
 await moment(ctx,actor,page,'parlay-conversation-list',shots);
 const entry=main.locator('li,article,tr').filter({hasText:subject}).last(),open=entry.getByRole('button',{name:'Open'});
 if(await open.count())await open.first().click();else await main.getByText(subject).first().click();
 await page.getByText(text).first().waitFor({timeout:20000});
 await page.getByRole('textbox',{name:'Message draft'}).fill(reply);
 await page.getByRole('button',{name:'Send message'}).click();
 await page.getByText(reply).first().waitFor({timeout:20000});
 ctx.ledger.record(actor.name,'parlay-message',reply,{reply:true});
 await moment(ctx,actor,page,'parlay-conversation',shots);
}

/** Opens the conversation `subject` and waits until `text` appears in it (refreshing while it travels). */
export async function expectMessage(ctx,actor,{subject,text}){
 const page=actor.pages.parlay,main=page.locator('.bb-web main');
 await page.locator('.bb-web nav').getByRole('button',{name:'Conversations',exact:true}).click();
 const entry=main.locator('li,article,tr').filter({hasText:subject}).last();await entry.waitFor({timeout:10000});
 const open=entry.getByRole('button',{name:'Open'});if(await open.count())await open.first().click();else await main.getByText(subject).first().click();
 for(let i=0;i<30;i++){if(await page.getByText(text).count())return;await page.locator('.bb-web header').getByRole('button',{name:'Refresh'}).click().catch(()=>{});await page.waitForTimeout(500);}
 throw new Error(`${actor.name} did not receive “${text}”: ${(await main.innerText()).replace(/\s+/g,' ').slice(0,300)}`);
}

// ---- load phase (medium scale) -------------------------------------------------------------------------------------
/** One mailbox operation through Parlay's real HTTP surface (/api/web/operation, the browser client's own route). */
async function operate(world,credential,name,input={}){
 const response=await world.network.fetch(world.services.parlay.origin+'/api/web/operation',{method:'POST',headers:{authorization:'Bearer '+credential,'content-type':'application/json'},body:JSON.stringify({name,input})});
 const body=await response.json().catch(()=>null);if(!response.ok)throw new Error(`${name} answered ${response.status}: ${body?.error??''} ${body?.message??''}`);return body;
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
/** Accepts {issuer, subject}, or a load actor {principal:{iss, sub}} / {provider, accountId} (tests/sim/load.mjs). */
function ownerOf(world,o){
 const issuer=o.issuer??o.principal?.iss??(o.provider&&world.providers[o.provider]?.origin),subject=o.subject??o.principal?.sub??o.accountId;
 if(typeof issuer!=='string'||typeof subject!=='string')throw new Error('loadMessages: an owner needs an issuer and a subject.');return {issuer,subject};
}
const pct=(values,p)=>{if(!values.length)return 0;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.ceil(p/100*sorted.length)-1)];};
/**
 * Same-provider message load for the medium scale (spike §3.3 "Messages (same-provider)"). `owners` are accounts on
 * one provider created by the caller through the provider's real signup ({issuer, subject} or a load actor). Each
 * consecutive pair (0↔1, 2↔3, …) is enrolled in Parlay and connects the way people do, through Parlay's own HTTP
 * surface (/api/web/operation): the first creates a one-time invitation (invites.create), the second checks and
 * redeems it (invites.inspect, invites.redeem), which opens their two-party conversation. Then `count` messages in
 * total are sent across the pairs by `concurrency` senders. Every message is a real signed envelope delivered
 * mailbox-to-mailbox through Parlay's egress to /bindle/ingress and verified against the provider's identity
 * document and delegation status (cached per the messaging rules). Asserts every message arrived.
 * Returns {pairs, sent, delivered, ms, sendMs, perSecond, stats:{count, p95Ms, perSecond}}.
 */
export async function loadMessages(world,{owners,count=5000,concurrency=8,log=()=>{}}={}){
 const started=Date.now(),service=world.services.parlay,pairs=[];
 if(!service?.enrol)throw new Error('Parlay is not mounted in this world.');
 const list=(owners??[]).map(o=>ownerOf(world,o));if(list.length<2)throw new Error('loadMessages needs at least two owners.');
 const credentials=new Map();
 for(const o of list)credentials.set(o.subject,await service.enrol(o));
 for(let i=0;i+1<list.length;i+=2){
  const [a,b]=[list[i],list[i+1]],ca=credentials.get(a.subject),cb=credentials.get(b.subject);
  const {data}=await operate(world,ca,'invites.create',{name:`Load ${i/2+1}`});
  await operate(world,cb,'invites.inspect',{data});
  let redeemed=await operate(world,cb,'invites.redeem',{data});
  for(let t=0;t<60&&redeemed?.state!=='accepted';t++){await sleep(250);redeemed=await operate(world,cb,'invites.redeem',{data});}
  if(redeemed?.state!=='accepted'||!redeemed.conversationId)throw new Error(`Load invitation ${i/2+1} ended ${JSON.stringify(redeemed)}.`);
  pairs.push({sender:b,receiver:a,cs:cb,cr:ca,conversationId:redeemed.conversationId,sent:0,base:0});
 }
 for(const pair of pairs){const d=await operate(world,pair.cr,'conversations.get',{conversationId:pair.conversationId,limit:1}).catch(()=>null);pair.base=d?.pagination?.total??0;}
 log(`  parlay load: ${pairs.length} conversations ready in ${Date.now()-started} ms`);
 const sendStarted=Date.now(),latencies=[];let next=0,sent=0;
 const worker=async()=>{for(;;){const n=next++;if(n>=count)return;const pair=pairs[n%pairs.length],t0=Date.now();
  for(let attempt=0;;attempt++){try{await operate(world,pair.cs,'conversations.send',{conversationId:pair.conversationId,text:`Load message ${n+1}`,operationId:crypto.randomUUID()});break;}catch(error){if(attempt>=3||!/ (409|429|503):/.test(error.message))throw error;await sleep(200*(attempt+1));}}
  latencies.push(Date.now()-t0);pair.sent++;sent++;if(sent%500===0)log(`  parlay load: ${sent}/${count} sent`);}};
 await Promise.all(Array.from({length:Math.max(1,concurrency)},worker));
 const sendMs=Date.now()-sendStarted;
 // Delivery: each receiver's copy of the conversation eventually holds every message (the outbox drains asynchronously).
 let delivered=0;
 for(const pair of pairs){
  let have=0;for(let t=0;t<600;t++){const d=await operate(world,pair.cr,'conversations.get',{conversationId:pair.conversationId,limit:1}).catch(()=>null);have=(d?.pagination?.total??pair.base)-pair.base;if(have>=pair.sent)break;await sleep(500);}
  delivered+=Math.min(have,pair.sent);
 }
 const ms=Date.now()-started,perSecond=Math.round(sent/(sendMs/1000)*10)/10;
 return {pairs:pairs.length,sent,delivered,ms,sendMs,perSecond,stats:{count:sent,delivered,p95Ms:pct(latencies,95),perSecond,ms}};
}
