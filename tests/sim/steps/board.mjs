// Board steps: what people do in the Board sample (sign-in required, live board, assignments) and around it in the
// providers' own pages (organizations console, member certificates), through real browsers and real providers.
import {writeFile} from 'node:fs/promises';
import {armedClick} from '../browser.mjs';
import {createKey,createProof} from '../../../packages/sdk/src/dpop.mjs';

export const BUS_FRAGMENT='https://board.example/buses/board-changes/v1';
const boardOrigin=ctx=>ctx.world.services.board.origin;
const moment=(ctx,actor,page,id,shots)=>shots?ctx.shots.moment(page,id,{scenario:ctx.scenario,step:ctx.step.id,actor:actor.name}):null;
const state=page=>page.evaluate(()=>window.__board.engine.read());

/** The person's own provider API from their browser session (cookie, CSRF, account context), for owner operations the
 * console has no control for yet. Mutations carry the provider's Origin, as the console's own requests do. */
export async function ownerApi(actor,provider){
 const request=actor.browser.context.request,session=await (await request.get(provider.origin+'/api/session')).json();
 if(!session.authenticated)throw new Error(`${actor.name} is not signed in at ${provider.host}.`);
 const base={'X-Bindle-Account':session.account.id,...session.sessionContext?{'X-Bindle-Session-Context':session.sessionContext}:{}};
 const answer=async response=>({status:response.status(),body:await response.json().catch(()=>null)});
 return {session,
  get:async path=>answer(await request.get(provider.origin+path,{headers:base})),
  post:async(path,data)=>answer(await request.post(provider.origin+path,{headers:{...base,Origin:provider.origin,'X-CSRF-Token':session.csrfToken,'Content-Type':'application/json'},data}))};
}

/** Drives a provider window (popup or the page itself) until it closes or returns to Board: account choice, the
 * consent walkthrough with the resources each fragment needs, approval. `shot` names the moment at the allow control. */
async function providerFlow(ctx,actor,page,{shots=false,shot=null,handle=null,dump='consent'}={}){
 let captured=false;
 for(let i=0;i<30;i++){
  if(page.isClosed())return 'closed';
  await page.waitForLoadState('domcontentloaded').catch(()=>{});
  if(page.isClosed())return 'closed';
  if(new URL(page.url()).origin===boardOrigin(ctx))return 'returned';
  // Each fragment with a resource field is configured in place: choose the offered resource (the first one, which
  // is the only one for this person), give storage a prefix, save; then the page shows the next one.
  let configured=false;
  for(const section of await page.locator('details').filter({has:page.locator('input[name^="resource:"]')}).all()){
   const resource=section.locator('input[name^="resource:"]').first();if(await resource.isChecked()||!await resource.isEnabled())continue;
   if(!await section.evaluate(d=>d.open))await section.locator('summary').first().click();
   await resource.check();const prefix=section.locator('input[name^="prefix:"]');if(await prefix.count())await prefix.first().fill('board/');
   await section.getByRole('button',{name:'Save preferences and review'}).click();await page.waitForTimeout(600);configured=true;break;
  }
  if(configured)continue;
  const radios=page.getByRole('radio');if(await radios.count()&&await radios.first().isVisible()&&!await radios.first().isChecked()){await radios.first().check();continue;}
  for(const box of await page.getByRole('checkbox').all())if(await box.isVisible().catch(()=>false)&&await box.isEnabled().catch(()=>false)&&!await box.isChecked().catch(()=>true)&&!/remember|review|Stop|readonly/i.test(await box.getAttribute('name').catch(()=>'')??''))await box.check().catch(()=>{});
  const choose=handle?page.getByRole('button',{name:new RegExp(`Continue as .*${handle}`)}):null;
  const actions=[...choose?[choose]:[],page.locator('[data-consent-action="return"]'),page.locator('[data-consent-action="allow"]'),page.locator('button:has-text("Allow selected access")'),page.locator('button:has-text("Save and continue")'),page.locator('button:has-text("Continue as")')];
  let acted=false;
  for(const control of actions){const c=control.first();if(await c.count()&&await c.isVisible().catch(()=>false)&&await c.getAttribute('aria-disabled').catch(()=>null)!=='true'&&!await c.isDisabled().catch(()=>true)){
   if(shot&&!captured&&/allow/i.test(String(c))){captured=true;await moment(ctx,actor,page,shot,shots);}
   await armedClick(page,c).catch(()=>{});await page.waitForTimeout(500).catch(()=>{});acted=true;break;}}
  if(!acted)await page.waitForTimeout(500).catch(()=>{});
 }
 // Diagnostics while developing a step: SIM_DUMP_DIR keeps the provider page's HTML for inspection.
 if(process.env.SIM_DUMP_DIR&&!page.isClosed())await writeFile(`${process.env.SIM_DUMP_DIR}/simp1-board-${dump}.html`,await page.content()).catch(()=>{});
 throw new Error(`The provider flow did not finish (at ${page.isClosed()?'closed':new URL(page.url()).pathname}).`);
}

export async function openBoard(ctx,actor,{key='board',shots=false}={}){
 const page=actor.pages[key]??=await actor.browser.page();
 await page.goto(boardOrigin(ctx)+'/');await page.waitForFunction(()=>document.querySelector('bindle-gate')?.getAttribute('state')==='signed-out');
 const card=page.locator('bindle-gate').getByRole('heading',{name:'Sign in to Board'});await card.waitFor();
 if(await page.locator('bindle-gate .board').isVisible())throw new Error('Board shows its content before sign-in.');
 await moment(ctx,actor,page,'board-gate',shots);
 return page;
}

/** Sign-in through the gate's own <bindle-sign-in>: the person's handle, a full-page redirect to their provider (the
 * providers declare redirect presentation for client-metadata apps), consent, and back to Board's callback. */
export async function signInToBoard(ctx,actor,provider,{key='board',shots=false,account=provider.name}={}){
 const page=actor.pages[key],signIn=page.locator('bindle-gate bindle-sign-in'),input=signIn.getByLabel(/^(Your handle|Your Bindle identity)$/);
 await input.waitFor();await input.fill(actor.accounts[account].address);
 await moment(ctx,actor,page,'board-gate-handle',shots);
 await signIn.getByRole('button',{name:'Continue',exact:true}).click();
 await page.waitForURL(url=>url.origin===provider.origin,{timeout:20000});
 await providerFlow(ctx,actor,page,{shots,shot:shots?'board-consent':null,handle:actor.accounts[account].handle});
 await page.waitForURL(url=>url.origin===boardOrigin(ctx),{timeout:30000});
 await page.waitForFunction(()=>{const s=window.__board?.engine.read();return !!s?.account&&!!s.board;},null,{timeout:30000});
 ctx.ledger.record(actor.name,'connection','board:'+key,{provider:provider.name});
}

export async function addCards(ctx,actor,cards,{shots=false}={}){
 const page=actor.pages.board;


 for(const {column,title} of cards){
  const input=page.locator(`.column-${column} .add-input`);await input.fill(title);await input.press('Enter');
  await page.locator(`.column-${column} .card`,{hasText:title}).waitFor();
  ctx.ledger.record(actor.name,'card',title,{column});
 }
 await page.waitForFunction(()=>document.querySelector('.live-chip')?.dataset.live==='live',null,{timeout:15000}).catch(()=>{});
 await moment(ctx,actor,page,'board-populated',shots);
 // Invariant: the stored board holds exactly the ledger's cards, each in its column.
 const stored=await page.evaluate(()=>window.__board.storedBoard());
 const have=stored.columns.flatMap(c=>c.cards.map(card=>`${c.id}:${card.title}`)).sort(),want=ctx.ledger.expected(actor.name,'card').map(e=>`${e.value.column}:${e.key}`).sort();
 if(JSON.stringify(have)!==JSON.stringify(want))throw new Error(`Stored board ${JSON.stringify(have)} differs from the ledger ${JSON.stringify(want)}.`);
}

/** A second open board (another tab, its own app session) follows a move made in the first through the bus. */
export async function liveSecondTab(ctx,actor,provider,{card,to,shots=false}={}){
 const first=actor.pages.board;
 await openBoard(ctx,actor,{key:'board2'});await signInToBoard(ctx,actor,provider,{key:'board2'});
 const second=actor.pages.board2;
 for(const page of [first,second])await page.waitForFunction(()=>document.querySelector('.live-chip')?.dataset.live==='live',null,{timeout:20000});
 const before=await state(second);if(!before.board.columns.some(c=>c.cards.some(x=>x.title===card)))throw new Error('The second tab does not show the board.');
 await first.bringToFront();
 const label=to==='doing'?'In progress':to==='done'?'Done':'To do';
 await first.locator('.card',{hasText:card}).getByRole('button',{name:`Move to ${label}`}).click();
 await first.locator(`.column-${to} .card`,{hasText:card}).waitFor();
 await second.locator(`.column-${to} .card.flash`,{hasText:card}).waitFor({timeout:30000});
 await second.bringToFront();
 await moment(ctx,actor,second,'board-live-update',shots);
 ctx.ledger.record(actor.name,'move',card,{to});
 // Event-bus invariant (G4): each read resumed from the cursor the previous read returned, with no gap.
 for(const page of [first,second]){const log=await page.evaluate(()=>window.__board.liveLog);
  for(let i=1;i<log.length;i++){if(log[i].previous!==log[i-1].cursor)throw new Error('A bus read did not resume from the previous cursor.');if(log[i].gap)throw new Error('A bus read reported a gap.');}
  if(!log.some(entry=>entry.records>0))throw new Error('No bus record reached an open board.');}
 ctx.ledger.record(actor.name,'bus-delivery',card,{tabs:2});
 await second.close();delete actor.pages.board2;
}

/** "Assign to me": the card names the person, and the app message reaches their provider's Messages. */
export async function assignToMe(ctx,actor,provider,{card,shots=false}={}){
 const page=actor.pages.board;
 await page.bringToFront();
 await page.locator('.card',{hasText:card}).getByRole('button',{name:'Assign to me'}).click();
 await page.locator('.card',{hasText:card}).locator('.assignee').waitFor();
 const toast=page.locator('.toast');await toast.waitFor();if(!(await toast.textContent()).includes(`Assigned to you: ${card}`))throw new Error(`Assignment toast: ${await toast.textContent()} (${(await state(page)).error})`);
 await page.locator('.card',{hasText:card}).locator('.assignee').waitFor();
 await moment(ctx,actor,page,'board-assigned',shots);
 ctx.ledger.record(actor.name,'app-message','assigned',{card});
 const inbox=await actor.browser.page();
 await inbox.goto(provider.origin+'/console');await inbox.locator('.app-shell').waitFor();
 await inbox.getByRole('button',{name:'Messages',exact:true}).click();
 await inbox.locator('.message-row').filter({hasText:`Assigned to you: ${card}`}).first().waitFor();
 await moment(ctx,actor,inbox,'provider-messages-assigned',shots);
 await inbox.close();
}

// ---- organizations -------------------------------------------------------------------------------------------------
const orgsList=body=>body?.organizations??body?.orgs??(Array.isArray(body)?body:[]);
async function orgConsole(actor,provider,org=null){
 const page=await actor.browser.page();
 await page.goto(provider.origin+'/console?view=organizations'+(org?'&org='+org.id:''));await page.locator('.app-shell').waitFor();
 await page.locator('.org-console').waitFor();return page;
}
/** Creates an organization through the console (the operator listed the creator for the paid check first), including
 * the organization's own recovery file. Returns {id, handle, name, identity, address, provider}. */
export async function createOrg(ctx,actor,provider,{name,shots=false}={}){
 ctx.world.services.board.allowCreator(actor.accounts[provider.name].id);
 const page=await orgConsole(actor,provider);
 const nameField=page.getByLabel('Organization name');await nameField.waitFor();
 await moment(ctx,actor,page,'org-create',shots);
 await nameField.fill(name);
 await page.getByRole('button',{name:'Create organization'}).click();
 const recovery=page.locator('section,article,div.panel').filter({has:page.getByRole('heading',{name:'Save the organization recovery file'})}).last();await recovery.waitFor({timeout:20000});
 const passphrase=(await recovery.locator('code.org-secret').textContent()).trim();
 const download=page.waitForEvent('download');await recovery.getByRole('button',{name:'Download encrypted file'}).click();await (await download).path();
 await recovery.getByLabel('Re-enter the passphrase to check your copy').fill(passphrase);await recovery.getByRole('button',{name:'Check'}).click();
 await recovery.getByLabel('I saved the file and passphrase securely').check();await recovery.getByRole('button',{name:'Finish'}).click();
 await recovery.waitFor({state:'detached',timeout:15000});
 const api=await ownerApi(actor,provider),list=await api.get('/api/orgs'),org=orgsList(list.body).map(o=>o.organization??o).find(o=>o.name===name);
 if(!org?.id||!org.handle)throw new Error('The new organization is not listed: '+JSON.stringify(list.body).slice(0,400));
 ctx.ledger.record(actor.name,'organization',name,{provider:provider.name});
 await page.close();
 return {id:org.id,handle:org.handle,name,provider:provider.name,identity:`${provider.origin}/identity/${org.id}`,address:`${org.handle}@${provider.host}`};
}
/** An invitation bound to one account, made in the console: find the account (handle or identity link), create the link. */
export async function inviteMember(ctx,admin,provider,org,{invitee,label,shots=false,rosterShot=false}={}){
 const page=await orgConsole(admin,provider,org);
 const field=page.locator('input[name="invitee"]');await field.waitFor({timeout:15000});
 await field.fill(invitee);await page.getByRole('button',{name:'Find account'}).click();
 await page.getByText('Invitation for').first().waitFor({timeout:15000});
 await page.getByRole('button',{name:'Create invitation link'}).click();
 const share=page.locator('article',{has:page.locator('#org-invitation')});await share.waitFor({timeout:15000});
 const url=await share.locator('input[readonly]').inputValue();if(!/^https:\/\/.+\/invitation\?/.test(url)&&!url)throw new Error('No invitation link was shown.');
 await moment(ctx,admin,page,'org-invitation',shots);
 await share.getByRole('button',{name:'Done'}).click().catch(()=>{});
 if(rosterShot){await page.locator('#org-members').scrollIntoViewIfNeeded().catch(()=>{});await moment(ctx,admin,page,'org-roster',true);}
 ctx.ledger.record(admin.name,'invitation',label,{org:org.name});
 await page.close();return url;
}
/** The invited person opens the link at the organization's provider and joins (same provider). */
export async function acceptInvitation(ctx,person,url,{org,shots=false}={}){
 const page=await person.browser.page();
 await page.goto(url);await page.locator('.app-shell').waitFor();
 const join=page.getByRole('button',{name:'Join organization'});await join.waitFor({timeout:15000});
 await moment(ctx,person,page,'org-accept',shots);
 await page.getByLabel('I want to join this organization').check();await join.click();
 await page.getByRole('heading',{name:'Your membership'}).waitFor({timeout:15000});
 await moment(ctx,person,page,'org-joined',shots);
 ctx.ledger.record(person.name,'membership',org.name,{via:'invitation'});
 await page.close();
}
/** A person homed on another provider pastes the invitation into their own provider's console ("Have an invitation?").
 * Expected-pending today: the accept route resolves the organization on the person's own host only. */
export async function acceptForeignInvitation(ctx,person,provider,url,{shots=false}={}){
 const page=await orgConsole(person,provider);
 const panel=page.locator('section,article,div.panel').filter({has:page.getByRole('heading',{name:'Have an invitation?'})}).last();await panel.waitFor({timeout:15000});
 await panel.locator('input[name="invitation"]').fill(url);await panel.getByLabel('I want to join this organization').check();
 await panel.getByRole('button',{name:'Join organization'}).click();
 const outcome=await Promise.race([page.getByRole('heading',{name:'Your membership'}).waitFor({timeout:12000}).then(()=>'joined'),page.locator('[role=alert], .org-check-error, .alert').filter({hasText:/./}).first().waitFor({timeout:12000}).then(()=>'refused')]).catch(()=>'nothing');
 await moment(ctx,person,page,'org-accept-foreign',shots);
 const text=outcome==='refused'?(await page.locator('[role=alert], .org-check-error, .alert').filter({hasText:/./}).first().textContent()).trim().slice(0,200):'';
 await page.close();
 if(outcome!=='joined')throw new Error(`A member on ${provider.host} could not join an organization on another provider (${outcome}${text?': '+text:''}).`);
}
/** The organization invites a member of the clean-room issuer by principal (owner API: the console resolves only
 * identity links of the form https://host/identity/<uuid>, and second.example's identities live at /people/<sub>). */
export async function inviteSecondMember(ctx,admin,provider,org,sub){
 const api=await ownerApi(admin,provider),made=await api.post(`/api/orgs/${org.id}/invitations`,{invitee:{iss:'https://second.example',sub}});
 if(made.status!==200||!made.body?.url)throw new Error('Inviting the second.example member failed: '+JSON.stringify(made).slice(0,300));
 ctx.ledger.record(admin.name,'invitation','second.example member',{org:org.name});return made.body;
}
/** The second.example member's app presents a member certificate minted by second.example at the organization's token
 * endpoint (RFC 7523 jwt-bearer, DPoP). Expected-pending: the member never joined (no foreign acceptance route) and the
 * organization has no connection to Board (no organization authorization flow). */
export async function secondMemberToken(ctx,provider,org,sub){
 const issuer=ctx.world.services.second.issuer,holder=await createKey();
 await issuer.person(sub);
 const certificate=await issuer.certify({sub,aud:org.identity,client:{client_id:'https://board.example/bindle/client.json',origin:'https://board.example'},holder});
 const endpoint=provider.origin+'/oauth/token',body=new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:certificate,client_id:'https://board.example/bindle/client.json'}).toString();
 let nonce,answer;
 for(let i=0;i<2;i++){const response=await ctx.world.network.fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:'https://board.example',DPoP:await createProof(holder,{htu:endpoint,htm:'POST',nonce})},body});answer={status:response.status,body:await response.json().catch(()=>null),nonce:response.headers.get('dpop-nonce')};if(answer.body?.error==='use_dpop_nonce'&&answer.nonce&&!nonce){nonce=answer.nonce;continue;}break;}
 if(!answer.body?.access_token)throw new Error(`The organization refused the second.example member's certificate: ${answer.status} ${answer.body?.error}.`);
}

/** In Board, a member of the organization names it, and their home provider issues a member certificate in a popup. */
export async function useOrgInBoard(ctx,actor,org,{shots=false}={}){
 const page=actor.pages.board;await page.bringToFront();
 await page.locator('.org-button').click();await page.locator('.org-sheet[open]').waitFor();
 await page.getByLabel('Organization address').fill(org.address);await page.getByRole('button',{name:'Find organization'}).click();
 const use=page.getByRole('button',{name:/^Use .+ in Board$/});await use.waitFor({timeout:15000});
 await moment(ctx,actor,page,'board-org-found',shots);
 const popupEvent=actor.browser.context.waitForEvent('page',{timeout:15000});await use.click();
 const popup=await popupEvent;await popup.waitForLoadState('domcontentloaded');
 await popup.getByRole('heading',{name:'Use your organization in this app'}).waitFor({timeout:20000});
 const confirm=popup.getByLabel('Allow this app to act with my member access');await confirm.waitFor();await confirm.check();
 await moment(ctx,actor,popup,'provider-member-certify',shots);
 await armedClick(popup,popup.getByRole('button',{name:'Issue certificate'}));
 if(!popup.isClosed())await popup.waitForEvent('close',{timeout:20000}).catch(()=>{});
 await page.bringToFront();
 await page.waitForFunction(()=>['pending','member'].includes(window.__board.engine.read().org.phase),null,{timeout:20000});
 const held=await page.evaluate(()=>window.__board.certificate);if(!held?.exp)throw new Error('Board holds no member certificate.');
 ctx.ledger.record(actor.name,'member-certificate',org.name,{issuer:'home provider'});
 await moment(ctx,actor,page,'board-org-sheet-pending',shots);
 await page.locator('.org-sheet').getByRole('button',{name:'Done'}).click();await page.locator('.org-sheet[open]').waitFor({state:'detached'}).catch(()=>{});
 await moment(ctx,actor,page,'board-org-context',shots);
}
/** The certificate becomes a member-context token at the organization's provider. Expected-pending: the organization
 * has no live connection to Board (organizations have no app authorization flow yet), so every exchange is invalid_grant. */
export async function memberToken(ctx,actor){
 const page=actor.pages.board,s=await state(page),held=await page.evaluate(()=>window.__board.certificate);
 if(!held?.token)throw new Error(`No member-context token: Board is in "${s.org.phase}" (${s.org.error}).`);
}

/** The organization chooser (org-context spike OC-4/OC-11, phase L2): the app asks for a context and the home provider
 * lists the person's organizations. Expected-pending: <bindle-session> has no `entity` attribute yet. */
export async function orgChooser(ctx,actor){
 const page=actor.pages.board,observed=await page.evaluate(()=>customElements.get('bindle-session')?.observedAttributes??[]);
 if(!observed.includes('entity'))throw new Error('<bindle-session> offers no organization context choice (no `entity` attribute).');
}
/** An organization admin looks up another organization as a relation counterparty by handle. */
export async function relationCounterparty(ctx,admin,provider,org,other){
 const api=await ownerApi(admin,provider),found=await api.post(`/api/orgs/${org.id}/relations/counterparty`,{handle:other.address});
 if(found.status!==200||found.body?.counterparty?.sub!==other.id)throw new Error(`The counterparty ${other.address} did not resolve: ${found.status} ${found.body?.error??''}.`);
 return found.body.counterparty;
}

/** The bus record's payload reaches the reader as published (the manifest's payload schema allows `card`, `column`,
 * `title`, `rev`). Expected-pending with ARTEFACT_VERSIONS on: versioned result shaping withholds every member of an
 * object whose contract schema names no properties, and event-bus/v1 declares `data: {}`. */
export async function recordPayload(ctx,actor){
 const page=actor.pages.board,log=await page.evaluate(()=>window.__board.liveLog),payloads=log.flatMap(e=>e.payloads??[]);
 if(!payloads.length)throw new Error('No bus record has been read on this board.');
 if(!payloads.some(p=>typeof p?.card==='string'))throw new Error(`Bus records arrive without their payload: ${JSON.stringify(payloads.slice(0,3))}.`);
}
