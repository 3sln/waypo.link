// CBOR phase 5 conformance (docs/architecture/cbor-rpc-spike.md §5, §7.3; integrations §6.1): integration events as
// untagged COSE_Sign1 CWTs. One refusal per strict rule (tags, shape, unprotected parameters, detached payload, crit,
// alg, extra and key-bearing headers, typ, kid, external_aad, wrong key or curve, tamper, non-deterministic payload,
// claims, size, media type), verification over the received bytes, high-S acceptance, replay and retry dedupe by cti,
// the RFC 9052 Appendix C.2.1 Sign1 vector for the generic Sig_structure layer, and the destructive reset of
// SET-era outbox attempts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {encode,decode} from '../packages/core/cbor.mjs';
import * as C from '../packages/core/cose.mjs';
import * as SDK from '../packages/sdk/src/integration-events.mjs';
import * as E from '../packages/runtime/integration-events.mjs';
import {createTestEngine,OWNER} from './helpers/app-engine.mjs';
import {fakeClock} from './helpers/chaos.mjs';

const ISSUER='https://provider.example',SUB=ISSUER+'/entities/e1',AUD='https://integration.example/bindle/events',KID='event.AAAAAAAAAAAAAAAAAAAAAA';
const TYPE='https://spec.bindle.example/events/preferences-updated/v1',NOW=Date.UTC(2026,9,29,12),IAT=Math.floor(NOW/1000);
const ECDSA={name:'ECDSA',namedCurve:'P-256'},SIG={name:'ECDSA',hash:'SHA-256'},N=0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const utf8=new TextEncoder(),hex=h=>Uint8Array.from(h.match(/../g),b=>parseInt(b,16)),cat=(...parts)=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;};
const bstr=bytes=>encode(bytes);
async function keyPair(){const pair=await crypto.subtle.generateKey(ECDSA,true,['sign','verify']),jwk=await crypto.subtle.exportKey('jwk',pair.publicKey);return {pair,jwk:{kty:'EC',crv:'P-256',x:jwk.x,y:jwk.y,kid:KID,alg:'ES256',use:'sig'}};}
const K=await keyPair(),JWKS={keys:[K.jwk]};
const lowS=sig=>{const s=BigInt('0x'+Buffer.from(sig.slice(32)).toString('hex'));if(s<=N>>1n)return sig;const out=new Uint8Array(sig);out.set(hex((N-s).toString(16).padStart(64,'0')),32);return out;};
const signer=(pair=K.pair)=>async bytes=>lowS(new Uint8Array(await crypto.subtle.sign(SIG,pair.privateKey,bytes)));
const claims=(over={})=>({iss:ISSUER,sub:SUB,aud:AUD,iat:IAT,cti:new Uint8Array(16).fill(9),events:{[TYPE]:{connection:'c1',generation:1,seq:1,fragment:'https://integration.example/preferences/settings/v1',revision:'r1',values:{retention:30,big:2n**64n,blob:Uint8Array.of(1,2,3)}}},...over});
const message=(over,options={})=>C.signIntegrationEvent({kid:KID,claims:claims(over),sign:signer(),...options});
const options=(over={})=>({contentType:C.INTEGRATION_EVENT_MEDIA_TYPE,keys:JWKS,issuer:ISSUER,audience:AUD,subject:SUB,connection:()=>true,now:NOW,...over});
const verify=(bytes,over)=>C.verifyIntegrationEvent(bytes,options(over));
const refuses=async(bytes,reason,over)=>{let got;try{await verify(bytes,over);}catch(error){got=error;}assert.ok(got instanceof C.IntegrationEventFault,`${reason}: ${got}`);assert.equal(got.reason,reason);};
// Raw message assembly: protected header map bytes, unprotected item bytes, payload bytes, signed over Sig_structure.
async function raw({header=new Map([[1,-7],[4,utf8.encode(KID)],[16,C.INTEGRATION_EVENT_TYP]]),headerBytes,unprotected=Uint8Array.of(0xa0),payload,aad=utf8.encode(C.INTEGRATION_EVENT_AAD),sign=signer(),signature}={}){
 const p=headerBytes??encode(header,{cose:true}),c=payload??encode(new Map([[1,ISSUER],[2,SUB],[3,AUD],[6,IAT],[7,new Uint8Array(16).fill(9)],['events',claims().events]]),{cose:true});
 const sig=signature??await sign(C.sigStructure(p,c,aad));return cat(Uint8Array.of(0x84),bstr(p),unprotected,bstr(c),bstr(sig));
}

test('a signed event has the exact profile shape and verifies; the SDK re-exports the same verifier',async()=>{
 const bytes=await message(),[p,u,c,s]=decode(bytes,{top:'any'});
 assert.equal(bytes[0],0x84,'untagged array of four');assert.deepEqual(Object.keys(u),[]);assert.equal(s.length,64);
 assert.deepEqual([...decode(p,{cose:true})],[[1,-7],[4,utf8.encode(KID)],[16,'application/vnd.bindle.integration-event+cwt']]);
 assert.deepEqual([...decode(c,{cose:true}).keys()],[1,2,3,6,7,'events'],'integer labels first in deterministic order');
 const v=await verify(bytes);assert.equal(v.kid,KID);assert.equal(v.type,TYPE);assert.equal(v.payload.values.big,2n**64n,'snapshots keep the CBOR data model');assert.deepEqual(v.payload.values.blob,Uint8Array.of(1,2,3));
 assert.equal(v.ctiId,Buffer.alloc(16,9).toString('base64url'));assert.deepEqual(v.cti,new Uint8Array(16).fill(9));
 assert.equal(SDK.verifyIntegrationEvent,C.verifyIntegrationEvent);assert.equal(E.verifyIntegrationEvent,C.verifyIntegrationEvent);assert.equal(SDK.INTEGRATION_EVENT_MAX_BYTES,65536);
 assert.equal(encode(C.sigStructure(p,c))[0]>>5,2);assert.equal(C.sigStructure(p,c)[0],0x84,'Sig_structure starts with 0x84, never base64url text');
});

test('RFC 9052 Appendix C.2.1 Sign1 vector verifies through the generic Sig_structure layer (and the strict profile refuses it)',async()=>{
 // Key "11" (RFC 9052 Appendix C.7.1), protected {1:-7}, unprotected {4:'11'}, payload "This is the content.", empty external_aad.
 const key=await crypto.subtle.importKey('jwk',{kty:'EC',crv:'P-256',x:'usWxHK2PmfnHKwXPS54m0kTcGJ90UiglWiGahtagnv8',y:'IBOL-C3BttVivg-lSreASjpkttcsz-1rb7btKLv8EX4'},ECDSA,false,['verify']);
 const sig=hex('8eb33e4ca31d1c465ab05aac34cc6b23d58fef5c083106c4d25a91aef0b0117e2af9a291aa32e14ab834dc56ed2a223444547e01f11d3b0916e5a4c345cacb36');
 assert.equal(await crypto.subtle.verify(SIG,key,sig,C.sigStructure(hex('a10126'),utf8.encode('This is the content.'),new Uint8Array())),true);
 const wire=cat(hex('d2'),Uint8Array.of(0x84),bstr(hex('a10126')),hex('a104423131'),bstr(utf8.encode('This is the content.')),bstr(sig));
 await refuses(wire,'tagged');await refuses(wire.subarray(1),'unprotected');
});

test('strict shape: tags 18/61, other arrays, unprotected parameters, detached payloads, trailing and non-shortest bytes',async()=>{
 const good=await message();
 await refuses(cat(hex('d2'),good),'tagged');await refuses(cat(hex('d83d'),good),'tagged');await refuses(cat(hex('d83dd2'),good),'tagged');
 await refuses(encode([1,2,3]),'structure');await refuses(encode({a:1}),'structure');
 const [p,,c,s]=decode(good,{top:'any'});
 await refuses(cat(Uint8Array.of(0x84),bstr(p),hex('a0'),bstr(c),encode([[bstr(p),{},s]])),'structure','COSE_Sign signatures array');
 await refuses(cat(Uint8Array.of(0x84),bstr(p),hex('a0'),bstr(c),bstr(s.subarray(0,32))),'signature','a 32-byte MAC tag or short signature');
 await refuses(await raw({unprotected:hex('a104'+'4b'+Buffer.from('event.other').toString('hex'))}),'unprotected','kid outside the signature');
 await refuses(await raw({unprotected:hex('a1182180')}),'unprotected','x5chain in the unprotected bucket');
 await refuses(await raw({unprotected:hex('a16161'+'01')}),'unprotected');
 await refuses(cat(Uint8Array.of(0x84),bstr(p),hex('a0f6'),bstr(s)),'detached');
 await refuses(cat(good,hex('00')),'malformed');await refuses(good.subarray(0,good.length-1),'malformed');
 await refuses(cat(Uint8Array.of(0x98,0x04),good.subarray(1)),'malformed','non-shortest array head');
 await refuses(new Uint8Array(),'malformed');await refuses('not bytes','malformed');
});

test('protected header: crit, alg (only from the protected header, exactly -7), extra or key-bearing parameters, typ and kid',async()=>{
 const kid=utf8.encode(KID),typ=C.INTEGRATION_EVENT_TYP;
 await refuses(await raw({header:new Map([[1,-7],[2,[1]],[4,kid],[16,typ]])}),'crit');
 for(const alg of [-35,-36,-8,-257,1,'ES256'])await refuses(await raw({header:new Map([[1,alg],[4,kid],[16,typ]])}),'alg',String(alg));
 await refuses(await raw({header:new Map([[4,kid],[16,typ]])}),'alg','alg absent');
 await refuses(await raw({header:new Map([[1,-7],[4,kid],[16,typ],[33,Uint8Array.of(1)]])}),'header','x5chain: keys are never taken from the message');
 await refuses(await raw({header:new Map([[1,-7],[4,kid],[16,typ],[34,[-16,Uint8Array.of(1)]]])}),'header','x5t');
 await refuses(await raw({header:new Map([[1,-7],[4,kid],[16,typ],[3,'application/cwt']])}),'header','content type parameter');
 await refuses(await raw({header:new Map([[1,-7],[4,kid],[16,typ],[11,Uint8Array.of(1)]])}),'header','counter signature');
 await refuses(await raw({header:new Map([[1,-7],[16,typ]])}),'header','kid absent');
 for(const other of ['application/cwt','application/vnd.bindle.relation-event+cwt','secevent+jwt'])await refuses(await raw({header:new Map([[1,-7],[4,kid],[16,other]])}),'typ',other);
 await refuses(await raw({header:new Map([[1,-7],[4,kid],[16,61]])}),'typ','typ as a CoAP content format');
 await refuses(await raw({header:new Map([[1,-7],[4,KID],[16,typ]])}),'kid','kid as text');
 await refuses(await raw({header:new Map([[1,-7],[4,Uint8Array.of(0xff,0xfe)],[16,typ]])}),'kid','kid not UTF-8');
 await refuses(await raw({header:new Map([[1,-7],[4,utf8.encode('event.unknown')],[16,typ]])}),'kid','kid not in the key set');
 await refuses(await raw({headerBytes:hex('a3012604')}),'protected','truncated header');
 await refuses(await raw({headerBytes:hex('a3102604')}),'protected','unsorted header');
 await refuses(await message(),'kid',{kid:k=>k.startsWith('removal.')});
});

test('signature: wrong key, wrong external_aad, tampered bytes, wrong curve or JWK, high-S accepted, verification over the received bytes',async()=>{
 const other=await keyPair();await refuses(await raw({sign:signer(other.pair)}),'signature','a foreign key under the real kid');
 await refuses(await raw({aad:utf8.encode('bindle-relation-event-v1')}),'signature','another domain string');
 await refuses(await raw({aad:new Uint8Array()}),'signature','no external_aad');
 const good=await message();for(const at of [good.length-1,good.length-40]){const t=new Uint8Array(good);t[at]^=1;await refuses(t,'signature');}
 const at=Buffer.from(good).indexOf(Buffer.from('retention')),t=new Uint8Array(good);t[at]^=0x20;await refuses(t,'signature','payload text changed in place');
 for(const [jwk,reason] of [[{...K.jwk,crv:'P-384'},'jwks'],[{...K.jwk,alg:'ES384'},'jwks'],[{...K.jwk,use:'enc'},'jwks'],[{...K.jwk,d:'A'.repeat(43)},'jwks'],[{...K.jwk,kty:'OKP'},'jwks']])await refuses(good,reason,{keys:{keys:[jwk]}});
 await refuses(good,'kid',{keys:{keys:[K.jwk,K.jwk]}});await refuses(good,'jwks',{keys:[K.jwk]});
 let asked;await verify(good,{keys:async kid=>{asked=kid;return JWKS;}});assert.equal(asked,KID,'the key set is looked up by the protected kid');
 // High-S: the same signature with s replaced by N - s still verifies (ECDSA malleability); dedupe never keys on signature bytes.
 const [p,,c,s]=decode(good,{top:'any'}),high=new Uint8Array(s);high.set(hex((N-BigInt('0x'+Buffer.from(s.slice(32)).toString('hex'))).toString(16).padStart(64,'0')),32);
 const malleated=cat(Uint8Array.of(0x84),bstr(p),hex('a0'),bstr(c),bstr(high));assert.equal((await verify(malleated)).ctiId,(await verify(good)).ctiId);
 // A payload signed in a non-deterministic encoding (unsorted claims) verifies cryptographically but is refused by the
 // strict decode before any signature work: verification is never over a re-encoding.
 await refuses(await raw({payload:cat(hex('a6'),encode(2,{top:'any'}),encode(SUB),encode(1),encode(ISSUER),encode(3),encode(AUD),encode(6),encode(IAT),encode(7),encode(new Uint8Array(16)),encode('events'),encode(claims().events))}),'claims','claims out of deterministic order');
});

test('claims: exactly iss, sub, aud, iat, 16-byte cti and one event; iss, aud, sub and the iat window in order',async()=>{
 const map=(entries)=>encode(new Map(entries),{cose:true}),base=[[1,ISSUER],[2,SUB],[3,AUD],[6,IAT],[7,new Uint8Array(16).fill(9)],['events',claims().events]];
 await refuses(await raw({payload:map([...base,[4,IAT+60]])}),'claims','exp');
 await refuses(await raw({payload:map(base.filter(([k])=>k!==7))}),'claims','cti missing');
 await refuses(await raw({payload:map([...base.filter(([k])=>k!==7),['jti','B'.repeat(22)]])}),'claims','jti instead of cti');
 await refuses(await raw({payload:map(base.map(([k,v])=>k===7?[k,new Uint8Array(15)]:[k,v]))}),'cti');
 await refuses(await raw({payload:map(base.map(([k,v])=>k===7?[k,'A'.repeat(22)]:[k,v]))}),'cti');
 await refuses(await raw({payload:map(base.map(([k,v])=>k===6?[k,IAT+0.5]:[k,v]))}),'claims','iat not an integer');
 await refuses(await raw({payload:map(base.map(([k,v])=>k==='events'?[k,{...v,'https://x.example/e/v1':{connection:'c1',generation:1,seq:2}}]:[k,v]))}),'events','two events');
 await refuses(await raw({payload:map(base.map(([k,v])=>k==='events'?[k,{[TYPE]:{connection:'c1',generation:1}}]:[k,v]))}),'events','seq missing');
 await refuses(await raw({payload:encode([1])}),'claims');
 await refuses(await message(),'iss',{issuer:'https://other.example'});
 let looked=0;await refuses(await message(),'iss',{issuer:'https://other.example',connection:()=>{looked++;return true;}});assert.equal(looked,0,'iss is checked before the lookup');
 await refuses(await message(),'connection',{connection:()=>null});
 await refuses(await message(),'aud',{audience:'https://integration.example/bindle/other'});
 await refuses(await message(),'sub',{subject:ISSUER+'/entities/other'});
 await refuses(await message({iat:IAT+31}),'iat');await refuses(await message({iat:IAT-601}),'iat');
 assert.ok(await verify(await message({iat:IAT+30})));assert.ok(await verify(await message({iat:IAT-600})));
});

test('media type and size: application/cwt only, 64 KiB encoded; the signer never signs an oversize or invalid event',async()=>{
 const good=await message();
 for(const type of [undefined,'application/cbor','application/secevent+jwt','application/cose; cose-type="cose-sign1"'])await refuses(good,'media_type',{contentType:type});
 assert.ok(await verify(good,{contentType:'Application/CWT; charset=binary'}),'parameters and case do not matter');
 await assert.rejects(verify(new Uint8Array(65537)),e=>e.reason==='too_large'&&e.status===413);
 let signed=0;const counting=async bytes=>{signed++;return signer()(bytes);};
 const big=claims({events:{[TYPE]:{connection:'c1',generation:1,seq:1,values:{text:'x'.repeat(66000)}}}});
 await assert.rejects(C.signIntegrationEvent({kid:KID,claims:big,sign:counting}),e=>e.reason==='too_large');assert.equal(signed,0);
 assert.ok(C.integrationEventSize(big)>65536);
 const fits=claims({events:{[TYPE]:{connection:'c1',generation:1,seq:1,values:{text:'x'.repeat(60000)}}}}),bytes=await C.signIntegrationEvent({kid:KID,claims:fits,sign:counting});
 assert.ok(bytes.length<=65536);assert.ok(C.integrationEventSize(fits)>=bytes.length,'the size bound is an upper bound under the longest kid');assert.equal(C.integrationEventSize(fits,KID),bytes.length,'and exact under the real kid');
 for(const bad of [{cti:new Uint8Array(8)},{events:{}},{iat:-1},{aud:''},{events:{[TYPE]:{connection:'c1',generation:1,seq:1,v:undefined}}}])await assert.rejects(C.signIntegrationEvent({kid:KID,claims:claims(bad),sign:counting}),C.IntegrationEventFault);
 await assert.rejects(C.signIntegrationEvent({kid:KID,claims:{...claims(),exp:1},sign:counting}),e=>e.reason==='claims');assert.equal(signed,1);
 await assert.rejects(verify(good,{connection:undefined}),TypeError);await assert.rejects(verify(good,{maxBytes:65537}),TypeError);
});

test('receiver dedupe: a replayed or re-signed retry (new iat, same cti) is acknowledged once; a 400 body is a CBOR map',async()=>{
 const seen=new Set(),applied=[];
 const receive=async(bytes,now=NOW)=>{try{const v=await verify(bytes,{now});if(seen.has(v.ctiId))return 202;seen.add(v.ctiId);applied.push(v.payload.seq);return 202;}catch(error){return {status:error.status,body:decode(C.integrationEventRejection(error),{objects:'plain'})};}};
 const first=await message();assert.equal(await receive(first),202);assert.equal(await receive(first),202,'a replay within the window');
 const retry=await message({iat:IAT+5});assert.notDeepEqual(retry,first);assert.equal(await receive(retry,NOW+5000),202);
 assert.deepEqual(applied,[1],'processed once');
 const fresh=await message({cti:new Uint8Array(16).fill(10),events:{[TYPE]:{connection:'c1',generation:1,seq:2}}});assert.equal(await receive(fresh),202);assert.deepEqual(applied,[1,2]);
 const late=await receive(first,NOW+601000);assert.deepEqual(late,{status:400,body:{err:'invalid_request',description:'The integration event was rejected.'}});
 const forged=new Uint8Array(first);forged[forged.length-1]^=1;assert.equal((await receive(forged)).body.err,'authentication_failed');
 assert.equal(C.rejectionCode(C.integrationEventRejection(new C.IntegrationEventFault('aud'))),'invalid_audience');assert.equal(C.rejectionCode(utf8.encode('{"err":"x"}')),null,'a JSON body is not read (clean break)');
});

test('reset integration-events-cti-v1: SET-era attempts lose their jti once (bounded, idempotent); the next attempt is a fresh COSE event',async t=>{
 const clock=fakeClock(NOW),sent=[];let lists=0;
 const harness=await createTestEngine({clock,providers:{integrationEvents:E.integrationEventsProvider({enabled:true,issuer:ISSUER,subject:()=>SUB,
  signer:{sign:async(purpose,c)=>({kid:KID,message:await C.signIntegrationEvent({kid:KID,claims:c,sign:signer()})})},
  egress:{send:async({body})=>{sent.push(body);return {status:202,bytes:new Uint8Array()};}},snapshot:async()=>({revision:'r',values:{a:1}}),
  connections:()=>({outbox:async()=>({events:[],gap:false}),ack:async()=>({}),list:async()=>{lists++;return [{id:'c1',clientId:'https://integration.example/bindle/client.json',generation:1,state:'active',integration:{kind:'external',snapshot:{manifest:{events_endpoint:AUD}}}}];},health:async()=>({})})})}});
 t.after(()=>harness.dispose());await harness.metadata.put('owner',OWNER);
 const actor={kind:'system',owner:OWNER},key='integration-events/row/c1/p:'+encodeURIComponent('https://integration.example/preferences/settings/v1');
 await harness.perform(new E.MarkPreferencesUpdated({actor,input:{connection:'c1',fragment:'https://integration.example/preferences/settings/v1'}}));
 // Simulate a row leased under the SET format (a jti and seq assigned, the attempt undelivered).
 const row=await harness.metadata.get(key);await harness.metadata.put('integration-events/conn/c1',{v:1,seq:1,generation:0});await harness.metadata.put(key,{...row,jti:'B'.repeat(22),seq:1,sentGeneration:1,body:{fragment:'x',revision:'r',values:{a:1}},attempts:1});
 const meta=await harness.metadata.get('integration-events/meta');assert.equal(meta.cti,undefined);
 await harness.perform(new E.IngestIntegrationEvents({actor}));
 const reset=await harness.metadata.get(key);assert.equal(Object.hasOwn(reset,'jti'),false,'the SET attempt identity is discarded');assert.equal((await harness.metadata.get('integration-events/meta')).cti,1,'marker written');
 await harness.metadata.put(key,{...reset,jti:'C'.repeat(22)});await harness.perform(new E.IngestIntegrationEvents({actor}));assert.equal((await harness.metadata.get(key)).jti,'C'.repeat(22),'idempotent: the marker stops a second sweep');
 // The lease applies the same rule per row: the row is sent as a fresh COSE event with a new cti and a new seq.
 await harness.perform(new E.DeliverIntegrationEvents({actor}));assert.equal(sent.length,1);
 const v=await verify(sent[0],{now:clock.now()});assert.equal(v.payload.seq,2,'a fresh seq after the discarded attempt');assert.equal(v.ctiId.length,22);
 assert.equal(E.INTEGRATION_EVENTS_CTI_RESET,'integration-events-cti-v1');assert.ok(lists>0);
});

test('a configured preference value set is bounded at 16 KiB encoded, so a preferences-updated snapshot leaves room in the 64 KiB event',async t=>{
 const {brokeredProvider}=await import('./fixtures/brokered-provider.mjs'),f=await brokeredProvider(t);
 await assert.rejects(f.configure({theme:'x'.repeat(16400)}),e=>e.code==='invalid_preferences'&&/too large/.test(e.message));
 await f.configure({theme:'dark',model:[],store:[]});
});
