// Signaling leg certificates and control statements (docs/spec/extensions/signaling.md §6; §21.1 "Certificates and
// messages", "Declaration and fragments"; AMD-SG-K1 typ separation). Retargeted from rtc-certificates.test.mjs for
// signaling rev 3.2: roles initiator/recipient, `kind` and `profile` instead of `purpose`, `client.feature`. Pure
// functions only. Provisional, unsigned.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLegCertificate,verifyLegCertificate,signLegCertificate,renewalPreserves,parseControl,verifyControl,signControl,verifyKeyStatus,certificationKey,directoryCertificationKeys,maxLegSecondsValid,LEG_CERTIFICATE_SECONDS,SKEW_SECONDS,CONTROL_REASONS} from '../packages/signaling/certificates.mjs';
import {parseMessage} from '../packages/signaling/messages.mjs';
import {validateSignalingOptions,signalingDeclaration,SIGNALING_FRAGMENT_DOCUMENT,ICE_RELAY_FRAGMENT_DOCUMENT,SIGNALING_EXTENSION} from '../packages/signaling/extension.mjs';
import {fragmentOutcome} from '../packages/core/fragments.mjs';
import {parseEntityCertificate,signEntityCertificate} from '../packages/identity/entity-certificates.mjs';
import {parseMemberCertificate} from '../packages/identity/member-certificates.mjs';
import {signJws,LEG_CERTIFICATE_TYP,CONTROL_TYP,MESSAGE_TYP} from '../packages/signaling/jws.mjs';
import {forEachSeed} from './helpers/chaos.mjs';
import {party,payload,sign,now,ALICE,BOB,SID,SID2,KIND,keyPair,identityOf} from './helpers/signaling-wire-fixture.mjs';

const code=c=>({code:c});
const initiator=await party(ALICE,{role:'initiator',peer:BOB});
const FEATURE='https://spec.bindle.example/extensions/example-feature/v1';
const opts=(p,extra={})=>({keys:p.keys,expected:{aud:p.aud,sid:p.sid,role:p.role},identity:p.identity,now,...extra});
const claimsOf=p=>parseLegCertificate(p.certificate).payload;
const resign=async(p,edit,{typ=LEG_CERTIFICATE_TYP,kid='cert-1',key=p.certification.privateKey}={})=>{const claims=structuredClone(claimsOf(p));edit(claims);return signJws({typ,kid,claims,privateKey:key});};
const baseInput=(extra={})=>({issuer:ALICE.iss,sub:ALICE.sub,identity:initiator.identity,aud:initiator.aud,sid:SID,role:'initiator',kind:KIND,profile:'webrtc',client:{client_id:'c',origin:'https://app.example',feature:null},delegate:initiator.leg.jwk,aep:0,now:now*1000,maxSeconds:900,...extra});
const signer={kid:'cert-1',privateKey:initiator.certification.privateKey};

test('a leg certificate signs, parses and verifies; 3sln.me issues 600 s; renewals keep sid, role, kind, profile and cnf',async()=>{
 const p=claimsOf(initiator);assert.equal(p.exp-p.iat,LEG_CERTIFICATE_SECONDS);assert.equal(p.bindle,'signaling-leg-certificate');assert.equal(p.role,'initiator');assert.deepEqual(p.kind,KIND);assert.equal(p.profile,'webrtc');
 assert.deepEqual(p.client,{client_id:'https://app.example/client',origin:'https://app.example',feature:null},'an app has feature null');
 assert.deepEqual(Object.keys(p),['bindle','v','iss','sub','identity','aud','sid','role','kind','profile','client','cnf','delegate','aep','jti','iat','exp'],'exactly the §6.1 members');
 const v=await verifyLegCertificate(parseLegCertificate(initiator.certificate),opts(initiator));assert.equal(v.jkt,initiator.leg.jkt);
 const renew=extra=>signLegCertificate(baseInput({client:p.client,now:(now+500)*1000,...extra}),signer);
 assert.ok(renewalPreserves(p,parseLegCertificate((await renew()).certificate).payload));
 const otherKey=await keyPair();
 for(const [extra,label] of [[{delegate:otherKey.jwk},'the leg key'],[{role:'recipient'},'the role'],[{sid:SID2},'the sid'],[{kind:{...KIND,version:2}},'the kind'],[{profile:'data'},'the profile'],[{client:{...p.client,feature:FEATURE}},'the client']])
  assert.equal(renewalPreserves(p,parseLegCertificate((await renew(extra)).certificate).payload),false,`a renewal never changes ${label}`);
});

test('issuance clamps the lifetime to the declared bound and the session end, and refuses bad inputs',async()=>{
 assert.equal((await signLegCertificate(baseInput({maxSeconds:300,lifetime:900}),signer)).exp,now+300);assert.equal((await signLegCertificate(baseInput({sessionEndsAt:now+42}),signer)).exp,now+42);
 await assert.rejects(signLegCertificate(baseInput({maxSeconds:901}),signer),TypeError);await assert.rejects(signLegCertificate(baseInput({maxSeconds:119}),signer),TypeError);
 await assert.rejects(signLegCertificate(baseInput({sessionEndsAt:now}),signer),TypeError,'never outlives the session');
 await assert.rejects(signLegCertificate(baseInput({delegate:{...initiator.leg.jwk,crv:'P-384'}}),signer),TypeError);
 for(const [extra,label] of [[{role:'caller'},'revision 2 role'],[{role:'observer'},'unknown role'],[{profile:'quic'},'unregistered profile'],[{kind:{...KIND,version:0}},'kind version'],[{client:{client_id:'c',origin:'https://app.example',feature:'http://x.example/f'}},'feature not https'],[{client:{client_id:'c',origin:'https://app.example',feature:FEATURE+'?q'}},'feature with a query']])
  await assert.rejects(signLegCertificate(baseInput(extra),signer),code('signaling_certificate_invalid'),label);
 // A missing feature is issued as null (an app).
 assert.equal(parseLegCertificate((await signLegCertificate(baseInput({client:{client_id:'c',origin:'https://app.example'}}),signer)).certificate).payload.client.feature,null);
 assert.ok(maxLegSecondsValid(120)&&maxLegSecondsValid(900));assert.ok(!maxLegSecondsValid(119)&&!maxLegSecondsValid(901)&&!maxLegSecondsValid(600.5));
});

test('§4.2, §6.1: a provider feature leg carries client.feature = its extension spec URL; an app leg carries null',async()=>{
 const feature=await party(ALICE,{role:'initiator',peer:BOB,feature:FEATURE});
 const p=claimsOf(feature);assert.equal(p.client.feature,FEATURE);
 await verifyLegCertificate(parseLegCertificate(feature.certificate),opts(feature));
 assert.equal(parseLegCertificate((await signLegCertificate(baseInput({client:{client_id:'c',origin:'https://app.example',feature:SIGNALING_EXTENSION}}),signer)).certificate).payload.client.feature,SIGNALING_EXTENSION,'any extension spec URL');
 const reject=async(edit,label)=>assert.throws(()=>parseLegCertificate(edit),code('signaling_certificate_invalid'),label);
 for(const [value,label] of [[undefined,'feature missing'],['','empty'],['spec','not a URL'],['http://spec.bindle.example/x','not https'],[FEATURE+'#f','fragment'],[FEATURE+'?a=1','query'],['https://u@spec.bindle.example/x','userinfo'],['https://spec.bindle.example/'+'x'.repeat(256),'over 256'],[7,'not a string'],[{url:FEATURE},'not a string']])
  await reject(await resign(initiator,c=>{if(value===undefined)delete c.client.feature;else c.client.feature=value;}),label);
 await reject(await resign(initiator,c=>{c.client.purpose=null;}),'client members are exact');
 // The verifier's expected client_id still applies to a feature leg.
 await assert.rejects(verifyLegCertificate(parseLegCertificate(feature.certificate),opts(feature,{expected:{aud:feature.aud,sid:SID,role:'initiator',client_id:'other'}})),code('signaling_certificate_invalid'));
});

test('verifiers check aud, sid, role, kind, profile, client, expiry with 60 s skew, declared lifetime and session end',async()=>{
 const parsed=parseLegCertificate(initiator.certificate),p=parsed.payload,fails=async(extra,c='signaling_certificate_invalid',label)=>assert.rejects(verifyLegCertificate(parsed,opts(initiator,extra)),code(c),label);
 const ex=extra=>({expected:{aud:initiator.aud,sid:SID,role:'initiator',...extra}});
 await fails({expected:{aud:identityOf(ALICE),sid:SID,role:'initiator'}},undefined,'aud is the verifier’s own entity');await fails(ex({sid:SID2}),undefined,'sid');
 await fails(ex({role:'recipient'}),undefined,'role');await fails(ex({kind:{...KIND,version:2}}),undefined,'kind version');await fails(ex({kind:{...KIND,artefact:'https://other.example/kinds/k/v1'}}),undefined,'kind line');
 await fails(ex({kind:{...KIND,digest:'sha256-'+'B'.repeat(43)}}),undefined,'kind digest');await fails(ex({profile:'data'}),undefined,'profile');await fails(ex({client_id:'other'}),undefined,'client');
 await verifyLegCertificate(parsed,opts(initiator,ex({kind:{...KIND},profile:'webrtc'})));
 assert.equal(SKEW_SECONDS,60);
 await verifyLegCertificate(parsed,opts(initiator,{now:p.exp+60}));await fails({now:p.exp+61},'signaling_certificate_expired');await verifyLegCertificate(parsed,opts(initiator,{now:p.iat-60}));await fails({now:p.iat-61},'signaling_certificate_expired','issued in the future');
 await fails({maxSeconds:300},undefined,'longer than this issuer declares');await fails({maxSeconds:1000},undefined,'an invalid declaration');await fails({sessionEndsAt:p.exp-1},undefined,'outlives the session');
 await fails({minAep:1},'signaling_epoch_rollback');await fails({now:undefined},'signaling_certificate_expired');
});

test('identity comes from the verifier, never from the certificate; the identity signing key and inactive keys fail',async()=>{
 const parsed=parseLegCertificate(initiator.certificate);
 await assert.rejects(verifyLegCertificate(parsed,opts(initiator,{identity:undefined})),code('signaling_identity_mismatch'));await assert.rejects(verifyLegCertificate(parsed,opts(initiator,{identity:'https://a.example/entities/someone-else'})),code('signaling_identity_mismatch'));
 // A certificate signed by the entity's identity signing key: that key is not a certification key, so nothing verifies it.
 const identityKey=await keyPair(),byIdentity=parseLegCertificate(await resign(initiator,()=>{},{kid:'identity',key:identityKey.privateKey}));
 await assert.rejects(verifyLegCertificate(byIdentity,opts(initiator)),code('signaling_signature_invalid'));
 await assert.rejects(verifyLegCertificate(byIdentity,opts(initiator,{keys:[...initiator.keys,{kid:'identity',use:'sig',alg:'ES256',jwk:identityKey.jwk,state:'active'}]})),code('signaling_signature_invalid'),'only active certification keys');
 for(const state of ['revoked','retired','pending',undefined])await assert.rejects(verifyLegCertificate(parsed,opts(initiator,{keys:[{...initiator.keys[0],state}]})),code('signaling_signature_invalid'),String(state));
 await assert.rejects(verifyLegCertificate(parsed,opts(initiator,{keys:[{...initiator.keys[0],kid:'other'}]})),code('signaling_signature_invalid'),'unknown kid');
 await assert.rejects(verifyLegCertificate(parsed,opts(initiator,{keys:[{...initiator.keys[0],jwk:(await keyPair()).jwk}]})),code('signaling_signature_invalid'),'wrong key under the kid');
 assert.equal(verifyKeyStatus(null,'x'),null);assert.equal(verifyKeyStatus([{kid:'x',use:'cert',state:'active'}],'x'),null);
 // cnf.jkt that does not match the delegate fails even under a valid signature.
 const swapped=parseLegCertificate(await resign(initiator,c=>{c.cnf.jkt=SID+'AAAAAAAAAAAAAAAAAAAAA';}));await assert.rejects(verifyLegCertificate(swapped,opts(initiator)),code('signaling_certificate_invalid'));
});

test('exact profile: members, bounds and typ separation from every other certification-key profile (AMD-SG-K1)',async()=>{
 const reject=async(edit,label)=>assert.throws(()=>parseLegCertificate(edit),code('signaling_certificate_invalid'),label);
 await reject(await resign(initiator,c=>{c.extra=1;}),'extra member');await reject(await resign(initiator,c=>{delete c.aep;}),'missing member');await reject(await resign(initiator,c=>{c.bindle='rtc-leg-certificate';}),'the revision 2 profile');await reject(await resign(initiator,c=>{c.v=2;}));
 await reject(await resign(initiator,c=>{c.exp=c.iat+901;}),'never more than 900 s');await reject(await resign(initiator,c=>{c.exp=c.iat;}));await reject(await resign(initiator,c=>{c.identity='https://other.example/entities/x';}),'identity on the issuer origin');
 await reject(await resign(initiator,c=>{c.role='caller';}),'revision 2 role');await reject(await resign(initiator,c=>{c.role='peer';}));await reject(await resign(initiator,c=>{c.client.extra=1;}));
 await reject(await resign(initiator,c=>{c.kind={...c.kind,digest:'sha256-x'};}));await reject(await resign(initiator,c=>{c.purpose=c.kind;delete c.kind;}),'purpose is gone');await reject(await resign(initiator,c=>{c.profile='quic';}),'unregistered profile');await reject(await resign(initiator,c=>{delete c.profile;}));
 await reject(await resign(initiator,c=>{c.sid='short';}));await reject(await resign(initiator,c=>{c.jti='x';}));
 await reject(await resign(initiator,c=>{c.delegate.d='private';}),'no private members');
 // Cross-profile: the same claims under another typ, and other profiles under this parser.
 await reject(await resign(initiator,()=>{},{typ:CONTROL_TYP}),'control typ');await reject(await resign(initiator,()=>{},{typ:MESSAGE_TYP}),'message typ');await reject(await resign(initiator,()=>{},{typ:'bindle-rtc-leg+jwt'}),'revision 2 typ');await reject(await resign(initiator,()=>{},{typ:'bindle-entity-certificate+jwt'}),'entity typ');
 await reject(await resign(initiator,()=>{},{typ:'bindle-member-certificate+jwt'}),'member typ');await reject(await resign(initiator,()=>{},{typ:'bindle-key-delegation+jwt'}),'delegation typ');
 const control=await signControl({issuer:ALICE.iss,sub:ALICE.sub,aud:initiator.aud,sid:SID,reason:'expired',now:now*1000},signer);await reject(control,'a control statement is not a certificate');
 assert.throws(()=>parseControl(initiator.certificate),code('signaling_control_invalid'));assert.throws(()=>parseMessage(initiator.certificate),code('signaling_message_invalid'));assert.throws(()=>parseMessage(control),code('signaling_message_invalid'));
 assert.equal(parseEntityCertificate(initiator.certificate),null);assert.throws(()=>parseMemberCertificate(initiator.certificate),{code:'invalid_certificate'});
 const entity=(await signEntityCertificate({issuer:ALICE.iss,org:ALICE.sub,identity:initiator.identity,aud:initiator.aud,instance:'https://a.example/relations/i',client:{client_id:'c',origin:'https://app.example'},actor:{},resource:'r',methods:{'https://c.example/v1':['get']},aep:0,delegate:initiator.leg.jwk,now:now*1000},signer)).certificate;
 await reject(entity,'an entity certificate is not a leg certificate');assert.throws(()=>parseControl(entity),code('signaling_control_invalid'));
 const msg=await sign(initiator,payload(initiator,'cancel',{}));await reject(msg,'a message is not a certificate');assert.throws(()=>parseControl(msg),code('signaling_control_invalid'));
});

test('control statements end legs or sessions only, under an active certification key',async()=>{
 const make=extra=>signControl({issuer:ALICE.iss,sub:ALICE.sub,aud:initiator.aud,sid:SID,reason:'revoked',now:now*1000,...extra},signer);
 for(const [extra,leg] of [[{},null],[{leg:initiator.leg.jkt},initiator.leg.jkt]]){const p=await verifyControl(parseControl(await make(extra)),{keys:initiator.keys,expected:{aud:initiator.aud,sid:SID,iss:ALICE.iss,sub:ALICE.sub},now});assert.equal(p.leg,leg);assert.equal(p.type,'end');assert.equal(p.bindle,'signaling-control');}
 assert.deepEqual(CONTROL_REASONS,['expired','revoked','moved','failed']);for(const reason of CONTROL_REASONS)parseControl(await make({reason}));
 await assert.rejects(make({reason:'paused'}),code('signaling_control_invalid'));await assert.rejects(make({reason:'closed'}),code('signaling_control_invalid'),'closed is a message end reason, not a control reason');await assert.rejects(make({leg:'x'}),code('signaling_control_invalid'));
 const typed=await signJws({typ:CONTROL_TYP,kid:'cert-1',claims:{...parseControl(await make()).payload,type:'resume'},privateKey:signer.privateKey});assert.throws(()=>parseControl(typed),code('signaling_control_invalid'),'only end is defined');
 const legacy=await signJws({typ:CONTROL_TYP,kid:'cert-1',claims:{...parseControl(await make()).payload,bindle:'rtc-control'},privateKey:signer.privateKey});assert.throws(()=>parseControl(legacy),code('signaling_control_invalid'),'the revision 2 profile');
 const parsed=parseControl(await make()),sessionParty={iss:ALICE.iss,sub:ALICE.sub};
 await assert.rejects(verifyControl(parsed,{keys:initiator.keys,expected:{...sessionParty,aud:identityOf(ALICE),sid:SID},now}),code('signaling_control_invalid'));await assert.rejects(verifyControl(parsed,{keys:initiator.keys,expected:{...sessionParty,aud:initiator.aud,sid:SID2},now}),code('signaling_control_invalid'));
 await assert.rejects(verifyControl(parsed,{keys:initiator.keys,expected:{...sessionParty,aud:initiator.aud,sid:SID,sub:BOB.sub},now}),code('signaling_control_invalid'),'signed by the session party');
 await assert.rejects(verifyControl(parsed,{keys:[{...initiator.keys[0],state:'revoked'}],expected:{...sessionParty,aud:initiator.aud,sid:SID},now}),code('signaling_signature_invalid'));
 await assert.rejects(verifyControl(parsed,{keys:initiator.keys,expected:{...sessionParty,aud:initiator.aud,sid:SID},now:now-61}),code('signaling_control_invalid'),'future iat');
});

test('declaration options and the signaling fragments (§3.1–§3.3; extensions rev 3.2: ordinary fragments, no slots)',()=>{
 const issuer='https://a.example',ok={endpoint:'https://a.example/bindle/signaling',max_leg_certificate_seconds:600,profiles:['data','webrtc']};
 assert.deepEqual(validateSignalingOptions(ok,{issuer}),ok);assert.deepEqual(validateSignalingOptions({...ok,profiles:['webrtc']},{issuer}),{...ok,profiles:['webrtc']});
 for(const value of [{...ok,endpoint:'https://b.example/bindle/signaling'},{...ok,max_leg_certificate_seconds:3600},{...ok,max_leg_certificate_seconds:119},
  {...ok,profiles:[]},{...ok,profiles:['webrtc','data']},{...ok,profiles:['webrtc','webrtc']},{...ok,profiles:['quic']},null])
  assert.equal(validateSignalingOptions(value,{issuer}),null,JSON.stringify(value));
 assert.deepEqual(validateSignalingOptions({...ok,extra:1},{issuer}),ok,'unknown option members are ignored (extensions §2.4)');
 assert.deepEqual(signalingDeclaration({issuer,endpointPath:'/bindle/signaling',maxLegSeconds:600}),{spec:SIGNALING_EXTENSION,options:ok});
 assert.equal(fragmentOutcome(structuredClone(SIGNALING_FRAGMENT_DOCUMENT)).status,'valid');assert.equal(fragmentOutcome(structuredClone(ICE_RELAY_FRAGMENT_DOCUMENT)).status,'valid');
 assert.deepEqual(SIGNALING_FRAGMENT_DOCUMENT.fields.signaling.consumers,['application','provider'],'consumers includes provider (§21.1)');assert.equal(SIGNALING_FRAGMENT_DOCUMENT.fields.signaling.selection,'exclusive');
 assert.deepEqual(ICE_RELAY_FRAGMENT_DOCUMENT.fields.relays.consumers,['application','provider']);assert.equal(ICE_RELAY_FRAGMENT_DOCUMENT.fields.relays.selection,'ordered');
});

test('seeded: random claim edits either fail verification or keep every bound the verifier relies on',async()=>{
 const edits=[c=>{c.exp+=1;},c=>{c.sid=SID2;},c=>{c.aud=identityOf(ALICE);},c=>{c.role='recipient';},c=>{c.aep+=1;},c=>{c.kind.version=2;},c=>{c.profile='data';},c=>{c.iat-=1;},c=>{c.client.origin='https://evil.example';},c=>{c.client.feature=FEATURE;}];
 await forEachSeed(30,async random=>{
  const edit=random.pick(edits),forged=await resign(initiator,edit,{key:random.chance(0.5)?initiator.certification.privateKey:(await keyPair()).privateKey});
  let result=null;try{result=await verifyLegCertificate(parseLegCertificate(forged),opts(initiator,{expected:{aud:initiator.aud,sid:SID,role:'initiator',kind:KIND,profile:'webrtc'}}));}catch(e){assert.match(e.code,/^signaling_/);}
  if(result){const p=result.payload;assert.equal(p.sid,SID);assert.equal(p.aud,initiator.aud);assert.equal(p.role,'initiator');assert.deepEqual(p.kind,KIND);assert.equal(p.profile,'webrtc');assert.ok(p.exp-p.iat<=900);}
 });
});

// ---- independent security review follow-ups (carried from rtc-signaling, DEVLOG "RTC-a/b/c"; provisional) -------------
test('review L4: verifyControl requires the expected session party (iss and sub); an unrelated entity cannot end a session',async()=>{
 const carolKey=await keyPair(),carol={iss:'https://c.example',sub:'00000000-0000-4000-8000-00000000000c'};
 const parsed=parseControl(await signControl({issuer:carol.iss,sub:carol.sub,aud:identityOf(BOB),sid:SID,reason:'failed',now:now*1000},{kid:'c1',privateKey:carolKey.privateKey}));
 const keys=[{kid:'c1',use:'cert',alg:'ES256',jwk:carolKey.jwk,state:'active'}];
 for(const expected of [{aud:identityOf(BOB),sid:SID},{aud:identityOf(BOB),sid:SID,iss:ALICE.iss},{aud:identityOf(BOB),sid:SID,sub:ALICE.sub},{aud:identityOf(BOB),sid:SID,iss:null,sub:null}])
  await assert.rejects(verifyControl(parsed,{keys,expected,now}),code('signaling_control_invalid'),JSON.stringify(expected));
 await assert.rejects(verifyControl(parsed,{keys,expected:{aud:identityOf(BOB),sid:SID,...ALICE},now}),code('signaling_control_invalid'),'the session party is A, not C');
 await assert.rejects(verifyControl(parsed,{keys,now}),code('signaling_control_invalid'),'no expectations at all');
 assert.equal((await verifyControl(parsed,{keys,expected:{aud:identityOf(BOB),sid:SID,...carol},now})).iss,carol.iss,'only when C is the expected party');
});

test('review L5: only use=cert, state=active keys verify, in the directory key shape; a sig key never verifies a leg certificate',async()=>{
 const parsed=parseLegCertificate(initiator.certificate),k=initiator.keys[0];
 for(const use of ['sig','enc',undefined,'CERT'])await assert.rejects(verifyLegCertificate(parsed,opts(initiator,{keys:[{...k,use}]})),code('signaling_signature_invalid'),String(use));
 assert.equal(verifyKeyStatus([{...k,use:'sig'}],'cert-1'),null);assert.equal(verifyKeyStatus([{...k,alg:'ES384'}],'cert-1'),null);
 for(const extra of [{status:'active',state:undefined},{state:'superseded'}])assert.equal(verifyKeyStatus([{...k,...extra}],'cert-1'),null,JSON.stringify(extra));
 assert.deepEqual(verifyKeyStatus([k],'cert-1'),k.jwk);
 const doc={kid:'cert-1',use:'cert',alg:'ES256',jwk:k.jwk,state:'active',predecessor:null,continuity:null};await verifyLegCertificate(parsed,opts(initiator,{keys:[{kid:'sig-1',use:'sig',alg:'ES256',jwk:(await keyPair()).jwk,state:'active'},doc]}));
 const calls=[],directory={async resolve(q){calls.push(q);return q.purpose==='certification'&&q.kid==='cert-1'&&q.identity===initiator.identity?{kid:'cert-1',purpose:'certification',alg:'ES256',publicJwk:k.jwk,state:'active',current:true,verifiable:true,identity:initiator.identity,authorityEpoch:1}:null;}};
 const lookup=directoryCertificationKeys(directory,{issuer:ALICE.iss,subject:ALICE.sub,identity:initiator.identity});
 await verifyLegCertificate(parsed,opts(initiator,{keys:lookup}));assert.ok(calls.every(q=>q.purpose==='certification'&&q.issuer===ALICE.iss&&q.subject===ALICE.sub),'never a signing-key lookup');
 const wrongIdentity=directoryCertificationKeys(directory,{issuer:ALICE.iss,subject:ALICE.sub,identity:'https://a.example/entities/other'});await assert.rejects(verifyLegCertificate(parsed,opts(initiator,{keys:wrongIdentity})),code('signaling_signature_invalid'));
 assert.equal(await certificationKey(async()=>({...k,use:'sig'}),'cert-1'),null);assert.equal(await certificationKey(async()=>{throw new Error('x');},'cert-1'),null);assert.equal(await certificationKey(async()=>({...k,kid:'other'}),'cert-1'),null);
 const control=parseControl(await signControl({issuer:ALICE.iss,sub:ALICE.sub,aud:initiator.aud,sid:SID,reason:'revoked',now:now*1000},signer));
 await verifyControl(control,{keys:lookup,expected:{aud:initiator.aud,sid:SID,...ALICE},now});await assert.rejects(verifyControl(control,{keys:[{...k,use:'sig'}],expected:{aud:initiator.aud,sid:SID,...ALICE},now}),code('signaling_signature_invalid'));
});
