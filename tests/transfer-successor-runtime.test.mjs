import test from 'node:test';import assert from 'node:assert/strict';
import {AccountController} from '../packages/runtime/accounts.mjs';
import {SqliteMetadata,SerialGate} from '../apps/node/resources.mjs';
import {key} from '../packages/core/records.mjs';
import {forEachSeed} from './helpers/chaos.mjs';
const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',OTHER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',origin={iss:'https://old.example',sub:OTHER};
async function fixture(t){const metadata=new SqliteMetadata(':memory:');t.after(()=>metadata.close());await metadata.put('owner',OWNER);const flag={on:true},c=new AccountController({metadata,gate:new SerialGate(),blobs:{},archives:{},sql:metadata.sql,config:{APP_ORIGIN:'https://host.example',flags:{for:()=>({enabled:()=>flag.on,global:()=>false,background:()=>false,envState:()=>({state:"unset"}),evaluate:()=>({value:false})})}}});return {c,metadata,flag};}
test('pending successor projection is owner-bound, relationship-scoped and never exposes signed package material',async t=>{
 const {c,metadata}=await fixture(t),digest='d'.repeat(43);await metadata.put(key('successor-pending',origin.iss,origin.sub,digest),{digest,seq:1,reason:'source-active',from:{iss:origin.iss},to:{iss:'https://new.example'},offeredAt:1,record:{statement:'not projected',attestation:'not projected'}});
 const value=await c.transferSuccessorPending(OWNER,{origin});assert.equal(value.pending.length,1);assert.equal(value.pending[0].oldProviderConfirmed,false);assert.equal(value.pending[0].oldHost,origin.iss);assert.ok(!JSON.stringify(value).includes('not projected'));
 assert.deepEqual((await c.transferSuccessorPending(OWNER,{origin:{...origin,sub:OWNER}})).pending,[]);await assert.rejects(c.transferSuccessorPending(OTHER,{origin}),{code:'not_found'});
});
test('review refuses disabled flags and malformed origins, adoption requires explicit confirmation',async t=>{
 const {c,flag}=await fixture(t);await assert.rejects(c.transferSuccessorDecide(OWNER,{origin,digest:'d'}),{code:'confirmation_required'});await assert.rejects(c.transferSuccessorPending(OWNER,{origin:{iss:'https://old.example/path',sub:OTHER}}),{code:'invalid_request'});flag.on=false;await assert.rejects(c.transferSuccessorPending(OWNER,{origin}),{code:'not_found'});
});
test('seeded parallel owner reads and foreign-owner attempts never leak pending relationships',async t=>{const {c}=await fixture(t);await forEachSeed(12,async random=>{const jobs=Array.from({length:12},()=>random.chance(.5)?c.transferSuccessorPending(OWNER,{origin}).then(value=>assert.deepEqual(value.pending,[])):assert.rejects(c.transferSuccessorPending(OTHER,{origin}),{code:'not_found'}));await Promise.all(jobs);});});
