// An OwnershipService organization over the real OrganizationBilling and the offline Polar model (tests/helpers/
// org-polar.mjs), driven through the production engine operations: the world of tests/orgs-ownership.test.mjs, shared by
// the 2026-10-23 wargame regression tests. `meter` counts the store work each operation does (reads, writes, bytes, the
// largest value written), so scale tests can assert that per-operation cost does not grow with the roster.
import assert from 'node:assert/strict';
import {SqliteMetadata} from '../../apps/node/resources.mjs';
import {createAppEngine,perform,read,AppQuery} from '../../packages/app/engine.mjs';
import {memoryAudit} from '../../packages/app/providers.mjs';
import {fakeClock,seededRandom,createRandom} from '../../packages/app/memory-providers.mjs';
import {OwnershipService,organizationEntitlementPort} from '../../packages/orgs/ownership.mjs';
import {readOrganization} from '../../packages/orgs/roster.mjs';
import {principalKey} from '../../packages/orgs/grants.mjs';
import {organizationsProvider,ORG_OPERATIONS,ORG_SYSTEM_OPERATIONS} from '../../packages/app/domains/orgs.mjs';
import {OrganizationBilling} from '../../packages/billing/organizations.mjs';
import {fakeOrgPolar,ORG_POLAR_CONFIG} from './org-polar.mjs';

export const ISS='https://3sln.example',ORG='dddddddd-dddd-4ddd-8ddd-dddddddddddd',A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',C='cccccccc-cccc-4ccc-8ccc-cccccccccccc',E='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',DAY=86400000,REQUEST='test-request-00001';
export const p=sub=>({iss:ISS,sub});
export const OPS=Object.fromEntries([...ORG_OPERATIONS,...ORG_SYSTEM_OPERATIONS].map(O=>[O.operation,O]));
export const rejects=(promise,code)=>assert.rejects(promise,e=>e.code===code||assert.fail(`expected ${code}, got ${e.code}: ${e.message}`));
/** A distinct, valid UUID per n (a member principal). */
export const uuid=n=>{const h=n.toString(16).padStart(12,'0');return `0000${h.slice(0,4)}-0000-4000-8000-${h}`;};
const prov=sub=>({kid:'k-'+sub.slice(0,8)+'-0123456789abcdef0123',publicKey:{kty:'EC',crv:'P-256',x:'x'.repeat(43),y:'y'.repeat(43)},certificationKid:null,authentication:'same-host-session'});

/** Wraps an account store so every read and write is counted in `stats`. */
export function metered(metadata,stats){
 const size=value=>value===undefined?0:JSON.stringify(value).length;
 const wrap=tx=>({
  get:async key=>{const v=await tx.get(key);stats.reads++;stats.readBytes+=size(v);return v;},
  put:async(key,value)=>{const n=size(value);stats.writes++;stats.writeBytes+=n;if(n>stats.maxValue){stats.maxValue=n;stats.maxKey=key;}return tx.put(key,value);},
  delete:async key=>{stats.writes++;return tx.delete(key);},
  list:async options=>{const rows=await tx.list(options);stats.lists++;stats.reads+=rows.size;for(const v of rows.values())stats.readBytes+=size(v);return rows;}
 });
 return {transaction:fn=>metadata.transaction(tx=>fn(wrap(tx))),get:key=>wrap(metadata).get(key),put:(key,value)=>wrap(metadata).put(key,value),delete:key=>wrap(metadata).delete(key),list:options=>wrap(metadata).list(options)};
}
export const freshStats=()=>({reads:0,writes:0,lists:0,readBytes:0,writeBytes:0,maxValue:0,maxKey:null});

export async function world(seed=1,{allowlist='',configured=true,owner=A,currency='usd',plan='org-team'}={}){
 const metadata=new SqliteMetadata(':memory:'),clock=fakeClock(400*DAY),random=seededRandom(createRandom(seed)),flag={on:true};await metadata.put('owner',ORG);
 const stats=freshStats(),store=metered(metadata,stats);
 const polar=fakeOrgPolar({clock}),config=configured?ORG_POLAR_CONFIG:{...ORG_POLAR_CONFIG,POLAR_SERVER:'production'};
 const billing=new OrganizationBilling({config,client:polar.client,now:clock.now});
 const people=new Map([[A,{kind:'person',status:'active',handle:'alice'}],[B,{kind:'person',status:'active',handle:'bob'}],[C,{kind:'person',status:'active',handle:'carol'}],[E,{kind:'person',status:'active',handle:'erin'}]]);
 const indexed=[],rotations=[],alerts=[];
 const effects={rotateRecovery:async org=>{rotations.push(org);return {rotated:true};},index:async(person,input)=>{indexed.push({person,...input});return true;}};
 const service=new OwnershipService({metadata:store,clock,random,issuer:ISS,flags:{for:()=>({enabled:()=>flag.on})},plans:organizationEntitlementPort({allowlist,billing}),billing,accounts:{get:async sub=>people.get(sub)??{kind:'person',status:'active',handle:'m'+sub.slice(-6)}},effects,alert:entry=>alerts.push(entry)});
 const engine=createAppEngine({providers:{clock,random,audit:memoryAudit({clock}),organizations:organizationsProvider(service)}});
 await perform(engine,new OPS['orgs.initialize']({actor:{kind:'system',owner:ORG},input:{request:REQUEST,creator:p(owner),name:'Acme',plan:{source:'polar',plan},addedUnder:prov(owner)}}));
 const verification=(extra={})=>({stepUpAt:clock.now(),enrolledAt:clock.now()-30*DAY,securityChangedAt:clock.now()-60*DAY,...extra});
 const act=(sub,extra={})=>({kind:'owner',owner:ORG,principal:p(sub),entity:{kind:'organization',id:ORG},powers:[],authTime:clock.now(),epoch:0,aep:0,verification:verification(),addedUnder:prov(sub),...extra});
 const run=(op,sub,input={},extra={})=>{const action=new OPS[op]({actor:sub==='system'?{kind:'system',owner:ORG}:act(sub,extra),input});return action instanceof AppQuery?read(engine,action):perform(engine,action);};
 const record=()=>readOrganization(metadata),summary=()=>metadata.get('org/record-v1');
 const member=async sub=>metadata.get('org/member/'+principalKey(p(sub)));
 const join=async(sub,grants=[],inviteExtra={},by=null)=>{const inviter=by??(await summary()).ownerOfRecord.sub;const invite=await run('orgs.invite',inviter,{invitee:p(sub),grants,...inviteExtra});await run('orgs.accept',sub,{invitation:invite.invitation});return member(sub);};
 const sync=()=>run('orgs.billing-sync','system'),tick=()=>run('orgs.ownership-tick','system'),drain=()=>run('orgs.ownership-drain','system'),sweep=()=>run('orgs.membership-sweep','system');
 let events=0;const webhook=(id='auto_'+(++events),bodyHash='a'.repeat(64))=>run('orgs.billing-webhook','system',{id,bodyHash,type:'subscription.updated'});
 const ownerSub=configured?polar.subscribe({org:ORG,owner,plan,purpose:'create',binding:REQUEST,currency}):null;
 if(configured)await sync();
 const offer=async(to=B,handle=people.get(to).handle,input={})=>(await run('orgs.transfer-offer',(await summary()).ownerOfRecord.sub,{recipient:to,handle,confirm:true,...input})).transfer.id;
 const accept=async(to=B,input={})=>{const view=await run('orgs.ownership',to);const choice=view.offer.plans[0];return run('orgs.transfer-accept',to,{transfer:view.offer.id,disclosure:choice.digest,confirm:true,...view.offer.choosePlan?{plan:choice.plan}:{},...input});};
 const payLatest=(purpose='transfer')=>polar.pay(polar.checkoutBy(k=>k.metadata?.['3sln_me_org_purpose']===purpose).id);
 return {metadata,store,stats,service,engine,clock,flag,polar,billing,people,indexed,rotations,alerts,act,run,record,summary,member,join,sync,tick,drain,sweep,webhook,offer,accept,payLatest,ownerSub,verification,close:async()=>{await engine.dispose();metadata.close();}};
}
/** Every stored value's size: [{key, bytes}] sorted largest first. */
export async function storedSizes(metadata){return [...await metadata.list({prefix:''})].map(([key,value])=>({key,bytes:new TextEncoder().encode(JSON.stringify(value)).length})).sort((a,b)=>b.bytes-a.bytes);}
