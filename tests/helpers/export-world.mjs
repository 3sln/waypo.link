// Wargame 4 export world: the fixture of tests/engine-account-export.test.mjs, shared for the M4 regression tests.
import {createTestEngine,OWNER,OTHER} from './app-engine.mjs';
import {fakeClock} from './chaos.mjs';
import * as E from '../../packages/app/domains/account-export.mjs';
import {createExportDigest} from '../../packages/runtime/export-generation.mjs';
import {createFlags} from '../../packages/flags/evaluate.mjs';
export {E};
export {OWNER,OTHER};
export const OP='00000000-0000-4000-8000-000000000001',OP2='00000000-0000-4000-8000-000000000002',OP3='00000000-0000-4000-8000-000000000003';
export function bucket(){const rows=new Map(),calls=[];return {rows,calls,async put(key,value){calls.push(['put',key]);rows.set(key,new Uint8Array(typeof value==='string'?new TextEncoder().encode(value):value));},async delete(keys){for(const key of Array.isArray(keys)?keys:[keys]){calls.push(['delete',key]);rows.delete(key);}},async get(key,{range}={}){calls.push(['get',key]);const value=rows.get(key);if(!value)return null;return {size:value.length,body:new Blob([range?value.slice(range.offset,range.offset+range.length):value]).stream(),arrayBuffer:async()=>value.slice().buffer,text:async()=>new TextDecoder().decode(value)};}};}
export async function fixture(t,{enabled=true,security={epoch:0,changedAt:0},contributors,notice,identity}={}){
 const clock=fakeClock(),archives=bucket(),blobs=bucket(),notices=[],env={ACCOUNT_EXPORT_ENABLED:enabled?'true':undefined};
 const ports={identitySecurity:async()=>security,digest:createExportDigest(),quota:async()=>1024**3,notice:notice??(async n=>{notices.push(n);}),contributorPorts:{identity:identity??(async()=>({id:OWNER,handle:'@owner.example1234',createdAt:1,status:'active',audit:[],passkeys:[],sessions:[]})),keys:async()=>({publicKeys:[],keyIds:[]}),grants:{page:async()=>({rows:[],done:true})},externalStorage:{page:async()=>({rows:[],done:true})}},...contributors?{contributors}:{}};
 const flags={for:ctx=>createFlags({snapshot:{v:1,version:0,issuedAt:0,flags:{}},env,clock:clock.now}).for(ctx)};
 const f=await createTestEngine({clock,providers:{archives,blobs,flags},config:{APP_ORIGIN:'https://issuer.example',exportPorts:ports}});await f.metadata.put('owner',OWNER);t.after(()=>f.dispose());
 const actor=()=>({kind:'owner',owner:OWNER,sessionId:'session1',stepUpAt:clock.now(),stepUpMethod:'passkey'}),system={kind:'system',owner:OWNER};
 const op=(Operation,{actor:who=actor(),...params}={})=>['exports.list','exports.status','exports.layout'].includes(Operation.operation)?f.read(new Operation({actor:who,...params})):f.perform(new Operation({actor:who,...params}));
 const create=(operationId=OP,extra={})=>op(E.CreateExport,{input:{operationId,...extra}});
 return {...f,clock,archives,blobs,notices,env,ports,security,flags,op,create,actor,system};
}
