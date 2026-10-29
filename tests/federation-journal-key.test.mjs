// Security review L1 (CR-X3-25): the federation journal fingerprint of a non-retained write is an HMAC under a per-subject
// key derived from a deployment secret that is never written to the owner shard.
import test from 'node:test';
import assert from 'node:assert/strict';
import {FederationController,DEV_JOURNAL_SECRET} from '../packages/federation/runtime.mjs';
import {federationJournalSecret} from '../packages/runtime/federation.mjs';
import {digest} from '../packages/core/records.mjs';
import {fingerprintInput} from '../packages/core/cbor.mjs';

const ORIGIN='https://3sln.example',SUBJECT=`${ORIGIN}/entities/00000000-0000-4000-8000-000000000001`,CONTRACT='https://spec.bindle.example/contracts/item-classification/v1';
function memoryMetadata(seed=[]){const rows=new Map(seed);return {rows,transaction:async op=>op({get:async k=>structuredClone(rows.get(k)),set:async(k,v)=>{rows.set(k,structuredClone(v));},delete:async k=>{rows.delete(k);},list:async prefix=>[...rows].filter(([k])=>k.startsWith(prefix)).map(([key,value])=>({key,value}))})};}
function host({secret,seed}={}){
 let runs=0;const metadata=memoryMetadata(seed);
 const self={dispatcher:{durableJournal:true,retainResult:()=>false,execute:async ctx=>{runs++;return {echo:ctx.args.text.length};}},metadata,clock:()=>1_800_000_000_000,issuer:ORIGIN};
 if(secret!=='omit')Object.defineProperty(self,'journalSecret',{value:secret,enumerable:false});
 return {metadata,runs:()=>runs,dispatch:ctx=>FederationController.prototype.dispatch.call(self,ctx,globalThis.crypto)};
}
const ctx=(over={})=>({contract:CONTRACT,method:'classify',subject:SUBJECT,resource:`${ORIGIN}/r/classifier`,clientId:'https://app.example/client.json',tx:'7f1c0a52-4a3b-4c6e-9d6f-2b9b3f0e5a11',args:{text:'Quarterly invoice'},...over});
const journal=metadata=>[...metadata.rows].filter(([k])=>k.startsWith('federation/journal/')).map(([,v])=>v);
// CBOR phase 2: the fingerprint input is the codec's domain-separated deterministic encoding of these members.
const fingerprinted=c=>fingerprintInput({resource:c.resource,addressedResource:c.resource,contract:c.contract,method:c.method,args:c.args,scope:{},epoch:null,resourceGeneration:null,connectionGeneration:null});
async function hmacWith(rawKey,value){const key=await crypto.subtle.importKey('raw',rawKey,{name:'HMAC',hash:'SHA-256'},false,['sign']);return 'hmac:'+Buffer.from(await crypto.subtle.sign('HMAC',key,value)).toString('base64url');}

test('same-tx retry with the same arguments is indeterminate and changed arguments are tx_conflict (dedupe preserved)',async()=>{
 const h=host({secret:'operator-secret-one-0123456789abcdef'}),c=ctx();
 assert.deepEqual(await h.dispatch(c),{echo:17});
 assert.equal((await h.dispatch({...c})).__federationError.code,'indeterminate');assert.equal(h.runs(),1);
 await assert.rejects(h.dispatch({...c,args:{text:'other'}}),{code:'tx_conflict'});assert.equal(h.runs(),1);
});

test('no key material is stored: the fingerprint cannot be recomputed from store contents alone',async()=>{
 const h=host({secret:'operator-secret-one-0123456789abcdef'}),c=ctx();await h.dispatch(c);
 assert.deepEqual([...h.metadata.rows.keys()].filter(k=>!k.startsWith('federation/journal/')),[],'only the journal row is written');
 const [row]=journal(h.metadata),value=fingerprinted(c);
 assert.match(row.fingerprint,/^hmac:[A-Za-z0-9_-]{43}$/);assert.notEqual(row.fingerprint,await digest(globalThis.crypto,value));
 // Every string in the store, tried as a raw HMAC key, fails to reproduce the fingerprint.
 const strings=JSON.stringify([...h.metadata.rows]).match(/"[^"]*"/g).map(s=>JSON.parse(s));
 for(const s of strings){assert.notEqual(await hmacWith(new TextEncoder().encode(s),value),row.fingerprint);try{assert.notEqual(await hmacWith(Buffer.from(s,'base64url'),value),row.fingerprint);}catch{}}
 assert.equal(JSON.stringify([...h.metadata.rows]).includes('operator-secret'),false);
});

test('different secrets, and different subjects under one secret, give different fingerprints; one secret is stable',async()=>{
 const fp=async(secret,over)=>{const h=host({secret});await h.dispatch(ctx(over));return journal(h.metadata)[0].fingerprint;};
 const a=await fp('operator-secret-one-0123456789abcdef'),b=await fp('operator-secret-two-0123456789abcdef');
 assert.notEqual(a,b);assert.equal(await fp('operator-secret-one-0123456789abcdef'),a,'stable, so a retry on a new isolate still deduplicates');
 assert.notEqual(await fp('operator-secret-one-0123456789abcdef',{subject:`${ORIGIN}/entities/00000000-0000-4000-8000-000000000002`}),a);
});

test('a production composition without a secret fails closed before the journal reservation and before any effect',async()=>{
 const h=host({secret:null});
 await assert.rejects(h.dispatch(ctx()),{code:'temporarily_unavailable'});
 assert.equal(h.runs(),0);assert.equal(h.metadata.rows.size,0,'nothing reserved');
 // A retained write does not need the secret (its fingerprint is a plain digest of a result the journal keeps anyway).
 const retained=host({secret:null});retained.metadata;const self={dispatcher:{durableJournal:true,execute:async()=>({ok:true})},metadata:retained.metadata,clock:()=>1,issuer:ORIGIN};Object.defineProperty(self,'journalSecret',{value:null});
 assert.deepEqual(await FederationController.prototype.dispatch.call(self,ctx(),globalThis.crypto),{ok:true});
});

test('secret wiring: FEDERATION_JOURNAL_KEY, else KEY_ENCRYPTION_KEY, else the public constant only in local development',()=>{
 assert.equal(federationJournalSecret({FEDERATION_JOURNAL_KEY:'a',KEY_ENCRYPTION_KEY:'b'}),'a');
 assert.equal(federationJournalSecret({KEY_ENCRYPTION_KEY:'b'}),'b');
 assert.equal(federationJournalSecret({LOCAL_DEVELOPMENT:'true'}),DEV_JOURNAL_SECRET);
 assert.equal(federationJournalSecret({LOCAL_DEVELOPMENT:'false'}),null);assert.equal(federationJournalSecret({}),null);
 // An omitted secret (bare test hosts) uses the documented dev constant rather than failing.
 assert.equal(typeof DEV_JOURNAL_SECRET,'string');
});

test('the legacy stored key row is deleted on the next non-retained write; a pre-CBOR row answers indeterminate until it expires (lazy reset)',async()=>{
 const c=ctx(),legacy=['federation/journal-key/v1',{key:'A'.repeat(43)}];
 const pre=[`federation/journal/${encodeURIComponent(c.subject)}/${encodeURIComponent(c.clientId)}/${c.tx}`,{fingerprint:'sha256-bare',status:'complete',retained:false,expiresAt:1_800_000_000_000+3600000}];
 const h=host({secret:'operator-secret-one-0123456789abcdef',seed:[legacy,pre]});
 // CBOR phase 2 reset: a live row without format 'cbor1' never answers its old outcome and never lets the write run again.
 assert.equal((await h.dispatch(c)).__federationError.code,'indeterminate');
 const fresh=host({secret:'operator-secret-one-0123456789abcdef',seed:[legacy]});await fresh.dispatch(c);
 assert.equal(fresh.metadata.rows.has('federation/journal-key/v1'),false);
});

test('an omitted secret on a bare dispatch host uses the dev constant (tests and embedded compositions)',async()=>{
 const h=host({secret:'omit'});assert.deepEqual(await h.dispatch(ctx()),{echo:17});assert.equal((await h.dispatch(ctx())).__federationError.code,'indeterminate');
});
