// ORG-12e break-glass console at the client-engine level: the production OrganizationsIntent (`bg-*` steps), the
// person-level notices Action and the render functions, against fake ports. Loopback only: no server, provider or
// delivery claim follows from these tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Provider} from '../../vendor/ngin/index.js';
import {createClientEngine,fakeBrowser,turn} from '../helpers/client-engine.mjs';
import {OrganizationsIntent,organizationsModel} from '../../apps/web/src/bl/organizations.mjs';
import {BreakGlassNotices,ownerClaims,adminItems,claimDecisions,viewDecisions} from '../../apps/web/src/bl/org-break-glass.mjs';
import {createOrganizationsPort} from '../../apps/web/src/providers/organizations.mjs';
import {ConfirmOwner} from '../../apps/web/src/bl/step-up.mjs';
import organizations from '../../apps/web/src/ui/org-console.mjs';
import {claimInterstitial} from '../../apps/web/src/ui/org-claim-interstitial.mjs';
import {orgError} from '../../apps/web/src/ui/org-messages.mjs';

const org='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',claimId='00000000-0000-4000-8000-0000000000c1',contestId='00000000-0000-4000-8000-0000000000c2';
const session={account:{id:'person'},sessionContext:'ctx'},initial={session,config:{organizationsEnabled:true,origin:'https://provider.example'},locale:'en'};
const membershipView=powers=>({organization:{id:org,name:'Example',label:'team',state:'active'},membership:{id:'member',grants:[]},powers});
const baseClaim={id:claimId,state:'gathering',createdAt:Date.UTC(2026,9,1),earliestEffectAt:null,closedReason:null};
const adminClaim=(decisions=[],extra={})=>({...baseClaim,frozen:false,initiator:{iss:'https://provider.example',sub:'admin-b',handle:'bea'},candidate:{iss:'https://provider.example',sub:'admin-b',handle:'bea'},candidacyAccepted:true,cosigners:[],objections:0,category:'owner-unreachable',statement:'Gone <b>for months</b>',paid:false,waitEndsAt:null,finalEndsAt:null,decisions,...extra});
const disclosure=[{plan:'org-team',price:{currency:'usd',amount:120000,exponent:2},digest:'a'.repeat(64),terms:{contestDays:90}}];
// Text and actions of a dodo tree (render-only checks without a DOM).
const text=n=>typeof n==='string'||typeof n==='number'?String(n):Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'&&Array.isArray(n.args)?n.args.map(text).join(''):'';
const actions=n=>Array.isArray(n)?n.flatMap(actions):n&&typeof n==='object'&&Array.isArray(n.args)?[...(n.$?.dataset?.orgAction?[n.$.dataset.orgAction]:[]),...n.args.flatMap(actions)]:[];
const tags=n=>Array.isArray(n)?n.flatMap(tags):n&&typeof n==='object'&&Array.isArray(n.args)?[n.tag,...n.args.flatMap(tags)]:[];

async function client(t,{powers=['admin'],view={claim:null,decisions:['start'],contest:null},items=[],routes={},calls:override,state={}}={}){
 const calls=[],focus=[],browser=fakeBrowser({focus:selector=>focus.push(selector),navigate:url=>browser.navigations.push(url)});browser.navigations=[];
 const reply=(a,v)=>a==='list'?{organizations:[{id:org,name:'Example'}]}:a==='membership'?membershipView(powers):a==='get'?{id:org,name:'Example',revision:1,state:'active'}:a==='requests'?{requests:[]}:a==='members'?{members:[],requests:[]}:a==='connections'?{connections:[]}:a==='preferences'?{preferences:[]}:a==='ownership'?{billing:{standing:'paid'},decisions:[],recovery:null}:a==='break-glass-view'?structuredClone(view):a==='break-glass-items'?{items:structuredClone(items)}:a==='invitee'?{invitee:{iss:'https://provider.example',sub:'00000000-0000-4000-8000-0000000000e1',handle:v.handle}}:a==='break-glass-checkout'?{checkout:{url:'https://sandbox.polar.sh/checkout/bg',server:'sandbox'}}:{};
 const port={id:()=> 'request',passphrase:()=> 'f'.repeat(64),call:async(a,v,o)=>{calls.push({a,v,org:o.org});return override?override(a,v,o,reply):reply(a,v);}};
 const c=await createClientEngine({state:{...initial,...state},browser,routes,providers:{organizationsConsole:Provider.fromSingleton(port),recoveryFile:Provider.fromSingleton({})}});t.after(()=>c.dispose());
 const act=(action,detail={})=>c.dispatch(new OrganizationsIntent({action,...detail}));
 return {...c,calls,focus,act,model:async()=>organizationsModel(await c.snapshot()),render:async()=>organizations(await c.snapshot())};
}

test('ORG-12e wizard: one question per step, focus moves to each step, nothing is sent before the reviewed start',async t=>{const c=await client(t);
 await c.act('select',{org});assert.deepEqual(viewDecisions((await c.model()).breakGlass),['start']);
 assert.ok(actions(await c.render()).includes('bg-wizard-open'),'the entry is offered with the start decision');
 await c.act('bg-wizard-open');assert.equal((await c.model()).breakGlassWizard.step,'alternatives');assert.equal(c.focus.at(-1),'#org-bg-step');
 const alternatives=text(await c.render());assert.match(alternatives,/Contact the owner directly/);assert.match(alternatives,/recovery file/);assert.doesNotMatch(alternatives,/billing-lapse claim under/,'the lapse alternative only when it applies');
 await c.act('bg-wizard-next');assert.equal((await c.model()).breakGlassWizard.step,'candidate');
 await c.act('bg-candidate',{values:{who:'self'}});let w=(await c.model()).breakGlassWizard;assert.equal(w.step,'category');assert.deepEqual(w.candidate,{sub:'person',handle:null,self:true});
 await c.act('bg-category',{values:{category:'boredom'}});assert.equal((await c.model()).error,'review_required');
 await c.act('bg-category',{values:{category:'owner-deceased'}});assert.equal((await c.model()).breakGlassWizard.step,'statement');
 await c.act('bg-statement',{values:{statement:'x'.repeat(2001)}});assert.equal((await c.model()).error,'invalid_statement');
 await c.act('bg-statement',{values:{statement:'  The owner died in May.  '}});w=(await c.model()).breakGlassWizard;assert.equal(w.step,'review');assert.equal(w.statement,'The owner died in May.');
 const review=text(await c.render());for(const term of [/at least 30 days/,/stop the claim at any time/,/contest it for 90 days/,/refunded in full/,/co-sign within 7 days/])assert.match(review,term);
 await c.act('bg-wizard-back');assert.equal((await c.model()).breakGlassWizard.step,'statement');await c.act('bg-statement',{values:{statement:'The owner died in May.'}});
 assert.equal(c.calls.filter(x=>x.a==='break-glass').length,0);
 await c.act('bg-start',{values:{}});assert.equal(c.calls.filter(x=>x.a==='break-glass').length,0,'start needs the confirmation');
 await c.act('bg-start',{values:{confirm:true}});
 assert.deepEqual(c.calls.find(x=>x.a==='break-glass'),{a:'break-glass',v:{operation:'start',candidate:{sub:'person'},category:'owner-deceased',statement:'The owner died in May.',confirm:true},org});
 assert.equal((await c.model()).breakGlassWizard,null);
});

test('ORG-12e wizard: another admin by handle through the admin-only lookup; no start decision, no wizard',async t=>{
 const c=await client(t);await c.act('select',{org});await c.act('bg-wizard-open');await c.act('bg-wizard-next');
 await c.act('bg-candidate',{values:{handle:'bad handle!'}});assert.equal((await c.model()).error,'invitee_unrecognized');
 await c.act('bg-candidate',{values:{handle:'@carol'}});assert.deepEqual(c.calls.find(x=>x.a==='invitee').v,{handle:'carol'});const w=(await c.model()).breakGlassWizard;assert.equal(w.candidate.handle,'carol');assert.equal(w.candidate.iss,'https://provider.example');
 const d=await client(t,{view:{claim:null,decisions:[],contest:null}});await d.act('select',{org});await d.act('bg-wizard-open');assert.equal((await d.model()).breakGlassWizard,null);assert.equal((await d.model()).error,'review_required');
 assert.equal((await d.render())===null,false);assert.ok(!actions(await d.render()).includes('bg-wizard-open'));
});

test('ORG-12e decisions: only advertised operations are sent; changes other than abort, accept and co-sign need review',async t=>{
 const c=await client(t,{view:{claim:adminClaim(['object']),decisions:[],contest:null}});await c.act('select',{org});
 await c.act('bg-cosign');assert.equal(c.calls.filter(x=>x.a==='break-glass').length,0,'co-sign was not advertised');
 await c.act('bg-object',{values:{reason:'Not true'}});assert.equal(c.calls.filter(x=>x.a==='break-glass').length,0,'objection needs review');
 await c.act('bg-object',{values:{reason:'Not true',confirm:true}});assert.deepEqual(c.calls.find(x=>x.a==='break-glass').v,{operation:'object',claim:claimId,reason:'Not true'});
 const d=await client(t,{view:{claim:adminClaim(['cosign','withdraw']),decisions:[],contest:null}});await d.act('select',{org});
 const rendered=actions(await d.render());assert.ok(rendered.includes('bg-cosign')&&rendered.includes('bg-withdraw'));assert.ok(!rendered.includes('bg-abort')&&!rendered.includes('bg-object'));
 await d.act('bg-cosign');assert.deepEqual(d.calls.find(x=>x.a==='break-glass').v,{operation:'cosign',claim:claimId});
 await d.act('bg-withdraw',{values:{}});assert.equal(d.calls.filter(x=>x.v?.operation==='withdraw').length,0);await d.act('bg-withdraw',{values:{confirm:true}});assert.equal(d.calls.filter(x=>x.v?.operation==='withdraw').length,1);
});

test('ORG-12e timeline: names by handle, statement as text, no owner channels or track for admins; held-for-support wording',async t=>{
 const c=await client(t,{view:{claim:adminClaim([],{state:'held-for-support',cosigners:[{principal:{sub:'admin-c',handle:'cy'},at:1}],paid:true}),decisions:[],contest:null}});await c.act('select',{org});
 const tree=await c.render(),all=text(tree);assert.match(all,/@bea/);assert.match(all,/@cy/);assert.match(all,/Held for support review/);assert.match(all,/cannot take effect by itself/);assert.match(all,/Gone <b>for months<\/b>/,'the statement is plain text');
 assert.ok(!tags(tree).includes('b'),'no injected markup');assert.doesNotMatch(all,/Notices about this claim go to your/,'no channel details for admins');
 const o=await client(t,{view:{claim:{...adminClaim(['abort']),track:'S',channels:[{kind:'email',enrolledAt:1,excluded:false},{kind:'email',enrolledAt:2,excluded:false},{kind:'push',enrolledAt:3,excluded:false}]},decisions:[],contest:null},powers:['admin','owner-of-record']});await o.act('select',{org});
 assert.match(text(await o.render()),/Notices about this claim go to your 2 email address, 1 notification device/);
});

test('ORG-12e members: a banner with the start and earliest effect dates; members get no claim actions',async t=>{
 const c=await client(t,{powers:[],view:{claim:{...baseClaim,state:'waiting',earliestEffectAt:Date.UTC(2026,10,10)},decisions:[],contest:null}});await c.act('select',{org});
 const tree=await c.render(),all=text(tree);assert.match(all,/An ownership claim is open/);assert.match(all,/cannot take effect before/);assert.match(all,/membership and access do not change/);
 assert.deepEqual(actions(tree).filter(a=>a.startsWith('bg-')),[]);
 const es=await client(t,{powers:[],state:{locale:'es'},view:{claim:{...baseClaim,state:'waiting'},decisions:[],contest:null}});await es.act('select',{org});assert.match(text(await es.render()),/Hay una reclamación de propiedad abierta/);
});

test('ORG-12e a refused or missing break-glass view leaves the console unchanged',async t=>{
 const c=await client(t,{calls:(a,v,o,reply)=>{if(a==='break-glass-view')throw Object.assign(Error('Not found.'),{status:404,code:'not_found'});return reply(a,v);}});await c.act('select',{org});const m=await c.model();assert.equal(m.breakGlass,null);assert.equal(m.error,null);assert.equal(m.organization.name,'Example');
});

test('ORG-12e checkout: disclosure, confirmation and paid-age attestation; navigation only to the Polar sandbox',async t=>{
 const c=await client(t,{view:{claim:adminClaim(['pay','withdraw'],{disclosure}),decisions:[],contest:null}});await c.act('select',{org});
 const all=text(await c.render());for(const term of [/30 to 127 days/,/at least 30 days to answer/,/stop the claim at any time/,/contest it for 90 days/,/refunded in full/,/processing fee is kept/,/\$1,200\.00/])assert.match(all,term);
 await c.act('bg-checkout',{values:{confirm:true}});assert.equal(c.calls.filter(x=>x.a==='break-glass-checkout').length,0,'paid-age attestation required');
 await c.act('bg-checkout',{values:{confirm:true,ageConfirmed:true}});assert.deepEqual(c.calls.find(x=>x.a==='break-glass-checkout'),{a:'break-glass-checkout',v:{claim:claimId,disclosure:'a'.repeat(64),confirm:true,ageConfirmed:18},org});
 assert.deepEqual(c.browser.navigations,['https://sandbox.polar.sh/checkout/bg']);
 const evil=await client(t,{view:{claim:adminClaim(['pay'],{disclosure}),decisions:[],contest:null},calls:(a,v,o,reply)=>a==='break-glass-checkout'?{checkout:{url:'https://evil.example/pay'}}:reply(a,v)});await evil.act('select',{org});await evil.act('bg-checkout',{values:{confirm:true,ageConfirmed:true}});
 assert.deepEqual(evil.browser.navigations,[]);assert.equal((await evil.model()).error,'billing_unavailable');
});

test('ORG-12e owner stop: owner_proof_required asks for a step-up once, then retries; a second refusal keeps the session',async t=>{
 for(const refuseAgain of [false,true]){let attempts=0;
  const c=await client(t,{view:{claim:adminClaim(['abort']),decisions:[],contest:null},powers:['admin','owner-of-record'],calls:(a,v,o,reply)=>a==='break-glass'?o.api.request('/api/orgs/'+org+'/break-glass',v):reply(a,v)});
  c.api.routes['POST /api/orgs/'+org+'/break-glass']=()=>{if(++attempts===1||refuseAgain)throw Object.assign(Error('Owner proof required'),{code:'owner_proof_required',status:401});return {claim:{state:'aborted'}};};
  c.api.routes['POST /api/auth/step-up/begin']=()=>({password:true});c.api.routes['POST /api/auth/step-up']=()=>({ok:true});
  await c.act('select',{org});const pending=c.act('bg-abort');while(!(await c.snapshot()).stepUp)await turn();
  const prompt=(await c.snapshot()).stepUp;await c.dispatch(new ConfirmOwner({id:prompt.id,method:'password',values:{password:'test-only'}}));await pending;
  const s=await c.snapshot();assert.deepEqual(s.session,session,'never signed out');assert.equal(attempts,2);assert.equal(c.api.calls.filter(x=>x.path==='/api/auth/step-up/begin').length,1);
  if(refuseAgain)assert.equal(organizationsModel(s).error,'owner_proof_required');else assert.equal(organizationsModel(s).notice,'break_glass_aborted');
 }
 assert.match(orgError('es','owner_proof_required'),/llave de acceso/);
});

test('ORG-12e interstitial: an open owner claim takes the screen; stop, set aside, and absent otherwise',async t=>{
 const ownerItem={org,name:'Acme <img src=x onerror=alert(1)>',handle:'acme',role:'owner',claim:{...baseClaim,state:'held-for-support',decisions:['abort']},decisions:[],contest:null};
 const c=await client(t,{items:[ownerItem,{org:other,name:'Club',role:'admin',claim:{...baseClaim,id:'00000000-0000-4000-8000-0000000000c3',decisions:['cosign','object']},decisions:[]}]});
 assert.equal(claimInterstitial(await c.snapshot()),null,'nothing before the notices load');
 await c.dispatch(new BreakGlassNotices());let s=await c.snapshot();assert.equal(ownerClaims(s).length,1);assert.equal(adminItems(organizationsModel(s)).length,1);
 assert.deepEqual(c.calls.map(x=>[x.a,x.org]),[['break-glass-items',undefined]],'one person-level read');
 const gate=claimInterstitial(s);assert.ok(gate);const all=text(gate);assert.match(all,/Someone is claiming ownership of Acme <img src=x onerror=alert\(1\)>/);assert.ok(!tags(gate).includes('img'));
 assert.deepEqual(actions(gate),['bg-gate-abort','bg-gate-dismiss']);assert.match(JSON.stringify(gate),/mailto:contact@3sln\.com/);
 await c.act('bg-dismiss',{claim:claimId});assert.equal(claimInterstitial(await c.snapshot()),null,'set aside for this session');
 // The personal view still lists it, with the co-signature item.
 const view=text(await c.render());assert.match(view,/Ownership claims waiting for you/);assert.match(view,/Ownership claim in Club/);
 await c.act('bg-abort',{org,claim:claimId});assert.deepEqual(c.calls.find(x=>x.a==='break-glass'),{a:'break-glass',v:{operation:'abort',claim:claimId},org});
 await c.act('bg-cosign',{org:other,claim:'00000000-0000-4000-8000-0000000000c3'});assert.deepEqual(c.calls.filter(x=>x.a==='break-glass')[1],{a:'break-glass',v:{operation:'cosign',claim:'00000000-0000-4000-8000-0000000000c3'},org:other});
 await c.act('bg-abort',{org:other,claim:'00000000-0000-4000-8000-0000000000c3'});assert.equal(c.calls.filter(x=>x.a==='break-glass').length,2,'abort was not advertised there');
 const es=await client(t,{items:[ownerItem],state:{locale:'es'}});await es.dispatch(new BreakGlassNotices());assert.match(text(claimInterstitial(await es.snapshot())),/Alguien reclama la propiedad de/);
 const off=await client(t,{items:[ownerItem],state:{config:{}}});await off.dispatch(new BreakGlassNotices());assert.equal(off.calls.length,0,'never probed with organizations off');
 const failing=await client(t,{calls:()=>{throw Object.assign(Error('down'),{status:503});}});await failing.dispatch(new BreakGlassNotices());assert.equal((await failing.snapshot()).error||'', '','a failed probe is silent');
});

test('ORG-12e former owner: contest entry from the notices, reviewed, sent to the organization',async t=>{
 const c=await client(t,{items:[{org,name:'Acme',role:'former-owner',claim:null,decisions:['contest'],contest:{claim:contestId,until:Date.UTC(2026,11,30),state:'window'}}]});
 await c.dispatch(new BreakGlassNotices());assert.ok(actions(await c.render()).includes('bg-contest'));assert.match(text(await c.render()),/Contest the ownership change/);
 await c.act('bg-contest',{org,claim:contestId,values:{}});assert.equal(c.calls.filter(x=>x.a==='break-glass').length,0);
 await c.act('bg-contest',{org,claim:contestId,values:{confirm:true,reason:'I was in hospital'}});assert.deepEqual(c.calls.find(x=>x.a==='break-glass'),{a:'break-glass',v:{operation:'contest',claim:contestId,reason:'I was in hospital'},org});
 assert.equal((await c.model()).notice,'break_glass_contested');
});

test('ORG-12e recovery-file banner: owner is pointed to the reissue, admins see only that no file exists',async t=>{
 const ownership=(decisions)=>({billing:{standing:'paid'},decisions,recovery:{state:'missing',since:1}});
 const o=await client(t,{powers:['admin','owner-of-record'],calls:(a,v,_o,reply)=>a==='ownership'?ownership(['reissue-recovery']):reply(a,v)});await o.act('select',{org});assert.match(text(await o.render()),/No current recovery file\. Get a new organization recovery file/);
 const a=await client(t,{calls:(x,v,_o,reply)=>x==='ownership'?ownership([]):reply(x,v)});await a.act('select',{org});assert.match(text(await a.render()),/No current recovery file\. Only the owner of record can issue one/);
});

test('ORG-12e HTTP port: break-glass reads and writes map to the agreed routes',async()=>{const calls=[],api={get:async p=>calls.push(['GET',p]),request:async(p,b,m='POST')=>calls.push([m,p,b])},port=createOrganizationsPort();
 await port.call('break-glass-items',undefined,{api});await port.call('break-glass-view',undefined,{api,org});await port.call('break-glass',{operation:'abort'},{api,org});await port.call('break-glass-checkout',{claim:'c'},{api,org});
 assert.deepEqual(calls,[['GET','/api/orgs/break-glass'],['GET','/api/orgs/'+org+'/break-glass'],['POST','/api/orgs/'+org+'/break-glass',{operation:'abort'}],['POST','/api/orgs/'+org+'/break-glass-checkout',{claim:'c'}]]);
 await assert.rejects(()=>port.call('break-glass-items',undefined,{api,org}),{code:'invalid_request'});
 assert.deepEqual(claimDecisions({decisions:['abort','invented']}),['abort']);
});
