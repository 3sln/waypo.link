// Session kinds and session handler approvals (signaling AMD-SG-I1 §20.1, proposed and unsigned, not applied to
// intents.md): the `session` member rules, the frozen growth row, disclosure, projection and the approval records.
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateIntentKind} from '../packages/intents/schema.mjs';
import {validateAdditive} from '../packages/core/artefacts.mjs';
import {sessionMemberValid,sessionBodyValid,partiesAdmit,basisAllowed,profileAllowed,addsDisclosure,projectContext,memoryKey,approvalIn,withApproval,withoutApproval,listApprovals,handlerOf} from '../packages/intents/sessions.mjs';
import {kindBody} from './helpers/signaling-fixture.mjs';
import {SqliteMetadata} from '../apps/node/resources.mjs';

const LINE='https://sync.example/kinds/device-sync/v1';
const valid=body=>{try{validateIntentKind(body);return true;}catch{return false;}};

test('§20.1.1: the session member is exactly {v:1, parties, profiles} plus optional bases',()=>{
 assert.equal(sessionMemberValid({v:1,parties:'self',profiles:{data:{}}}),true);
 assert.equal(sessionMemberValid({v:1,parties:'any',profiles:{data:{},webrtc:{}},bases:['offer','pairing']}),true);
 for(const bad of [
  {v:2,parties:'self',profiles:{data:{}}},{v:1,parties:'everyone',profiles:{data:{}}},{v:1,parties:'self',profiles:{}},
  {v:1,parties:'self',profiles:{sip:{}}},{v:1,parties:'self',profiles:{webrtc:{media:['audio']}}},{v:1,parties:'self',profiles:{data:{}},extra:1},
  {v:1,parties:'self',profiles:{data:{}},bases:[]},{v:1,parties:'self',profiles:{data:{}},bases:['link']},{v:1,parties:'self',profiles:{data:{}},bases:['none']},
  {v:1,parties:'self',profiles:{data:{}},bases:['self','self']},
 ])assert.equal(sessionMemberValid(bad),false,JSON.stringify(bad));
});

test('§20.1.1: a session kind is join, never a capability, bounded to 2,048 bytes and 8 data properties',()=>{
 const ok=kindBody({line:LINE,parties:'self'});assert.equal(valid(ok),true);assert.equal(sessionBodyValid(ok),true);
 assert.equal(valid({...ok,effect:'view'}),false,'effect join');
 assert.equal(valid({...ok,capability:true}),false,'capability false');
 const {max_bytes,...noBytes}=ok;assert.equal(valid(noBytes),false,'max_bytes required');
 assert.equal(valid({...ok,max_bytes:4096}),false,'max_bytes at most 2,048');
 const nine=kindBody({line:LINE,properties:Object.fromEntries(Array.from({length:9},(_,i)=>['p'+i,{type:'boolean'}]))});assert.equal(valid(nine),false,'at most 8 data properties');
 const eight=kindBody({line:LINE,properties:Object.fromEntries(Array.from({length:8},(_,i)=>['p'+i,{type:'boolean'}]))});assert.equal(valid(eight),true);
 // An ordinary intent kind without `session` is unchanged.
 const {session,...plain}=ok;assert.equal(valid({...plain,effect:'view'}),true);
});

test('§20.1.1 growth table: `/session` is frozen (any change under it is not additive)',()=>{
 const a=kindBody({line:LINE,parties:'self'}),b=structuredClone(a);b.session.bases=['self'];
 assert.equal(validateAdditive('intent',a,b).additive,false);
 const c=structuredClone(a);c.title.fr='Synchro';assert.equal(validateAdditive('intent',a,c).additive,true,'a translation stays additive');
 const {session,...without}=a;assert.equal(validateAdditive('intent',a,without).additive,false,'removing session');
});

test('§3.4: parties, bases and profiles are read from the session member',()=>{
 const self=kindBody({line:LINE,parties:'self',profiles:{data:{}}}),other=kindBody({line:LINE,parties:'other',bases:['offer']});
 assert.equal(partiesAdmit(self,{own:true}),true);assert.equal(partiesAdmit(self,{own:false}),false);
 assert.equal(partiesAdmit(other,{own:true}),false);assert.equal(partiesAdmit(other,{own:false}),true);
 assert.equal(basisAllowed(self,'offer'),true,'absent bases allows every basis');assert.equal(basisAllowed(other,'pairing'),false);
 assert.equal(profileAllowed(self,'data'),true);assert.equal(profileAllowed(self,'webrtc'),false);
});

test('§15, §5.8: disclosure-adding versions and context projection',()=>{
 const v1=kindBody({line:LINE,properties:{call:{type:'string',maxLength:36,format:'uuid'}},categories:['personal-data']});
 const v2=structuredClone(v1);v2.data.properties.room={type:'string',maxLength:36,format:'uuid'};v2.disclosure.fields.room={title:{en:'room'},categories:['personal-data'],display:'presence'};
 assert.equal(validateAdditive('intent',v1,v2).additive,true);assert.equal(addsDisclosure(v1,v2),false,'same categories: no new disclosure');
 const v3=structuredClone(v2);v3.disclosure.fields.room.categories=['location'];assert.equal(addsDisclosure(v1,v3),true,'a new category adds disclosure');
 assert.deepEqual(projectContext({call:'x',room:'y'},v1),{call:'x'});assert.equal(projectContext(null,v1),null);
});

test('§20.1.4: approval records live in intents memory beside the default, per handler, fail closed',async()=>{
 const owner='0a0a0a0a-0000-4000-8000-000000000001',store=new SqliteMetadata(':memory:'),key=memoryKey(owner,LINE);
 assert.equal(key,'intent-memory/'+owner+'/'+encodeURIComponent(LINE),'the router\'s memory key');
 const app=handlerOf({clientId:'https://app.example/client'}),feature=handlerOf({clientId:'https://3sln.example',feature:'https://3sln.example/extensions/answering/v1'});
 assert.deepEqual(feature,{handler:'https://3sln.example/extensions/answering/v1',feature:true});
 let m=withApproval({kind:LINE,default:{handler:'x'}},LINE,{...app,version:1,digest:'d1',at:1,autoConnect:true});
 assert.equal(m.default.handler,'x','the routing default is untouched');
 m=withApproval(m,LINE,{...feature,version:1,digest:'d1',at:2,autoConnect:false});
 assert.equal(approvalIn(m,app).autoConnect,true);assert.equal(approvalIn(m,feature).at,2);
 m=withApproval(m,LINE,{...app,version:2,digest:'d2',at:3,autoConnect:false});assert.equal(approvalIn(m,app).version,2,'replaced, not duplicated');assert.equal(m.approvals.length,2);
 const r=withoutApproval(m,app);assert.equal(r.removed,true);assert.equal(approvalIn(r.memory,app),null);
 assert.equal(approvalIn({approvals:[{handler:app.handler,feature:false,version:'1'}]},app),null,'malformed approves nothing');
 await store.put(key,m);const listed=await store.transaction(tx=>listApprovals(tx,owner));assert.equal(listed.length,2);assert.equal(listed[0].line,LINE);
});

test('§20.1.2: a session kind received as an intent link is refused (intent_kind_invalid) after resolution, without handoff',async()=>{
 const {createAppEngine,read,perform}=await import('../packages/app/engine.mjs');
 const {ResolveIntent,Candidates}=await import('../packages/intents/router.mjs');
 const {encodeIntent}=await import('../packages/intents/format.mjs');
 const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',db=new SqliteMetadata(':memory:'),digest='sha256-'+'A'.repeat(43),body=kindBody({line:LINE,parties:'self'});
 const calls=[],config={APP_ORIGIN:'https://provider.example',INTENT_LINKS_ENABLED:'true',ARTEFACT_VERSIONS_ENABLED:'true',INTENT_BUILTINS:[],ARTEFACTS:{enabled:true,resolve:async input=>{calls.push(input);return {body:structuredClone(body),reference:{artefact:input.artefact,version:input.version,digest:input.digest}};}}};
 let n=0;const engine=createAppEngine({providers:{clock:{now:()=>Date.UTC(2026,9,28)},random:{uuid:()=>`00000000-0000-0000-0000-${String(++n).padStart(12,'0')}`},audit:{record(){}},accountStore:db,config}});
 const value=encodeIntent({bintent:1,kind:{artefact:LINE,version:1,digest},data:{}});
 try{
  await assert.rejects(read(engine,new Candidates({actor:{kind:'owner',owner},input:{value}})),e=>e.code==='intent_kind_invalid');
  await assert.rejects(perform(engine,new ResolveIntent({actor:{kind:'owner',owner},input:{value}})),e=>e.code==='intent_kind_invalid');
  assert.equal(calls.length,2,'refused after kind resolution');assert.equal((await db.list({prefix:'intent-flow/'})).size,0,'no flow receipt, no handoff');
 }finally{await engine.dispose();}
});
