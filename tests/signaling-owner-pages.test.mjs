// Signaling owner pages at the engine level (packages/signaling/owner-pages.mjs; spec rev 3.2 §20.1.4 session handler
// approval, §5.8 pairing creation and activation, §4.3 service designation, §14.1 live offers; release gate
// "Signaling", owner pages). Every page action is driven through dispatched ngin operations with the services running
// as the runtime runs them (`ownerPages`): a widening action needs a review of the same owner, action and input, is
// refused before the review's arming time, consumes the review, and the review carries what the page must disclose.
// Narrowing (removal, revocation, relabelling, shortening, auto-connect off, designation removal) needs no review.
// Local behaviour only; reserved .example hosts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {signalingHost,standardKinds,rejects,fault,APP,OTHER_APP,SYNC,CHAT,CALLBACK,REMOTE,PEER,DAY,subOf,ISS} from './helpers/signaling-fixture.mjs';
import {PAGE_REVIEW,approvalPageURL,canonicalInput,REVIEW_PREFIX} from '../packages/signaling/owner-pages.mjs';
import {BOUNDS} from '../packages/app/domains/signaling.mjs';
import {memoryKey} from '../packages/intents/sessions.mjs';

async function host(options={}){const h=await signalingHost({ownerPages:true,...options});const refs=await standardKinds(h);return {h,refs};}
const approve=(h,n,clientId,line,extra)=>h.page(n,'session-approve',{clientId,kind:h.ref(line)},'intents.session-approve',extra?{extra}:{});
const review=(h,n,action,input,actor)=>h.run(n,'signaling.review',{actor:actor??h.owner(n),input:{action,input}});
const commit=(h,n,operation,input,reviewId,actor)=>h.run(n,operation,{actor:{...actor??h.owner(n),...reviewId?{review:reviewId}:{}},input});
const own=(h,line=SYNC,extra={})=>({kind:h.ref(line),local:{client_id:APP,client_session:null},peer:{self:{client_id:OTHER_APP,client_session:null}},opens:'both',label:'Desk to phone',...extra});

test('approval page: the review discloses the kind, risk and what the handler sees; only an armed, matching, unused review records the approval',async()=>{
 const {h}=await host();
 // Without a review the widening operation is refused (the JSON route is only the page's adapter).
 await rejects(h.run(1,'intents.session-approve',{input:{clientId:APP,kind:h.ref(CHAT)}}),'review_required','no review');
 // The review accepts a kind line (the newest held version) as approval_required hands it to the page.
 const r=await review(h,1,'session-approve',{clientId:APP,kind:CHAT});
 assert.match(r.review,/^rv_[A-Za-z0-9_-]{22}$/);assert.equal(r.armAt,h.clock.now()+PAGE_REVIEW.dwellMs);assert.equal(r.expiresAt,h.clock.now()+PAGE_REVIEW.ttlMs);
 assert.deepEqual(r.input,{clientId:APP,kind:h.ref(CHAT)});
 const d=r.disclosure;
 assert.deepEqual(d.handler,{client_id:APP,client_session:null,origin:'https://app.example'});
 assert.deepEqual({host:d.kind.host,reviewed:d.kind.reviewed,effect:d.kind.effect,parties:d.kind.parties,profiles:d.kind.profiles,bases:d.kind.bases,categories:d.kind.categories,title:d.kind.title.en},
  {host:'chat.example',reviewed:false,effect:'join',parties:'any',profiles:['data','webrtc'],bases:null,categories:['personal-data'],title:'Kind'});
 assert.deepEqual(d.kind.fields.map(f=>f.name),['call']);assert.equal(d.risk,'medium');
 assert.deepEqual(d.sees,['identity','origin','context'],'the handler will see the verified identity, reported origin and context of every invite');
 assert.equal(d.serviceClass,false);assert.equal(d.autoConnectAllowed,false);assert.equal(d.existing,null);assert.deepEqual(d.activatable,[]);
 // Too early: refused, and the review stays usable.
 await rejects(commit(h,1,'intents.session-approve',r.input,r.review),'decision_not_armed','before the arming time');
 h.clock.advance(PAGE_REVIEW.dwellMs);
 // A review covers exactly its owner, action and input.
 await rejects(commit(h,1,'intents.session-approve',{clientId:APP,kind:h.ref(SYNC)},r.review),'review_required','another kind');
 await rejects(commit(h,1,'intents.session-approve',{clientId:OTHER_APP,kind:h.ref(CHAT)},r.review),'review_required','another app');
 await rejects(h.run(2,'intents.session-approve',{actor:{...h.owner(2),review:r.review},input:r.input}),'review_required','another owner');
 // Auto-connect on a kind whose `parties` is not `self` is refused by the operation itself.
 await rejects(commit(h,1,'intents.session-approve',{...r.input,autoConnect:true},r.review),'invalid_args','not a self kind');
 assert.deepEqual(await commit(h,1,'intents.session-approve',r.input,r.review),{kind:CHAT,clientId:APP,version:1,autoConnect:false});
 await rejects(commit(h,1,'intents.session-approve',r.input,r.review),'review_required','a review authorizes one action');
 assert.deepEqual((await h.run(1,'intents.session-approvals')).approvals.map(a=>[a.kind,a.handler]),[[CHAT,APP]]);
 // An expired review is refused.
 const late=await review(h,1,'session-approve',{clientId:APP,kind:SYNC});h.clock.advance(PAGE_REVIEW.ttlMs);
 await rejects(commit(h,1,'intents.session-approve',late.input,late.review),'review_required','expired');
});

test('approval page refusals: signaling off, an app without a live grant, an excluded handler and an unheld kind; reviews are bounded per owner',async()=>{
 const {h}=await host();
 await rejects(review(h,1,'session-approve',{clientId:'https://stranger.example/client',kind:CHAT}),'not_found','no live connection and grant (P1 evidence)');
 await rejects(review(h,1,'session-approve',{clientId:APP,kind:'https://chat.example/kinds/unknown/v1'}),'invalid_args','a kind the provider does not hold');
 await rejects(review(h,1,'session-approve',{clientId:APP,kind:{...h.ref(CHAT),digest:'sha256-'+'B'.repeat(43)}}),'invalid_args','a version the provider does not hold');
 await rejects(review(h,1,'unknown-action',{}),'invalid_args');await rejects(review(h,1,'session-approve',{clientId:APP,kind:CHAT,extra:1}),'invalid_args');
 // An exclusion (intents §7.4) makes the handler unapprovable for that kind.
 await h.account(1).store.put(memoryKey(subOf(1),CHAT),{kind:CHAT,excluded:[{site:'app.example',at:1}]});
 await rejects(review(h,1,'session-approve',{clientId:APP,kind:CHAT}),'handler_excluded');
 h.flags.deny(subOf(1),'SIGNALING_ENABLED');await rejects(review(h,1,'session-approve',{clientId:APP,kind:SYNC}),'not_found','widening while off');h.flags.allow(subOf(1),'SIGNALING_ENABLED');
 // At most PAGE_REVIEW.max live reviews: the oldest is dropped first.
 const first=await review(h,1,'session-approve',{clientId:APP,kind:SYNC});
 for(let i=0;i<PAGE_REVIEW.max;i++){h.clock.advance(1);await review(h,1,'session-approve',{clientId:APP,kind:SYNC});}
 assert.equal((await h.rows(1,REVIEW_PREFIX)).length,PAGE_REVIEW.max);
 h.clock.advance(PAGE_REVIEW.dwellMs);await rejects(commit(h,1,'intents.session-approve',first.input,first.review),'review_required','the oldest review was dropped');
});

test('approval page: re-approval names the earlier version; pending pairings this approval completes are listed with links; a service-class handler gets the service disclosure',async()=>{
 const {h}=await host({organizations:[3]});
 await approve(h,1,APP,SYNC);
 const {result:pending}=await h.page(1,'pairing-create',own(h),'signaling.pairing-create');
 assert.equal(pending.state,'pending','OTHER_APP holds no approval yet');
 const r=await review(h,1,'session-approve',{clientId:OTHER_APP,kind:SYNC});
 assert.deepEqual(r.disclosure.activatable.map(p=>[p.id,p.label,p.opens,p.state,p.local.client_id,p.peer.self.client_id]),[[pending.id,'Desk to phone','both','pending',APP,OTHER_APP]]);
 assert.equal(r.disclosure.autoConnectAllowed,true);
 // A newer version that adds disclosure: the review names the earlier approval and that it adds disclosure.
 await h.publish({line:SYNC,parties:'self',profiles:{data:{},webrtc:{}},properties:{where:{type:'string',maxLength:8}},fieldCategories:{where:['location']}});
 const again=await review(h,1,'session-approve',{clientId:APP,kind:SYNC});
 assert.equal(again.input.kind.version,2);assert.deepEqual(again.disclosure.existing,{version:1,autoConnect:false});assert.equal(again.disclosure.addsDisclosure,true);
 // Service class (§4.3): an approved app of a designated organization may publish long offers; the page says so.
 await h.page(3,'set-service',{designated:true,revision:0},'signaling.set-service');
 const service=await review(h,3,'session-approve',{clientId:APP,kind:CHAT});
 assert.equal(service.disclosure.serviceClass,true);assert.deepEqual(service.disclosure.serviceLimits,{openSeconds:BOUNDS.offerServiceOpenSeconds,boundSeconds:BOUNDS.offerServiceBoundSeconds});
 assert.equal((await review(h,1,'session-approve',{clientId:APP,kind:CHAT})).disclosure.serviceClass,false,'a person entity is never service-class');
});

test('auto-connect page: turning it on needs a review and a self kind; turning it off never does',async()=>{
 const {h}=await host();
 await approve(h,1,APP,SYNC);await approve(h,1,APP,CHAT);
 await rejects(h.run(1,'intents.session-auto-connect',{input:{clientId:APP,kind:SYNC,autoConnect:true}}),'review_required');
 await rejects(review(h,1,'session-auto-connect',{clientId:APP,kind:CHAT}),'invalid_args','CHAT is not a self kind');
 await rejects(review(h,1,'session-auto-connect',{clientId:OTHER_APP,kind:SYNC}),'not_found','no approval to widen');
 const {review:r,result}=await h.page(1,'session-auto-connect',{clientId:APP,kind:SYNC},'intents.session-auto-connect');
 assert.equal(r.disclosure.kind.parties,'self');assert.deepEqual(result,{autoConnect:true});
 assert.deepEqual(await h.run(1,'intents.session-auto-connect',{input:{clientId:APP,kind:SYNC,autoConnect:false}}),{autoConnect:false},'narrowing needs no review');
});

test('pairing creation page (own entity): parties check, P1 status, activation at creation, and the review binds every member',async()=>{
 const {h}=await host();
 await rejects(h.run(1,'signaling.pairing-create',{input:own(h)}),'review_required');
 await rejects(review(h,1,'pairing-create',own(h,CALLBACK)),'invalid_args','CALLBACK admits no own-entity party (and no pairing basis)');
 await rejects(review(h,1,'pairing-create',own(h,SYNC,{peer:{self:{client_id:APP,client_session:null}}})),'invalid_args','never the local app itself');
 await rejects(review(h,1,'pairing-create',own(h,SYNC,{opens:undefined})),'invalid_args');
 // Neither app approved: created pending; the page says the pairing will wait.
 let r=await review(h,1,'pairing-create',{...own(h),kind:SYNC,local:{client_id:APP}});
 assert.deepEqual(r.input,{...own(h),expiresAt:null,created_via:'settings'},'a kind line and a missing client_session are normalized');
 assert.deepEqual(r.disclosure.parties,[{client_id:APP,connected:true,approved:false},{client_id:OTHER_APP,connected:true,approved:false}]);
 assert.equal(r.disclosure.activateNow,false);assert.equal(r.disclosure.cross,false);assert.equal(r.disclosure.expiresAt,null);
 assert.deepEqual(r.disclosure.effect,{direct:true,data:true,categories:['personal-data']});assert.equal(r.disclosure.peerCanTellRunning,false);
 h.clock.advance(PAGE_REVIEW.dwellMs);
 await rejects(commit(h,1,'signaling.pairing-create',{...r.input,label:'Changed after review'},r.review),'review_required','the label shown is the label created');
 await rejects(commit(h,1,'signaling.pairing-create',{...r.input,opens:'local'},r.review),'review_required','opens');
 await rejects(commit(h,1,'signaling.pairing-create',{...r.input,activate:true},r.review),'review_required','a review showing the pairing staying inactive never activates it');
 const pending=await commit(h,1,'signaling.pairing-create',r.input,r.review);assert.equal(pending.state,'pending');
 // Both approved: the creation page's control is the activation control (P3 "Activation at creation").
 await approve(h,1,APP,REMOTE);await approve(h,1,OTHER_APP,REMOTE);
 r=await review(h,1,'pairing-create',own(h,REMOTE,{label:'Remote',opens:'local'}));assert.equal(r.disclosure.activateNow,true);
 h.clock.advance(PAGE_REVIEW.dwellMs);assert.equal((await commit(h,1,'signaling.pairing-create',{...r.input,activate:true},r.review)).state,'live');
 // The same page's "Create without activating" control: the reviewed activation is offered, not imposed.
 r=await review(h,1,'pairing-create',own(h,REMOTE,{label:'Remote, later',opens:'peer'}));assert.equal(r.disclosure.activateNow,true);
 h.clock.advance(PAGE_REVIEW.dwellMs);assert.equal((await commit(h,1,'signaling.pairing-create',r.input,r.review)).state,'pending');
});

test('pairing creation reviewed as staying inactive is never committed live when the missing approvals arrive before the decision (§5.8 P3, review M1)',async()=>{
 const {h}=await host();
 // Neither app holds an approval: the page says the pairing "will be created but stays inactive".
 const r=await review(h,1,'pairing-create',own(h));assert.equal(r.disclosure.activateNow,false);
 // Within the review's life the approvals are recorded (another tab, or the page's own "Review approval" link).
 await approve(h,1,APP,SYNC);await approve(h,1,OTHER_APP,SYNC);
 h.clock.advance(PAGE_REVIEW.dwellMs);
 // A decision carrying `activate` on that review is refused and leaves nothing behind; the review stays usable.
 await rejects(commit(h,1,'signaling.pairing-create',{...r.input,activate:true},r.review),'review_required','activation was never shown as a control');
 assert.deepEqual((await h.run(1,'signaling.pairings')).pairings,[]);
 // The reviewed decision creates it pending; activation is its own reviewed step.
 const created=await commit(h,1,'signaling.pairing-create',r.input,r.review);assert.equal(created.state,'pending');
 const a=await review(h,1,'pairing-activate',{id:created.id,revision:created.revision});assert.equal(a.disclosure.activateNow,true);
 h.clock.advance(PAGE_REVIEW.dwellMs);assert.equal((await commit(h,1,'signaling.pairing-activate',a.input,a.review)).state,'live');
});

test('pairing creation page (cross entity): fresh authentication, verified handle display, mandatory expiry, enforcement disclosure and one pairing per (peer, kind line)',async()=>{
 const {h}=await host();await approve(h,1,APP,CHAT);
 const cross={kind:CHAT,local:{client_id:APP,client_session:null},peer:{handle:'user2'},opens:'local',label:'Bob'};
 await rejects(review(h,1,'pairing-create',cross),'reauthentication_required','the owner authenticates freshly');
 const fresh=h.owner(1,{freshAuth:true});
 await rejects(review(h,1,'pairing-create',{...cross,peer:{handle:'nobody'}},fresh),'peer_unknown');
 await rejects(review(h,1,'pairing-create',{...cross,kind:SYNC},fresh),'invalid_args','a self kind admits no other party');
 await rejects(review(h,1,'pairing-create',{...cross,peer:{handle:'user1'}},fresh),'invalid_args','never the owner itself');
 const r=await review(h,1,'pairing-create',cross,fresh);
 assert.deepEqual(r.input.peer,{principal:h.principal(2)},'the handle resolves to the origin principal, which is what is paired');
 assert.deepEqual(r.disclosure.peer,{principal:h.principal(2),issuerOrigin:ISS,handle:'user2',sameProvider:true},'shown by handle only with a verified binding');
 assert.equal(r.input.expiresAt,h.clock.now()+BOUNDS.pairingDefaultMs);assert.equal(r.disclosure.expiresAt,r.input.expiresAt,'a cross-entity pairing always expires (default 90 days)');
 assert.equal(r.disclosure.peerCanTellRunning,true);assert.equal(r.disclosure.recipientOnlyEnforcement,true);assert.equal(r.disclosure.cross,true);
 await rejects(review(h,1,'pairing-create',{...cross,expiresAt:h.clock.now()+400*DAY},fresh),'invalid_args','at most a year');
 h.clock.advance(PAGE_REVIEW.dwellMs);
 await rejects(commit(h,1,'signaling.pairing-create',r.input,r.review),'reauthentication_required','fresh authentication again at the decision');
 const created=await commit(h,1,'signaling.pairing-create',{...r.input,activate:true},r.review,fresh);assert.equal(created.state,'live');assert.equal(created.expires_at,r.input.expiresAt);
 // A second one for the same peer and kind line: the review links to the existing pairing instead.
 assert.deepEqual(await review(h,1,'pairing-create',{...cross,label:'Bob again',opens:'both'},fresh),{action:'pairing-create',review:null,refusal:{code:'pairing_exists',existing:created.id}});
 // A foreign principal is shown in full (no handle without a verified binding).
 const far={iss:'https://far.example',sub:'0a0a0a0a-0000-4000-8000-0000000000ff'},farReview=await review(h,1,'pairing-create',{...cross,peer:{principal:far}},fresh);
 assert.deepEqual(farReview.disclosure.peer,{principal:far,issuerOrigin:'https://far.example',handle:null,sameProvider:false});
});

test('pairing activation page: P1 status, explicit activation, CAS, cross-entity fresh authentication',async()=>{
 const {h}=await host();await approve(h,1,APP,SYNC);
 const {result:p}=await h.page(1,'pairing-create',own(h),'signaling.pairing-create');assert.equal(p.state,'pending','created without activate');
 await rejects(h.run(1,'signaling.pairing-activate',{input:{id:p.id,revision:1}}),'review_required');
 let r=await review(h,1,'pairing-activate',{id:p.id,revision:1});
 assert.equal(r.disclosure.activateNow,false);assert.deepEqual(r.disclosure.parties.map(x=>x.approved),[true,false]);assert.equal(r.disclosure.label,'Desk to phone');assert.equal(r.disclosure.opens,'both');
 h.clock.advance(PAGE_REVIEW.dwellMs);await rejects(commit(h,1,'signaling.pairing-activate',r.input,r.review),'pairing_parties_incomplete');
 await approve(h,1,OTHER_APP,SYNC);
 assert.equal((await h.run(1,'signaling.pairings')).pairings[0].state,'pending','approving a party never activates (P3)');
 await rejects(review(h,1,'pairing-activate',{id:p.id,revision:0}),'conflict','a stale page');
 const {review:shown,result:live}=await h.page(1,'pairing-activate',{id:p.id,revision:1},'signaling.pairing-activate');
 assert.equal(shown.disclosure.activateNow,true);assert.deepEqual([live.state,live.revision],['live',2]);
 await rejects(review(h,1,'pairing-activate',{id:p.id,revision:2}),'invalid_args','a live pairing is not activated again');
 // A cross-entity pairing created pending (its local app not yet approved): activation asks for fresh authentication.
 const fresh=h.owner(1,{freshAuth:true});
 const {result:x}=await h.page(1,'pairing-create',{kind:h.ref(PEER),local:{client_id:APP,client_session:null},peer:{principal:h.principal(2)},opens:'peer',label:'Peer'},'signaling.pairing-create',{actor:fresh});
 assert.equal(x.state,'pending');await approve(h,1,APP,PEER);
 await rejects(review(h,1,'pairing-activate',{id:x.id,revision:1}),'reauthentication_required');
 const {result:xl}=await h.page(1,'pairing-activate',{id:x.id,revision:1},'signaling.pairing-activate',{actor:fresh});assert.equal(xl.state,'live');
 // The 7-day pending limit: an older pending pairing is gone at the moment of decision.
 const {result:old}=await h.page(1,'pairing-create',own(h,SYNC,{label:'Old'}),'signaling.pairing-create');h.clock.advance(BOUNDS.pairingPendingMs);
 await rejects(review(h,1,'pairing-activate',{id:old.id,revision:1}),'not_found');
});

test('pairing page: relabel and shorten need no review; renew and re-confirm do (with fresh authentication across entities); remove is narrowing; the page read lists a newer version',async()=>{
 const {h}=await host();await approve(h,1,APP,CHAT);
 const fresh=h.owner(1,{freshAuth:true});
 const {result:p}=await h.page(1,'pairing-create',{kind:h.ref(CHAT),local:{client_id:APP,client_session:null},peer:{principal:h.principal(2)},opens:'local',label:'Bob'},'signaling.pairing-create',{actor:fresh,extra:{activate:true}});
 assert.equal(p.state,'live');
 let cur=await h.run(1,'signaling.pairing-update',{input:{id:p.id,revision:p.revision,label:'Bob (laptop)'}});assert.equal(cur.label,'Bob (laptop)');
 cur=await h.run(1,'signaling.pairing-update',{input:{id:p.id,revision:cur.revision,expiresAt:p.expires_at-DAY}});assert.equal(cur.expires_at,p.expires_at-DAY,'shortening is narrowing');
 await rejects(h.run(1,'signaling.pairing-update',{actor:fresh,input:{id:p.id,revision:cur.revision,expiresAt:h.clock.now()+300*DAY}}),'review_required','renewing widens');
 await rejects(review(h,1,'pairing-update',{id:p.id,revision:cur.revision,label:'x'}),'invalid_args','only the widening members are reviewed');
 await rejects(review(h,1,'pairing-update',{id:p.id,revision:cur.revision,expiresAt:h.clock.now()+DAY}),'invalid_args','a shorter expiry needs no review');
 await rejects(review(h,1,'pairing-update',{id:p.id,revision:cur.revision,expiresAt:h.clock.now()+300*DAY}),'reauthentication_required','renewing a cross-entity pairing');
 await rejects(review(h,1,'pairing-update',{id:p.id,revision:cur.revision,expiresAt:null},fresh),'invalid_args','a cross-entity pairing always expires');
 const {review:renew,result:renewed}=await h.page(1,'pairing-update',{id:p.id,revision:cur.revision,expiresAt:h.clock.now()+300*DAY},'signaling.pairing-update',{actor:fresh});
 assert.equal(renew.disclosure.current.expires_at,cur.expires_at);assert.equal(renew.disclosure.next.expires_at,renewed.expires_at);
 // Re-confirmation: a newer, additive version of the kind that adds disclosure (§5.8 "Kind versions").
 assert.equal((await h.run(1,'signaling.pairing',{input:{id:p.id}})).newer,null);
 await h.publish({line:CHAT,parties:'any',properties:{call:{type:'string',maxLength:36,format:'uuid'},where:{type:'string',maxLength:8}},fieldCategories:{call:['personal-data'],where:['location']}});
 const detail=await h.run(1,'signaling.pairing',{actor:h.owner(1),input:{id:p.id}});
 assert.equal(detail.newer.kind.version,2);assert.equal(detail.newer.addsDisclosure,true);assert.deepEqual(detail.peer.handle,'user2');assert.deepEqual(detail.parties,[{client_id:APP,connected:true,approved:true}]);
 const {review:rc,result:reconfirmed}=await h.page(1,'pairing-update',{id:p.id,revision:renewed.revision,kind:CHAT},'signaling.pairing-update',{actor:fresh});
 assert.equal(rc.input.kind.version,2);assert.equal(rc.disclosure.next.addsDisclosure,true);assert.equal(reconfirmed.kind.version,2);
 assert.deepEqual(await h.run(1,'signaling.pairing-remove',{input:{id:p.id}}),{removed:true});
 await rejects(h.run(1,'signaling.pairing',{input:{id:p.id}}),'not_found');
});

test('live offers on the owner pages: listed per app without tokens, revoked one at a time, per app or all, with no review',async()=>{
 const {h}=await host();await approve(h,2,APP,CALLBACK);await approve(h,2,OTHER_APP,CALLBACK);
 const d=h.device(2,{kinds:[CALLBACK]}),e=h.device(2,{clientId:OTHER_APP,kinds:[CALLBACK]});await d.register();await e.register();
 await d.offer(CALLBACK,{principals:[h.principal(1)]});await d.offer(CALLBACK,{uses:3,expires_in:600});await e.offer(CALLBACK,{uses:2});
 let offers=(await h.run(2,'signaling.offers')).offers;
 assert.deepEqual(offers.map(o=>[o.clientId,o.principal?'bound':'anyone',o.uses,o.spent]).sort(),[[APP,'anyone',3,0],[APP,'bound',1,0],[OTHER_APP,'anyone',2,0]].sort());
 assert.ok(offers.every(o=>!('offer' in o)&&!('token' in o)),'never the token');
 assert.deepEqual(await h.run(2,'signaling.revoke-offers',{input:{id:offers.find(o=>o.principal).id}}),{revoked:1});
 assert.deepEqual(await h.run(2,'signaling.revoke-offers',{input:{clientId:APP}}),{revoked:1});
 assert.deepEqual(await h.run(2,'signaling.revoke-offers',{input:{all:true}}),{revoked:1});
 assert.deepEqual((await h.run(2,'signaling.offers')).offers,[]);
});

test('service designation page: only an organization; setting needs a review with the §4.3 disclosure; removing revokes only offers longer than 900 s and says how many',async()=>{
 const {h}=await host({organizations:[3]});
 await rejects(review(h,1,'set-service',{designated:true,revision:0}),'not_found','a person entity cannot be designated');
 await rejects(h.run(3,'signaling.set-service',{input:{designated:true,revision:0}}),'review_required');
 await approve(h,3,APP,CHAT);
 const r=await review(h,3,'set-service',{designated:true,revision:0});
 assert.deepEqual(r.disclosure,{openSeconds:7776000,boundSeconds:604800,personSeconds:900,apps:[{client_id:APP,client_session:null,origin:'https://app.example',kinds:[CHAT]}]});
 await rejects(review(h,3,'set-service',{designated:true,revision:5}),'conflict');
 h.clock.advance(PAGE_REVIEW.dwellMs);assert.deepEqual(await commit(h,3,'signaling.set-service',r.input,r.review),{designated:true,revision:1});
 // Long and short offers of the designated entity's app.
 const d=h.device(3,{kinds:[CHAT]});await d.register();
 await d.offer(CHAT,{uses:100,expires_in:30*86400});await d.offer(CHAT,{principals:[h.principal(1)],expires_in:3*86400});await d.offer(CHAT,{uses:2,expires_in:600});
 assert.deepEqual(await h.run(3,'signaling.service'),{designated:true,eligible:true,revision:1,longOffers:2});
 assert.deepEqual(await h.run(3,'signaling.set-service',{input:{designated:false,revision:1}}),{designated:false,revision:2,revoked:2},'removing is narrowing: no review');
 assert.deepEqual((await h.run(3,'signaling.offers')).offers.map(o=>o.uses),[2],'the 900 s offer stays');
 assert.equal((await h.run(3,'signaling.service')).longOffers,0);
});

test('approval_required carries the provider approval page URL for the refused app and kind (§20.1.4); canonical inputs ignore what the page chooses alongside',async()=>{
 const {h}=await host();const d=h.device(1,{kinds:[CHAT]});
 const refused=await fault(d.register());assert.equal(refused.code,'approval_required');
 const e=await d.register().catch(x=>x);const url=new URL(e.url);
 assert.equal(url.href,approvalPageURL(ISS,APP,CHAT));assert.equal(url.origin,ISS);assert.deepEqual(Object.fromEntries(url.searchParams),{view:'signaling',page:'approve',client:APP,kind:CHAT});
 assert.deepEqual(canonicalInput('pairing-update',{id:'pr_x',revision:2,label:'l',expiresAt:5}),{id:'pr_x',revision:2,expiresAt:5});
 assert.deepEqual(canonicalInput('session-approve',{clientId:APP,kind:{artefact:CHAT,version:1,digest:'d',extra:1},autoConnect:true}),{clientId:APP,kind:{artefact:CHAT,version:1,digest:'d'}});
});

test('reviews bind the disclosed state: a changed service class, approval version or designation app set refuses the decision with review_stale (review L1)',async()=>{
 const {h}=await host({organizations:[3]});
 // Service class: an approval reviewed while the organization is undesignated, committed after designation.
 await approve(h,3,APP,SYNC);
 const r=await review(h,3,'session-approve',{clientId:OTHER_APP,kind:CHAT});assert.equal(r.disclosure.serviceClass,false);
 const s=await review(h,3,'set-service',{designated:true,revision:0});
 assert.deepEqual(s.disclosure.apps.map(a=>a.client_id),[APP],'the designation page lists only the apps approved now');
 h.clock.advance(PAGE_REVIEW.dwellMs);
 await commit(h,3,'signaling.set-service',s.input,s.review);
 await rejects(commit(h,3,'intents.session-approve',r.input,r.review),'review_stale','the approval page did not show the service-class wording');
 assert.deepEqual((await h.run(3,'intents.session-approvals')).approvals.map(a=>a.handler),[APP],'nothing recorded');
 const again=await review(h,3,'session-approve',{clientId:OTHER_APP,kind:CHAT});assert.equal(again.disclosure.serviceClass,true);
 h.clock.advance(PAGE_REVIEW.dwellMs);assert.equal((await commit(h,3,'intents.session-approve',again.input,again.review)).clientId,OTHER_APP,'a fresh review with the service wording commits');

 // Designation app set: an app approved after the designation review is not in its "Apps this applies to now" list.
 assert.deepEqual(await h.run(3,'signaling.set-service',{input:{designated:false,revision:1}}),{designated:false,revision:2,revoked:0});
 const d=await review(h,3,'set-service',{designated:true,revision:2});
 assert.deepEqual(d.disclosure.apps.map(a=>[a.client_id,a.kinds]),[[APP,[SYNC]],[OTHER_APP,[CHAT]]]);
 await approve(h,3,OTHER_APP,REMOTE);
 h.clock.advance(PAGE_REVIEW.dwellMs);
 await rejects(commit(h,3,'signaling.set-service',d.input,d.review),'review_stale','an app or kind line approved since the review');
 assert.equal((await h.run(3,'signaling.service')).designated,false);
 // An unrelated change (none) between review and decision commits.
 const ok=await review(h,3,'set-service',{designated:true,revision:2});h.clock.advance(PAGE_REVIEW.dwellMs);
 assert.deepEqual(await commit(h,3,'signaling.set-service',ok.input,ok.review),{designated:true,revision:3});

 // Auto-connect: the approval version shown on the page is the one turned on.
 await approve(h,1,APP,SYNC);
 const ac=await review(h,1,'session-auto-connect',{clientId:APP,kind:SYNC});assert.equal(ac.disclosure.kind.version,1);
 await h.publish({line:SYNC,parties:'self',profiles:{data:{},webrtc:{}},properties:{where:{type:'string',maxLength:8}},fieldCategories:{where:['location']}});
 await approve(h,1,APP,SYNC);
 assert.equal((await h.run(1,'intents.session-approvals')).approvals.find(a=>a.kind===SYNC).version,2,'re-approved at the newer version');
 h.clock.advance(PAGE_REVIEW.dwellMs);
 await rejects(commit(h,1,'intents.session-auto-connect',ac.input,ac.review),'review_stale','a version the auto-connect page did not show');
 assert.equal((await h.run(1,'intents.session-approvals')).approvals.find(a=>a.kind===SYNC).autoConnect,false);
 const ac2=await review(h,1,'session-auto-connect',{clientId:APP,kind:SYNC});assert.equal(ac2.disclosure.kind.version,2);
 h.clock.advance(PAGE_REVIEW.dwellMs);assert.deepEqual(await commit(h,1,'intents.session-auto-connect',ac2.input,ac2.review),{autoConnect:true});
});
