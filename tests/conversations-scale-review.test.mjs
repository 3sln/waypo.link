// Scale round 2 review follow-ups (2026-10-24) for legacy conversations.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ConversationService,memberId} from '../packages/conversations/index.mjs';

const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',room='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const id=n=>String(n).padStart(12,'0');
function memoryMetadata(){
 const rows=new Map();
 const api={
  async get(k){const v=rows.get(k);return v===undefined?undefined:structuredClone(v);},
  async put(k,v){rows.set(k,structuredClone(v));},
  async delete(k){for(const key of Array.isArray(k)?k:[k])rows.delete(key);},
  async list({prefix='',startAfter,limit=1000}={}){const out=new Map();for(const k of [...rows.keys()].sort()){if(!k.startsWith(prefix))continue;if(startAfter!==undefined&&k<=startAfter)continue;out.set(k,structuredClone(rows.get(k)));if(out.size>=limit)break;}return out;},
  async setAlarm(){},
  async transaction(fn){return fn(api);},
  rows
 };
 return api;
}

test('L3: a redrive page made only of expired backlog keeps the job for the live entries behind it',async()=>{
 const now=1e12,metadata=memoryMetadata(),source={owner,origin:'https://owner.example'},target={owner:room,origin:'https://peer.example'},peer=memberId(target);
 const svc=new ConversationService({metadata,owner,origin:source.origin,seal:async v=>v,open:async v=>v,identity:async()=>null,transport:async()=>{},inbox:async()=>({}),clock:()=>now});
 // Sixteen expired backlog letters sort ahead of one live letter in the peer index.
 for(let i=0;i<16;i++)await svc.metadata.put('conversation/dead/'+room+'/'+id(i),{target,source,id:room,eventId:id(i),kind:'invite',state:'paused',deadAt:0,code:'conversation_peer_backlog'});
 await svc.metadata.put('conversation/dead/'+room+'/live',{target,source,id:room,eventId:'live',kind:'invite',state:'paused',deadAt:now,code:'conversation_peer_backlog'});
 await metadata.put('conversation/sweep/index-migration',{phase:3});
 await metadata.put('conversation/sweep/redrive-job/'+encodeURIComponent(peer),peer);
 for(let i=0;i<3;i++)await svc.drain({limit:16});
 const outbox=[...(await metadata.list({prefix:'conversation/outbox/'})).values()];
 assert.deepEqual(outbox.map(t=>t.eventId),['live'],'the live backlog letter was requeued');
 assert.equal((await metadata.list({prefix:'conversation/dead/'})).size,0);
});
