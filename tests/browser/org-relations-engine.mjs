// ORG-10g Relationships tab at the client-engine level: the production OrganizationsIntent (`rel-*` steps), the
// relations BL and the render functions, against a fake API that follows the ORG-10f console contract. Loopback only:
// no server, provider, delivery or production claim follows from these tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Provider} from '../../vendor/ngin/index.js';
import {createClientEngine,fakeBrowser,turn} from '../helpers/client-engine.mjs';
import {OrganizationsIntent,organizationsModel} from '../../apps/web/src/bl/organizations.mjs';
import {relationLanding,relationValues,keptEntries,principalKey,RELATION_STEPS} from '../../apps/web/src/bl/org-relations.mjs';
import {ConfirmOwner} from '../../apps/web/src/bl/step-up.mjs';
import organizations from '../../apps/web/src/ui/org-console.mjs';
import {orgRelationError,orgRelationNotice,ORG_RELATION_ERRORS,ORG_RELATION_NOTICES,ORG_FALLBACK} from '../../apps/web/src/ui/org-messages.mjs';

const ORIGIN='https://provider.example',org='00000000-0000-4000-8000-000000000001',STORAGE='https://3sln.me/artefacts/contracts/object-storage/v1';
const session={account:{id:'person'},sessionContext:'ctx'},initial={session,config:{organizationsEnabled:true,origin:ORIGIN},locale:'en'};
const REL='/api/orgs/'+org+'/relations',META='eyJhbGciOiJFUzI1NiJ9.eyJqdGkiOiJ4In0.c2ln',OTHER_META='eyJhbGciOiJFUzI1NiJ9.eyJqdGkiOiJ5In0.c2ln';
const pin={artefact:'https://3sln.me/artefacts/relations/share',version:1,digest:'d'.repeat(64)},supplyPin={artefact:'https://3sln.me/artefacts/relations/supply',version:1,digest:'c'.repeat(64)};
const P=sub=>({iss:ORIGIN,sub}),acme=P('00000000-0000-4000-8000-0000000000a1'),beta=P('00000000-0000-4000-8000-0000000000b1'),zed=P('00000000-0000-4000-8000-0000000000c1'),newco=P('00000000-0000-4000-8000-0000000000d1');
const resA=ORIGIN+'/entities/'+org+'/resources/a',resB=ORIGIN+'/entities/'+org+'/resources/b',instance=ORIGIN+'/entities/'+org+'/relations/i1';
const fragment={fragment:'https://3sln.me/artefacts/fragments/files',version:1,digest:'f'.repeat(64)};
const catalogue={relations:[{key:'share',title:'Share',description:'Share files with one organization.',publisher:'https://3sln.me',publisherVerified:false,listedBy:'3sln.me',pin,slots:[{name:'owner',title:'Owner',min:1,max:1},{name:'recipient',title:'Recipient',min:1,max:1}]}]};
const matrix={relation:pin.artefact,title:'Share',publisher:'https://3sln.me',publisherVerified:false,slot:'owner',slotTitle:'Owner',arity:{min:1,max:1},
 gives:[{to:'recipient',index:0,fragment,methods:{files:{[STORAGE]:['capabilities','get']}},required:true,actor_disclosure:'pairwise'},{to:'nobody',index:5,fragment,methods:{files:{[STORAGE]:['get']}},required:true,actor_disclosure:'pairwise'}],
 receives:[{from:'recipient',index:1,fragment,methods:{files:{[STORAGE]:['put']}},required:false,actor_disclosure:'named'}]};
const pool={resources:[{id:resA,label:'Ledgers <b>2026</b>',contracts:{[STORAGE]:['capabilities','delete','get','put']},scoping:{fields:{prefix:{maxLength:64},readOnly:{}}}},{id:resB,label:'Photos',contracts:{[STORAGE]:['get']}}]};
const disclosure={invitation:'jti-in',inviter:{identity:ORIGIN+'/identity/'+zed.sub,handle:'zed',origin:ORIGIN},relation:{id:supplyPin.artefact,title:'Supply <i>',publisher:'https://supply.example',publisherVerified:false,pin:supplyPin},slot:'supplier',counterpartySlot:'buyer',
 gives:[{index:2,fragment,methods:{files:{[STORAGE]:['get']}},required:true,actor_disclosure:'pairwise'}],receives:[{index:3,fragment,methods:{files:{[STORAGE]:['put']}},required:false,actor_disclosure:'named'}],
 warnings:['new-counterparty','same-title-different-relation'],caveats:['counterparty-sees-actor-chain','copies-cannot-be-recalled','proxying-undetectable'],expiresAt:Date.UTC(2026,10,20),disclosure:'e'.repeat(64)};
const overview=()=>({enabled:true,billing:'active',closing:false,
 instances:[{instance,relation:pin,title:'Share',slots:['owner'],state:'live',counterparts:[
  {principal:acme,handle:'acme',name:'Acme <img src=x>',slot:'recipient',as:'owner',state:'live',outgoing:{state:'live',generation:2,live:true,entries:[{index:0,resources:[{resource:resA,field:'files',methods:{[STORAGE]:['get']},expires_at:2000000000},{resource:resB,field:'files',methods:{[STORAGE]:['get']}}]}]},incoming:{state:'live',generation:1,live:true},peer:{grant:'live',acceptance:'live'},unreachable:{since:Date.UTC(2026,8,1),flagged:true}},
  {principal:beta,handle:'beta',name:'Beta',slot:'recipient',as:'owner',state:'live',outgoing:{state:'suspended',generation:3,live:false,cause:'moved',entries:[{index:0,resources:[{resource:ORIGIN+'/entities/old/resources/z',field:'files',methods:{[STORAGE]:['get']}}]}]},incoming:{state:null,generation:0,live:false},peer:{grant:'live',acceptance:null},hold:{kind:'full',aep:3,cause:'aep-increase',since:Date.UTC(2026,9,20)}}]}],
 invitations:[{invitation:'jti-open',instance,slot:'recipient',as:'owner',invitee:newco,inviteeHandle:'newco',expiresAt:Date.UTC(2026,10,30),createdAt:Date.UTC(2026,9,23)}],
 inbound:{items:[{kind:'invitation',invitation:'jti-in',meta:META,from:zed,fromHandle:'zed',fromName:'Zed',instance:ORIGIN+'/entities/zed/relations/s',relation:supplyPin,slot:'supplier',receivedAt:Date.UTC(2026,9,22),expiresAt:Date.UTC(2026,10,20)}],
  introductions:[{kind:'introduction',introduction:'intro-1',proposer:acme,proposerHandle:'acme',instance,slot:'recipient',candidate:newco,candidateHandle:'newco',receivedAt:Date.UTC(2026,9,22),expiresAt:Date.UTC(2026,10,21)}]},
 holds:{holds:[{counterpart:beta,kind:'full',aep:3,cause:'aep-increase',since:Date.UTC(2026,9,20)}],unreachable:[{counterpart:acme,since:Date.UTC(2026,8,1),flagged:true}]},
 imports:[{grantor:acme,grantorHandle:'acme',grantorName:'Acme',instance,entry:1,status:'available',held:true,resources:[{id:'imp_1',resource:ORIGIN+'/entities/acme/resources/x',contracts:[STORAGE],methods:{[STORAGE]:['put']},status:'available'}]}]});
const memberImports={imports:[{id:'imp_1',grantor:acme,grantorHandle:'acme',grantorName:'Acme',status:'available',contracts:[STORAGE]}]};
const membershipView=powers=>({organization:{id:org,name:'Example',label:'team',state:'active'},membership:{id:'member',grants:[]},powers});
// Text and actions of a dodo tree (render-only checks without a DOM).
const text=n=>typeof n==='string'||typeof n==='number'?String(n):Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'&&Array.isArray(n.args)?n.args.map(text).join(''):'';
const actions=n=>Array.isArray(n)?n.flatMap(actions):n&&typeof n==='object'&&Array.isArray(n.args)?[...(n.$?.dataset?.orgAction?[n.$.dataset.orgAction]:[]),...n.args.flatMap(actions)]:[];
const tags=n=>Array.isArray(n)?n.flatMap(tags):n&&typeof n==='object'&&Array.isArray(n.args)?[n.tag,...n.args.flatMap(tags)]:[];
const rawCode=/\b[a-z]+(?:_[a-z]+)+\b/;

async function client(t,{powers=['admin'],state={},ops={},routes={},landing=null,relations=overview}={}){
 const portCalls=[],focus=[],copies=[],browser=fakeBrowser({focus:selector=>focus.push(selector)});
 const reply=a=>a==='list'?{organizations:[{id:org,name:'Example'}]}:a==='membership'?membershipView(powers):a==='get'?{id:org,name:'Example',revision:1,state:'active'}:a==='requests'?{requests:[]}:a==='members'?{members:[],requests:[]}:a==='connections'?{connections:[]}:a==='preferences'?{preferences:[]}:a==='ownership'?{billing:{standing:'paid'},decisions:[],recovery:null}:a==='break-glass-view'?{claim:null,decisions:[],contest:null}:a==='audit'?{entries:[{seq:1,action:'organization-renamed'}]}:{};
 const port={id:()=> 'request',passphrase:()=> 'f'.repeat(64),call:async(a,v,o)=>{portCalls.push({a,v,org:o.org});return reply(a);},copy:async text=>{copies.push(text);return true;},...landing?{relationLanding:landing}:{}};
 const defaults={
  ['GET '+REL]:()=>{if(typeof relations==='function')return relations();throw relations;},['GET '+REL+'/imports']:()=>memberImports,['GET '+REL+'/catalogue']:()=>catalogue,['GET '+REL+'/resources']:()=>pool,
  ['POST '+REL+'/counterparty']:({body})=>body.handle==='acme'?{counterparty:{...acme,handle:'acme',name:'Acme <img src=x>',identity:ORIGIN+'/identity/'+acme.sub,origin:ORIGIN,kind:'organization'}}:body.handle==='fresh'?{counterparty:{...P('00000000-0000-4000-8000-0000000000e1'),handle:'fresh',name:'Fresh',identity:ORIGIN+'/identity/x',origin:ORIGIN,kind:'organization'}}:(()=>{throw Object.assign(Error('Not found.'),{status:404,code:'counterparty_unavailable'});})(),
  ['POST '+REL]:call=>{const o=call.body.operation;if(Object.hasOwn(ops,o))return ops[o](call);
   if(o==='preview')return {pin:call.body.relation,matrix,warnings:['new-relation']};if(o==='inbound-preview')return structuredClone(disclosure);
   if(o==='create')return {instance:ORIGIN+'/entities/'+org+'/relations/new',relation:pin,slots:call.body.slots};
   if(o==='invite'||o==='admit')return {invitation:OTHER_META,jti:'jti-new',expiresAt:Date.UTC(2026,10,1),instance,slot:'recipient'};
   return {ok:true};},
  'POST /api/auth/step-up/begin':()=>({password:true}),'POST /api/auth/step-up':()=>({ok:true})};
 const c=await createClientEngine({state:{...initial,...state},browser,routes:{...defaults,...routes},providers:{organizationsConsole:Provider.fromSingleton(port),recoveryFile:Provider.fromSingleton({})}});t.after(()=>c.dispose());
 const act=(action,detail={})=>c.dispatch(new OrganizationsIntent({action,...detail}));
 const opCalls=()=>c.api.calls.filter(x=>x.method==='POST'&&x.path===REL).map(x=>x.body);
 return {...c,act,focus,copies,portCalls,opCalls,model:async()=>organizationsModel(await c.snapshot()),render:async()=>organizations(await c.snapshot())};
}
const open=async c=>{await c.act('select',{org});await c.act('rel-tab',{tab:'relationships'});};
const edge=(c,key=principalKey(acme))=>c.act('rel-edge',{instance,counterpart:key});

test('ORG-10g wizard: one question per step in order; nothing is created or invited before the reviewed last step',async t=>{
 const c=await client(t);await open(c);assert.ok(actions(await c.render()).includes('rel-wizard-open'));
 await c.act('rel-wizard-create',{values:{confirm:true}});assert.equal((await c.model()).relationError,'review_required');
 await c.act('rel-wizard-open');let w=(await c.model()).relationWizard;assert.equal(w.step,'relation');assert.equal(c.focus.at(-1),'#org-rel-step');
 let page=text(await c.render());assert.match(page,/Listed by 3sln\.me\. Publisher not verified: https:\/\/3sln\.me/);assert.doesNotMatch(page,/verified publisher/i);
 const tryEarly=async()=>{await c.act('rel-wizard-create',{values:{confirm:true}});assert.equal((await c.model()).relationError,'review_required');await c.act('rel-wizard-values',{values:{'res:0:0:0':true}});};
 await tryEarly();assert.equal((await c.model()).relationWizard.step,'relation','a later step cannot be skipped to');
 await c.act('rel-wizard-relation',{values:{relation:'invented'}});assert.equal((await c.model()).relationError,'review_required');
 await c.act('rel-wizard-relation',{values:{relation:'share'}});assert.equal((await c.model()).relationWizard.step,'slot');await tryEarly();
 await c.act('rel-wizard-slot',{values:{slot:'owner'}});w=(await c.model()).relationWizard;assert.equal(w.step,'counterparty');assert.equal(w.invite,'recipient');
 assert.deepEqual(c.opCalls().at(-1),{operation:'preview',relation:pin,slot:'owner'});
 assert.deepEqual(w.matrix.gives.map(e=>e.index),[0],'only the entries this organization gives to the invited slot');assert.deepEqual(w.matrix.receives.map(e=>e.index),[1]);
 await tryEarly();assert.equal((await c.model()).relationWizard.step,'counterparty');
 await c.act('rel-wizard-counterparty');assert.equal((await c.model()).relationError,'review_required','an organization must be resolved first');
 await c.act('rel-wizard-find',{values:{handle:'@nobody'}});assert.equal((await c.model()).relationError,'counterparty_unavailable');
 await c.act('rel-wizard-find',{values:{handle:'@fresh'}});page=text(await c.render());assert.match(page,/never dealt with this organization/);assert.match(page,/Identity link/);
 await c.act('rel-wizard-unfind');await c.act('rel-wizard-find',{values:{handle:'@acme'}});w=(await c.model()).relationWizard;assert.equal(w.found.handle,'acme');assert.equal(w.found.seen,true);
 page=text(await c.render());assert.match(page,/Acme <img src=x>/);assert.ok(!tags(await c.render()).includes('img'));assert.match(page,new RegExp(ORIGIN+'/identity/'+acme.sub));
 await c.act('rel-wizard-counterparty');assert.equal((await c.model()).relationWizard.step,'values');
 await c.act('rel-wizard-values',{values:{}});assert.equal((await c.model()).relationError,'relation_values_incomplete','a required entry needs a value');
 await c.act('rel-wizard-values',{values:{'res:0:0:1':false,'res:0:0:0':true,'ro:0:0:0':true,'px:0:0:0':'/ledgers'}});w=(await c.model()).relationWizard;assert.equal(w.step,'review');
 assert.deepEqual(w.values,{0:[{resource:resA,field:'files',scope:{readOnly:true,prefix:'/ledgers'}}]});
 assert.equal(c.opCalls().filter(b=>['create','invite'].includes(b.operation)).length,0,'nothing created before the review');
 page=text(await c.render());for(const term of [/What you give/,/What you would receive/,/see what the storage supports/,/read files/,/add or replace files/,/required/,/optional/,/separate code for each person/,/verified identity/,/can’t be recalled/,/relays requests/,/never used this relation before/,/Ledgers <b>2026<\/b>/,/read only/])assert.match(page,term);
 assert.doesNotMatch(page,rawCode);
 await c.act('rel-wizard-back');assert.equal((await c.model()).relationWizard.step,'values');await c.act('rel-wizard-values',{values:{'res:0:0:0':true}});
 await c.act('rel-wizard-create',{values:{}});assert.equal(c.opCalls().filter(b=>b.operation==='create').length,0,'creating needs the confirmation');
 await c.act('rel-wizard-create',{values:{confirm:true,receive:true,expiresInDays:'14'}});
 const ops=c.opCalls();assert.deepEqual(ops.find(b=>b.operation==='create'),{operation:'create',relation:pin,slots:['owner']});
 const invite=ops.find(b=>b.operation==='invite');assert.deepEqual({...invite,expiresAt:undefined},{operation:'invite',instance:ORIGIN+'/entities/'+org+'/relations/new',as:'owner',slot:'recipient',invitee:acme,values:{0:[{resource:resA,field:'files'}]},receive:true,expiresAt:undefined});
 assert.ok(invite.expiresAt>Date.now()+13*86400000&&invite.expiresAt<=Date.now()+14*86400000);
 const m=await c.model();assert.equal(m.relationWizard,null);assert.equal(m.relationIssued.invitation,OTHER_META);assert.equal(m.relationNotice,'relation_invited');assert.equal(c.focus.at(-1),'#org-rel-issued');
 assert.match(text(await c.render()),/\/relations\/accept/);
 await c.act('rel-copy');assert.deepEqual(c.copies,[OTHER_META]);assert.equal((await c.model()).relationNotice,'relation_copied');
});

test('ORG-10g step-up: reauthentication_required prompts the existing security check once and retries; a refused invite never creates twice',async t=>{
 let invites=0;const c=await client(t,{ops:{invite:()=>{if(++invites===1)throw Object.assign(Error('Fresh authentication required.'),{status:401,code:'reauthentication_required'});if(invites===2)throw Object.assign(Error('Limited'),{status:429,code:'relation_invitation_pending'});return {invitation:OTHER_META,jti:'j2',expiresAt:Date.UTC(2026,10,1),instance,slot:'recipient'};}}});
 await open(c);await c.act('rel-wizard-open');await c.act('rel-wizard-relation',{values:{relation:'share'}});await c.act('rel-wizard-slot',{values:{slot:'owner'}});await c.act('rel-wizard-find',{values:{handle:'acme'}});await c.act('rel-wizard-counterparty');await c.act('rel-wizard-values',{values:{'res:0:0:0':true}});
 const pending=c.act('rel-wizard-create',{values:{confirm:true}});while(!(await c.snapshot()).stepUp)await turn();
 const prompt=(await c.snapshot()).stepUp;await c.dispatch(new ConfirmOwner({id:prompt.id,method:'password',values:{password:'test-only'}}));await pending;
 const s=await c.snapshot();assert.deepEqual(s.session,session,'the session survives');assert.equal(s.stepUp,null);assert.equal(c.api.calls.filter(x=>x.path==='/api/auth/step-up/begin').length,1);
 assert.equal(invites,2);assert.equal(organizationsModel(s).relationError,'relation_invitation_pending');assert.equal((await c.model()).relationWizard.step,'review','a refusal keeps the reviewed wizard');
 await c.act('rel-wizard-create',{values:{confirm:true}});assert.equal(invites,3);assert.equal(c.opCalls().filter(b=>b.operation==='create').length,1,'the created instance is reused');
 assert.equal((await c.model()).relationIssued.jti,'j2');
});

test('ORG-10g acceptance: every §9.4 disclosure from inbound-preview; the digest round-trips into accept with inline values',async t=>{
 const c=await client(t);await open(c);
 await c.act('rel-inbound',{invitation:'nope'});assert.equal((await c.model()).relationError,'not_found');
 await c.act('rel-inbound',{invitation:'jti-in'});assert.deepEqual(c.opCalls().at(-1),{operation:'inbound-preview',invitation:META});assert.equal(c.focus.at(-1),'#org-rel-accept');
 const tree=await c.render(),page=text(tree);
 for(const term of [/@zed/,new RegExp(ORIGIN+'/identity/'+zed.sub),/Verified origin/,/provider\.example/,/Supply <i>/,/Publisher not verified: https:\/\/supply\.example/,/Your role.*supplier/,/never dealt with this organization/,/different relation/,/What you would receive/,/What you would give/,/can’t be recalled/,/chain of who acts/,/relays requests/,/verified identity/])assert.match(page,term);
 assert.ok(!tags(tree).includes('i'),'server strings are text');assert.ok(actions(tree).includes('rel-accept')&&actions(tree).includes('rel-accept-decline'));assert.doesNotMatch(page,rawCode);
 await c.act('rel-accept',{values:{'res:2:0:0':true}});assert.equal(c.opCalls().filter(b=>b.operation==='accept').length,0,'accepting needs the confirmation');
 await c.act('rel-accept',{values:{confirm:true}});assert.equal((await c.model()).relationError,'relation_values_incomplete');
 await c.act('rel-accept',{values:{confirm:true,receive:true,'res:2:0:1':true}});
 assert.deepEqual(c.opCalls().find(b=>b.operation==='accept'),{operation:'accept',invitation:META,disclosure:'e'.repeat(64),values:{2:[{resource:resB,field:'files'}]},receive:true});
 const m=await c.model();assert.equal(m.relationAccept,null);assert.equal(m.relationNotice,'relation_accepted');
});

test('ORG-10g acceptance: a changed disclosure is shown again; an invalid invitation says "ask for a new one"; decline sends the item',async t=>{
 let accepts=0,previews=0;const c=await client(t,{ops:{accept:()=>{accepts++;throw Object.assign(Error('Changed'),{status:409,code:'relation_disclosure_changed'});},'inbound-preview':()=>{previews++;return {...structuredClone(disclosure),disclosure:previews>1?'a'.repeat(64):'e'.repeat(64)};}}});
 await open(c);await c.act('rel-inbound',{invitation:'jti-in'});await c.act('rel-accept',{values:{confirm:true,'res:2:0:0':true}});
 let m=await c.model();assert.equal(accepts,1);assert.equal(previews,2,'the disclosure is fetched again');assert.equal(m.relationAccept.disclosure.disclosure,'a'.repeat(64));assert.equal(m.relationError,'relation_disclosure_changed');assert.match(text(await c.render()),/terms of this invitation changed/);
 await c.act('rel-accept-decline');assert.deepEqual(c.opCalls().find(b=>b.operation==='decline'),{operation:'decline',item:'jti-in'});
 const d=await client(t,{ops:{'inbound-preview':()=>{throw Object.assign(Error('Invalid'),{status:400,code:'invitation_invalid'});}}});await open(d);
 await d.act('rel-paste',{values:{invitation:'not a token'}});assert.equal((await d.model()).relationError,'invitation_invalid');assert.equal(d.opCalls().length,0,'a malformed code never reaches the server');
 await d.act('rel-paste',{values:{invitation:META}});m=await d.model();assert.deepEqual(m.relationAccept,{invalid:true,reason:'invitation_invalid'});
 const page=text(await d.render());assert.match(page,/no longer valid\. Ask the other organization for a new one/);assert.doesNotMatch(page,/Supply/);
});

test('ORG-10g fragment landing: read once, removed from the address bar, kept privately, and opened as the acceptance page',async t=>{
 const saved={location:globalThis.location,history:globalThis.history,sessionStorage:globalThis.sessionStorage},replaced=[],store=new Map();t.after(()=>Object.assign(globalThis,saved));
 const href='https://provider.example/console?view=organizations&org='+org+'&tab=relationships#relation-invitation='+META;
 Object.assign(globalThis,{location:{href,hash:'#relation-invitation='+META},history:{state:null,replaceState:(s,_,url)=>{replaced.push(url);globalThis.location={href:ORIGIN+url,hash:''};}},sessionStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)}});
 assert.deepEqual(relationLanding.take(),{org,meta:META});assert.deepEqual(replaced,['/console?view=organizations&org='+org+'&tab=relationships'],'the fragment is removed at once');
 assert.deepEqual(relationLanding.take(),{org,meta:META},'kept in this tab');assert.equal(replaced.length,1,'read once');relationLanding.clear();assert.equal(relationLanding.take(),null);
 globalThis.sessionStorage={getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('blocked');},removeItem:()=>{throw Error('blocked');}};assert.equal(relationLanding.take(),null,'storage failures degrade quietly');
 // Engine: the console's own address opens the acceptance page for the addressed organization only.
 const taken=[],cleared=[];let pending={org,meta:META};const landing={take:()=>{taken.push(1);return pending;},clear:()=>{cleared.push(1);pending=null;}};
 const c=await client(t,{landing});await c.act('open',{org});let m=await c.model();
 assert.equal(m.relationsTab,true);assert.equal(m.relationPane.kind,'accept');assert.equal(m.relationAccept.landed,true);assert.equal(c.opCalls().filter(b=>b.operation==='inbound-preview').length,1);assert.equal(c.focus.at(-1),'#org-rel-accept');
 await c.act('rel-accept',{values:{confirm:true,'res:2:0:0':true}});assert.equal(cleared.length,1,'accepted: the private copy is forgotten');
 await c.act('open',{org});assert.equal(c.opCalls().filter(b=>b.operation==='inbound-preview').length,1,'nothing is opened twice');
 const other={take:()=>({org:'00000000-0000-4000-8000-000000000009',meta:META}),clear:()=>{}},d=await client(t,{landing:other});await d.act('open',{org});assert.equal(d.opCalls().length,0,'an invitation for another organization is not opened here');
 const bad={take:()=>({org,meta:null}),clear:()=>cleared.push('bad')},e=await client(t,{landing:bad});await e.act('open',{org});m=await e.model();assert.equal(m.relationAccept.invalid,true);assert.equal(e.opCalls().length,0);assert.ok(cleared.includes('bad'));assert.match(text(await e.render()),/no longer valid/);
});

test('ORG-10g member view: a non-admin reads only the imports they hold grants on and never requests the overview',async t=>{
 const c=await client(t,{powers:[]});await c.act('select',{org});
 const gets=c.api.calls.filter(x=>x.method==='GET').map(x=>x.path);assert.ok(gets.includes(REL+'/imports'));assert.ok(!gets.includes(REL),'no overview read');assert.ok(!gets.some(p=>/catalogue|resources/.test(p)));
 let m=await c.model();assert.equal(m.relations,null);assert.equal(m.relationImports.length,1);
 await c.act('rel-tab',{tab:'relationships'});const tree=await c.render(),page=text(tree);
 assert.match(page,/Shared with this organization/);assert.match(page,/Acme/);assert.match(page,/File storage/);
 assert.doesNotMatch(page,/Relationships \(|Needs your attention|Paused for safety|Invitations you sent|their role/i);assert.ok(!actions(tree).some(a=>['rel-edge','rel-wizard-open','rel-inbound','rel-hold-confirm'].includes(a)));
 const before=c.api.calls.length;for(const a of ['rel-wizard-open','rel-reload','rel-inbound','rel-hold-confirm'])await c.act(a,{invitation:'jti-in',counterpart:principalKey(beta)});
 assert.equal(c.api.calls.length,before,'admin operations are not even sent');m=await c.model();assert.equal(m.relationError,'not_found');
 const none=await client(t,{powers:[],routes:{['GET '+REL+'/imports']:()=>({imports:[]})}});await none.act('select',{org});assert.ok(!actions(await none.render()).includes('rel-tab-relationships'),'no tab without imports');
});

test('ORG-10g narrowing: suspend, end, narrow, leave, withdraw, decline and mute need no step-up; ending and narrowing are confirmed first',async t=>{
 const c=await client(t);await open(c);await edge(c);assert.equal(c.focus.at(-1),'#org-rel-edge');
 const tree=await c.render(),page=text(tree);for(const term of [/What you give: active/,/What you receive: active/,/separate code/,/held until an admin confirms/,/over 30 days/])assert.match(page,term);
 for(const a of ['rel-suspend','rel-end','rel-narrow','rel-mute','rel-audit','rel-suspend-incoming','rel-introduce'])assert.ok(actions(tree).includes(a),a);
 const key=principalKey(acme);
 await c.act('rel-suspend',{instance,counterpart:key,direction:'outgoing'});
 await c.act('rel-end',{instance,counterpart:key,direction:'incoming',values:{}});assert.equal(c.opCalls().filter(b=>b.operation==='end').length,0,'ending needs the confirmation');
 await c.act('rel-end',{instance,counterpart:key,direction:'incoming',values:{confirm:true}});
 await c.act('rel-narrow',{instance,counterpart:key,values:{confirm:true,'keep:0':true,'keepr:0:0':true,'keepr:0:1':false}});
 await c.act('rel-narrow',{instance,counterpart:key,values:{confirm:true,'keep:0':false}});assert.equal((await c.model()).relationError,'relation_values_incomplete','dropping everything is ending, not narrowing');
 await c.act('rel-withdraw',{invitation:'jti-open'});await c.act('rel-decline',{item:'intro-1'});await c.act('rel-mute',{organization:principalKey(zed),values:{confirm:true}});
 await c.act('rel-mute',{organization:principalKey(P('00000000-0000-4000-8000-0000000000ff')),values:{confirm:true}});assert.equal((await c.model()).relationError,'review_required','only organizations this console loaded can be muted');
 await c.act('rel-leave',{instance,values:{confirm:true}});
 assert.deepEqual(c.opCalls(),[{operation:'suspend',instance,counterpart:acme,direction:'outgoing'},{operation:'end',instance,counterpart:acme,direction:'incoming'},{operation:'narrow',instance,counterpart:acme,entries:{0:[resA]}},{operation:'withdraw',invitation:'jti-open'},{operation:'decline',item:'intro-1'},{operation:'mute',organization:zed,muted:true},{operation:'leave',instance}]);
 assert.equal(c.api.calls.filter(x=>x.path.startsWith('/api/auth/step-up')).length,0,'no security check for narrowing');assert.equal((await c.snapshot()).stepUp??null,null);
 assert.deepEqual(keptEntries({entries:[{index:0,required:true,resources:[{resource:'a'}]},{index:1,resources:[{resource:'b'}]}]},{'keep:0':true,'keepr:0:0':true}),{0:true});
 assert.throws(()=>keptEntries({entries:[{index:0,required:true,resources:[{resource:'a'}]}]},{'keep:0':false,'keepr:0:0':true}),{code:'relation_values_incomplete'});
 // The activity log link: the organization tab, the audit loaded and focused.
 await c.act('rel-audit');const m=await c.model();assert.equal(m.relationsTab,false);assert.equal(m.audit.length,1);assert.equal(c.focus.at(-1),'#org-audit');
});

test('ORG-10g holds: Confirm sends the hold’s own aep (never a form value); explained in plain words with End offered instead',async t=>{
 const c=await client(t);await open(c);const tree=await c.render(),page=text(tree);
 assert.match(page,/Paused for safety/);assert.match(page,/authority was reset/);assert.match(page,/Everything you share with it is paused/);assert.ok(actions(tree).includes('rel-hold-confirm')&&actions(tree).includes('rel-hold-end'));
 await c.act('rel-hold-confirm',{counterpart:principalKey(beta),values:{confirm:true,aep:99,counterpart:principalKey(acme)}});
 assert.deepEqual(c.opCalls().at(-1),{operation:'confirm-counterpart',counterpart:beta,aep:3});
 await c.act('rel-hold-confirm',{counterpart:principalKey(acme)});assert.equal((await c.model()).relationError,'relation_hold_changed');
 const w=await client(t,{relations:()=>({...overview(),holds:{holds:[{counterpart:beta,kind:'write',aep:4,cause:'attested-move',since:Date.UTC(2026,9,20),until:Date.UTC(2026,9,23)}],unreachable:[]}})});await open(w);
 assert.match(text(await w.render()),/attested handover.*Only adding, replacing and deleting are paused until/s);
});

test('ORG-10g rebind after a move: new values from the pool for the moved edge only',async t=>{
 const c=await client(t);await open(c);assert.match(text(await c.render()),/Choose new resources/);
 await c.act('rel-rebind-open',{instance,counterpart:principalKey(acme)});assert.equal((await c.model()).relationError,'review_required','only an edge suspended by a move');
 await c.act('rel-rebind-open',{instance,counterpart:principalKey(beta)});let m=await c.model();assert.equal(m.relationPool.length,2);assert.equal(m.relationPane.kind,'edge');assert.equal(c.focus.at(-1),'#org-rel-rebind');
 assert.ok(actions(await c.render()).includes('rel-rebind'));
 await c.act('rel-rebind',{values:{'res:0:0:1':true}});assert.equal(c.opCalls().filter(b=>b.operation==='rebind').length,0,'needs the confirmation');
 await c.act('rel-rebind',{values:{confirm:true,'res:0:0:1':true}});
 assert.deepEqual(c.opCalls().find(b=>b.operation==='rebind'),{operation:'rebind',instance,counterpart:beta,values:{0:[{resource:resB,field:'files'}]}});m=await c.model();assert.equal(m.relationRebind,null);assert.equal(m.relationNotice,'relation_rebound');
});

test('ORG-10g introductions: propose for a counterpart with a live edge; admit issues an invitation with this organization’s values; decline',async t=>{
 const c=await client(t);await open(c);const page=text(await c.render());assert.match(page,/Introduction: @newco/);assert.match(page,/introductions expire after 30 days/);
 await c.act('rel-introduce',{instance,counterpart:principalKey(beta),values:{confirm:true}});assert.equal((await c.model()).relationError,'review_required','no live edge with that counterpart');
 await c.act('rel-introduce',{instance,counterpart:principalKey(acme),values:{confirm:true}});assert.deepEqual(c.opCalls().at(-1),{operation:'introduce',instance,slot:'recipient',candidate:acme});
 await c.act('rel-admit-open',{introduction:'intro-1'});assert.deepEqual(c.opCalls().at(-1),{operation:'preview',relation:pin,slot:'owner'});const m=await c.model();assert.equal(m.relationPane.kind,'admit');assert.deepEqual(m.relationAdmit.gives.map(e=>e.index),[0]);assert.equal(c.focus.at(-1),'#org-rel-admit');
 assert.match(text(await c.render()),/Admit @newco/);
 await c.act('rel-admit',{values:{'res:0:0:0':true}});assert.equal(c.opCalls().filter(b=>b.operation==='admit').length,0);
 await c.act('rel-admit',{values:{confirm:true,'res:0:0:0':true}});assert.deepEqual(c.opCalls().find(b=>b.operation==='admit'),{operation:'admit',introduction:'intro-1',values:{0:[{resource:resA,field:'files'}]},receive:false,as:'owner'});
 assert.equal((await c.model()).relationIssued.invitation,OTHER_META);
 await c.act('rel-decline',{item:'intro-1'});assert.deepEqual(c.opCalls().at(-1),{operation:'decline',item:'intro-1'});
});

test('ORG-10g uniform 404: a refused operation is not-found text and the overview refreshes; a refused overview hides the tab body quietly',async t=>{
 let gets=0;const c=await client(t,{relations:()=>{gets++;return overview();},ops:{suspend:()=>{throw Object.assign(Error('Not found.'),{status:404,code:'not_found'});}}});await open(c);const before=gets;
 await c.act('rel-suspend',{instance,counterpart:principalKey(acme)});const m=await c.model();assert.equal(m.relationError,'not_found');assert.equal(gets,before+1,'refreshed');assert.equal(m.error,null);
 assert.match(text(await c.render()),/This isn’t available/);
 const d=await client(t,{relations:Object.assign(Error('Not found.'),{status:404,code:'not_found'})});await d.act('select',{org});const dm=await d.model();assert.equal(dm.relations,null);assert.equal(dm.relationsUnavailable,true);assert.equal(dm.error,null,'the rest of the console is unaffected');
 await d.act('rel-tab',{tab:'relationships'});assert.match(text(await d.render()),/aren’t available for this organization/);
 // Off for this organization: widening is not offered and is refused locally; narrowing stays.
 const off=await client(t,{relations:()=>({...overview(),enabled:false})});await open(off);const tree=await off.render();assert.ok(!actions(tree).includes('rel-wizard-open'));assert.match(text(tree),/off for this organization/);
 await off.act('rel-wizard-open');assert.equal((await off.model()).relationError,'relation_unavailable');await off.act('rel-suspend',{instance,counterpart:principalKey(acme)});assert.equal(off.opCalls().at(-1).operation,'suspend');
 // An uncertain outcome (5xx) refreshes and says so.
 const u=await client(t,{ops:{withdraw:()=>{throw Object.assign(Error('Bad gateway'),{status:502});}}});await open(u);await u.act('rel-withdraw',{invitation:'jti-open'});assert.equal((await u.model()).relationError,'change_uncertain');
});

test('ORG-10g messages: every contract code has English and Spanish text, never a raw code; unknown codes fall back',async()=>{
 const codes=['not_found','invitation_invalid','reauthentication_required','relation_disclosure_changed','relation_values_invalid','relation_values_incomplete','relation_slot_invalid','relation_slot_full','relation_counterpart_exists','relation_invitation_empty','relation_invitation_pending','relation_invitations_limited','relation_limit','relation_redeem_unavailable','relation_acceptance_conflict','relation_party_invalid','relation_party_unsupported','relation_foreign_unavailable','relation_rebind_required','relation_hold_changed','relation_billing_lapsed','organization_deletion_pending','relation_introduction_invalid','relation_introduction_empty','relation_mute_limit','relation_unavailable','counterparty_unavailable','invalid_request','review_required','change_uncertain','saved_stale','copy_failed','rate_limited','unavailable','invitee_unrecognized'];
 for(const code of codes){assert.ok(Object.hasOwn(ORG_RELATION_ERRORS,code),code);const en=orgRelationError('en',code),es=orgRelationError('es',code);assert.ok(en&&es&&en!==es,code);for(const s of [en,es]){assert.doesNotMatch(s,rawCode,code);assert.ok(!s.includes(code));}}
 for(const code of Object.keys(ORG_RELATION_NOTICES)){const en=orgRelationNotice('en',code),es=orgRelationNotice('es',code);assert.ok(en!==es);assert.doesNotMatch(en+es,rawCode);}
 assert.equal(orgRelationError('en','relation_some_new_limit'),ORG_FALLBACK);assert.doesNotMatch(orgRelationError('es','relation_some_new_limit'),rawCode);
});

test('ORG-10g rendering: en and es overview, checklists for a sale and a deletion, imports; no raw codes and no markup from the server',async t=>{
 for(const locale of ['en','es']){const c=await client(t,{state:{locale}});await open(c);let tree=await c.render(),page=text(tree);
  assert.doesNotMatch(page,rawCode);assert.ok(!tags(tree).includes('img'));assert.match(page,locale==='es'?/Requiere tu atención \(5\)/:/Needs your attention \(5\)/);assert.match(page,locale==='es'?/Invitación de/:/Invitation from/);
  await c.act('rel-pane',{pane:'imports'});page=text(await c.render());assert.match(page,locale==='es'?/Las apps a las que asignas un recurso importado saben/:/Apps you assign an imported resource to learn/);assert.match(page,locale==='es'?/retenido hasta/:/held until an admin confirms/);
  await c.act('rel-tab',{tab:'organization'});tree=await c.render();page=text(tree);assert.doesNotMatch(page,rawCode);
  const relCount=(page.match(locale==='es'?/Antes de una venta: relaciones que revisar/g:/Before a sale: relationships to review/g)??[]).length;assert.equal(relCount,1,'the change-of-control checklist sits with billing and ownership');
  for(const code of Object.keys(ORG_RELATION_ERRORS)){c.engine.container.use({state:{write:true}},({state})=>state.transition(s=>Object.assign(s,{organizationsConsole:{...s.organizationsConsole,relationsTab:true,relationPane:null,relationError:code}})));assert.doesNotMatch(text(await c.render()),rawCode,code);}
 }
 const del=await client(t,{routes:{}});await del.act('select',{org});await del.engine.container.use({state:{write:true}},({state})=>state.transition(s=>Object.assign(s,{organizationsConsole:{...s.organizationsConsole,organization:{...s.organizationsConsole.organization,state:'deletion-scheduled',deletion:{notBefore:Date.UTC(2026,11,1)}}}})));
 assert.match(text(await del.render()),/Relationships to review before deletion \(1\)/);
 const empty=await client(t,{relations:()=>({enabled:true,billing:'active',closing:false})});await empty.act('select',{org});await empty.act('rel-tab',{tab:'relationships'});assert.match(text(await empty.render()),/no relationships yet/);
 assert.deepEqual(RELATION_STEPS,['relation','slot','counterparty','values','review']);
 assert.throws(()=>relationValues([{index:0,required:false,methods:{files:{[STORAGE]:['get']}}}],[{id:'x',contracts:{other:['get']}}],{'res:0:0:0':true}),{code:'relation_values_invalid'},'a resource that does not fit is refused locally');
});

test('ORG-10g relation URL selects only a host-supported pinned relation',async t=>{
 const c=await client(t);await open(c);await c.act('rel-wizard-open');
 await c.act('rel-wizard-relation',{values:{relationUrl:'https://unknown.example/relation'}});
 assert.equal((await c.model()).relationWizard.step,'relation');
 await c.act('rel-wizard-relation',{values:{relationUrl:pin.artefact}});
 assert.equal((await c.model()).relationWizard.step,'slot');
 assert.deepEqual((await c.model()).relationWizard.relation.pin,pin);
});

test('ORG-10g export downloads all pages with flags off, without step-up; members cannot export',async t=>{
 const downloads=[],records=[{key:'relation:a',value:{private:'one'}},{key:'relation:b',value:{private:'two'}}];
 const c=await client(t,{relations:()=>({...overview(),enabled:false}),routes:{
  ['GET '+REL+'/export']:()=>({version:1,organization:P(org),records:[records[0]],next:'cursor/a'}),
  ['GET '+REL+'/export?after=cursor%2Fa']:()=>({version:1,organization:P(org),records:[records[1]],next:null})
 }});
 c.browser.download=(...args)=>downloads.push(args);
 await open(c);assert.ok(actions(await c.render()).includes('rel-export'));await c.act('rel-export');
 assert.equal(downloads.length,1);assert.equal(downloads[0][0],'organization-relations-'+org+'.json');assert.deepEqual(JSON.parse(downloads[0][1]),{version:1,organization:P(org),records});
 assert.equal(c.api.calls.some(x=>x.path.startsWith('/api/auth/step-up')),false);
 const member=await client(t,{powers:[]});await open(member);await member.act('rel-export');assert.equal((await member.model()).relationError,'not_found');assert.equal(member.api.calls.some(x=>x.path.endsWith('/export')),false);
});
