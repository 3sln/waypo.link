// RTC-a: leg certificates and control statements (docs/spec/rtc-signaling.md §5; AMD-R1 typ separation).
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLegCertificate,verifyLegCertificate,signLegCertificate,renewalPreserves,parseControl,verifyControl,signControl,verifyKeyStatus,certificationKey,directoryCertificationKeys,maxLegSecondsValid,LEG_CERTIFICATE_SECONDS} from '../packages/rtc/certificates.mjs';
import {parseMessage} from '../packages/rtc/messages.mjs';
import {validateRtcFeature,RTC_SIGNALING_FRAGMENT_DOCUMENT,ICE_RELAY_FRAGMENT_DOCUMENT} from '../packages/rtc/extension.mjs';
import {fragmentOutcome} from '../packages/core/fragments.mjs';
import {parseEntityCertificate,signEntityCertificate} from '../packages/identity/entity-certificates.mjs';
import {parseMemberCertificate} from '../packages/identity/member-certificates.mjs';
import {signRtcJws,RTC_LEG_CERTIFICATE_TYP,RTC_CONTROL_TYP,RTC_MESSAGE_TYP} from '../packages/rtc/jws.mjs';
import {forEachSeed} from './helpers/chaos.mjs';
import {party,payload,sign,now,ALICE,BOB,SID,SID2,CALL,keyPair,identityOf} from './helpers/rtc-wire-fixture.mjs';

const code=c=>({code:c});
const caller=await party(ALICE,{role:'caller',peer:BOB});
const opts=(p,extra={})=>({keys:p.keys,expected:{aud:p.aud,sid:p.sid,role:p.role},identity:p.identity,now,...extra});
const claimsOf=p=>parseLegCertificate(p.certificate).payload;
const resign=async(p,edit,{typ=RTC_LEG_CERTIFICATE_TYP,kid='cert-1',key=p.certification.privateKey}={})=>{const claims=structuredClone(claimsOf(p));edit(claims);return signRtcJws({typ,kid,claims,privateKey:key});};

test('a leg certificate signs, parses and verifies; 3sln.me issues 600 s; renewals keep sid, role and cnf',async()=>{
 const p=claimsOf(caller);assert.equal(p.exp-p.iat,LEG_CERTIFICATE_SECONDS);assert.equal(p.role,'caller');assert.deepEqual(p.purpose,CALL);
 const v=await verifyLegCertificate(parseLegCertificate(caller.certificate),opts(caller));assert.equal(v.jkt,caller.leg.jkt);
 const renewed=await signLegCertificate({issuer:ALICE.iss,sub:ALICE.sub,identity:caller.identity,aud:caller.aud,sid:SID,role:'caller',purpose:CALL,client:p.client,delegate:caller.leg.jwk,aep:0,now:(now+500)*1000,maxSeconds:900},{kid:'cert-1',privateKey:caller.certification.privateKey});
 assert.ok(renewalPreserves(p,parseLegCertificate(renewed.certificate).payload));
 const otherKey=await keyPair(),moved=await signLegCertificate({issuer:ALICE.iss,sub:ALICE.sub,identity:caller.identity,aud:caller.aud,sid:SID,role:'caller',purpose:CALL,client:p.client,delegate:otherKey.jwk,aep:0,now:now*1000,maxSeconds:900},{kid:'cert-1',privateKey:caller.certification.privateKey});
 assert.equal(renewalPreserves(p,parseLegCertificate(moved.certificate).payload),false,'a renewal never changes the leg key');
});

test('issuance clamps the lifetime to the declared bound and the session end, and refuses bad inputs',async()=>{
 const base={issuer:ALICE.iss,sub:ALICE.sub,identity:caller.identity,aud:caller.aud,sid:SID,role:'caller',purpose:CALL,client:{client_id:'c',origin:'https://app.example'},delegate:caller.leg.jwk,aep:0,now:now*1000};
 const signer={kid:'cert-1',privateKey:caller.certification.privateKey};
 assert.equal((await signLegCertificate({...base,maxSeconds:300,lifetime:900},signer)).exp,now+300);assert.equal((await signLegCertificate({...base,maxSeconds:900,sessionEndsAt:now+42},signer)).exp,now+42);
 await assert.rejects(signLegCertificate({...base,maxSeconds:901},signer),TypeError);await assert.rejects(signLegCertificate({...base,maxSeconds:119},signer),TypeError);
 await assert.rejects(signLegCertificate({...base,maxSeconds:900,sessionEndsAt:now},signer),TypeError,'never outlives the session');
 await assert.rejects(signLegCertificate({...base,maxSeconds:900,delegate:{...caller.leg.jwk,crv:'P-384'}},signer),TypeError);
 await assert.rejects(signLegCertificate({...base,maxSeconds:900,role:'observer'},signer),code('rtc_certificate_invalid'));
 assert.ok(maxLegSecondsValid(120)&&maxLegSecondsValid(900));assert.ok(!maxLegSecondsValid(119)&&!maxLegSecondsValid(901)&&!maxLegSecondsValid(600.5));
});

test('verifiers check aud, sid, role, purpose, client, expiry with 60 s skew, declared lifetime and session end',async()=>{
 const parsed=parseLegCertificate(caller.certificate),p=parsed.payload,fails=async(extra,c='rtc_certificate_invalid',label)=>assert.rejects(verifyLegCertificate(parsed,opts(caller,extra)),code(c),label);
 await fails({expected:{aud:identityOf(ALICE),sid:SID,role:'caller'}},undefined,'aud is the verifier’s own entity');await fails({expected:{aud:caller.aud,sid:SID2,role:'caller'}},undefined,'sid');
 await fails({expected:{aud:caller.aud,sid:SID,role:'callee'}},undefined,'role');await fails({expected:{aud:caller.aud,sid:SID,purpose:{...CALL,version:2}}},undefined,'purpose');await fails({expected:{aud:caller.aud,sid:SID,client_id:'other'}},undefined,'client');
 await verifyLegCertificate(parsed,opts(caller,{now:p.exp+60}));await fails({now:p.exp+61},'rtc_certificate_expired');await verifyLegCertificate(parsed,opts(caller,{now:p.iat-60}));await fails({now:p.iat-61},'rtc_certificate_expired','issued in the future');
 await fails({maxSeconds:300},undefined,'longer than this issuer declares');await fails({maxSeconds:1000},undefined,'an invalid declaration');await fails({sessionEndsAt:p.exp-1},undefined,'outlives the session');
 await fails({minAep:1},'rtc_epoch_rollback');await fails({now:undefined},'rtc_certificate_expired');
});

test('identity comes from the verifier, never from the certificate; the identity signing key and inactive keys fail',async()=>{
 const parsed=parseLegCertificate(caller.certificate);
 await assert.rejects(verifyLegCertificate(parsed,opts(caller,{identity:undefined})),code('rtc_identity_mismatch'));await assert.rejects(verifyLegCertificate(parsed,opts(caller,{identity:'https://a.example/entities/someone-else'})),code('rtc_identity_mismatch'));
 // A certificate signed by the entity's identity signing key: that key is not a certification key, so nothing verifies it.
 const identityKey=await keyPair(),byIdentity=parseLegCertificate(await resign(caller,()=>{},{kid:'identity',key:identityKey.privateKey}));
 await assert.rejects(verifyLegCertificate(byIdentity,opts(caller)),code('rtc_signature_invalid'));
 await assert.rejects(verifyLegCertificate(byIdentity,opts(caller,{keys:[...caller.keys,{kid:'identity',use:'sig',alg:'ES256',jwk:identityKey.jwk,state:'active'}]})),code('rtc_signature_invalid'),'only active certification keys');
 for(const state of ['revoked','retired','pending',undefined])await assert.rejects(verifyLegCertificate(parsed,opts(caller,{keys:[{...caller.keys[0],state}]})),code('rtc_signature_invalid'),String(state));
 await assert.rejects(verifyLegCertificate(parsed,opts(caller,{keys:[{...caller.keys[0],kid:'other'}]})),code('rtc_signature_invalid'),'unknown kid');
 await assert.rejects(verifyLegCertificate(parsed,opts(caller,{keys:[{...caller.keys[0],jwk:(await keyPair()).jwk}]})),code('rtc_signature_invalid'),'wrong key under the kid');
 assert.equal(verifyKeyStatus(null,'x'),null);assert.equal(verifyKeyStatus([{kid:'x',use:'cert',state:'active'}],'x'),null);
 // cnf.jkt that does not match the delegate fails even under a valid signature.
 const swapped=parseLegCertificate(await resign(caller,c=>{c.cnf.jkt=SID+'AAAAAAAAAAAAAAAAAAAAA';}));await assert.rejects(verifyLegCertificate(swapped,opts(caller)),code('rtc_certificate_invalid'));
});

test('exact profile: members, bounds and typ separation from every other certification-key profile (AMD-R1)',async()=>{
 const reject=async(edit,label)=>assert.throws(()=>parseLegCertificate(edit),code('rtc_certificate_invalid'),label);
 await reject(await resign(caller,c=>{c.extra=1;}),'extra member');await reject(await resign(caller,c=>{delete c.aep;}),'missing member');await reject(await resign(caller,c=>{c.bindle='rtc-leg';}));await reject(await resign(caller,c=>{c.v=2;}));
 await reject(await resign(caller,c=>{c.exp=c.iat+901;}),'never more than 900 s');await reject(await resign(caller,c=>{c.exp=c.iat;}));await reject(await resign(caller,c=>{c.identity='https://other.example/entities/x';}),'identity on the issuer origin');
 await reject(await resign(caller,c=>{c.role='peer';}));await reject(await resign(caller,c=>{c.client.extra=1;}));await reject(await resign(caller,c=>{c.purpose={...c.purpose,digest:'sha256-x'};}));await reject(await resign(caller,c=>{c.sid='short';}));await reject(await resign(caller,c=>{c.jti='x';}));
 await reject(await resign(caller,c=>{c.delegate.d='private';}),'no private members');
 // Cross-profile: the same claims under another typ, and other profiles under this parser.
 await reject(await resign(caller,()=>{},{typ:RTC_CONTROL_TYP}),'control typ');await reject(await resign(caller,()=>{},{typ:RTC_MESSAGE_TYP}),'message typ');await reject(await resign(caller,()=>{},{typ:'bindle-entity-certificate+jwt'}),'entity typ');
 await reject(await resign(caller,()=>{},{typ:'bindle-member-certificate+jwt'}),'member typ');await reject(await resign(caller,()=>{},{typ:'bindle-key-delegation+jwt'}),'delegation typ');
 const control=await signControl({issuer:ALICE.iss,sub:ALICE.sub,aud:caller.aud,sid:SID,reason:'expired',now:now*1000},{kid:'cert-1',privateKey:caller.certification.privateKey});await reject(control,'a control statement is not a certificate');
 assert.throws(()=>parseControl(caller.certificate),code('rtc_control_invalid'));assert.throws(()=>parseMessage(caller.certificate),code('rtc_message_invalid'));assert.throws(()=>parseMessage(control),code('rtc_message_invalid'));
 assert.equal(parseEntityCertificate(caller.certificate),null);assert.throws(()=>parseMemberCertificate(caller.certificate),{code:'invalid_certificate'});
 const entity=(await signEntityCertificate({issuer:ALICE.iss,org:ALICE.sub,identity:caller.identity,aud:caller.aud,instance:'https://a.example/relations/i',client:{client_id:'c',origin:'https://app.example'},actor:{},resource:'r',methods:{'https://c.example/v1':['get']},aep:0,delegate:caller.leg.jwk,now:now*1000},{kid:'cert-1',privateKey:caller.certification.privateKey})).certificate;
 await reject(entity,'an entity certificate is not a leg certificate');assert.throws(()=>parseControl(entity),code('rtc_control_invalid'));
 const msg=await sign(caller,payload(caller,'cancel',{}));await reject(msg,'a message is not a certificate');assert.throws(()=>parseControl(msg),code('rtc_control_invalid'));
});

test('control statements end legs or sessions only, under an active certification key',async()=>{
 const signer={kid:'cert-1',privateKey:caller.certification.privateKey},make=extra=>signControl({issuer:ALICE.iss,sub:ALICE.sub,aud:caller.aud,sid:SID,reason:'revoked',now:now*1000,...extra},signer);
 for(const [extra,leg] of [[{},null],[{leg:caller.leg.jkt},caller.leg.jkt]]){const p=await verifyControl(parseControl(await make(extra)),{keys:caller.keys,expected:{aud:caller.aud,sid:SID,iss:ALICE.iss,sub:ALICE.sub},now});assert.equal(p.leg,leg);assert.equal(p.type,'end');}
 for(const reason of ['expired','revoked','moved','failed'])parseControl(await make({reason}));
 await assert.rejects(make({reason:'paused'}),code('rtc_control_invalid'));await assert.rejects(make({leg:'x'}),code('rtc_control_invalid'));
 const typed=await signRtcJws({typ:RTC_CONTROL_TYP,kid:'cert-1',claims:{...parseControl(await make()).payload,type:'resume'},privateKey:signer.privateKey});assert.throws(()=>parseControl(typed),code('rtc_control_invalid'),'only end is defined');
 const parsed=parseControl(await make()),party={iss:ALICE.iss,sub:ALICE.sub};
 await assert.rejects(verifyControl(parsed,{keys:caller.keys,expected:{...party,aud:identityOf(ALICE),sid:SID},now}),code('rtc_control_invalid'));await assert.rejects(verifyControl(parsed,{keys:caller.keys,expected:{...party,aud:caller.aud,sid:SID2},now}),code('rtc_control_invalid'));
 await assert.rejects(verifyControl(parsed,{keys:caller.keys,expected:{...party,aud:caller.aud,sid:SID,sub:BOB.sub},now}),code('rtc_control_invalid'),'signed by the session party');
 await assert.rejects(verifyControl(parsed,{keys:[{...caller.keys[0],state:'revoked'}],expected:{...party,aud:caller.aud,sid:SID},now}),code('rtc_signature_invalid'));
 await assert.rejects(verifyControl(parsed,{keys:caller.keys,expected:{...party,aud:caller.aud,sid:SID},now:now-61}),code('rtc_control_invalid'),'future iat');
});

test('feature declaration and the RTC fragments (extensions rev 3.2: ordinary fragments, no slots)',()=>{
 assert.deepEqual(validateRtcFeature({endpoint:'https://a.example/bindle/rtc',max_leg_certificate_seconds:600},{issuer:'https://a.example'}),{endpoint:'https://a.example/bindle/rtc',max_leg_certificate_seconds:600});
 for(const value of [{endpoint:'https://b.example/bindle/rtc',max_leg_certificate_seconds:600},{endpoint:'https://a.example/bindle/rtc?x',max_leg_certificate_seconds:600},{endpoint:'https://a.example/bindle/rtc',max_leg_certificate_seconds:3600},{endpoint:'https://a.example/bindle/rtc',max_leg_certificate_seconds:600,extra:1},null])assert.equal(validateRtcFeature(value,{issuer:'https://a.example'}),null);
 assert.equal(fragmentOutcome(structuredClone(RTC_SIGNALING_FRAGMENT_DOCUMENT)).status,'valid');assert.equal(fragmentOutcome(structuredClone(ICE_RELAY_FRAGMENT_DOCUMENT)).status,'valid');
});

test('seeded: random claim edits either fail verification or keep every bound the verifier relies on',async()=>{
 const edits=[c=>{c.exp+=1;},c=>{c.sid=SID2;},c=>{c.aud=identityOf(ALICE);},c=>{c.role='callee';},c=>{c.aep+=1;},c=>{c.purpose.version=2;},c=>{c.iat-=1;},c=>{c.client.origin='https://evil.example';}];
 await forEachSeed(30,async random=>{
  const edit=random.pick(edits),forged=await resign(caller,edit,{key:random.chance(0.5)?caller.certification.privateKey:(await keyPair()).privateKey});
  let result=null;try{result=await verifyLegCertificate(parseLegCertificate(forged),opts(caller));}catch(e){assert.match(e.code,/^rtc_/);}
  if(result){const p=result.payload;assert.equal(p.sid,SID);assert.equal(p.aud,caller.aud);assert.equal(p.role,'caller');assert.ok(p.exp-p.iat<=900);}
 });
});

// ---- independent security review follow-ups (DEVLOG "RTC-a/b/c", "Review follow-ups"; provisional) -------------------
test('review L4: verifyControl requires the expected session party (iss and sub); an unrelated entity cannot end a session',async()=>{
 // poc1: entity C signs a control for the A–B session under its own active certification key.
 const carolKey=await keyPair(),carol={iss:'https://c.example',sub:'00000000-0000-4000-8000-00000000000c'};
 const parsed=parseControl(await signControl({issuer:carol.iss,sub:carol.sub,aud:identityOf(BOB),sid:SID,reason:'failed',now:now*1000},{kid:'c1',privateKey:carolKey.privateKey}));
 const keys=[{kid:'c1',use:'cert',alg:'ES256',jwk:carolKey.jwk,state:'active'}];
 for(const expected of [{aud:identityOf(BOB),sid:SID},{aud:identityOf(BOB),sid:SID,iss:ALICE.iss},{aud:identityOf(BOB),sid:SID,sub:ALICE.sub},{aud:identityOf(BOB),sid:SID,iss:null,sub:null}])
  await assert.rejects(verifyControl(parsed,{keys,expected,now}),code('rtc_control_invalid'),JSON.stringify(expected));
 await assert.rejects(verifyControl(parsed,{keys,expected:{aud:identityOf(BOB),sid:SID,...ALICE},now}),code('rtc_control_invalid'),'the session party is A, not C');
 await assert.rejects(verifyControl(parsed,{keys,now}),code('rtc_control_invalid'),'no expectations at all');
 assert.equal((await verifyControl(parsed,{keys,expected:{aud:identityOf(BOB),sid:SID,...carol},now})).iss,carol.iss,'only when C is the expected party');
});

test('review L5: only use=cert, state=active keys verify, in the directory key shape; a sig key never verifies a leg certificate',async()=>{
 const parsed=parseLegCertificate(caller.certificate),k=caller.keys[0];
 // poc1: the same key material published as the identity signing key (use: 'sig') or encryption key.
 for(const use of ['sig','enc',undefined,'CERT'])await assert.rejects(verifyLegCertificate(parsed,opts(caller,{keys:[{...k,use}]})),code('rtc_signature_invalid'),String(use));
 assert.equal(verifyKeyStatus([{...k,use:'sig'}],'cert-1'),null);assert.equal(verifyKeyStatus([{...k,alg:'ES384'}],'cert-1'),null);
 for(const extra of [{status:'active',state:undefined},{state:'superseded'}])assert.equal(verifyKeyStatus([{...k,...extra}],'cert-1'),null,JSON.stringify(extra));
 assert.deepEqual(verifyKeyStatus([k],'cert-1'),k.jwk);
 // A directory document's real entries verify as they are (packages/federation/directory.mjs §keys).
 const doc={kid:'cert-1',use:'cert',alg:'ES256',jwk:k.jwk,state:'active',predecessor:null,continuity:null};await verifyLegCertificate(parsed,opts(caller,{keys:[{kid:'sig-1',use:'sig',alg:'ES256',jwk:(await keyPair()).jwk,state:'active'},doc]}));
 // The adapter reuses the directory's certification lookup (purpose 'certification' → use 'cert', active in document and pin).
 const calls=[],directory={async resolve(q){calls.push(q);return q.purpose==='certification'&&q.kid==='cert-1'&&q.identity===caller.identity?{kid:'cert-1',purpose:'certification',alg:'ES256',publicJwk:k.jwk,state:'active',current:true,verifiable:true,identity:caller.identity,authorityEpoch:1}:null;}};
 const lookup=directoryCertificationKeys(directory,{issuer:ALICE.iss,subject:ALICE.sub,identity:caller.identity});
 await verifyLegCertificate(parsed,opts(caller,{keys:lookup}));assert.ok(calls.every(q=>q.purpose==='certification'&&q.issuer===ALICE.iss&&q.subject===ALICE.sub),'never a signing-key lookup');
 const wrongIdentity=directoryCertificationKeys(directory,{issuer:ALICE.iss,subject:ALICE.sub,identity:'https://a.example/entities/other'});await assert.rejects(verifyLegCertificate(parsed,opts(caller,{keys:wrongIdentity})),code('rtc_signature_invalid'));
 // A lookup that hands back a sig key, or throws, fails closed.
 assert.equal(await certificationKey(async()=>({...k,use:'sig'}),'cert-1'),null);assert.equal(await certificationKey(async()=>{throw new Error('x');},'cert-1'),null);assert.equal(await certificationKey(async()=>({...k,kid:'other'}),'cert-1'),null);
 const control=parseControl(await signControl({issuer:ALICE.iss,sub:ALICE.sub,aud:caller.aud,sid:SID,reason:'revoked',now:now*1000},{kid:'cert-1',privateKey:caller.certification.privateKey}));
 await verifyControl(control,{keys:lookup,expected:{aud:caller.aud,sid:SID,...ALICE},now});await assert.rejects(verifyControl(control,{keys:[{...k,use:'sig'}],expected:{aud:caller.aud,sid:SID,...ALICE},now}),code('rtc_signature_invalid'));
});
