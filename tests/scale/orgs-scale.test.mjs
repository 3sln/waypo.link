// Wargame F-02 at the size the Scale plan sells (5,000 members), at the engine level. Slow (about half a minute), so it
// runs in `npm run test:organizations`, not `npm test`; tests/orgs-wargame.test.mjs covers the same rules at 800 members.
// Asserts that no stored value approaches the 2 MB Durable Object value limit, and that a join, the sweep, an admin grant
// change, the member's own view and an admin removal cost the same store work at 100 and at 5,000 members.
import test from 'node:test';
import assert from 'node:assert/strict';
import {world,uuid,freshStats,storedSizes,A} from '../helpers/org-world.mjs';
import {ORGANIZATION_PLANS} from '../../packages/billing/organizations.mjs';

const G=[{resource:'https://3sln.example/r/1',methods:{'https://contract.example/v1':['get','put']}}];
test('F-02: an organization with the 5,000 members its plan sells stays far under the platform value limit, at flat per-operation cost',{timeout:600000},async()=>{const w=await world(1,{plan:'org-scale'});try{
 const N=ORGANIZATION_PLANS['org-scale'].members;assert.equal(N,5000);
 const measure=async fn=>{Object.assign(w.stats,freshStats());const t=performance.now();await fn();return {...w.stats,ms:performance.now()-t};};
 let n=0,last=null;const grow=async to=>{while(n<to){n++;last=await w.join(uuid(n),G);}};
 const cost=async tag=>{const ops={};
  ops.join=await measure(()=>w.join(uuid(900000+tag),G));
  ops.sweep=await measure(()=>w.sweep());
  ops.grants=await measure(()=>w.run('orgs.member-grants',A,{membership:last.id,grants:[]}));
  ops.membership=await measure(()=>w.run('orgs.membership',last.principal.sub));
  ops.members=await measure(()=>w.run('orgs.members',A));
  ops.remove=await measure(()=>w.run('orgs.remove-member',A,{membership:last.id}));
  return ops;};
 await grow(100);const small=await cost(1);await grow(N-3);const large=await cost(2);
 for(const op of Object.keys(small))for(const metric of ['reads','writes','readBytes','writeBytes'])assert.ok(large[op][metric]<=small[op][metric]*1.25+64,`${op} ${metric}: ${small[op][metric]} at 100 members, ${large[op][metric]} at ${N}`);
 const summary=await w.summary();assert.equal(summary.roster.live,N-2,'owner + 4,999 members joined, two removed');
 const sizes=await storedSizes(w.metadata);
 assert.ok(sizes[0].bytes<64*1024,`largest stored value ${sizes[0].key} is ${sizes[0].bytes} bytes (Durable Object limit 2 MB)`);
 assert.ok(JSON.stringify(summary).length<16*1024,'the record holds only bounded summary state');
}finally{await w.close();}});
