// CBOR phases 2-4 (docs/architecture/cbor-rpc-spike.md revision 2; docs/spec/cbor.md, protocol.md §5): the RPC wire,
// journal fingerprint and retained-result semantics, the Node record store, contract value keywords and brokered RPC.
// Engine-level: real routes, controllers and codec; only identity and adapters are stand-ins.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {handleFederation} from '../packages/federation/http.mjs';
import {FederationController} from '../packages/federation/runtime.mjs';
import {compileContractVersion} from '../packages/federation/integrations.mjs';
import {object} from '../packages/federation/schema.mjs';
import {canonical} from '../packages/core/records.mjs';
import {encode,decode,fingerprintInput,fingerprint,BindleDecimal,NDArray} from '../packages/core/cbor.mjs';
import {RPC_MEDIA_TYPE,readRPCRequest,readRPCResponse,rpcEnvelope,decodeRPC,encodeRPC} from '../packages/core/rpc-wire.mjs';
import {SqliteMetadata} from '../apps/node/resources.mjs';
import {parseRPC,MAILBOX_CONTRACT} from '../packages/messaging-protocol/index.mjs';
import {rpcHeaders,rpcBody} from './helpers/rpc.mjs';

const ISSUER='https://provider.example',APP='https://app.example',TX='2f17cceb-7cae-49cd-ae13-1aad1ceab264';
const envelope=(args={key:'app/directory.json'},extra={})=>({version:'0',tx:TX,resource:`${ISSUER}/entities/e/resources/r`,contract:'https://3sln.me/artefacts/contracts/object-storage/v1',method:'get',args,...extra});
const hex=h=>Uint8Array.from(h.match(/../g),b=>parseInt(b,16));

// A controller stand-in that records what the route handed it (bytes across the isolate hop) and answers an envelope.
function stub(answer=env=>({version:'0',tx:env.tx,result:{echo:env.args}})){
 const seen=[];
 return {seen,controller:{clients:[{id:'app',origin:APP}],ready:async()=>true,tokenClient:async()=>'app',rpc:async(token,received,transport)=>{seen.push({token,received,transport});return answer(rpcEnvelope(received));}}};
}
const call=(controller,init)=>handleFederation(new Request(`${ISSUER}/bindle/rpc`,{method:'POST',...init}),{controller,issuer:ISSUER});

test('Bearer RPC: CBOR round trip carries bytes, unsafe integers and decimals exactly; the route hands the received bytes on',async()=>{
 const {seen,controller}=stub(),args={data:new Uint8Array([0,1,254,255]),big:2n**64n+5n,small:5n,price:BindleDecimal.from('12.50'),nested:{__proto__:null,x:[1.5,-2]}};
 const body=encodeRPC(envelope(args)),response=await call(controller,{headers:rpcHeaders({Authorization:'Bearer t',Origin:APP}),body});
 assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),RPC_MEDIA_TYPE);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(response.headers.get('Access-Control-Allow-Origin'),APP);
 assert.ok(seen[0].received instanceof Uint8Array,'the envelope crosses as bytes');assert.deepEqual(seen[0].received,body,'received bytes are canonical');
 const out=await rpcBody(response),echo=out.result.echo;
 assert.deepEqual(echo.data,args.data);assert.equal(echo.big,2n**64n+5n);assert.equal(echo.small,5,'a safe-range bigint decodes as a number');assert.ok(echo.price instanceof BindleDecimal);assert.equal(echo.price.toString(),'12.5');assert.deepEqual(echo.nested.x,[1.5,-2]);
 assert.equal(Object.getPrototypeOf(decodeRPC(body).args),Object.prototype,'handlers see Object.prototype maps, as under JSON.parse');
});

test('Bearer RPC: JSON is 415 with a CBOR error body; nothing reaches the controller',async()=>{
 const {seen,controller}=stub();
 for(const type of ['application/json','application/cbor','text/plain',undefined]){
  const response=await call(controller,{headers:{Authorization:'Bearer t',...type?{'Content-Type':type}:{}},body:JSON.stringify(envelope())});
  assert.equal(response.status,415,String(type));assert.equal(response.headers.get('Content-Type'),RPC_MEDIA_TYPE);assert.deepEqual(await rpcBody(response),{error:'unsupported_media_type',message:`Use ${RPC_MEDIA_TYPE}.`});
 }
 assert.equal(seen.length,0);
});

test('Bearer RPC: the 1,500,000-byte bound is on encoded bytes, checked before decoding (declared and streamed)',async()=>{
 const {seen,controller}=stub(),big=encodeRPC(envelope({blob:new Uint8Array(1_500_000-400)}));
 assert.ok(big.byteLength<=1_500_000);assert.equal((await call(controller,{headers:rpcHeaders({Authorization:'Bearer t'}),body:big})).status,200,'just under the bound passes');
 const over=new Uint8Array(1_500_001);over[0]=0xa0;// not even CBOR beyond its first byte: refused for size before any decode
 const streamed=await call(controller,{headers:rpcHeaders({Authorization:'Bearer t'}),body:new ReadableStream({start(c){c.enqueue(over.subarray(0,1_000_000));c.enqueue(over.subarray(1_000_000));c.close();}}),duplex:'half'});
 assert.equal(streamed.status,413);assert.equal((await rpcBody(streamed)).error,'body_too_large');
 const declared=await readRPCRequest(new Request(`${ISSUER}/bindle/rpc`,{method:'POST',headers:{...rpcHeaders(),'Content-Length':'1500001'},body:new Uint8Array(4)})).catch(e=>e);
 assert.equal(declared.status,413);assert.equal(seen.length,1);
});

test('Bearer RPC: strict decoding refuses every non-canonical or out-of-profile body with 400 and no echo',async()=>{
 const {seen,controller}=stub(),good=encodeRPC(envelope());
 const bad={
  'top-level array':encode([1],{}),'top-level text':encode('x'),'trailing byte':Uint8Array.from([...good,0]),'truncated':good.subarray(0,good.length-1),
  'unsorted keys':hex('a2'+'6276'+'01'+'6161'+'02'),'duplicate key':hex('a2'+'6161'+'01'+'6161'+'02'),'integer key':hex('a1'+'01'+'01'),
  'indefinite map':hex('bf'+'6161'+'01'+'ff'),'non-shortest head':hex('a1'+'6161'+'1801'),'undefined':hex('a1'+'6161'+'f7'),
  'integral float':hex('a1'+'6161'+'f94000'),'NaN':hex('a1'+'6161'+'f97e00'),'disallowed tag 0':hex('a1'+'6161'+'c0'+'6178'),
  'bignum that fits 64 bits':hex('a1'+'6161'+'c2'+'4101'),'big-endian typed array tag':hex('a1'+'6161'+'d841'+'42'+'0001'),'empty body':new Uint8Array(),
  'JSON bytes under the CBOR type':new TextEncoder().encode(JSON.stringify(envelope())),'depth 33':Uint8Array.from([...Array(33)].flatMap(()=>[0xa1,0x61,0x61]).concat([0x01])),
 };
 for(const [name,body] of Object.entries(bad)){
  const response=await call(controller,{headers:rpcHeaders({Authorization:'Bearer t'}),body});
  assert.equal(response.status,400,name);const out=await rpcBody(response);assert.deepEqual(out,{error:'invalid_request',message:'The request is not valid Bindle CBOR.'},name);
 }
 assert.equal(seen.length,0,'no refusal reached the controller');
});

test('route-level errors on /bindle/rpc are CBOR: missing bearer 401, wrong method 405, unknown origin 403',async()=>{
 const {controller}=stub();
 const unauth=await call(controller,{headers:rpcHeaders(),body:encodeRPC(envelope())});assert.equal(unauth.status,401);assert.equal((await rpcBody(unauth)).error,'unauthorized');
 const origin=await call(controller,{headers:rpcHeaders({Authorization:'Bearer t',Origin:'https://evil.example'}),body:encodeRPC(envelope())});assert.equal(origin.status,403);assert.equal((await rpcBody(origin)).error,'forbidden');
 const get=await handleFederation(new Request(`${ISSUER}/bindle/rpc`),{controller,issuer:ISSUER});assert.equal(get.status,405);assert.equal(get.headers.get('Content-Type'),RPC_MEDIA_TYPE);
});

test('SDK-side reader: only the RPC media type is decoded; a platform page is a transport failure',async()=>{
 await assert.rejects(readRPCResponse(new Response('<h1>502</h1>',{status:502,headers:{'Content-Type':'text/html'}})),{code:'transport_failure'});
 await assert.rejects(readRPCResponse(new Response(JSON.stringify({version:'0'}),{headers:{'Content-Type':'application/json'}})),{code:'transport_failure'});
 assert.deepEqual(await readRPCResponse(new Response(encodeRPC({version:'0',tx:TX,result:{ok:true}}),{headers:{'Content-Type':RPC_MEDIA_TYPE}})),{version:'0',tx:TX,result:{ok:true}});
});

// --- Journal fingerprint and retained results -------------------------------------------------------------------------
function memoryMetadata(){const rows=new Map();return {rows,transaction:async op=>op({get:async k=>structuredClone(rows.get(k)),set:async(k,v)=>{rows.set(k,structuredClone(v));},delete:async k=>{rows.delete(k);},list:async prefix=>[...rows].filter(([k])=>k.startsWith(prefix)).map(([key,value])=>({key,value:structuredClone(value)}))})};}
function journalHost({retain=true,result=ctx=>({stored:ctx.args.data,big:2n**70n,missing:undefined})}={}){
 let runs=0;const metadata=memoryMetadata();
 const self={dispatcher:{durableJournal:true,retainResult:()=>retain,execute:async ctx=>{runs++;return result(ctx);}},metadata,clock:()=>1_800_000_000_000,issuer:ISSUER};
 Object.defineProperty(self,'journalSecret',{value:'operator-secret-one-0123456789abcdef',enumerable:false});
 return {metadata,runs:()=>runs,dispatch:ctx=>FederationController.prototype.dispatch.call(self,ctx,globalThis.crypto)};
}
const writeCtx=(args,over={})=>({contract:'https://3sln.me/artefacts/contracts/object-storage/v1',method:'put',subject:`${ISSUER}/entities/00000000-0000-4000-8000-000000000001`,resource:`${ISSUER}/r/1`,clientId:'app',tx:TX,args,...over});

test('journal: the retained fingerprint is SHA-256 over the domain-separated CBOR of the resolved request',async()=>{
 const h=journalHost(),c=writeCtx({key:'k',data:new Uint8Array([1,2,3])});await h.dispatch(c);
 const [row]=[...h.metadata.rows.values()];
 const expected=await fingerprint({resource:c.resource,addressedResource:c.resource,contract:c.contract,method:c.method,args:c.args,scope:{},epoch:null,resourceGeneration:null,connectionGeneration:null});
 assert.equal(row.format,'cbor1');assert.equal(row.fingerprint,expected);
 assert.deepEqual([...fingerprintInput({a:1}).subarray(0,26)],[...new TextEncoder().encode('bindle-rpc-fingerprint-v1'),0]);
});

test('journal: dedupe follows decoded-value equality: bytes never collide with look-alike maps; 5n and 5 are the same request',async()=>{
 const h=journalHost(),bytes=writeCtx({key:'k',data:new Uint8Array([7,8])});
 await h.dispatch(bytes);
 await assert.rejects(h.dispatch(writeCtx({key:'k',data:{0:7,1:8}})),{code:'tx_conflict'},'a map that JSON canonical form would confuse with the bytes');
 assert.equal(h.runs(),1);
 const n=journalHost();await n.dispatch(writeCtx({key:'k',size:5n}));const replay=await n.dispatch(writeCtx({key:'k',size:5}));assert.equal(n.runs(),1,'a safe-range bigint and the equal number are one request');assert.ok(replay.stored===undefined||replay);
 await assert.rejects(n.dispatch(writeCtx({key:'k',size:5.5})),{code:'tx_conflict'});
});

test('journal: a retained result is stored as encoded CBOR bytes and replayed byte-identically, bytes and bigints intact',async()=>{
 const h=journalHost(),c=writeCtx({key:'k',data:new Uint8Array([9,9,9])});
 const first=await h.dispatch(c),[row]=[...h.metadata.rows.values()];
 assert.ok(row.result instanceof Uint8Array,'opaque CBOR blob');assert.deepEqual(decode(row.result,{objects:'plain'}),{stored:new Uint8Array([9,9,9]),big:2n**70n});
 const again=await h.dispatch({...c});assert.equal(h.runs(),1);
 assert.deepEqual(encodeRPC(again),encodeRPC(first),'replay encodes to the same bytes');assert.equal(Object.hasOwn(again,'missing'),false,'undefined members are omitted, as JSON did');
});

test('journal: a result the profile cannot encode is recorded as indeterminate after the effect, never retained or retried',async()=>{
 const h=journalHost({result:()=>({when:new Date(0)})}),c=writeCtx({key:'k'});
 assert.equal((await h.dispatch(c)).__federationError.code,'indeterminate');assert.equal((await h.dispatch({...c})).__federationError.code,'indeterminate');assert.equal(h.runs(),1);
});

test('journal: a live pre-CBOR row answers indeterminate and never runs the write again (lazy reset)',async()=>{
 const h=journalHost(),c=writeCtx({key:'k'}),key=`federation/journal/${encodeURIComponent(c.subject)}/${encodeURIComponent(c.clientId)}/${c.tx}`;
 h.metadata.rows.set(key,{fingerprint:'old-json-digest',status:'complete',result:{old:true},expiresAt:1_800_000_000_000+1000});
 assert.equal((await h.dispatch(c)).__federationError.code,'indeterminate');assert.equal(h.runs(),0);
 h.metadata.rows.set(key,{fingerprint:'old-json-digest',status:'complete',result:{old:true},expiresAt:1_800_000_000_000-1});
 await h.dispatch(c);assert.equal(h.runs(),1,'an expired pre-CBOR row is replaced');assert.equal(h.metadata.rows.get(key).format,'cbor1');
});

test('canonical(): CBOR-only values render without JSON collisions or throws; JSON-era renderings are unchanged',()=>{
 assert.equal(canonical({b:1,a:[true,null,'x']}),'{"a":[true,null,"x"],"b":1}');
 assert.notEqual(canonical(new Uint8Array([1,2])),canonical({0:1,1:2}));assert.equal(canonical(5n),canonical(5));assert.notEqual(canonical(2n**64n),canonical(2**64));
 assert.notEqual(canonical(BindleDecimal.from('1.5')),canonical(1.5));assert.match(canonical(new Float32Array([1])),/^c'/);
});

test('Node record store keeps bytes and bigints (structured-clone blobs) and JSON rows unchanged',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'bindle-cbor-store-'));
 try{const db=new SqliteMetadata(join(directory,'x.sqlite'));
  await db.transaction(async tx=>{await tx.put('journal',{result:encode({data:new Uint8Array([1])}),n:2n**64n});await tx.put('plain',{a:1,u:undefined});});
  const row=await db.get('journal');assert.ok(row.result instanceof Uint8Array);assert.deepEqual(decode(row.result,{objects:'plain'}),{data:new Uint8Array([1])});assert.equal(row.n,2n**64n);
  assert.deepEqual(await db.get('plain'),{a:1},'JSON rows keep JSON semantics');
  assert.equal(typeof db.db.prepare('SELECT value FROM records WHERE key=?').get('plain').value,'string');
  assert.deepEqual([...(await db.list({prefix:''})).keys()],['journal','plain']);db.close();
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('isolate hops: received bytes decode on the far side so a decimal is never a look-alike plain object',()=>{
 const bytes=encodeRPC(envelope({amount:BindleDecimal.from('0.1')}));
 assert.ok(rpcEnvelope(bytes).args.amount instanceof BindleDecimal);
 const cloned=structuredClone(decodeRPC(bytes)).args.amount;assert.equal(cloned instanceof BindleDecimal,false,'why bytes cross isolates: structured clone loses the class');
 assert.equal(object(cloned),true);assert.equal(object(rpcEnvelope(bytes).args.amount),false);
});

// --- Contract value keywords (CBOR spike §2.5) -------------------------------------------------------------------------
const contract=(args,defs={})=>({$id:'https://contracts.example/c/v1','x-methods':{m:{result:{type:'object'}}},type:'object',properties:{method:{const:'m'},args},required:['method','args'],additionalProperties:false,$defs:defs});
const valid=(schema,args)=>compileContractVersion(contract(schema)).validate({method:'m',args});

test('contracts: x-type bytes (lengths in bytes), never strings or objects; type object never accepts bytes or codec values',()=>{
 const schema={type:'object',properties:{data:{'x-type':'bytes',minLength:1,maxLength:4}},required:['data'],additionalProperties:false};
 assert.equal(valid(schema,{data:new Uint8Array(4)}),true);assert.equal(valid(schema,{data:new Uint8Array(5)}),false);assert.equal(valid(schema,{data:new Uint8Array(0)}),false);
 assert.equal(valid(schema,{data:'AAAA'}),false,'base64 text is not bytes');assert.equal(valid(schema,{data:{0:1}}),false);assert.equal(valid(schema,{data:new Uint16Array(1)}),false);
 assert.equal(valid({type:'object',properties:{o:{type:'object'}}},{o:new Uint8Array(1)}),false);assert.equal(valid({type:'object',properties:{o:{type:'object'}}},{o:BindleDecimal.from('1.5')}),false);
 assert.equal(valid({type:'object',properties:{s:{type:'string'}}},{s:new Uint8Array(1)}),false);
 assert.throws(()=>valid({type:'object',properties:{d:{'x-type':'bytes',type:'string'}}},{d:'x'}),{code:'artefact_unverifiable'},'x-type with type');
 assert.throws(()=>valid({type:'object',properties:{d:{'x-type':'blob'}}},{d:'x'}),{code:'artefact_unverifiable'});
});

test('contracts: integers are unbounded unless bounded; bounds compare exactly (x-minimum/x-maximum, bigint, decimals, floats)',()=>{
 const int={type:'object',properties:{n:{type:'integer'}}},u64={type:'object',properties:{n:{type:'integer',minimum:0,'x-maximum':'18446744073709551615'}}};
 assert.equal(valid(int,{n:2n**80n}),true);assert.equal(valid(int,{n:1e20}),false,'an unsafe integral number was a float');assert.equal(valid(int,{n:1.5}),false);
 assert.equal(valid(u64,{n:2n**64n-1n}),true);assert.equal(valid(u64,{n:2n**64n}),false);assert.equal(valid(u64,{n:-1}),false);
 const safe={type:'object',properties:{n:{type:'integer',minimum:-9007199254740991,maximum:9007199254740991}}};assert.equal(valid(safe,{n:2n**53n}),false);assert.equal(valid(safe,{n:2**53-1}),true);
 const amount={type:'object',properties:{a:{'x-type':'decimal',minimum:0,'x-maximum':'1000000'}}};
 assert.equal(valid(amount,{a:BindleDecimal.from('999999.99')}),true);assert.equal(valid(amount,{a:BindleDecimal.from('1000000.01')}),false);assert.equal(valid(amount,{a:1000000}),true);assert.equal(valid(amount,{a:1.5}),false,'a float is never a decimal');
 const frac={type:'object',properties:{x:{type:'number','x-maximum':'0.1'}}};assert.equal(valid(frac,{x:0.1}),false,'the double 0.1 is above the exact decimal 0.1');assert.equal(valid(frac,{x:0.09}),true);
 assert.equal(valid({type:'object',properties:{n:{type:'integer',multipleOf:3}}},{n:3n**40n}),true);assert.equal(valid({type:'object',properties:{n:{type:'integer',multipleOf:3}}},{n:3n**40n+1n}),false);
 assert.throws(()=>valid({type:'object',properties:{n:{type:'integer',minimum:0,'x-minimum':'0'}}},{n:1}),{code:'artefact_unverifiable'});
 assert.throws(()=>valid({type:'object',properties:{n:{type:'integer','x-maximum':'1e5'}}},{n:1}),{code:'artefact_unverifiable'});
});

test('contracts: typed arrays, ndarrays and x-table columns',()=>{
 const emb={type:'object',properties:{v:{'x-type':'typed-array','x-element':'f32',minItems:2,maxItems:4}}};
 assert.equal(valid(emb,{v:new Float32Array(3)}),true);assert.equal(valid(emb,{v:new Float64Array(3)}),false);assert.equal(valid(emb,{v:[1,2,3]}),false);assert.equal(valid(emb,{v:new Float32Array(5)}),false);
 const nd={type:'object',properties:{m:{'x-type':'ndarray','x-element':'i32','x-shape':[null,2]}}};
 assert.equal(valid(nd,{m:new NDArray([3,2],new Int32Array(6))}),true);assert.equal(valid(nd,{m:new NDArray([2,3],new Int32Array(6))}),false);assert.equal(valid(nd,{m:new NDArray([3,2],new Float32Array(6))}),false);
 assert.throws(()=>valid({type:'object',properties:{v:{'x-type':'typed-array'}}},{v:new Float32Array(1)}),{code:'artefact_unverifiable'},'x-element is required');
 const table={type:'object',properties:{t:{type:'object','x-table':{columns:{id:{'x-type':'typed-array','x-element':'u64'},name:{type:'array',items:{type:'string'}}},maxRows:3}}}};
 assert.equal(valid(table,{t:{id:new BigUint64Array([1n,2n]),name:['a','b']}}),true);
 assert.equal(valid(table,{t:{id:new BigUint64Array([1n,2n]),name:['a']}}),false,'columns of unequal length');
 assert.equal(valid(table,{t:{id:new BigUint64Array([1n,2n]),name:['a','b'],extra:[]}}),false,'undeclared column');
 assert.equal(valid(table,{t:{id:new BigUint64Array(4),name:['a','b','c','d']}}),false,'beyond maxRows');
});

test('contracts: const and enum compare by deterministic encoding, not JSON.stringify',()=>{
 assert.equal(valid({type:'object',properties:{k:{const:5}}},{k:5n}),true);
 assert.equal(valid({type:'object',properties:{k:{enum:[{a:1,b:2}]}}},{k:{b:2,a:1}}),true,'map key order does not matter');
 assert.equal(valid({type:'object',properties:{k:{const:{0:1}}}},{k:new Uint8Array([1])}),false);
 assert.equal(valid({type:'object',properties:{k:{type:'array',uniqueItems:true}}},{k:[new Uint8Array([1]),{0:1}]}),true);
});

test('every integer node in the shipped contracts has explicit bounds (contract lint, CBOR spike §2.5)',async()=>{
 const {readdir,readFile}=await import('node:fs/promises'),files=[];
 for(const dir of ['docs/artefacts','docs/artefacts/extensions','docs/artefacts/fragments'])for(const name of await readdir(dir))if(name.endsWith('.json')&&name!=='artefacts.lock.json')files.push(join(dir,name));
 const unbounded=[];
 const walk=(node,path)=>{if(Array.isArray(node))return node.forEach((x,i)=>walk(x,`${path}/${i}`));if(!node||typeof node!=='object')return;
  const types=Array.isArray(node.type)?node.type:[node.type];if(types.includes('integer')&&(!('minimum' in node||'exclusiveMinimum' in node||'x-minimum' in node)||!('maximum' in node||'exclusiveMaximum' in node||'x-maximum' in node))&&!('const' in node||'enum' in node))unbounded.push(path);
  for(const [k,v] of Object.entries(node))walk(v,`${path}/${k}`);};
 for(const file of files)walk(JSON.parse(await readFile(file,'utf8')),file);
 assert.deepEqual(unbounded,[]);
});

// --- Brokered RPC (phase 4) ---------------------------------------------------------------------------------------------
test('brokered RPC: Parlay parseRPC decodes strict CBOR and refuses JSON and non-canonical bodies',()=>{
 const resource='https://hub.box.example/mailboxes/m1',ok=encodeRPC({version:'0',tx:TX,resource,contract:MAILBOX_CONTRACT,method:'describe',args:{}});
 assert.equal(parseRPC(ok).method,'describe');
 assert.throws(()=>parseRPC(new TextEncoder().encode(JSON.stringify(decodeRPC(ok)))),{code:'malformed'});
 assert.throws(()=>parseRPC(Uint8Array.from([...ok,0])),{code:'malformed'});
 assert.throws(()=>parseRPC(encodeRPC({version:'0',tx:TX,resource,contract:MAILBOX_CONTRACT,method:'describe',args:{x:new Uint8Array(1)}})),e=>e.code==='invalid_args'&&e.rpc===true);
});

test('RPC encoding omits what JSON omitted (undefined, symbol-keyed and non-enumerable members) and still refuses accessors',()=>{
 const result={object:{key:'k',size:1,gone:undefined}};Object.defineProperty(result,Symbol.dispose,{value:()=>{},enumerable:true});Object.defineProperty(result,'hidden',{value:1,enumerable:false});
 assert.deepEqual(decodeRPC(encodeRPC(result)),{object:{key:'k',size:1}});
 assert.throws(()=>encode(result),{code:'unsupported'},'the strict default keeps refusing them');
 assert.throws(()=>encodeRPC(Object.defineProperty({},'g',{get:()=>1,enumerable:true})),{code:'unsupported'});
});

test('L2: request arguments cross the owner-shard and relations hops as CBOR bytes; the handler sees the codec types',async()=>{
 const {methods}=await import('../packages/runtime/account/storage.mjs');
 const owner='00000000-0000-4000-8000-000000000001',origin='https://provider.example',resourceId='22222222-2222-4222-8222-222222222222';
 let seen;const controller={config:{APP_ORIGIN:origin},warm:async()=>{},apps:{check:async()=>{}},
  metadata:{get:async k=>k==='resource/'+resourceId?{id:resourceId,owner,provider:'hosted',status:'connected',capabilities:{}}:undefined,put:async()=>{},delete:async()=>{},list:async()=>new Map()},
  hostedOperation:async(resource,method,args)=>{seen=args;return {ok:true};}};
 const args={key:'k',price:BindleDecimal.from('1.25'),grid:new NDArray([2,2],new Int16Array([1,2,3,4])),big:2n**70n};
 const call=a=>methods.federationRPC.call(controller,{subject:`${origin}/entities/${owner}`,resource:`${origin}/entities/${owner}/resources/${resourceId}`,contract:'https://3sln.me/artefacts/contracts/object-storage/v1',method:'get',clientId:'c',tx:crypto.randomUUID(),args:a});
 await call(encodeRPC(args));
 assert.ok(seen.price instanceof BindleDecimal&&seen.price.toString()==='1.25');
 assert.ok(seen.grid instanceof NDArray&&seen.grid.shape.join()==='2,2');
 assert.equal(seen.big,2n**70n);
 // The structured clone the hop used to apply is exactly what loses the types.
 assert.ok(!(structuredClone(args).price instanceof BindleDecimal));
 await call(args);assert.ok(seen.price instanceof BindleDecimal); // an in-process caller's object form is still accepted
 await assert.rejects(call(new Uint8Array([0xa1,0x61,0x61,0xc4,0x82,0x20,0xfa,0x5d,0x80,0,0])),{code:'invalid_request'}); // strict options on the far side
});
