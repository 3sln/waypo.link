// The core signed-object profile (packages/core/signed-object.mjs; contacts-and-links spike §4.1 and CR-C0; provisional,
// unsigned): round trip, tampering, the wrong key, strict JSON and header rejections, canonical segments, low-S, and the
// signaling wrapper's fault mapping.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SignedObjectFault,parseCompactJWS,verifyCompactJWS,signCompactJWS,lowS,normalizeLowS,segmentBytes} from '../packages/core/signed-object.mjs';
import {parseSignalingJws,verifySignature,signJws,SignalingWireFault,MESSAGE_TYP} from '../packages/signaling/jws.mjs';
import {base64url,fromBase64url,textEncoder} from '../packages/core/records.mjs';
import {forEachSeed} from './helpers/chaos.mjs';

const TYP='bindle-test-object+jwt',MAX=4096;
const pair=async()=>{const keys=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);const {kty,crv,x,y}=await crypto.subtle.exportKey('jwk',keys.publicKey);return {privateKey:keys.privateKey,publicJwk:{kty,crv,x,y}};};
const enc=text=>base64url(textEncoder.encode(text));
const N=0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551n;
const scalar=bytes=>bytes.reduce((v,b)=>(v<<8n)|BigInt(b),0n);
const highS=sig=>{const out=new Uint8Array(sig);let v=N-scalar(sig.subarray(32));for(let i=63;i>=32;i--){out[i]=Number(v&255n);v>>=8n;}return out;};
const parse=(compact,options={})=>parseCompactJWS(compact,{typ:TYP,maxBytes:MAX,...options});
// Signs arbitrary header/payload TEXT, so malformed JSON can still carry a valid signature.
const rawSign=async(headerText,payloadText,privateKey)=>{const head=`${enc(headerText)}.${enc(payloadText)}`;const sig=normalizeLowS(new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},privateKey,textEncoder.encode(head))));return `${head}.${base64url(sig)}`;};
const header=JSON.stringify({alg:'ES256',kid:'key-1',typ:TYP});

test('round trip: sign, parse and verify over the received bytes; claims keep member order',async()=>{
 const {privateKey,publicJwk}=await pair(),claims={z:1,a:'two',nested:{list:[1,2,{deep:true}]}};
 const compact=await signCompactJWS({typ:TYP,kid:'key-1',claims,privateKey});
 const parsed=parse(compact);
 assert.deepEqual(parsed.header,{alg:'ES256',kid:'key-1',typ:TYP});assert.deepEqual(parsed.payload,claims);assert.deepEqual(Object.keys(parsed.payload),['z','a','nested']);
 assert.equal(parsed.compact,compact);assert.deepEqual(parsed.input,textEncoder.encode(compact.split('.').slice(0,2).join('.')));assert.equal(parsed.signature.length,64);
 assert.equal(await verifyCompactJWS(parsed,publicJwk),true);
 // Signing input is the received bytes: an equivalent re-serialization (whitespace) is a different object.
 const spaced=await rawSign(header,'{ "z": 1 }',privateKey),p2=parse(spaced);assert.equal(await verifyCompactJWS(p2,publicJwk),true);
 assert.notDeepEqual(p2.input,parse(await rawSign(header,'{"z":1}',privateKey)).input);
});

test('signing always emits low-S, and the parser refuses a high-S twin that WebCrypto would verify',async()=>{
 const {privateKey,publicJwk}=await pair();
 for(let i=0;i<8;i++){
  const compact=await signCompactJWS({typ:TYP,kid:'key-1',claims:{i},privateKey}),[h,p,s]=compact.split('.'),sig=fromBase64url(s);
  assert.equal(lowS(sig),true);
  const twin=highS(sig);assert.equal(lowS(twin),false);
  assert.equal(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},await crypto.subtle.importKey('jwk',publicJwk,{name:'ECDSA',namedCurve:'P-256'},false,['verify']),twin,textEncoder.encode(`${h}.${p}`)),true,'the twin is a valid ECDSA signature');
  assert.throws(()=>parse(`${h}.${p}.${base64url(twin)}`),SignedObjectFault);
 }
 assert.equal(lowS(new Uint8Array(64)),false,'zero r and s');assert.equal(lowS(new Uint8Array(63)),false);assert.equal(lowS('x'),false);
});

test('tampering: any changed header, payload or signature byte fails verification or parsing',async()=>{
 const {privateKey,publicJwk}=await pair(),compact=await signCompactJWS({typ:TYP,kid:'key-1',claims:{sub:'alice',n:1},privateKey}),[h,p,s]=compact.split('.');
 const otherPayload=enc(JSON.stringify({sub:'mallory',n:1})),otherHeader=enc(JSON.stringify({alg:'ES256',kid:'key-2',typ:TYP}));
 for(const forged of [`${h}.${otherPayload}.${s}`,`${otherHeader}.${p}.${s}`]){const parsed=parse(forged);assert.equal(await verifyCompactJWS(parsed,publicJwk),false);}
 await forEachSeed(16,async random=>{
  const sig=fromBase64url(s),flipped=new Uint8Array(sig);flipped[random.int(64)]^=1<<random.int(8);
  let parsed;try{parsed=parse(`${h}.${p}.${base64url(flipped)}`);}catch(error){assert.ok(error instanceof SignedObjectFault);return;}
  assert.equal(await verifyCompactJWS(parsed,publicJwk),false);
 });
});

test('wrong key, malformed keys and malformed parsed objects verify false and never throw',async()=>{
 const a=await pair(),b=await pair(),parsed=parse(await signCompactJWS({typ:TYP,kid:'key-1',claims:{},privateKey:a.privateKey}));
 assert.equal(await verifyCompactJWS(parsed,b.publicJwk),false);
 for(const jwk of [null,{},{...a.publicJwk,x:'AAAA'}])assert.equal(await verifyCompactJWS(parsed,jwk),false);
 assert.equal(await verifyCompactJWS(null,a.publicJwk),false);assert.equal(await verifyCompactJWS({...parsed,signature:new Uint8Array(3)},a.publicJwk),false);
});

test('strict I-JSON: duplicate members, lone surrogates, noncharacters, -0, non-integers, unsafe integers, depth and non-objects',async()=>{
 const {privateKey}=await pair();
 const bad=['{"a":1,"a":2}','{"a":{"b":1,"b":2}}','{"a":"\\ud800"}','{"a":"\\udc00"}','{"a":"\\ufdd0"}','{"a":-0}','{"a":1.5}','{"a":1e3}','{"a":9007199254740992}','{"a":01}','{"a":1} x','{"a":[1,]}',"{'a':1}",'{"a":NaN}','{"a":"\u0001"}','[1]','"text"','null','{"a":'+'['.repeat(8)+'1'+']'.repeat(8)+'}'];
 for(const text of bad)await assert.rejects(async()=>parse(await rawSign(header,text,privateKey)),SignedObjectFault,text);
 for(const text of bad.slice(0,-1))await assert.rejects(async()=>parse(await rawSign(text,'{}',privateKey)),SignedObjectFault,'header '+text);
 // Depth: eight nested levels are accepted, nine are not; maxDepth widens it.
 const deep=n=>'{"a":'+'['.repeat(n-1)+'1'+']'.repeat(n-1)+'}';
 assert.ok(parse(await rawSign(header,deep(8),privateKey)));
 const nine=await rawSign(header,deep(9),privateKey);assert.throws(()=>parse(nine),SignedObjectFault);assert.ok(parse(nine,{maxDepth:16}));
 // Invalid UTF-8 inside a segment.
 const head=`${enc(header)}.${base64url(new Uint8Array([0x7b,0x22,0x61,0x22,0x3a,0x22,0xff,0x22,0x7d]))}`;assert.throws(()=>parse(`${head}.${base64url(new Uint8Array(64).fill(1))}`),SignedObjectFault);
});

test('header profile: exactly {alg, kid, typ}, ES256, the one typ, a valid kid; three canonical segments within maxBytes',async()=>{
 const {privateKey}=await pair(),claims='{}';
 for(const h of [{alg:'ES256',kid:'k',typ:'other+jwt'},{alg:'EdDSA',kid:'k',typ:TYP},{alg:'none',kid:'k',typ:TYP},{alg:'ES256',typ:TYP},{alg:'ES256',kid:'k',typ:TYP,crit:['x']},{alg:'ES256',kid:'',typ:TYP},{alg:'ES256',kid:'a\u0000b',typ:TYP},{alg:'ES256',kid:'k'.repeat(201),typ:TYP},{alg:'ES256',kid:7,typ:TYP}])
  await assert.rejects(async()=>parse(await rawSign(JSON.stringify(h),claims,privateKey)),SignedObjectFault,JSON.stringify(h));
 const good=await rawSign(header,claims,privateKey),[h,p,s]=good.split('.');assert.ok(parse(good));
 assert.ok(parse(good,{kid:value=>value==='key-1'}));assert.throws(()=>parse(good,{kid:value=>value==='other'}),SignedObjectFault);
 for(const forged of [`${h}.${p}`,`${h}.${p}.${s}.x`,`${h}.${p}.${s}=`,`${h}=.${p}.${s}`,`${h}.${p}.${s.slice(0,-1)}`,`${h}.${p}.${base64url(new Uint8Array(65).fill(1))}`,`${h}.${p}.${s.replace(/-/g,'+')}x`,'',`..`])assert.throws(()=>parse(forged),SignedObjectFault,forged);
 // A non-canonical final character (nonzero trailing bits) is refused.
 const last=p.at(-1),idx='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.indexOf(last);
 if(p.length%4!==0){const alt='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[idx+1];assert.throws(()=>parse(`${h}.${p.slice(0,-1)}${alt}.${s}`),SignedObjectFault);}
 assert.throws(()=>parse(good,{maxBytes:good.length-1}),SignedObjectFault);assert.ok(parse(good,{maxBytes:good.length}));
 assert.throws(()=>parse(12),SignedObjectFault);assert.throws(()=>parseCompactJWS(good,{maxBytes:MAX}),TypeError,'a typ is required');
 assert.throws(()=>segmentBytes('ab=='),SignedObjectFault);assert.deepEqual(segmentBytes('AQ'),new Uint8Array([1]));
});

test('signaling repoint: the wrapper maps every profile failure to its own code and keeps verify and sign behaviour',async()=>{
 const {privateKey,publicJwk}=await pair();
 const compact=await signJws({typ:MESSAGE_TYP,kid:'key-1',claims:{a:1},privateKey});
 const parsed=parseSignalingJws(compact,{typ:MESSAGE_TYP,maxBytes:MAX,code:'signaling_message_invalid'});assert.equal(await verifySignature(parsed,publicJwk),true);
 assert.equal(await verifyCompactJWS(parseCompactJWS(compact,{typ:MESSAGE_TYP,maxBytes:MAX}),publicJwk),true,'one profile');
 for(const bad of [compact.slice(0,-2),compact.replace(/\.[^.]+\./,'.e30.')+'x',`${compact}.x`])assert.throws(()=>parseSignalingJws(bad,{typ:MESSAGE_TYP,maxBytes:MAX,code:'signaling_message_invalid'}),error=>error instanceof SignalingWireFault&&error.code==='signaling_message_invalid');
 assert.throws(()=>parseSignalingJws(compact,{typ:'bindle-signaling-leg+jwt',maxBytes:MAX,code:'signaling_certificate_invalid'}),{code:'signaling_certificate_invalid'});
});
