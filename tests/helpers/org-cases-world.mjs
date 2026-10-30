// ORG-12d fixture: the break-glass organization world (tests/helpers/break-glass-world.mjs) whose engine verifies
// operator decisions with the PRODUCTION verifier and writes the PRODUCTION support case index, both over a real admin
// store (AdminStorage on SQLite), plus the real AdminService and IdentityService with passkey step-ups, driven through
// the ngin engine operations the admin HTTP routes dispatch. Local recording transports and a local WebAuthn verifier:
// local behaviour only, never provider conformance or operator-identity proof in production.
import {SqliteMetadata} from '../../apps/node/resources.mjs';
import {IdentityRepository} from '../../packages/runtime/accounts.mjs';
import {IdentityService} from '../../packages/identity/service.mjs';
import {AdminStorage} from '../../packages/identity/admin-store.mjs';
import {AdminService,ListOrgCases,ReadOrgCase,DecideOrgCase,OrgCaseAudit,OrgCaseChallenge,adminOperatorPasskeyContext} from '../../packages/identity/admin.mjs';
import {operatorAssertionVerifier,supportCaseIndex} from '../../packages/identity/operator-assertions.mjs';
import {createAppEngine,perform,read} from '../../packages/app/engine.mjs';
import {cryptoRandom,nullAudit} from '../../packages/app/providers.mjs';
import {fakeClock} from '../../packages/app/memory-providers.mjs';
import {mintBootToken,bootTokenDigest} from '../../packages/identity/boot.mjs';
import {bgWorld,OP1,OP2,OP3,OP4,ORG,A,B,C,E,DAY,p,rejects} from './break-glass-world.mjs';
import {ISS} from './org-world.mjs';

export {OP1,OP2,OP3,OP4,ORG,A,B,C,E,DAY,p,rejects,ISS};
export const OP5='0f000000-0000-4000-8000-000000000005',NOCAP='0f000000-0000-4000-8000-0000000000aa',PWD='0f000000-0000-4000-8000-0000000000bb';
export const KEY=Buffer.from(new Uint8Array(32).map((_,i)=>i*7+3)).toString('base64');
export const CATALOG={version:1,capabilities:{'support.org-break-glass':{class:'internal',description:'Decides held organization ownership claims.'}},roles:{'support-operator':{class:'internal',name:'Support operator',description:'Organization break-glass support.',capabilities:['support.org-break-glass']}},badgeClasses:{}};
const MARKERS=['support','security','abuse','sys','root','postmaster','webmaster','notify'];

export async function orgCasesWorld(seed=1,{keyEncryptionKey=KEY,...options}={}){
 const clock=options.clock??fakeClock(400*DAY),databases=[],db=()=>{const m=new SqliteMetadata(':memory:');databases.push(m);return m;};
 const store=new AdminStorage(db()),operators=operatorAssertionVerifier({store,issuer:ISS}),cases=supportCaseIndex({store,clock:clock.now});
 const w=await bgWorld(seed,{...options,clock,operators,supportCases:cases});
 const flags={for:()=>({enabled:name=>w.flag.names[name]??w.flag.on,global:()=>true,background:()=>true})};
 const config={APP_ORIGIN:ISS,ADMIN_ENABLED:'true',...keyEncryptionKey?{KEY_ENCRYPTION_KEY:keyEncryptionKey}:{},flags};
 const repository=new IdentityRepository({metadata:db(),config});
 const webauthn={registrationOptions:async()=>({challenge:'local-registration'}),authenticationOptions:async()=>({challenge:'local-'+crypto.randomUUID()}), // unique, so a challenge binding can be tested
 verifyAuthentication:async({response})=>{if(response?.id!=='passkey'||response?.ok!==true)throw Error('Invalid local assertion');return {counter:1,backedUp:false};}};
 const rateLimiter={check:async()=>true};
 // Boot enrols a passkey (boot is passkey only, 2026-10-29, provisional); only the admin service registers one.
 const bootWebauthn={...webauthn,verifyRegistration:async({response})=>{if(response?.id!=='boot-passkey'||response?.ok!==true)throw Error('Invalid local registration');return {id:response.id,publicKey:'local',counter:0};}};
 const identity=new IdentityService({repository,webauthn,rateLimiter,clock:clock.now,turnstile:{verify:async()=>true},config:{origin:ISS,rpID:'3sln.example',termsVersion:'v1'}});
 // The organization port as the adapters compose it (packages/runtime/admin-org-cases.mjs), straight into the engine.
 // `intercept` lets a test capture an issued assertion instead of forwarding it.
 const notFound=()=>Object.assign(new Error('Not found.'),{code:'not_found',status:404});
 const port={calls:[],intercept:null,
  async case(org){if(org!==ORG)throw notFound();return w.run('orgs.breakglass-case','system');},
  async resolve(org,input){port.calls.push({method:'resolve',org,input});if(port.intercept)return port.intercept('resolve',org,input);if(org!==ORG)throw notFound();const out=await w.run('orgs.breakglass-resolve','system',input);await w.settle();return out;},
  async cancelProposals(org,input){port.calls.push({method:'cancelProposals',org,input});if(org!==ORG)throw notFound();return w.run('orgs.breakglass-proposal-cancel','system',input);},
  async claimResolve(org,input){port.calls.push({method:'claimResolve',org,input});if(port.intercept)return port.intercept('claimResolve',org,input);if(org!==ORG)throw notFound();const out=await w.run('orgs.claim-resolve','system',input);await w.settle();return out;}};
 const admin=new AdminService({store,identity,webauthn:bootWebauthn,rateLimiter,clock:clock.now,config,organizations:port,connectionsSeverAccount:async()=>{}});
 await store.commit({writes:{catalog:CATALOG}});
 const contexts=new Map();let marker=0;
 /** An internal (system-marked) account with a passkey (user passwords were dropped 2026-10-28), its roles, and a signed-in console session. */
 async function operator(id,{roles=['admin','support-operator'],internal=true}={}){
  const assignmentId=crypto.randomUUID(),account={id,handle:'n.'+String(1000+contexts.size),assignmentId,revision:1,status:'active',createdAt:clock.now(),security:{epoch:1,changedAt:null},credentials:[{id:'passkey',publicKey:'local'}],recoveryHash:'recovery',sessions:[],challenges:[],audit:[],emailLoginEnabled:false};
  if(internal){const m=account.systemIdentity={version:1,handle:MARKERS[marker++%MARKERS.length],role:'system',bootstrapId:crypto.randomUUID(),assignmentId,claimDigest:String(marker).padStart(64,'a')};
   const claims={version:1,purpose:'bindle-system-account-setup',issuer:ISS,owner:id,assignmentId,handle:m.handle,role:m.role,nonce:m.bootstrapId,issuedAt:clock.now(),expiresAt:clock.now()+DAY},binding='b'.repeat(43);
   await repository.reserveSystemIdentity(claims,m.claimDigest,binding);await repository.setSystemAdmission(m.handle,m.claimDigest,binding);await repository.setSystemCanonical(m.handle,m.claimDigest,binding,account.handle);}
  if(!await repository.create(account))throw Error('Account already exists');
  await store.commit({writes:{['principal/'+id]:{owner:id,assignmentId,roles,hold:null}}});
  await signIn(id);return id;
 }
 /** A new console session with a passkey step-up (the clock in these tests jumps by days; sessions do not). */
 const signedAt=new Map();
 async function signIn(id){const active=await repository.get(id),session=await identity.session(active,{credentialId:'passkey'});await identity.save(active,active.revision);
  contexts.set(id,{actor:'admin',origin:ISS,sessionToken:session.sessionToken,csrfToken:session.csrfToken,remoteIP:contexts.get(id)?.remoteIP??'192.0.2.'+(contexts.size+10)});signedAt.set(id,clock.now());await stepUp(id);}
 const renew=async id=>{if(clock.now()-(signedAt.get(id)??-Infinity)>=10*60000)await signIn(id);};
 async function stepUp(id,method='passkey'){const context=contexts.get(id);await identity.stepUpBegin({},context);return identity.stepUp(method==='passkey'?{method:'passkey',response:{id:'passkey',ok:true}}:{method:'password',password:'long local operator password'},context);}
 for(const id of [OP1,OP2,OP3,OP4,OP5])await operator(id);
 await operator(NOCAP,{roles:['admin']});await operator(PWD);
 const adminEngine=createAppEngine({providers:{admin,clock,random:cryptoRandom,audit:nullAudit}});
 const actor=(id,context=contexts.get(id))=>({kind:'admin-http',context});
 const fresh=async id=>{await renew(id);return actor(id);};
 const list=async(id,input={})=>read(adminEngine,new ListOrgCases({actor:await fresh(id),input}));
 const view=async(id,org=ORG)=>(await read(adminEngine,new ReadOrgCase({actor:await fresh(id),input:{org}}))).case;
 const auditLog=async(id,input={})=>read(adminEngine,new OrgCaseAudit({actor:await fresh(id),input}));
 /** One decision as the HTTP route makes it: a fresh passkey step-up, then the one-use evidence for this decision. */
 const challenge=(id,input)=>perform(adminEngine,new OrgCaseChallenge({actor:actor(id),input}));
 const decide=async(id,decision,input={},{passkey=true,bind={}}={})=>{
  await renew(id);const base=contexts.get(id);
  const c=input.process?null:await w.claim(),kind=input.kind??'break-glass',process=input.process??(kind==='break-glass'?c?.id:(await w.summary()).billing?.claim?.id);
  // Review L7: the passkey challenge is begun for exactly this decision (`bind` overrides it, to test a mismatch).
  let context=base;if(passkey){await challenge(id,{org:ORG,kind,process,decision,...input.exclude?{exclude:input.exclude}:{},...bind});const pending=await admin.pendingStepUpChallenge(base);await identity.stepUp({method:'passkey',response:{id:'passkey',ok:true}},base);context=adminOperatorPasskeyContext(admin,base,pending);}
  const needsReason=['note','abort','close','proceed','uphold','reject'].includes(decision);
  return perform(adminEngine,new DecideOrgCase({actor:{kind:'admin-http',context},input:{org:ORG,kind,process,decision,...needsReason&&decision!=='note'?{category:'evidence-reviewed'}:{},...needsReason?{reason:'Reviewed the case evidence out of band.'}:{},...input}}));
 };
 const caseRow=()=>store.get('org-case/'+ORG);
 /** A boot console session (passkey), stepped up: only boot changes administrators' roles or suspends them. */
 async function boot(){const ctx=extra=>({origin:ISS,remoteIP:'192.0.2.250',...extra}),token=mintBootToken(ISS,{now:clock.now()});config.BOOTSTRAP_TOKEN_SHA256=await bootTokenDigest(token);
  await admin.bootStart({bootToken:token},ctx({setupBinding:'boot-browser'}));const result=await admin.bootComplete({bootToken:token,method:'passkey',response:{id:'boot-passkey',ok:true},acknowledgeExpiry:true},ctx({setupBinding:'boot-browser'}));
  return ctx({actor:'boot',bootSession:result.sessionToken,csrfToken:result.csrfToken});}
 const close=w.close;
 return Object.assign(w,{store,admin,identity,repository,port,adminEngine,contexts,config,operator,stepUp,signIn,list,view,auditLog,decide,challenge,caseRow,boot,verifier:operators,
  close:async()=>{await adminEngine.dispose();await close();for(const m of databases)m.close();}});
}
