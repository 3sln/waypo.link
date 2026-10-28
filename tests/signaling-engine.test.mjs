// Signaling rev 3.2 engine tests (docs/spec/extensions/signaling.md §5, §8, §10, §13, §14, §21.1): every call is a
// dispatched ngin Action or Query over the loopback host (tests/helpers/signaling-fixture.mjs). Local behaviour only;
// provisional and unsigned (Appendix C.5 step 1 outstanding).
import test from 'node:test';
import assert from 'node:assert/strict';
import {signJws,MESSAGE_TYP} from '../packages/signaling/jws.mjs';
import {signalingHost,standardKinds,payloadOf,keyPair,fault,rejects,relay,host as mdnsHost,rawHost,APP,OTHER_APP,SYNC,CHAT,CALLBACK,REMOTE,PEER,subOf} from './helpers/signaling-fixture.mjs';

async function setup(options={}){const h=await signalingHost(options);await standardKinds(h);return h;}
const invitesOf=d=>d.events.filter(e=>e.type==='invite');

test('§10.1, §20.1.4: register, open and offer need a session handler approval; approval_required otherwise',async()=>{
 const h=await setup();const d=h.device(1,{kinds:[CHAT]});
 await rejects(d.register(),'approval_required','register');
 await h.approve(1,APP,CHAT);await d.register();
 await rejects(d.open(h.principal(1),SYNC),'approval_required','open of an unapproved kind');
 await rejects(d.offer(CALLBACK,{principals:[h.principal(2)]}),'approval_required','offer');
 // The approval is checked live: removing it makes the next widening call fail (and narrows at once, §14.2).
 const r=await h.unapprove(1,APP,CHAT);assert.equal(r.removed,true);
 await rejects(d.register(),'approval_required','after removal');
});

test('§5.4 cases 1 and 2, §5.5: own-entity invites reach only the initiating app; auto-connect needs the same app and a self kind',async()=>{
 const h=await setup();
 for(const c of [APP,OTHER_APP])await h.approve(1,c,SYNC,{autoConnect:true});
 const a=h.device(1,{kinds:[SYNC]}),b=h.device(1,{kinds:[SYNC]}),other=h.device(1,{clientId:OTHER_APP,kinds:[SYNC]});
 await a.register();await b.register();await other.register();
 const s=await a.open(h.principal(1),SYNC,{profile:'data'});await a.invite(s);await h.pump();
 await b.listen();await other.listen();await a.listen();
 assert.equal(invitesOf(b).length,1,'the same app');assert.equal(invitesOf(other).length,0,'never another app (no cross-app visibility)');assert.equal(invitesOf(a).length,0,'never the initiating endpoint');
 const p=invitesOf(b)[0].projection;assert.equal(p.basis,'self');assert.equal(p.auto_connect,true);assert.equal(p.offer_match,false);assert.equal(p.paired,false);
 assert.equal(p.kind.artefact,SYNC);assert.equal(p.profile,'data');assert.deepEqual(p.params,{});
 // Accept, connect, exchange data both ways (post-claim only), end.
 const r=await b.claim(s.sid);await b.accept(r,{});await h.pump();await a.listen();
 const acc=a.events.find(e=>e.type==='message');assert.equal(payloadOf(acc.message).type,'accept');
 await a.data(s,32);await h.pump();await b.listen();assert.ok(b.events.some(e=>e.type==='message'&&payloadOf(e.message).type==='data'));
 await b.end(r);await h.pump();await a.listen();
 assert.ok(a.events.some(e=>e.type==='message'&&payloadOf(e.message).type==='end'));
 // A target of another, unpaired app is refused (§5.4).
 await rejects(a.open(h.principal(1),SYNC,{profile:'data',target:other.endpoint}),'invalid_args','target of an unpaired app');
});

test('§5.1, §5.2: a cross-entity open needs a basis; a cross-entity invite without one admits nothing and records nothing',async()=>{
 const h=await setup();await h.approve(1,APP,CHAT);await h.approve(2,APP,CHAT);
 const a=h.device(1),b=h.device(2);await a.register();await b.register();
 await rejects(a.open(h.principal(2),CHAT),'invalid_args','no basis');
});

test('§5.7 bound offers: single use spent at admission, routed to the minting endpoint, offer_match only there; wrong principal admits nothing',async()=>{
 const h=await setup();for(const n of [1,2,3])await h.approve(n,APP,CALLBACK);
 const minter=h.device(1,{kinds:[CALLBACK]}),sibling=h.device(1,{kinds:[CALLBACK]}),holder=h.device(2,{kinds:[CALLBACK]}),thief=h.device(3,{kinds:[CALLBACK]});
 for(const d of [minter,sibling,holder,thief])await d.register();
 const {offers}=await minter.offer(CALLBACK,{principals:[h.principal(2)]});const token=offers[0].offer;
 assert.equal(offers[0].principal.sub,subOf(2));
 // Another reader of the app message (principal 3) dials back with the bound token: nothing, uniformly.
 const t=await thief.open(h.principal(1),CALLBACK,{basis:{offer:token}});await thief.invite(t);await h.pump();
 await minter.listen();await sibling.listen();assert.equal(invitesOf(minter).length,0);
 const o1=(await h.run(1,'signaling.offers')).offers[0];assert.equal(o1.spent,0,'the wrong principal reserves nothing');
 // The bound principal dials back: admitted, spent, routed to the minting endpoint only.
 const s=await holder.open(h.principal(1),CALLBACK,{basis:{offer:token}});await holder.invite(s);await h.pump();
 await minter.listen();await sibling.listen();
 assert.equal(invitesOf(minter).length,1);assert.equal(invitesOf(sibling).length,0,'the minting endpoint, not the app');
 const p=invitesOf(minter)[0].projection;assert.equal(p.basis,'offer');assert.equal(p.offer_match,true);
 assert.ok(!JSON.stringify(invitesOf(minter)[0]).includes(token),'the token is never in a listen event');
 assert.equal((await h.run(1,'signaling.offers')).offers[0].spent,1);
 // A second dial-back (after a decline) admits nothing: a bound offer is single-use.
 const r=await minter.claim(s.sid,'decline');await minter.decline(r);await h.pump();
 const s2=await holder.open(h.principal(1),CALLBACK,{basis:{offer:token}});await holder.invite(s2);await h.pump();await minter.listen();
 assert.equal(invitesOf(minter).length,1);
 // uses other than 1 with principals is refused.
 await rejects(minter.offer(CALLBACK,{principals:[h.principal(2)],uses:2}),'invalid_args','bound uses');
 await rejects(minter.offer(CALLBACK,{principals:[h.principal(1)]}),'invalid_args','own principal');
 await rejects(minter.offer(CALLBACK,{expires_in:901}),'invalid_args','person expiry cap');
});

test('§5.2, §5.7 open offers: reserve at admission, spend on accept, release on decline or unclaimed end',async()=>{
 const h=await setup({entities:4});for(const n of [1,2,3,4])await h.approve(n,APP,CALLBACK);
 const minter=h.device(1,{kinds:[CALLBACK]});await minter.register();
 const {offers}=await minter.offer(CALLBACK,{uses:1});const token=offers[0].offer;assert.equal(offers[0].principal,null);
 const dial=async n=>{const d=h.device(n,{kinds:[CALLBACK]});await d.register();const s=await d.open(h.principal(1),CALLBACK,{basis:{offer:token}});await d.invite(s);await h.pump();return {d,s};};
 const x=await dial(2);await minter.listen();assert.equal(invitesOf(minter).length,1);
 let o=(await h.run(1,'signaling.offers')).offers[0];assert.equal(o.reserved,1);assert.equal(o.spent,0);
 // While reserved, another holder admits nothing (uses = 1).
 await dial(3);await minter.listen();assert.equal(invitesOf(minter).length,1);
 // A decline releases the use; the next holder is admitted.
 const r=await minter.claim(x.s.sid,'decline');await minter.decline(r);await h.pump();
 o=(await h.run(1,'signaling.offers')).offers[0];assert.equal(o.reserved,0);assert.equal(o.spent,0);
 const y=await dial(4);await minter.listen();assert.equal(invitesOf(minter).length,2);
 await minter.claim(y.s.sid,'accept');
 o=(await h.run(1,'signaling.offers')).offers[0];assert.equal(o.spent,1);assert.equal(o.reserved,0);
});

test('§5.7: revoking an offer ends the pending sessions it admitted, silently; a later claim fails with claimed',async()=>{
 const h=await setup();for(const n of [1,2])await h.approve(n,APP,CALLBACK);
 const minter=h.device(1,{kinds:[CALLBACK]}),holder=h.device(2,{kinds:[CALLBACK]});await minter.register();await holder.register();
 const {offers}=await minter.offer(CALLBACK,{principals:[h.principal(2)]});
 const s=await holder.open(h.principal(1),CALLBACK,{basis:{offer:offers[0].offer}});await holder.invite(s);await h.pump();await minter.listen();
 const before=h.log.batches.length;
 await minter.revokeOffer([offers[0].offer]);await h.pump();
 assert.equal(h.log.batches.length,before,'nothing goes to the initiator');
 await rejects(minter.claim(s.sid),'claimed','claim after offer end');
});

test('§5.8 own-entity pairing: pending until activated, then routes, auto-connects and is paired; opens is enforced',async()=>{
 const h=await setup();for(const c of [APP,OTHER_APP])await h.approve(1,c,REMOTE);
 const daemon=h.device(1,{clientId:OTHER_APP,kinds:[REMOTE],clientSession:'cs-1',deviceLabel:'Office daemon'}),web=h.device(1,{kinds:[REMOTE]});
 await daemon.register();await web.register();
 const pairing=await h.run(1,'signaling.pairing-create',{input:{kind:h.ref(REMOTE),local:{client_id:OTHER_APP,client_session:'cs-1'},peer:{self:{client_id:APP,client_session:null}},opens:'peer',label:'Daemon'}});
 assert.equal(pairing.state,'pending');
 await rejects(web.open(h.principal(1),REMOTE,{target:daemon.endpoint}),'invalid_args','pending pairing covers nothing');
 const live=await h.run(1,'signaling.pairing-activate',{input:{id:pairing.id,revision:pairing.revision}});assert.equal(live.state,'live');
 // The web app learns its pairings and, as the opening side, the daemon endpoint (with the provider's own label).
 const ep=await web.run('signaling.endpoints',{...web.auth(),pairing:pairing.id});
 assert.ok(ep.pairings.some(p=>p.id===pairing.id&&p.side==='peer'));assert.ok(ep.endpoints.some(e=>e.endpoint===daemon.endpoint&&e.label==='Office daemon'&&e.last_seen===undefined));
 const dEp=await daemon.run('signaling.endpoints',{...daemon.auth(),pairing:pairing.id});assert.equal(dEp.endpoints.filter(e=>e.client_id).length,0,'the answering side gets nothing extra');
 const s=await web.open(h.principal(1),REMOTE,{target:daemon.endpoint});await web.invite(s);await h.pump();await daemon.listen();
 const inv=invitesOf(daemon)[0];assert.equal(inv.projection.basis,'pairing');assert.equal(inv.projection.paired,true);assert.equal(inv.projection.auto_connect,true);
 // opens: 'peer' means the daemon (local side) may not open to the web app.
 await rejects(daemon.open(h.principal(1),REMOTE,{target:web.endpoint}),'invalid_args','local side may not open');
 // Another client session of the daemon app is not covered.
 const other=h.device(1,{clientId:OTHER_APP,kinds:[REMOTE],clientSession:'cs-2'});await other.register();
 await rejects(web.open(h.principal(1),REMOTE,{target:other.endpoint}),'invalid_args','unbound session');
 // Removing the approval of either party deletes the pairing (clearing never parks it as pending).
 await h.unapprove(1,APP,REMOTE);assert.equal((await h.run(1,'signaling.pairings')).pairings.length,0);
});

test('§5.8 cross-entity pairing: the relation basis admits only under the recipient record, with one pairing per (peer, kind)',async()=>{
 const h=await setup();for(const n of [1,2])await h.approve(n,APP,PEER);
 const a=h.device(1,{kinds:[PEER]}),b=h.device(2,{kinds:[PEER]});await a.register();await b.register();
 // No pairing on either side: the initiator's own open is refused.
 await rejects(a.open(h.principal(2),PEER,{basis:{relation:'pairing'}}),'invalid_args','no initiator pairing');
 const fresh=n=>h.owner(n,{freshAuth:true});
 await rejects(h.run(1,'signaling.pairing-create',{input:{kind:h.ref(PEER),local:{client_id:APP,client_session:null},peer:{principal:h.principal(2)},opens:'local',label:'B'}}),'reauthentication_required','fresh auth');
 const pa=await h.run(1,'signaling.pairing-create',{actor:fresh(1),input:{kind:h.ref(PEER),local:{client_id:APP,client_session:null},peer:{principal:h.principal(2)},opens:'local',label:'B',activate:true}});
 assert.equal(pa.state,'live');assert.ok(pa.expires_at>h.clock.now(),'a cross-entity pairing always expires');
 await rejects(h.run(1,'signaling.pairing-create',{actor:fresh(1),input:{kind:h.ref(PEER),local:{client_id:OTHER_APP,client_session:null},peer:{principal:h.principal(2)},opens:'both',label:'B2'}}),'pairing_exists','one per (peer, kind)');
 // Only the initiator's record: the recipient admits nothing (uniform), and records nothing.
 const s=await a.open(h.principal(2),PEER,{basis:{relation:'pairing'}});await a.invite(s);await h.pump();await b.listen();assert.equal(invitesOf(b).length,0);
 assert.equal((await h.rows(2,'sig/in/')).length,0);
 // The recipient's own record with opens 'peer' admits it, routed to covered endpoints, paired.
 await h.run(2,'signaling.pairing-create',{actor:fresh(2),input:{kind:h.ref(PEER),local:{client_id:APP,client_session:null},peer:{principal:h.principal(1)},opens:'peer',label:'A',activate:true}});
 const s2=await a.open(h.principal(2),PEER,{basis:{relation:'pairing'}});await a.invite(s2);await h.pump();await b.listen();
 assert.equal(invitesOf(b).length,1);assert.equal(invitesOf(b)[0].projection.paired,true);assert.equal(invitesOf(b)[0].projection.basis,'pairing');
 // A principal block deletes the pairing and its pending invites end silently.
 await h.run(2,'signaling.block',{input:{principal:h.principal(1)}});assert.equal((await h.run(2,'signaling.pairings')).pairings.length,0);
});

test('§3.4, §5.1, §9.2 step 7: the kind\'s bases are enforced by open, offer and the recipient',async()=>{
 const h=await setup();for(const n of [1,2]){await h.approve(n,APP,CALLBACK);await h.approve(n,APP,REMOTE);await h.approve(n,APP,PEER);}
 const a=h.device(1,{kinds:[CALLBACK,REMOTE,PEER]});await a.register();
 await rejects(a.offer(REMOTE,{principals:[h.principal(2)]}),'invalid_args','REMOTE does not allow offers');
 await rejects(a.offer(PEER,{principals:[h.principal(2)]}),'invalid_args','PEER is pairing only');
 await rejects(a.open(h.principal(1),CALLBACK),'invalid_args','CALLBACK is offer only (and other parties)');
});

test('§3.5, §13.1: data only in data sessions, after the claim, 4 KiB per message and 64 KiB per leg',async()=>{
 const h=await setup();for(const c of [APP])await h.approve(1,c,SYNC);
 const a=h.device(1,{kinds:[SYNC]}),b=h.device(1,{kinds:[SYNC]});await a.register();await b.register();
 const s=await a.open(h.principal(1),SYNC,{profile:'data'});await a.invite(s);
 await rejects(a.send(s,[await a.sign(s,'data',{payload:Buffer.alloc(8).toString('base64url')},{to:s.leg.jkt})]),'invalid_args','data before the claim');s.seq--;
 await h.pump();await b.listen();const r=await b.claim(s.sid);await b.accept(r,{});await h.pump();await a.listen();
 // Signed without the client-side validator: the provider refuses an over-4 KiB payload itself.
 const big={bindle:'signaling-message',v:1,iss:h.ISS,sub:subOf(1),aud:s.aud,sid:s.sid,leg:s.leg.jkt,to:s.peerLeg,seq:s.seq,iat:Math.floor(h.clock.now()/1000),type:'data',body:{payload:Buffer.alloc(4097,1).toString('base64url')}};
 await rejects(a.send(s,[await signJws({typ:MESSAGE_TYP,kid:s.leg.jkt,claims:big,privateKey:s.leg.privateKey})]),'invalid_args','over 4 KiB');
 for(let i=0;i<16;i++)await a.data(s,4096);
 await rejects(a.data(s,1),'invalid_args','over 64 KiB per leg');
 // A webrtc session carries no data message.
 const w=await a.open(h.principal(1),SYNC,{profile:'webrtc'});await a.invite(w);await h.pump();await b.listen();const rw=await b.claim(w.sid);await b.accept(rw);await h.pump();await a.listen();
 await rejects(a.data(w,8),'invalid_args','data in a webrtc session');
});

test('§13.1: own-entity open calls take the own-device window, not the open window',async()=>{
 const h=await setup();await h.approve(1,APP,SYNC);const a=h.device(1,{kinds:[SYNC]});await a.register();
 for(let i=0;i<70;i++){const s=await a.open(h.principal(1),SYNC,{profile:'data'});await a.invite(s);await a.cancel(s);if(i%8===7)await h.pump();}
 // 70 > the 60/h open window: none was refused.
});

test('§14.2: removing an approval ends the app\'s sessions, endpoints, offers and pending invites delivered only to it, silently',async()=>{
 const h=await setup();for(const n of [1,2])await h.approve(n,APP,CALLBACK);
 const minter=h.device(1,{kinds:[CALLBACK]}),holder=h.device(2,{kinds:[CALLBACK]});await minter.register();await holder.register();
 const {offers}=await minter.offer(CALLBACK,{principals:[h.principal(2)]});
 const s=await holder.open(h.principal(1),CALLBACK,{basis:{offer:offers[0].offer}});await holder.invite(s);await h.pump();await minter.listen();
 const before=h.log.batches.length;
 await h.unapprove(1,APP,CALLBACK);await h.pump();
 assert.equal(h.log.batches.length,before,'silent towards the initiator');
 assert.equal((await h.run(1,'signaling.offers')).offers.length,0,'offers revoked');
 assert.equal((await h.run(1,'signaling.endpoint-list')).endpoints.length,0,'endpoint registration removed');
});

test('§13.2: blocks are silent, own principal and own issuer cannot be blocked',async()=>{
 const h=await setup();
 await rejects(h.run(1,'signaling.block',{input:{principal:h.principal(1)}}),'invalid_args','own principal');
 await rejects(h.run(1,'signaling.block',{input:{issuer:h.ISS}}),'invalid_args','own issuer');
 assert.deepEqual(await h.run(1,'signaling.block',{input:{issuer:'https://spam.example'}}),{blocked:true});
 const b=await h.run(1,'signaling.blocked');assert.equal(b.issuers.length,1);
 const e=await h.run(1,'signaling.export');assert.equal(e.blockedIssuers.length,1,'provider blocks are exported (the rtc/block-iss/ gap closed)');
});

test('§14.1: IP policy updates are compare-and-swap; widening needs signaling on',async()=>{
 const h=await setup();
 const p=await h.run(1,'signaling.policy');assert.equal(p.other,'relay');assert.equal(p.self,'all');
 const next=await h.run(1,'signaling.set-policy',{input:{revision:p.revision,other:'public'}});assert.equal(next.revision,p.revision+1);
 await rejects(h.run(1,'signaling.set-policy',{input:{revision:p.revision,other:'relay'}}),'conflict','stale revision');
 h.flags.deny(subOf(1),'SIGNALING_ENABLED');
 await rejects(h.run(1,'signaling.set-policy',{input:{revision:next.revision,self:'all'}}).then(()=>h.run(1,'signaling.set-policy',{input:{revision:next.revision,other:'public'}})),'conflict');
 const narrowed=await h.run(1,'signaling.set-policy',{input:{revision:(await h.run(1,'signaling.policy')).revision,other:'relay'}});assert.equal(narrowed.other,'relay','narrowing is never gated');
});
