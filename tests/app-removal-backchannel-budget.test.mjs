// Wargame F2 regressions: the back-channel per-client budget is never keyed on an unverified `iss` alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteMetadata} from '../apps/node/resources.mjs';
import {FixedWindowGuard} from '../packages/runtime/accounts.mjs';
import {stages,REMOVAL_COMPLETE} from '../packages/runtime/routes/app-removal.mjs';
const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',RID=OWNER+'.bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',ATTACKER='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',ARID=ATTACKER+'.ffffffff-ffff-4fff-8fff-ffffffffffff',ORIGIN='https://issuer.example',VICTIM='https://tasks.example/client.json';
const assertion=(claims,sig='sig')=>['e30',Buffer.from(JSON.stringify(claims)).toString('base64url'),sig].join('.');
// A windowed limiter with the FixedWindowGuard contract, including `peek`.
function limiter(){const buckets=new Map();return {buckets,consume:async(key,{limit,peek=false})=>{const n=buckets.get(key)??0;if(n+1>limit)return false;if(!peek)buckets.set(key,n+1);return true;}};}
function fixture({abuse=limiter()}={}){
 let completions=0,verifications=0;
 const env={APP_ORIGIN:ORIGIN,SESSION_COOKIE_KEY:'k',ABUSE:abuse,
  ACCOUNTS:{idFromName:x=>x,get:()=>({invoke:async({method,args})=>method==='appRemovalAdmission'?([RID,ARID].includes(args?.[1])?{clientId:VICTIM,removal:args[1]}:null):method==='appRemovalComplete'?(completions++,{}):null})},
  FEDERATION_AUTHORITY:{removalVerifyAssertion:async({assertion})=>{verifications++;if(!assertion.endsWith('.genuine'))throw Error('bad signature');}}};
 const post=(ip,claims,sig)=>stages.public({path:REMOVAL_COMPLETE,env,request:new Request(ORIGIN+REMOVAL_COMPLETE,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','CF-Connecting-IP':ip},body:new URLSearchParams({outcome:'completed',client_assertion_type:'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',client_assertion:assertion(claims,sig)})})});
 return {env,abuse,post,completions:()=>completions,verifications:()=>verifications};
}
test('F2: forged assertions naming a victim client cannot starve its genuine back-channel completion',async()=>{
 // The original repro limiter has no peek support and counts every call.
 const buckets=new Map(),f=fixture({abuse:{consume:async(key,{limit})=>{const n=(buckets.get(key)??0)+1;buckets.set(key,n);return n<=limit;}}});
 for(let i=0;i<30;i++)assert.equal((await f.post('198.51.100.'+i,{iss:VICTIM,bindle_removal:'x'})).status,202);
 assert.equal((await f.post('192.0.2.10',{iss:VICTIM,bindle_removal:RID},'genuine')).status,202);
 assert.equal(f.completions(),1);
});
test('F2: only failed verifications of a locally matched removal spend the per-client budget',async()=>{
 const f=fixture();
 // Successes never charge it.
 for(let i=0;i<40;i++)await f.post('192.0.2.'+i,{iss:VICTIM,bindle_removal:RID},'genuine');
 assert.equal(f.completions(),40);
 assert.equal([...f.abuse.buckets.keys()].filter(k=>k.startsWith('app-removal:removal-failure:')).length,0);
 // Thirty bad signatures for a matched removal exhaust it; verification then stops for that client.
 for(let i=0;i<30;i++)await f.post('203.0.113.'+i,{iss:VICTIM,bindle_removal:RID},'forged');
 const before=f.verifications();
 await f.post('203.0.113.200',{iss:VICTIM,bindle_removal:RID},'forged');
 assert.equal(f.verifications(),before,'verification attempted after the failure budget ran out');
});
test('F2: the per-source budget still applies before any lookup or verification',async()=>{
 const f=fixture();
 for(let i=0;i<30;i++)await f.post('198.51.100.7',{iss:VICTIM,bindle_removal:RID},'forged');
 const before=f.verifications();
 await f.post('198.51.100.7',{iss:VICTIM,bindle_removal:RID},'genuine');
 assert.equal(f.verifications(),before);assert.equal(f.completions(),0);
});
test('F2: FixedWindowGuard peek reports capacity without spending it',async t=>{
 const metadata=new SqliteMetadata(':memory:');t.after(()=>metadata.close());const guard=new FixedWindowGuard({metadata,clock:()=>1000000});
 for(let i=0;i<5;i++)assert.equal(await guard.consume({windowMs:60000,limit:2,peek:true}),true);
 assert.equal(await guard.consume({windowMs:60000,limit:2}),true);assert.equal(await guard.consume({windowMs:60000,limit:2}),true);
 assert.equal(await guard.consume({windowMs:60000,limit:2,peek:true}),false);
 assert.equal(await guard.consume({lifetime:true,limit:2,peek:true}),false,'peek is windowed only');
});
test('review follow-up 1: an attacker who opens their own removal of the app cannot starve another owner\'s completion',async()=>{
 const f=fixture();
 // The attacker's own clean removal of the victim app matches locally, so forged assertions under it reach verification.
 for(let i=0;i<60;i++)await f.post('203.0.113.'+i,{iss:VICTIM,bindle_removal:ARID},'forged');
 const before=f.verifications();
 assert.equal((await f.post('192.0.2.10',{iss:VICTIM,bindle_removal:RID},'genuine')).status,202);
 assert.equal(f.verifications(),before+1);assert.equal(f.completions(),1);
});
