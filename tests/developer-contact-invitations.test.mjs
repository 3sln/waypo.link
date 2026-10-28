// Developer contact through principal-bound invitations (contacts spike rev 2 §4.7, CR-C5; provisional, unsigned).
// GET /api/developer-contact is an eligibility read only; POST re-checks eligibility and asks the developer identity's
// Parlay, through the host mint hook DEVELOPER_CONTACT_MINT, for a single-use invitation bound to the requesting user,
// then answers with the `connect` intent. The hook here is a test double: no provider-to-Parlay transport exists yet.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {AccountController} from '../packages/runtime/accounts.mjs';
import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';
import {developerContactRoutes,connectKindReference,DEVELOPER_INVITE_TTL,CONNECT_INTENT_KIND} from '../packages/runtime/developer-contact.mjs';
import {allowedMethods,admission} from '../packages/runtime/routes/developer-contact.mjs';
import {decodeIntent,parseProtocolIntent} from '../packages/intents/format.mjs';
import {CONNECT_REFERENCE} from '../apps/parlay/web/bl/intents.mjs';

const origin='https://developer.example';
const token=()=>Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');

// A same-host world: a real requesting AccountController (tier stubbed per test), the developer identity in the
// directory, the population census port and a recording mint double.
async function world({population='all-active',mint=true}={}){
 const closers=[],state={population,tier:'free',mints:[],mintAnswer:null,tierCalls:[]};
 const metadata=new SqliteMetadata(':memory:'),stored=new Map(),bucket={put:async(k,b)=>{stored.set(k,new Uint8Array(b));},get:async k=>stored.has(k)?{size:stored.get(k).byteLength,arrayBuffer:async()=>stored.get(k).buffer.slice(0)}:null,delete:async k=>{stored.delete(k);}};closers.push(()=>metadata.close());
 const userId=crypto.randomUUID(),developerId=crypto.randomUUID(),assignmentId=crypto.randomUUID();
 const controller=new AccountController({metadata,gate:new SerialGate(),blobs:bucket,archives:bucket,config:{APP_ORIGIN:origin,KEY_ENCRYPTION_KEY:Buffer.alloc(32,12).toString('base64'),WORK_LIMITS_ENABLED:'false',STORAGE_WRITE_ENABLED:'false'}});
 await controller.warm(userId);controller.developerContactTier=async(owner,options)=>{state.tierCalls.push(options);if(state.tier==='error')throw Object.assign(Error('stale'),{code:'developer_contact_eligibility_unavailable'});return state.tier;};
 const recipient={id:developerId,handle:'n.dev',assignmentId,status:'active',systemIdentity:{version:1,handle:'ray',role:'developer',assignmentId,bootstrapId:crypto.randomUUID(),claimDigest:'a'.repeat(64)}};
 const env={APP_ORIGIN:origin,DEVELOPER_CONTACT_HANDLE:'ray',IDENTITY_REPOSITORY:{findByHandle:async handle=>handle==='ray'?recipient:null},
  DEVELOPER_CONTACT_POPULATION:{policy:async()=>{if(state.population==='throw')throw Error('down');const now=Date.now();return {mode:state.population,observedAt:now,validUntil:now+60000};}},
  ...mint?{DEVELOPER_CONTACT_MINT:async input=>{state.mints.push(structuredClone(input));if(state.mintAnswer)return state.mintAnswer(input);return {inviter:{iss:origin,sub:developerId},token:state.token=token(),delegation:'eyJhbGciOiJFUzI1NiJ9.e30.'+'A'.repeat(86),expires_at:Math.floor((Date.now()+input.expiresIn)/1000)};}}:{}};
 const object=new Proxy({},{get:(_,method)=>async(...args)=>{const result=await controller.invoke({method,args});if(result?.$fault)throw Object.assign(Error(result.$fault.message),result.$fault);return result;}});
 const route=(method='GET',{input={},limit,intentRoute}={})=>developerContactRoutes({path:'/api/developer-contact',request:{method},env,owner:{account:{id:userId}},object,accountHandle:()=>{throw Error('unused');},body:async()=>input,json:(value,status=200,headers={})=>({status,value,headers}),limit,remoteIP:'192.0.2.1',intentRoute});
 return {env,state,controller,metadata,userId,developerId,recipient,route,close:()=>closers.forEach(close=>close())};
}

test('the connect kind reference is the reviewed artefact snapshot (same digest as Parlay pins)',async()=>{
 const reference=await connectKindReference(),file=JSON.parse(await readFile(new URL('../docs/artefacts/intents/connect-v1.json',import.meta.url),'utf8'));
 assert.equal(reference.artefact,CONNECT_INTENT_KIND);assert.equal(file.id,CONNECT_INTENT_KIND);assert.equal(reference.version,file.versions.length);
 assert.deepEqual({...reference},{...CONNECT_REFERENCE});
});

test('GET is an eligibility read: paid tiers eligible, free follows the population mode, failures are unavailable',async()=>{const w=await world();try{
 const get=async()=>(await w.route('GET')).value;
 assert.deepEqual(await get(),{available:true,eligibility:{state:'eligible',tier:'free'},recipientBadge:{kind:'system',role:'developer',handle:'ray'}});
 for(const tier of ['paid','plus','ultra']){w.state.tier=tier;assert.deepEqual((await get()).eligibility,{state:'eligible',tier});}
 w.state.tier='free';w.state.population='paid-only';assert.deepEqual((await get()).eligibility,{state:'ineligible',reason:'paid-required',tier:'free'});
 w.state.tier='paid';assert.deepEqual((await get()).eligibility,{state:'eligible',tier:'paid'},'paid accounts stay eligible above the threshold');
 w.state.tier='free';w.state.population='throw';assert.deepEqual((await get()).eligibility,{state:'unavailable'});
 w.state.population='stale';assert.deepEqual((await get()).eligibility,{state:'unavailable'});
 w.state.population='all-active';w.state.tier='error';assert.deepEqual((await get()).eligibility,{state:'unavailable'},'billing that cannot be verified is unavailable');
 // No side effects: nothing minted, nothing written to the requesting account.
 const before=[...(await w.metadata.list({prefix:''})).keys()].join();for(let i=0;i<3;i++)await get();
 assert.equal(w.state.mints.length,0);assert.equal([...(await w.metadata.list({prefix:''})).keys()].join(),before);
 // The response carries no link, URL or intent any more.
 w.state.tier='paid';const value=await get();for(const gone of ['url','intent','mode','policy','expiresAt'])assert.equal(Object.hasOwn(value,gone),false,gone);
}finally{w.close();}});

test('POST mints only when eligible, bound to the requesting user with a one-hour expiry, and answers a connect intent',async()=>{const w=await world();try{
 w.state.tier='plus';const result=await w.route('POST');assert.equal(result.status,200);
 assert.deepEqual(w.state.mints,[{developer:{id:w.developerId,handle:'n.dev'},principal:{issuer:origin,subject:w.userId},tier:'plus',expiresIn:DEVELOPER_INVITE_TTL}]);
 assert.equal(DEVELOPER_INVITE_TTL,3600000);
 const {intent,expiresAt}=result.value;assert.deepEqual(Object.keys(result.value).sort(),['expiresAt','intent']);
 assert.equal(intent.url,'web+bindle://intent?bintent='+intent.value);
 const decoded=decodeIntent(intent.value);assert.deepEqual(decoded.kind,{...await connectKindReference()});
 assert.deepEqual(decoded.data.inviter,{iss:origin,sub:w.developerId});assert.equal(decoded.data.token,w.state.token);assert.equal(decoded.exp,decoded.data.expires_at);
 assert.equal(expiresAt,decoded.data.expires_at*1000);assert.ok(expiresAt<=Date.now()+DEVELOPER_INVITE_TTL&&expiresAt>Date.now()+DEVELOPER_INVITE_TTL-5000);
 assert.equal(parseProtocolIntent(encodeURIComponent(intent.url)).value,intent.value,'the scheme form parses');
 // Ineligible and unavailable accounts never reach the mint.
 w.state.mints.length=0;w.state.tier='free';w.state.population='paid-only';
 assert.deepEqual(await w.route('POST'),{status:403,value:{error:'not_eligible',eligibility:{state:'ineligible',reason:'paid-required',tier:'free'}},headers:{}});
 w.state.population='throw';assert.deepEqual((await w.route('POST')).value,{error:'eligibility_unavailable',eligibility:{state:'unavailable'}});assert.equal((await w.route('POST')).status,503);
 w.state.population='all-active';w.state.tier='error';assert.equal((await w.route('POST')).status,503);
 assert.equal(w.state.mints.length,0);
 // A free account in early access mints at the free tier.
 w.state.tier='free';assert.equal((await w.route('POST')).status,200);assert.equal(w.state.mints.at(-1).tier,'free');
 // POST takes an empty JSON object only.
 assert.deepEqual((await w.route('POST',{input:{principal:{issuer:origin,subject:crypto.randomUUID()}}})).value,{error:'invalid_request'});
}finally{w.close();}});

test('contacts phase 4: with intent links on for the account the answer also names the provider /i route, which carries the same value',async()=>{const w=await world();try{
 w.state.tier='paid';const off=await w.route('POST');assert.equal(off.value.intent.route,undefined,'scheme URL only while the provider does not route connect');
 const on=await w.route('POST',{intentRoute:true}),{intent}=on.value;assert.equal(on.status,200);
 assert.equal(intent.route,origin+'/i#bintent='+intent.value);assert.equal(intent.url,'web+bindle://intent?bintent='+intent.value);
 assert.equal(decodeIntent(new URL(intent.route).hash.slice('#bintent='.length)).kind.artefact,'https://spec.bindle.example/messaging/v1/intents/connect');
 for(const truthy of ['true',1,{}])assert.equal((await w.route('POST',{intentRoute:truthy})).value.intent.route,undefined,'only a boolean true enables the route');
}finally{w.close();}});

test('developer contact is unavailable without a mint hook, a developer handle or the developer identity',async()=>{
 const w=await world({mint:false});try{for(const method of ['GET','POST'])assert.deepEqual(await w.route(method),{status:200,value:{available:false,reason:'developer-unavailable'},headers:{}});}finally{w.close();}
 const v=await world();try{
  for(const handle of [undefined,'','  ']){v.env.DEVELOPER_CONTACT_HANDLE=handle;for(const method of ['GET','POST'])assert.deepEqual((await v.route(method)).value,{available:false,reason:'developer-unavailable'});}
  v.env.DEVELOPER_CONTACT_HANDLE='ray';v.recipient.status='disabled';assert.deepEqual((await v.route('GET')).value,{available:false,reason:'developer-unavailable'});
  v.recipient.status='active';v.recipient.systemIdentity={...v.recipient.systemIdentity,role:'support'};assert.deepEqual((await v.route('POST')).value,{available:false,reason:'developer-unavailable'});
  assert.equal(v.state.mints.length,0);
 }finally{v.close();}
});

test('a malformed or failed mint answer is refused without echoing it',async()=>{const w=await world();try{
 const secret=token(),good=input=>({inviter:{iss:origin,sub:w.developerId},token:secret,delegation:'x.y.z',expires_at:Math.floor((Date.now()+input.expiresIn)/1000)});
 const answers=[()=>{throw Object.assign(Error('mint failed: '+secret),{code:'boom'});},()=>null,input=>({...good(input),inviter:{iss:'https://other.example',sub:w.developerId}}),input=>({...good(input),inviter:{iss:origin,sub:crypto.randomUUID()}}),
  input=>({...good(input),token:'short'}),input=>({...good(input),expires_at:Math.floor(Date.now()/1000)+7200}),input=>({...good(input),expires_at:Math.floor(Date.now()/1000)-1}),input=>({...good(input),extra:secret}),input=>({...good(input),delegation:'a'.repeat(2049)}),input=>({...good(input),hint:'reply'})];
 for(const answer of answers){w.state.mintAnswer=answer;const result=await w.route('POST');assert.equal(result.status,503);assert.deepEqual(result.value,{error:'developer_unavailable',available:false,reason:'developer-unavailable'});assert.equal(JSON.stringify(result).includes(secret),false);}
 w.state.mintAnswer=input=>({...good(input),hint:'no-reply'});assert.equal((await w.route('POST')).status,200);
}finally{w.close();}});

test('the minted token never reaches logs or the requesting account store',async t=>{const w=await world();try{
 const logged=[];for(const level of ['log','info','warn','error','debug'])t.mock.method(console,level,(...args)=>logged.push(args.map(String).join(' ')));
 w.state.tier='paid';const result=await w.route('POST');assert.equal(result.status,200);const secret=w.state.token;assert.ok(secret);
 assert.equal(logged.some(line=>line.includes(secret)),false);
 const rows=await w.metadata.list({prefix:''});assert.equal(JSON.stringify([...rows]).includes(secret),false);
}finally{w.close();}});

test('rate limiting covers GET and POST with a stable code; the route allows GET and POST and POST is capacity-exempt',async()=>{const w=await world();try{
 const seen=[];const limit=async(env,input)=>{seen.push(input);return false;};
 for(const method of ['GET','POST'])assert.deepEqual(await w.route(method,{limit}),{status:429,value:{error:'rate_limited'},headers:{'Retry-After':'60'}});
 assert.deepEqual(seen.map(s=>[s.operation,s.handle]),[['developer-contact',w.userId],['developer-contact',w.userId]]);assert.equal(w.state.mints.length,0);
 assert.deepEqual(await w.route('DELETE'),{status:405,value:{error:'method_not_allowed'},headers:{Allow:'GET, POST'}});
 assert.deepEqual(allowedMethods('/api/developer-contact'),['GET','POST']);assert.equal(admission.exempt('/api/developer-contact'),true);
}finally{w.close();}});

test('developer contact is off without DEVELOPER_CONTACT_HANDLE: no lookup and no cron census',async()=>{
 const {default:http}=await import('../packages/runtime/http.mjs');
 for(const handle of [undefined,'','  ']){
  const lookups=[],census=[],waits=[],env={APP_ORIGIN:origin,DEVELOPER_CONTACT_MINT:async()=>{throw Error('unreachable');},...handle===undefined?{}:{DEVELOPER_CONTACT_HANDLE:handle},IDENTITY_REPOSITORY:{findByHandle:async h=>{lookups.push(h);return null;}},DEVELOPER_CONTACT_POPULATION:{censusStep:async()=>{census.push(1);}}};
  const result=await developerContactRoutes({path:'/api/developer-contact',request:{method:'GET'},env,owner:{account:{id:crypto.randomUUID()}},accountHandle:()=>{throw Error('unreachable');},json:(value,status=200)=>({status,value})});
  assert.deepEqual(result,{status:200,value:{available:false,reason:'developer-unavailable'}});assert.deepEqual(lookups,[]);
  await http.scheduled({},env,{waitUntil:p=>waits.push(p)});await Promise.all(waits);assert.deepEqual(census,[]);
 }
 const lookups=[],census=[],waits=[],env={APP_ORIGIN:origin,DEVELOPER_CONTACT_MINT:async()=>{throw Error('unreachable');},DEVELOPER_CONTACT_HANDLE:'n.someone',IDENTITY_REPOSITORY:{findByHandle:async h=>{lookups.push(h);return null;}},DEVELOPER_CONTACT_POPULATION:{censusStep:async()=>{census.push(1);}}};
 const result=await developerContactRoutes({path:'/api/developer-contact',request:{method:'GET'},env,owner:{account:{id:crypto.randomUUID()}},accountHandle:()=>{throw Error('unreachable');},json:(value,status=200)=>({status,value})});
 assert.deepEqual(result.value,{available:false,reason:'developer-unavailable'});assert.deepEqual(lookups,['n.someone']);
 await http.scheduled({},env,{waitUntil:p=>waits.push(p)});await Promise.all(waits);assert.deepEqual(census,[1]);
});

test('review L5: GET reads the cached entitlement (no forced billing refresh); POST re-checks with a fresh one',async()=>{const w=await world();try{
 w.state.tier='paid';await w.route('GET');assert.deepEqual(w.state.tierCalls,[{fresh:false}]);
 await w.route('POST');assert.deepEqual(w.state.tierCalls.at(-1),{fresh:true});
}finally{w.close();}});
