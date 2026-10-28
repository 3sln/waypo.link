// PORT-2 engine-level tests: identity transfer-out at the source (docs/architecture/identity-portability.md §3.1, §3.3,
// §6.1, §6.1a, §6.3–§6.5; docs/spec/identity-portability.md §5.2, §6). Real identity repository, real attestation key,
// recording fake ports. Seeded chaos interleavings are in tests/transfer-out-chaos.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {transferFixture,keyPair,DAY,HOUR,MINUTE,ISSUER,DEST,REDIRECT,OWNER,TRANSFER_KEY,LOCK_KEY} from './helpers/transfer-out.mjs';
import {verifyMoveAttestation,statementDigest,parseMoveStatement} from '../packages/identity/succession.mjs';
import {TIMING,transferView,transferIdentityPort,transferDueIndex,sweepTransferDue,transferNoticeTemplate,createTransferNotices,attestorFromJwk,COMMIT_STAGES,TRANSFER_OUT_OPERATIONS,transferBlocksDeletion} from '../packages/identity/transfer-out.mjs';
import {operations} from '../packages/app/engine.mjs';
import {lifecycleIdentityPort,movedWindow,retainedMoved,TOMBSTONE_REASONS,deletionReason} from '../packages/identity/lifecycle-tombstone.mjs';
import {DeletionService,REQUEST_KEY,FENCE_KEY} from '../packages/runtime/account-deletion.mjs';
import {purgeBatch,PURGE_PLANS,PURGE_REASONS,PURGE_KEY,TOMBSTONE_KEY} from '../packages/runtime/lifecycle-storage.mjs';

const committedFlow=async(fx,input)=>{await fx.start(input);await fx.post();fx.clock.advance(25*HOUR);return fx.post();};

test('operations register with unique wire names and terms-exempt policies',()=>{
 const registry=operations(...TRANSFER_OUT_OPERATIONS);
 assert.deepEqual(Object.keys(registry).sort(),['transfer.authorize','transfer.authorize-waiting','transfer.begin','transfer.cancel','transfer.dispute','transfer.elevate','transfer.restart-choice','transfer.statement','transfer.status','transfer.step','transfer.support']);
 for(const Operation of TRANSFER_OUT_OPERATIONS)assert.equal(Operation.termsGate,'exempt');
 assert.deepEqual(COMMIT_STAGES,['identity','keys','delegations','connections','grants','due','notice']);
 assert.equal(TIMING.personDelay,24*HOUR);assert.equal(TIMING.freshDelay,72*HOUR);assert.equal(TIMING.holdExpiry,30*DAY);assert.equal(TIMING.credentialAge,7*DAY);assert.equal(TIMING.exportWindow,30*DAY);assert.equal(TIMING.redirect,90*DAY);
});

test('path (a): begin, authorize, notices with per-channel dispute tokens, statement binding and the 24 h delay',async t=>{
 const fx=await transferFixture(t);
 const draft=await fx.begin({redirect:true});assert.equal(draft.state,'draft');
 const view=await fx.authorize({draft:draft.draft});
 assert.equal(view.state,'pending');assert.equal(view.path,'a');assert.match(view.transfer.id,/^[A-Za-z0-9_-]{32}$/);
 const record=await fx.get();assert.equal(record.noticedAt,fx.clock.now());assert.equal(record.delay,24*HOUR);
 // One notice per channel, each with its own dispute token, before any commit.
 const pending=fx.notices.filter(n=>n.kind==='pending');assert.equal(pending.length,2);assert.notEqual(pending[0].disputeToken,pending[1].disputeToken);assert.equal(record.tokens.length,2);
 assert.ok(pending.every(n=>n.destination===DEST));
 const first=await fx.post();assert.equal(first.status,'pending');assert.equal(first.retry_after,86400);
 assert.equal((await fx.get()).statement.redirectBase,REDIRECT);
 fx.clock.advance(23*HOUR);assert.equal((await fx.post()).status,'pending');assert.equal((await fx.identityRecord()).status,'active');
 fx.clock.advance(HOUR);const attested=await fx.post();assert.equal(attested.status,'attested');
 // The attestation is over exactly this statement, under the attestation key (spec §5.3).
 const statement=parseMoveStatement(fx.body.statement),parsed=await verifyMoveAttestation(attested.attestation,{statement,publicJwk:fx.attestation.publicJwk});
 assert.equal(parsed.payload.statement,await statementDigest(statement.input));assert.equal(parsed.payload.iss,ISSUER);assert.equal(parsed.payload.aep,0,'the authority epoch, not security.epoch (3)');assert.deepEqual(parsed.payload.to,{iss:DEST,identity:`${DEST}/identity/${OWNER}`});
 assert.equal(attested.redirect_until,Math.floor((fx.clock.now()+90*DAY)/1000));
 // Idempotent per statement; a different redirect_base or statement is refused.
 assert.deepEqual(await fx.post(),attested);assert.deepEqual(await fx.post({redirect_base:`${DEST}/other/`}),{status:'refused'});
 assert.deepEqual(await fx.post({},undefined,{fresh:true}),{status:'refused'});
});

test('commit effects: identity moved, sessions and recovery ended, keys destroyed, delegations, connections and grants, due rows and a completion notice',async t=>{
 const fx=await transferFixture(t);
 assert.equal((await committedFlow(fx)).status,'attested');
 const account=await fx.identityRecord();
 assert.equal(account.status,'moved');assert.deepEqual(account.sessions,[]);assert.equal(account.recoveryHash,null);assert.equal(account.recoveryIssuedAt,undefined);assert.equal(account.emailLoginEnabled,false);
 // Credentials stay for the read-only export window; the moved record carries the target and proof.
 assert.equal(account.credentials.length,2);assert.equal(account.passwordHash,'hash');
 const record=await fx.get();
 assert.equal(account.moved.statementDigest,record.statement.digest);assert.equal(account.moved.redirectBase,REDIRECT);assert.equal(account.moved.exportUntil,record.committedAt+30*DAY);assert.equal(account.moved.movedUntil,record.committedAt+90*DAY);
 assert.ok(account.audit.some(entry=>entry.type==='identity-moved'));
 assert.deepEqual(Object.keys(record.stages),COMMIT_STAGES);assert.deepEqual(fx.effects,{revoked:1,severed:1,erased:1,purged:0,destroyed:1});
 assert.deepEqual(fx.events.filter(e=>!e.startsWith('notice.')),['keys.destroy','delegations','connections','grants']);
 assert.ok(fx.notices.some(n=>n.kind==='committed'&&!n.disputeToken));
 const due=await fx.ports.due.due({now:Infinity});assert.deepEqual(due.map(row=>row.kind).sort(),['moved-end','moved-probe','tick'],'redirect management adds the 30-day target probe');
 // The owner's own surface shows identity_moved (spec §6.3).
 const status=await fx.status();assert.equal(status.error,'identity_moved');assert.deepEqual(status.moved.to,{iss:DEST,identity:`${DEST}/identity/${OWNER}`});
 // A committed move never attests again and refuses a different statement or a new transfer.
 assert.deepEqual(await fx.post({},undefined,{fresh:true}),{status:'refused'});
 await assert.rejects(fx.begin(),{code:'account_not_active'});
 assert.equal(await transferBlocksDeletion(fx.metadata),true);
});

test('declined redirect: no redirect base, proof kept 30 days',async t=>{
 const fx=await transferFixture(t);
 await fx.start({},{});const record=await fx.get();await fx.metadata.put(TRANSFER_KEY,{...record,redirect:false,revision:record.revision+1});
 await fx.post();fx.clock.advance(25*HOUR);const attested=await fx.post();
 assert.equal(attested.redirect_until,null);const moved=(await fx.identityRecord()).moved;
 assert.equal(moved.redirectBase,null);assert.equal(moved.movedUntil,moved.committedAt+30*DAY);
 assert.equal(movedWindow(moved,fx.clock.now()).live,false);assert.equal(movedWindow(moved,fx.clock.now()).proof,true);
});

test('transfer authority (P14, spec §6.1): superseded, too-new, legacy, resume-only and mismatched credentials, stale step-up and recent security changes are refused',async t=>{
 const cases=[
  ['wrong token',fx=>fx.start({recoveryToken:`${OWNER}.${'w'.repeat(43)}`}),'recovery_invalid'],
  ['other owner token',fx=>fx.start({recoveryToken:`bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.${'r'.repeat(43)}`}),'recovery_invalid'],
  ['credential under 7 days',async fx=>{await fx.patchIdentity(a=>({...a,recoveryIssuedAt:fx.clock.now()-6*DAY}));return fx.start();},'recovery_too_new'],
  ['legacy v1 file',async fx=>{await fx.patchIdentity(a=>({...a,recoveryBackupVersion:1}));return fx.start();},'recovery_invalid'],
  ['no recorded issuance (legacy record)',async fx=>{await fx.patchIdentity(a=>{delete a.recoveryIssuedAt;return a;});return fx.start();},'recovery_invalid'],
  ['resume-only credential',async fx=>{await fx.patchIdentity(a=>({...a,status:'recovering',recoveryResumeHash:a.recoveryHash,recoveryHash:null}));return fx.start();},'account_not_active'],
  ['keychain mismatch (key possession alone)',async fx=>{fx.state.keysMatch=false;return fx.start();},'recovery_invalid'],
  ['no step-up',fx=>fx.begin({},{stepUpAt:undefined}),'step_up_required'],
  ['step-up older than 10 minutes',fx=>fx.begin({},{stepUpAt:fx.clock.now()-10*MINUTE}),'step_up_required'],
  ['security change within 7 days',async fx=>{await fx.bumpSecurity(fx.clock.now()-6*DAY);return fx.start();},'recent_security_change'],
  ['suspended',async fx=>{await fx.patchIdentity(a=>({...a,status:'suspended'}));return fx.start();},'account_not_active'],
  ['admin hold',async fx=>{fx.state.hold={held:true};return fx.start();},'account_held'],
  ['unreadable hold',async fx=>{fx.state.hold=new Error('down');return fx.start();},'account_held'],
  ['organization',async fx=>{await fx.patchIdentity(a=>({...a,kind:'organization'}));return fx.start();},'organization_moves_unavailable'],
  ['deletion scheduled',async fx=>{await fx.metadata.put(REQUEST_KEY,{state:'scheduled'});return fx.start();},'deletion_scheduled'],
  ['own origin',fx=>fx.begin({destination:ISSUER}),'invalid_destination'],
  ['not https',fx=>fx.begin({destination:'http://dest.example'}),'invalid_destination'],
  ['flag off',async fx=>{fx.state.flags.enabled=false;return fx.begin();},'not_found'],
  ['no confirmation',async fx=>{const d=await fx.begin();return fx.authorize({draft:d.draft,confirm:false});},'confirmation_required'],
  ['expired draft',async fx=>{const d=await fx.begin();fx.clock.advance(31*MINUTE);return fx.authorize({draft:d.draft});},'draft_expired'],
 ];
 for(const [name,run,code]of cases){const fx=await transferFixture(t);await assert.rejects(run(fx),{code},name);assert.notEqual((await fx.get())?.state,'pending',name);}
});

test('statements without an authorization create no state; binding refuses other destinations, transfers, redirect bases, kids and stale iat (IP-R1-H3)',async t=>{
 const fx=await transferFixture(t);
 const unbound=await fx.post();assert.equal(unbound.status,'pending');assert.equal(await fx.get(),undefined);
 assert.deepEqual(await fx.statement({statement:'not.a.jws',transfer:null,redirect_base:REDIRECT}),{status:'refused'});
 assert.deepEqual(await fx.statement({statement:await fx.sign(),transfer:null,redirect_base:REDIRECT,extra:1}),{status:'refused'});
 // Signed by a key that is not the identity's current key: refused even without an authorization.
 const thief=await keyPair();assert.deepEqual(await fx.post({},{key:thief.privateKey}),{status:'refused'});
 await fx.start();
 const refusals=[
  [{},{payload:{to:{iss:'https://evil.example',identity:`https://evil.example/identity/${OWNER}`}}}],
  [{transfer:'y'.repeat(32)}],
  [{redirect_base:'https://evil.example/r/'}],
  [{redirect_base:`${DEST}/a/../b/`}],
  [{},{payload:{iat:Math.floor((fx.clock.now()-HOUR)/1000)}}],
  [{},{payload:{seq:2,prev:`sha256-${'a'.repeat(43)}`}}],
  [{},{payload:{from:{iss:ISSUER,identity:`${ISSUER}/identity/other`}}}],
  [{},{kid:'kid-2'}],
 ];
 for(const [extra,options]of refusals)assert.deepEqual(await fx.post(extra,options??{}),{status:'refused'},JSON.stringify(extra)+JSON.stringify(options));
 assert.equal((await fx.get()).statement,null);
 assert.equal((await fx.post({},undefined,{fresh:true})).status,'pending');const bound=(await fx.get()).statement;assert.ok(bound);
 // Once bound, a different statement (another old file posting first or later) is refused. The digest covers the
 // signing input, so a re-signature of identical claims is the same statement; a different `iat` is not.
 fx.clock.advance(1000);assert.deepEqual(await fx.post({},undefined,{fresh:true}),{status:'refused'});assert.equal((await fx.get()).statement.digest,bound.digest);
});

test('a held move never commits by itself at any age and aborts after 30 days; disputes need a known device',async t=>{
 const fx=await transferFixture(t);await fx.start();await fx.post();
 // A device enrolled after the move began cannot dispute.
 await assert.rejects(fx.dispute({choice:'hold'},{kind:'owner',owner:OWNER,sessionId:'new',sessionCreatedAt:fx.clock.now()+1}),{code:'dispute_not_allowed'});
 await assert.rejects(fx.dispute({choice:'hold',token:'z'.repeat(43)}),{code:'invalid_token'});
 const held=await fx.dispute({choice:'hold',token:fx.tokenFor('email')});assert.equal(held.state,'held');
 for(let day=1;day<30;day++){fx.clock.advance(DAY);await fx.step();assert.equal((await fx.post()).status,'pending');assert.equal((await fx.get()).state,'held');}
 assert.equal((await fx.identityRecord()).status,'active');
 fx.clock.advance(DAY);const step=await fx.step();assert.equal(step.action,'aborted');
 const record=await fx.get();assert.equal(record.state,'aborted');assert.equal(record.reason,'hold-expired');assert.deepEqual(record.tokens,[]);
 assert.deepEqual(await fx.post(),{status:'refused'});assert.ok((await fx.lock()).restart);
});

test('a known signed-in device holds; an abort cancels, blocks a restart with the same credential until the owner chooses',async t=>{
 const fx=await transferFixture(t);await fx.start();
 const held=await fx.dispute({choice:'hold'},{kind:'owner',owner:OWNER,sessionId:'s-two',sessionCreatedAt:fx.clock.now()-20*DAY});assert.equal(held.state,'held');
 const aborted=await fx.dispute({choice:'abort',token:fx.tokenFor('push')});assert.equal(aborted.state,'aborted');assert.equal(aborted.recoveryReissueOffered,true);
 await assert.rejects(fx.start(),{code:'restart_blocked'});
 // The requesting session cannot lift its own block; another device known before the move can (F5).
 await assert.rejects(fx.restartChoice('keep'),{code:'restart_choice_not_allowed'});
 assert.deepEqual(await fx.restartChoice('keep',{sessionId:'s-two',sessionCreatedAt:fx.clock.now()-20*DAY,credentialId:'pk-two',credentialCreatedAt:fx.clock.now()-50*DAY}),{restartBlocked:false,recoveryReissueRequired:false});
 assert.equal((await fx.start()).state,'pending');
});

test('owner reissue choice invalidates the presented credential',async t=>{
 const fx=await transferFixture(t);await fx.start();await fx.dispute({choice:'abort',token:fx.tokenFor('email')});
 assert.deepEqual(await fx.restartChoice('reissue'),{restartBlocked:false,recoveryReissueRequired:true});
 const account=await fx.identityRecord();assert.equal(account.recoveryHash,null);assert.equal(account.security.epoch,4);
 await assert.rejects(fx.start(),{code:'recent_security_change'});
});

test('requester withdraws without a restart block; another session cancelling blocks the restart',async t=>{
 const fx=await transferFixture(t);await fx.start();
 assert.equal((await fx.cancel()).state,'cancelled');assert.equal((await fx.lock())?.restart,undefined);
 await fx.start();assert.equal((await fx.cancel(fx.owner({sessionId:'s-two'}))).state,'cancelled');assert.ok((await fx.lock()).restart);
});

test('elevated proof by the disputing side aborts, invalidates the recovery file and opens the 30-day contest window',async t=>{
 const fx=await transferFixture(t);await fx.start();await fx.dispute({choice:'hold',token:fx.tokenFor('email')});
 // P17 records the credential that confirmed the step-up (wargame 2026-10-23), not the one the session signed in with.
 const result=await fx.elevate({side:'disputer'},{credentialId:'pk-signin',stepUpCredentialId:'pk-two',sessionId:'s-two'});
 assert.equal(result.state,'aborted');assert.equal(result.recoveryReissueRequired,true);assert.equal(result.recoveryInvalidated,true);
 assert.equal((await fx.identityRecord()).recoveryHash,null);
 const lock=await fx.lock();assert.equal(lock.elevatedAbort.credentialId,'pk-two');assert.equal(lock.restart,undefined);
 // A move request by another credential within 30 days goes to support.
 await assert.rejects(fx.begin({},{stepUpCredentialId:'pk-old'}),{code:'transfer_contested'});assert.equal((await fx.lock()).contested.reason,'conflicting-request-after-elevated-abort');
 await assert.rejects(fx.begin({},{stepUpCredentialId:'pk-two'}),{code:'transfer_locked'});
});

test('P17 compares the step-up credential: a session signed in with the aborting passkey but stepped up with a password is another credential',async t=>{
 const fx=await transferFixture(t);await fx.start();await fx.dispute({choice:'hold',token:fx.tokenFor('email')});
 await fx.elevate({side:'disputer'},{credentialId:'pk-two',stepUpCredentialId:'pk-two',sessionId:'s-two'});
 await assert.rejects(fx.begin({},{credentialId:'pk-two',stepUpCredentialId:'password',sessionId:'s-three'}),{code:'transfer_contested'});
 assert.equal((await fx.lock()).contested.reason,'conflicting-request-after-elevated-abort');
});

test('elevated proof by the requester removes named devices and emails and restarts a 72 h notified delay; a further dispute is contested',async t=>{
 const fx=await transferFixture(t);await fx.start();await fx.post();
 const emailToken=fx.tokenFor('email'),pushToken=fx.tokenFor('push');
 await fx.dispute({choice:'hold',token:pushToken});
 // The device s-two (signed in with passkey pk-two) and the email dispute as well; only disputers can be named (F1).
 await fx.dispute({choice:'hold'},{kind:'owner',owner:OWNER,sessionId:'s-two',sessionCreatedAt:fx.clock.now()-20*DAY,credentialId:'pk-two',credentialCreatedAt:fx.clock.now()-50*DAY});
 await assert.rejects(fx.elevate({side:'requester',remove:{emails:['owner@mover.example']}}),{code:'not_a_disputer'});
 await fx.dispute({choice:'hold',token:emailToken});
 await assert.rejects(fx.elevate({side:'requester',remove:{sessions:['nope']}}),{code:'unknown_device'});
 await assert.rejects(fx.elevate({side:'requester'}),{code:'invalid_request'});
 const view=await fx.elevate({side:'requester',remove:{sessions:['s-two'],passkeys:['pk-two'],push:['p1'],emails:['owner@mover.example']}});
 assert.equal(view.state,'pending');assert.equal(view.freshDelay,true);
 const account=await fx.identityRecord();
 assert.deepEqual(account.sessions.map(s=>s.id),['s-old']);assert.deepEqual(account.credentials.map(c=>c.id),['pk-old']);assert.equal(account.verifiedEmail,null);assert.equal(account.removedEmails[0].address,'owner@mover.example');
 assert.equal(await fx.metadata.get('push-subscription/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/p1/'),undefined);
 const record=await fx.get();assert.equal(record.delay,72*HOUR);assert.equal(record.securityEpoch,account.security.epoch);assert.equal(record.round,2);
 // The removed push device's token is gone; the detached email is re-notified and can only escalate.
 await assert.rejects(fx.dispute({choice:'abort',token:pushToken}),{code:'invalid_token'});
 assert.ok(fx.notices.some(n=>n.kind==='restarted'&&n.channel.email==='owner@mover.example'));
 // Removing disputers does not cancel the move (unlike other security changes).
 fx.clock.advance(HOUR);await fx.step();assert.equal((await fx.get()).state,'pending');
 fx.clock.advance(70*HOUR);assert.equal((await fx.post()).status,'pending');
 const contested=await fx.dispute({choice:'abort',token:fx.tokenFor('email')});assert.equal(contested.state,'contested');
 assert.equal((await fx.get()).state,'contested');assert.deepEqual(await fx.post(),{status:'refused'});
 await assert.rejects(fx.start(),{code:'transfer_pending'});
 await assert.rejects(emailToken&&fx.dispute({choice:'hold',token:emailToken}),{code:'invalid_token'});
});

test('support decides a contested move: allow needs two operators and a final 24 h notified delay; abort can lock up to 30 days',async t=>{
 const fx=await transferFixture(t);await fx.start();await fx.post();await fx.dispute({choice:'hold',token:fx.tokenFor('push')});
 await fx.elevate({side:'requester',remove:{push:['p1']}});await fx.dispute({choice:'hold',token:fx.tokenFor('email')});
 assert.equal((await fx.get()).state,'contested');
 await assert.rejects(fx.support({decision:'allow',operators:['op-1']}),{code:'second_operator_required'});
 const allowed=await fx.support({decision:'allow',operators:['op-1','op-2']});assert.equal(allowed.state,'pending');assert.equal((await fx.get()).delay,24*HOUR);
 assert.equal((await fx.lock())?.contested,undefined);
 fx.clock.advance(23*HOUR);assert.equal((await fx.post()).status,'pending');fx.clock.advance(2*HOUR);assert.equal((await fx.post()).status,'attested');
 const other=await transferFixture(t);await other.start();await other.dispute({choice:'hold',token:other.tokenFor('push')});await other.elevate({side:'requester',remove:{push:['p1']}});await other.dispute({choice:'hold',token:other.tokenFor('email')});
 await assert.rejects(other.support({decision:'abort',operators:['op-1'],lockDays:31}),{code:'invalid_request'});
 const aborted=await other.support({decision:'abort',operators:['op-1'],lockDays:30});assert.equal(aborted.state,'aborted');
 await assert.rejects(other.begin(),{code:'transfer_locked'});other.clock.advance(30*DAY+1);await other.restartChoice('keep',{sessionId:'s-two',sessionCreatedAt:other.clock.now()-31*DAY,credentialId:'pk-two'});assert.equal((await other.begin()).state,'draft');
});

test('elevated proof on both sides, or a second elevated proof, is contested',async t=>{
 const fx=await transferFixture(t);await fx.start();await fx.dispute({choice:'hold',token:fx.tokenFor('push')});
 await fx.elevate({side:'requester',remove:{push:['p1']}});
 assert.equal((await fx.elevate({side:'disputer'},{credentialId:'pk-two'})).state,'contested');
});

test('a restart with elevated proof overcomes a repeated tier-0 abort, naming the aborting email',async t=>{
 const fx=await transferFixture(t);await fx.start();await fx.dispute({choice:'abort',token:fx.tokenFor('email')});
 await assert.rejects(fx.start(),{code:'restart_blocked'});
 // The restart is itself a security change only after the 7-day lookback check, which it passes here.
 const view=await fx.start({remove:{emails:['owner@mover.example']}});assert.equal(view.state,'pending');assert.equal(view.freshDelay,true);
 const record=await fx.get();assert.equal(record.delay,72*HOUR);assert.equal(record.elevated.restart,true);assert.equal(record.channels.email,null);
 // The detached email can no longer abort: it escalates to support.
 assert.equal((await fx.dispute({choice:'abort',token:fx.tokenFor('email')})).state,'contested');
});

test('path (b): a 7-day waiting period with notices to removed channels; any sign-in cancels; holds resolve only by support or withdrawal',async t=>{
 const fx=await transferFixture(t,{identity:{removedEmails:[{address:'old@mover.example',removedAt:Date.UTC(2026,9,1)}]}});
 const view=await fx.waiting();assert.equal(view.path,'b');assert.equal((await fx.get()).delay,7*DAY);
 assert.ok(fx.notices.some(n=>n.channel.email==='old@mover.example'&&n.disputeToken));
 await fx.post();fx.clock.advance(6*DAY);assert.equal((await fx.post()).status,'pending');
 await fx.dispute({choice:'hold',token:fx.tokenFor('push')});
 await assert.rejects(fx.elevate({side:'requester',remove:{push:['p1']}}),{code:'elevated_proof_unavailable'});
 await assert.rejects(fx.cancel({kind:'credential',owner:OWNER},{recoveryToken:`${OWNER}.${'x'.repeat(43)}`}),{code:'recovery_invalid'});
 assert.equal((await fx.cancel({kind:'credential',owner:OWNER},{recoveryToken:fx.token})).state,'cancelled');
 const signin=await transferFixture(t);await signin.waiting();await signin.post();signin.clock.advance(DAY);
 await signin.patchIdentity(a=>({...a,sessions:[...a.sessions,{id:'s-new',createdAt:signin.clock.now(),expiresAt:signin.clock.now()+DAY,hash:'h3'}]}));
 const step=await signin.step();assert.equal(step.action,'cancelled');assert.equal(step.reason,'sign-in');
 const done=await transferFixture(t);await done.waiting();await done.post();done.clock.advance(7*DAY-MINUTE);assert.equal((await done.post()).status,'pending');done.clock.advance(2*MINUTE);assert.equal((await done.post()).status,'attested');
});

test('path (b) refuses without any notice channel',async t=>{
 const fx=await transferFixture(t,{identity:{verifiedEmail:null,emailVerifiedAt:null},push:false});
 await assert.rejects(fx.waiting(),{code:'notice_channel_required'});
});

test('automatic cancellation: security change, superseded credential, key rotation, expiry without a statement',async t=>{
 const a=await transferFixture(t);await a.start();await a.post();await a.bumpSecurity();a.clock.advance(MINUTE);assert.equal((await a.step()).reason,'security-change');assert.ok((await a.lock()).restart);
 const b=await transferFixture(t);await b.start();await b.patchIdentity(x=>({...x,recoveryHash:'other',recoveryIssuedAt:b.clock.now()}));assert.equal((await b.step()).reason,'credential-superseded');
 const c=await transferFixture(t);await c.start();await c.post();c.state.currentKid='kid-2';assert.equal((await c.step()).reason,'key-rotated');
 const d=await transferFixture(t);await d.start();d.clock.advance(7*DAY);const step=await d.step();assert.equal(step.action,'expired');assert.deepEqual(await d.post(),{status:'refused'});assert.equal((await d.lock())?.restart,undefined);
 // A statement that arrived in time keeps the move alive past the authorization expiry.
 const e=await transferFixture(t);await e.start();e.clock.advance(6*DAY);await e.post();e.clock.advance(2*DAY);await e.step();assert.equal((await e.get()).state,'committed');
});

test('notices: no commit until every channel was tried and one accepted; the delay runs from that moment',async t=>{
 const fx=await transferFixture(t,{accept:false});await fx.start();await fx.post();
 assert.equal((await fx.get()).noticedAt,null);fx.clock.advance(3*DAY);await fx.step();assert.equal((await fx.get()).state,'pending');assert.equal((await fx.identityRecord()).status,'active');
 fx.state.accept=input=>Boolean(input.channel.push);fx.clock.advance(7*HOUR);await fx.step();
 const record=await fx.get();assert.equal(record.noticedAt,fx.clock.now());
 fx.clock.advance(24*HOUR-1);await fx.step();assert.equal((await fx.get()).state,'pending');fx.clock.advance(1);await fx.step();assert.equal((await fx.get()).state,'committed');
});

test('commit holds for an admin hold, a missing attestor and the env kill switch; cancellation still works under the kill switch',async t=>{
 const fx=await transferFixture(t,{attestor:false});await fx.start();await fx.post();fx.clock.advance(25*HOUR);
 assert.equal((await fx.step()).reason,'attestor-unconfigured');
 const held=await transferFixture(t);await held.start();await held.post();held.clock.advance(25*HOUR);held.state.hold={held:true};assert.equal((await held.step()).reason,'admin-hold');held.state.hold={held:false};assert.equal((await held.post()).status,'attested');
 const killed=await transferFixture(t);await killed.start();await killed.post();killed.clock.advance(25*HOUR);killed.state.flags.background=false;
 assert.equal((await killed.step()).action,'killed');assert.equal((await killed.post()).status,'unavailable');
 assert.equal((await killed.cancel()).state,'cancelled');
 // The evaluated flag gates only new transfers: a pending move continues after it is turned off.
 const ramp=await transferFixture(t);await ramp.start();await ramp.post();ramp.state.flags.enabled=false;ramp.clock.advance(25*HOUR);assert.equal((await ramp.post()).status,'attested');
});

test('deletion racing a move (IP-R1-L10): a deletion request cancels a pending move in its own commit; a committed move refuses deletion; a fence beats the commit',async t=>{
 const fx=await transferFixture(t);await fx.start();await fx.post();
 const identity=lifecycleIdentityPort(fx.repository,{clock:fx.clock.now});
 const deletion=new DeletionService({executor:{metadata:fx.metadata,blobs:{},archives:{},config:{}},ports:{identity,security:async()=>({epoch:3,changedAt:null}),hold:async()=>({held:false}),adminAuthority:async()=>({admin:false}),billing:null,notices:null,erasure:{},exports:null,due:null},
  flags:{for:()=>({enabled:()=>true,background:()=>true,global:()=>true})},clock:fx.clock,random:{uuid:()=>crypto.randomUUID(),bytes:n=>crypto.getRandomValues(new Uint8Array(n))}});
 const request=actor=>deletion.request({kind:'owner',owner:OWNER,stepUpAt:fx.clock.now()-1000,...actor},{confirmHandle:'mover.one',acknowledgements:{messages:true,storage:true,names:true},operationId:'op-0123456789abcdef'});
 assert.equal((await request()).state,'scheduled');
 const record=await fx.get();assert.equal(record.state,'cancelled');assert.equal(record.reason,'deletion');
 fx.clock.advance(25*HOUR);assert.deepEqual(await fx.post(),{status:'refused'});assert.equal((await fx.identityRecord()).status,'active');
 // A committed move: the deletion request is refused (the identity is moved, and the account record says so).
 const moved=await transferFixture(t);await committedFlow(moved);
 const deletion2=new DeletionService({executor:{metadata:moved.metadata,blobs:{},archives:{},config:{}},ports:{identity:lifecycleIdentityPort(moved.repository,{clock:moved.clock.now}),security:async()=>({epoch:3,changedAt:null}),hold:async()=>({held:false}),adminAuthority:async()=>({admin:false}),billing:null,notices:null,erasure:{},exports:null,due:null},
  flags:{for:()=>({enabled:()=>true,background:()=>true,global:()=>true})},clock:moved.clock,random:{uuid:()=>crypto.randomUUID(),bytes:n=>crypto.getRandomValues(new Uint8Array(n))}});
 await assert.rejects(deletion2.request({kind:'owner',owner:OWNER,stepUpAt:moved.clock.now()-1000},{confirmHandle:'mover.one',acknowledgements:{messages:true,storage:true,names:true},operationId:'op-0123456789abcdef'}),{code:'account_unavailable'});
 // A deletion fence committed after the move's checks but before its commit transaction wins.
 const raced=await transferFixture(t);await raced.start();await raced.post();raced.clock.advance(25*HOUR);
 const sign=raced.ports.attestor.sign;raced.ports.attestor={kid:'att-1',async sign(payload){const jws=await sign(payload);await raced.metadata.put(FENCE_KEY,{v:1,owner:OWNER});return jws;}};
 assert.equal((await raced.post()).status,'pending');assert.notEqual((await raced.get()).state,'committed');assert.equal((await raced.identityRecord()).status,'active');
 assert.equal((await raced.step()).reason,'deletion');assert.equal((await raced.get()).state,'cancelled');
});

test('crash between phases: an identity stage failure after commit is resumed; the attestation never changes; an attestation signed for a lost commit is never returned',async t=>{
 const fx=await transferFixture(t);await fx.start();await fx.post();fx.clock.advance(25*HOUR);
 const markMoved=fx.ports.identity.markMoved;let fail=2;fx.ports.identity={...fx.ports.identity,async markMoved(...args){if(fail-->0)throw Object.assign(new Error('identity shard down'),{code:'unavailable'});return markMoved(...args);}};
 // No attestation leaves before the identity stopped being active: the destination is told to retry (F2).
 const early=await fx.post();assert.equal(early.status,'pending');assert.equal(early.retry_after,60);
 let record=await fx.get();assert.equal(record.state,'committed');assert.deepEqual(record.stages,{});assert.equal((await fx.identityRecord()).status,'active');
 const signedAttestation=record.attestation;
 // Nothing after the identity stage ran: the keys are still in custody until the identity stops speaking.
 assert.equal(fx.effects.destroyed,0);
 fx.clock.advance(MINUTE);await fx.step();assert.equal((await fx.identityRecord()).status,'active');
 fx.clock.advance(MINUTE);await fx.step();record=await fx.get();assert.deepEqual(Object.keys(record.stages),COMMIT_STAGES);assert.equal((await fx.identityRecord()).status,'moved');
 const first=await fx.post();assert.equal(first.status,'attested');assert.equal(first.attestation,signedAttestation);assert.deepEqual(await fx.post(),first);assert.equal(fx.effects.destroyed,1);
 // Every stage is idempotent: re-running steps repeats nothing.
 fx.clock.advance(MINUTE);await fx.step();assert.equal(fx.effects.destroyed,1);assert.equal(fx.effects.severed,1);
 // A commit transaction that loses its revision race discards the attestation it signed.
 const lost=await transferFixture(t);await lost.start();await lost.post();lost.clock.advance(25*HOUR);
 const sign=lost.ports.attestor.sign;let signed=null;lost.ports.attestor={kid:'att-1',async sign(payload){signed=await sign(payload);const live=await lost.get();await lost.metadata.put(TRANSFER_KEY,{...live,revision:live.revision+1});return signed;}};
 const answer=await lost.post();assert.notEqual(answer.attestation,signed);
 const after=await lost.get();if(after.state==='committed')assert.notEqual(after.attestation,signed);
});

test('export window and purge: steps wait until exportUntil, then run the moved purge until done',async t=>{
 const fx=await transferFixture(t);await committedFlow(fx);fx.state.purgeAfter=2;
 const record=await fx.get();
 fx.clock.advance(29*DAY);assert.equal((await fx.step()).action,'export-window');assert.equal(fx.effects.purged,0);
 fx.clock.set(record.exportUntil);const first=await fx.step();assert.equal(first.action,'purging');assert.equal(first.stop,true);
 const second=await fx.step();assert.equal(second.action,'purged');assert.equal(fx.effects.purged,2);
});

test('moved purge through the shared executor: plan, reason, connections vocabulary and the moved tombstone',async t=>{
 assert.ok(PURGE_REASONS.includes('moved'));assert.ok(TOMBSTONE_REASONS.has('moved'));
 assert.deepEqual(PURGE_PLANS.moved,['billing-stop','identity','grants','drain','vectors','email-bridge','exports','archive','blobs','billing-anonymize','metadata']);
 assert.ok(!PURGE_PLANS.moved.includes('operator-apps')&&!PURGE_PLANS.moved.includes('notice'));
 const fx=await transferFixture(t);await committedFlow(fx);const record=await fx.get();
 const identity=lifecycleIdentityPort(fx.repository,{clock:fx.clock.now});
 assert.deepEqual(await identity.get(OWNER).then(v=>({status:v.status,moved:v.moved})),{status:'moved',moved:true});
 const severed=[],blobs={async delete(){},async get(){return null;}},archives={async delete(){},async get(){return null;}};
 const executor={metadata:fx.metadata,blobs,archives,config:{},async connectionsSeverAccount(owner,{reason}){severed.push(reason);}};
 const stage=async()=>({done:true});
 fx.clock.set(record.exportUntil);
 let batch;for(let i=0;i<20;i++){batch=await purgeBatch(executor,OWNER,{identity,fence:async()=>true,reason:'moved',basis:'moved',requestedAt:record.committedAt,clock:fx.clock.now,stages:{billingStop:stage,eraseGrants:stage,drain:stage,eraseEmailBridge:stage,exportsCancel:stage,billingAnonymize:stage}});if(batch.done)break;}
 assert.equal(batch.done,true);assert.deepEqual(severed,['system']);
 const tombstone=await fx.metadata.get(TOMBSTONE_KEY);assert.equal(tombstone.reason,'moved');assert.equal(tombstone.basis,'moved');
 // The identity keeps status `moved` and its record while the redirect runs; credentials, email and keys are gone.
 const account=await fx.identityRecord();
 assert.equal(account.status,'moved');assert.deepEqual(account.credentials,[]);assert.equal(account.passwordHash,null);assert.equal(account.verifiedEmail,undefined);assert.equal(await fx.idDb.get('email/owner@mover.example'),undefined);
 assert.equal(account.moved.redirectBase,REDIRECT);assert.ok(Number.isSafeInteger(account.movedPurgedAt));assert.equal(deletionReason(account),'moved');
 // Idempotent, and never with another reason.
 assert.equal(await identity.tombstone(OWNER,{reason:'moved'}),true);await assert.rejects(identity.tombstone(OWNER,{reason:'owner'}),{code:'lifecycle_identity_conflict'});
 // After movedUntil the scheduler ends it: exactly a deleted identity, nothing naming the new address.
 const port=transferIdentityPort(fx.repository,{clock:fx.clock.now});
 assert.deepEqual(await port.endMoved(OWNER),{ok:true,ended:false,nextAt:account.moved.redirectUntil});
 fx.clock.set(account.moved.movedUntil);const due=transferDueIndex(fx.dueDb);
 assert.deepEqual(await sweepTransferDue({index:due,identity:port,accounts:{get:()=>({invoke:async()=>({$fault:{code:'account_deleted'}})})},now:fx.clock.now()}),{done:2,failed:1},'the target-probe row waits without a reminders port');
 const ended=await fx.identityRecord();assert.equal(ended.status,'deleted');assert.equal(ended.moved,undefined);assert.equal(ended.movedSettlement.endedAt,account.moved.redirectUntil,'review M2: the address-free settlement marker stays in the purged tombstone');assert.ok(!JSON.stringify(ended).includes('dest.example'));
 assert.deepEqual((await due.due({now:Infinity})).map(row=>row.kind).sort(),['moved-end','moved-probe'],'the marker keeps its moved-end row (pruned after 400 days); the probe row waits for a port');
});

test('moved tombstone retention and windows are pure',()=>{
 const moved={v:1,to:{iss:DEST,identity:`${DEST}/identity/${OWNER}`},redirectBase:REDIRECT,statement:'s',attestation:'a',committedAt:0,redirectUntil:90*DAY,movedUntil:90*DAY,exportUntil:30*DAY,reminderEmail:'x@y.example'};
 assert.deepEqual(movedWindow(moved,DAY),{live:true,proof:true,nextAt:90*DAY});assert.deepEqual(movedWindow(moved,90*DAY),{live:false,proof:false,nextAt:null});
 assert.equal(retainedMoved(moved,90*DAY),null);assert.equal(retainedMoved(moved,DAY).reminderEmail,'x@y.example');
 const declined={...moved,redirectBase:null,redirectUntil:null,movedUntil:30*DAY};assert.deepEqual(movedWindow(declined,DAY),{live:false,proof:true,nextAt:30*DAY});
});

test('identity port: verifyRecovery never consumes, refuses other owners and wrong tokens alike; markMoved is idempotent per statement',async t=>{
 const fx=await transferFixture(t);const port=fx.ports.identity;
 const ok=await port.verifyRecovery(OWNER,fx.token);assert.equal(ok.version,3);assert.equal(await port.verifyRecovery(OWNER,fx.token).then(v=>v.ref),ok.ref);
 for(const bad of [null,'x',`${OWNER}.short`,`bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.${'r'.repeat(43)}`,`${OWNER}.${'q'.repeat(43)}`])assert.equal(await port.verifyRecovery(OWNER,bad),null);
 const current=await port.get(OWNER),expect={securityEpoch:current.security.epoch,recoveryRef:current.recovery.ref,recoveryIssuedAt:current.recovery.issuedAt};
 await assert.rejects(port.markMoved(OWNER,{moved:{v:1,statementDigest:'sha256-x'}}),TypeError);
 // The expected epoch and credential are re-checked in the identity's own write (F2).
 assert.deepEqual(await port.markMoved(OWNER,{moved:{v:1,statementDigest:'sha256-x'},expect:{...expect,securityEpoch:expect.securityEpoch+1}}),{ok:false,status:'security-change'});
 assert.deepEqual(await port.markMoved(OWNER,{moved:{v:1,statementDigest:'sha256-x'},expect:{...expect,recoveryRef:'other'}}),{ok:false,status:'credential-superseded'});
 const moved={v:1,statementDigest:'sha256-x',exportUntil:1};assert.equal((await port.markMoved(OWNER,{moved,expect})).ok,true);assert.equal((await port.markMoved(OWNER,{moved,expect})).ok,true);
 assert.equal((await port.markMoved(OWNER,{moved:{...moved,statementDigest:'sha256-y'},expect})).ok,false);
 assert.equal(await port.verifyRecovery(OWNER,fx.token),null);
});

test('notices: template carries the dispute link in a fragment; delivery records acceptance only',async()=>{
 const notice={owner:OWNER,kind:'pending',destination:DEST,notBefore:Date.UTC(2026,9,23,12),delayHours:24,disputeToken:'t'.repeat(43)};
 const template=transferNoticeTemplate(notice,{origin:ISSUER});
 assert.match(template.text,/dest\.example/);assert.ok(template.text.includes(`${ISSUER}/account/transfer-out/dispute#owner=${OWNER}&token=${'t'.repeat(43)}`));assert.equal(template.push.path.includes('?'),false);
 assert.throws(()=>transferNoticeTemplate({...notice,disputeToken:'bad'},{origin:ISSUER}));assert.throws(()=>transferNoticeTemplate({...notice,destination:'javascript:x'},{origin:ISSUER}));
 const sent=[];const notices=createTransferNotices({origin:ISSUER,mail:{sendTransferNotice:async input=>{sent.push(input);return {messageId:'m1'};}},push:{send:async()=>({accepted:false})}});
 assert.deepEqual(await notices.deliver({...notice,channel:{email:'a@b.example'}}),{accepted:true});assert.equal(sent[0].email,'a@b.example');
 assert.deepEqual(await notices.deliver({...notice,channel:{push:{endpoint:'x'}}}),{accepted:false});
 assert.deepEqual(await createTransferNotices({origin:ISSUER}).deliver({...notice,channel:{email:'a@b.example'}}),{accepted:false});
 assert.equal(attestorFromJwk('{bad'),null);assert.equal(attestorFromJwk({kid:'k',jwk:{kty:'EC',crv:'P-256'}}),null);
});

test('views: transfer id only while pending without a statement; terminal reasons; none',()=>{
 assert.deepEqual(transferView(undefined),{state:'none'});
 const view=transferView({state:'cancelled',path:'a',destination:DEST,createdAt:1,delay:1,noticedAt:null,transfer:{id:'i',exp:1},statement:null,expiresAt:5,reason:'withdrawn',endedAt:2,disputes:[]});
 assert.equal(view.transfer,undefined);assert.equal(view.reason,'withdrawn');
});

test('privacy: the copied channel snapshot is dropped when a transfer ends or after the completion notice',async t=>{
 const fx=await transferFixture(t);await fx.start();assert.ok((await fx.get()).channels.email);
 await fx.cancel();const ended=await fx.get();assert.equal(ended.channels,null);assert.deepEqual(ended.notices,{});
 const moved=await transferFixture(t);await committedFlow(moved);assert.equal((await moved.get()).channels,null);
});

test('a path (b) request inside the 30-day window after an elevated abort is contested',async t=>{
 const fx=await transferFixture(t);await fx.start();
 const {recoveryHash:hash,recoveryIssuedAt:issuedAt,recoveryFileId:fileId}=await fx.identityRecord();
 await fx.elevate({side:'disputer'},{credentialId:'pk-two'});
 // Garbage credentials never reach the contest (F4); the current credential does.
 await assert.rejects(fx.waiting({recoveryToken:'garbage'}),{code:'recovery_invalid'});assert.equal((await fx.lock()).contested,undefined);
 await fx.patchIdentity(a=>({...a,recoveryHash:hash,recoveryIssuedAt:issuedAt,recoveryFileId:fileId,recoveryBackupVersion:3}));
 await assert.rejects(fx.waiting(),{code:'transfer_contested'});assert.equal((await fx.lock()).contested.reason,'conflicting-request-after-elevated-abort');
});

test('review: the move attestation carries the authority epoch (aep), not security.epoch',async t=>{
 const fx=await transferFixture(t,{identity:{aep:7}});
 const draft=await fx.begin({redirect:true});await fx.authorize({draft:draft.draft});await fx.post();fx.clock.advance(24*HOUR);
 const attested=await fx.post();assert.equal(attested.status,'attested');
 const statement=parseMoveStatement(fx.body.statement),parsed=await verifyMoveAttestation(attested.attestation,{statement,publicJwk:fx.attestation.publicJwk});
 assert.equal(parsed.payload.aep,7);assert.equal((await fx.get()).aep,7);
});
