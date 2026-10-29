// ORG-12b fixture: the break-glass world (tests/helpers/break-glass-world.mjs) with the PRODUCTION owner-channels
// adapter (packages/identity/owner-channels.mjs) over identity records, real person-side hint storage in each person's
// own account metadata (BreakGlassService#breakGlassHint, as packages/runtime/account/orgs.mjs wires it), and the real
// identity service whose sign-in hook signals through those hints. Loopback fixtures: local behaviour only.
import {bgWorld,A,B,C,E,DAY,ORG,p} from './break-glass-world.mjs';
import {ownerChannelsAdapter} from '../../packages/identity/owner-channels.mjs';
import {BreakGlassService} from '../../packages/orgs/break-glass.mjs';
import {identityEngine,activate,signupInput,signInPasskey} from './identity-engine.mjs';
import {SqliteMetadata} from '../../apps/node/resources.mjs';
import {metered,freshStats} from './org-world.mjs';

export const ISS='https://3sln.example',SECRET='owner-channels-test-secret-0001',H=3600000;
/** Identity records as the identity service stores them (only the fields the adapter reads). */
export function people(now){
 const person=(sub,email,extra={})=>({id:sub,kind:'person',status:'active',handle:'h'+sub.slice(0,6),verifiedEmail:email,emailVerifiedAt:now-200*DAY,credentials:[{id:'cred-'+sub.slice(0,4),createdAt:now-300*DAY}],sessions:[{id:'sess-'+sub.slice(0,4),createdAt:now-H,expiresAt:now+20*H}],lastInteractiveAt:now-90*DAY,...extra});
 return new Map([[A,person(A,'alice@home-alice.example')],[B,person(B,'bob@bob-family.example')],[C,person(C,'carol@carol.example')],[E,person(E,'erin@erin.example')],[ORG,{id:ORG,kind:'organization',status:'active',handle:'acme'}]]);
}
export function fixture(now,{mail=true,fail=()=>false}={}){
 const records=people(now),sent=[],pushes=[],pushRows=new Map([[A,[{id:'pushrow-alice-0001',createdAt:now-150*DAY}]]]);
 const mailer=mail?{async sendBreakGlassNotice(notice){if(fail(notice))throw new Error('provider down');sent.push(notice);return {messageId:'m'};}}:null;
 const push={list:async sub=>pushRows.get(sub)??[],send:async(sub,input)=>{if(fail(input))return {accepted:false};pushes.push({sub,...input});return {accepted:true};}};
 const adapter=ownerChannelsAdapter({origin:ISS,secret:SECRET,identity:async sub=>structuredClone(records.get(sub)??null),push,mailer});
 return {records,sent,pushes,pushRows,adapter};
}

/** A break-glass world whose owner channels are the production adapter over identity records, with real hint storage
 * in each person's own account metadata (BreakGlassService#breakGlassHint, as the runtime wires it). */
export async function channelWorld(seed=31,options={}){
 let f;const people=new Map();
 const personService=sub=>{if(!people.has(sub)){const metadata=new SqliteMetadata(':memory:'),stats=freshStats();people.set(sub,{metadata,stats,ready:metadata.put('owner',sub),service:null});}return people.get(sub);};
 const serviceOf=async(sub,clock)=>{const x=personService(sub);await x.ready;x.service??=new BreakGlassService({metadata:metered(x.metadata,x.stats),clock,random:{uuid:()=>crypto.randomUUID()},issuer:ISS});return x;};
 let clock;const claimHints={apply:async(sub,input)=>(await serviceOf(sub,clock)).service.breakGlassHint({kind:'system',owner:sub},input)};
 const lazy={snapshot:(...a)=>f.adapter.snapshot(...a),domains:(...a)=>f.adapter.domains(...a),notify:(...a)=>f.adapter.notify(...a)};
 const w=await bgWorld(seed,{ownerChannels:lazy,claimHints,...options});clock=w.clock;f=fixture(w.clock.now(),options.fixture);
 const hints=async sub=>(await (await serviceOf(sub,clock)).service.breakGlassHints({kind:'system',owner:sub})).hints;
 /** The runtime's orgsBreakGlassOwnerSignal over this world: owner hints only, liveness into the organization. */
 const signal=async(sub,{kind,at})=>{let signalled=0;for(const h of (await hints(sub)).filter(x=>x.role==='owner')){await w.run('orgs.breakglass-liveness','system',{principal:p(sub),kind,at});signalled++;}return {signalled};};
 return Object.assign(w,{f,hints,signal,personStats:async sub=>(await serviceOf(sub,clock)).stats});
}

/** The identity service over the same clock, with the hook wired to the world's person-side signal. The identity
 * record is re-keyed to the organization owner A, so the service signs A in. */
export async function identityFor(w,{wired=true}={}){
 const calls=[],cas={count:0};
 const id=identityEngine({clock:w.clock,...wired?{organizationSignals:{liveness:async(owner,input)=>{calls.push({owner,...input});return w.signal(owner,input);}}}:{}});
 const swap=id.repository.compareAndSwap.bind(id.repository);id.repository.compareAndSwap=async(...args)=>{cas.count++;return swap(...args);};
 const {owner,credentialId}=await activate(id.act,signupInput({handle:'alice'}));const record=id.repository.records.get(owner.account.id);id.repository.records.delete(record.id);record.id=A;id.repository.records.set(A,record);
 calls.length=0;cas.count=0;
 const login=async()=>{const result=await signInPasskey(id.act,'alice',credentialId);await id.service.settleBackground();return result;};
 return {...id,calls,cas,login,credentialId};
}

