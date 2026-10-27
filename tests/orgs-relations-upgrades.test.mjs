import test from 'node:test';
import assert from 'node:assert/strict';
import {relationsHost,rejects,ISS,STORE} from './helpers/relations-world.mjs';
import {relationUpgradeMethods} from '../packages/orgs/relation-upgrades.mjs';

async function setup(){
 const h=await relationsHost({orgs:2}),[A,B]=h.list;
 Object.assign(A.relations,relationUpgradeMethods);
 const resource=await A.resource(`${ISS}/r/upgrades/files`,{[STORE]:['get','list','put']});
 const {instance}=await h.relate(A,B,{give:{0:[{resource}]}});
 const old=structuredClone(h.bodies.share),next=structuredClone(old);
 next.access.push({...structuredClone(next.access[0]),grantor:'recipient',grantee:'owner',required:false});
 const pins=await h.publish('share',[old,next]);
 return {h,A,B,resource,instance,pins,input:{instance,counterpart:B.principal,version:pins[1],values:{0:[{resource}]}},call:function(input=this.input,actor=this.A.act(this.A.admin)){return this.A.relations.upgrade(actor,input);}};
}

test('additive upgrade offers a replacement with full acceptance and leaves previous edge unchanged',async()=>{
 const w=await setup();try{
  const before=await w.A.cp(w.instance,w.B),out=await w.call();
  assert.equal(out.replacement,true);assert.equal(out.previous,w.instance);assert.notEqual(out.instance,w.instance);
  assert.deepEqual(await w.A.cp(w.instance,w.B),before);
  assert.equal(await w.A.cp(out.instance,w.B),undefined,'replacement has no live edge before acceptance');
  await w.A.system('relations.outbox-drain');
  const review=await w.B.run('relations.inbound-preview',null,{invitation:out.invitation});
  assert.equal(review.relation.pin.version,2);
  await rejects(w.B.run('relations.accept',null,{invitation:out.invitation,receive:true}),'relation_disclosure_changed');
  await w.h.accept(w.B,out.invitation,{receive:true});
  assert.equal((await w.B.cp(out.instance,w.A)).state,'live');
  assert.equal((await w.A.cp(w.instance,w.B)).state,'live');
 }finally{await w.h.close();}
});

test('upgrade requires flag, fresh admin, newer additive pins and document-defined disclosure',async()=>{
 const w=await setup();try{
  await rejects(w.call(w.input,w.A.act(w.A.member)),'not_found');
  await rejects(w.call(w.input,w.A.act(w.A.admin,{authTime:0})),'reauthentication_required');
  w.h.flag.on=false;await rejects(w.call(),'not_found');w.h.flag.on=true;
  await rejects(w.call({...w.input,version:w.pins[0]}),'relation_upgrade_invalid');
  await rejects(w.call({...w.input,disclosure:'named'}),'invalid_request');
  const changed=structuredClone(w.h.bodies.share);changed.title='Changed';
  const pins=await w.h.publish('share',[w.h.bodies.share,changed]);
  await rejects(w.call({...w.input,version:pins[1]}),'relation_upgrade_invalid');
  assert.equal((await w.A.part(w.instance)).state,'live');
 }finally{await w.h.close();}
});

test('failed replacement invitation retires its empty instance without touching the old relation',async()=>{
 const w=await setup();try{
  await rejects(w.call({...w.input,values:{999:[{resource:w.resource}]}}),'relation_values_invalid');
  const rows=[...(await w.A.list('rel/instance/')).values()];
  assert.equal(rows.filter(p=>p.state==='live').length,1);
  assert.equal((await w.A.part(w.instance)).state,'live');
 }finally{await w.h.close();}
});
