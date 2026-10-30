// Wargame 4 admin fixture: boot, claims and reservations over the real AdminService, AdminStorage and identity shards
// (the plain, unscheduled variant of tests/claim-redemption-chaos.test.mjs). Local behaviour only.
const R='../../';
const {SqliteMetadata}=await import(R+'apps/node/resources.mjs');const {FixedWindowGuard}=await import(R+'packages/runtime/accounts.mjs');
const {IdentityShardStorage,ShardedIdentityRepository,IDENTITY_LAYOUT}=await import(R+'packages/runtime/identity-shards.mjs');
const {IdentityService}=await import(R+'packages/identity/service.mjs');const {encode}=await import(R+'packages/identity/crypto.mjs');const {onboardingPort}=await import(R+'packages/identity/onboarding.mjs');
const {mintBootToken,bootTokenDigest}=await import(R+'packages/identity/boot.mjs');const {AdminStorage}=await import(R+'packages/identity/admin-store.mjs');const {AdminService}=await import(R+'packages/identity/admin.mjs');
const {fakeClock}=await import(R+'packages/app/memory-providers.mjs');
export const origin='https://admin.example',key=encode(new Uint8Array(32).fill(77));
export function claimFixture(){
 const clock=fakeClock(1792000000000),stores=[],db=()=>{const value=new SqliteMetadata(':memory:');stores.push(value);return value;},shards=new Map();
 const shard=name=>{if(!shards.has(name))shards.set(name,new IdentityShardStorage(db()));const storage=shards.get(name);return new Proxy({},{get:(_,method)=>method==='then'||typeof method==='symbol'?undefined:(...args)=>storage[method.slice(5,6).toLowerCase()+method.slice(6)](...args)});};
 const config={APP_ORIGIN:origin,ONBOARDING_KEY:key,BOOT_ACCESS_HOURS:'24',SIGNUP_MAX_ADMISSIONS:5000,SIGNUP_FREE_MAX_ADMISSIONS:1000};
 const repository=new ShardedIdentityRepository({shard,layout:IDENTITY_LAYOUT,clock:clock.now}),store=new AdminStorage(db());
 const guard=new FixedWindowGuard({metadata:db()}),rateLimiter={check:async()=>true},webauthn={registrationOptions:async()=>({challenge:'reg'}),authenticationOptions:async()=>({challenge:'auth'})},bootWebauthn={...webauthn,verifyRegistration:async({response})=>{if(response?.id!=='boot-passkey'||response?.ok!==true)throw Error('bad');return {id:response.id,publicKey:'pk',counter:0};},verifyAuthentication:async({response})=>{if(response?.id!=='boot-passkey'||response?.ok!==true)throw Error('bad');return {counter:1,backedUp:false};}};
 let admin;
 const onboarding=onboardingPort({config,repository,authority:{consumeSignup:(_,input)=>guard.consumeSignup(input)},clock:clock.now,runtimeName:(n,d)=>admin.runtimeName(n,d),redeemName:(n,d)=>admin.redeemName(n,d)});
 const identity=new IdentityService({repository,onboarding,clock:clock.now,reservedHandle:name=>admin.isReserved(name),config:{...config,origin,rpID:'admin.example',termsVersion:'v1'},turnstile:{verify:async()=>true},rateLimiter,webauthn});
 admin=new AdminService({store,identity,onboarding,webauthn:bootWebauthn,rateLimiter,clock:clock.now,config});
 const ctx=(extra={})=>({origin,remoteIP:'192.0.2.9',...extra});
 async function boot(){const token=mintBootToken(origin,{now:clock.now()});config.BOOTSTRAP_TOKEN_SHA256=await bootTokenDigest(token);await admin.bootStart({bootToken:token},ctx({setupBinding:'boot-browser'}));const result=await admin.bootComplete({bootToken:token,method:'passkey',response:{id:'boot-passkey',ok:true},acknowledgeExpiry:true},ctx({setupBinding:'boot-browser'}));return ctx({actor:'boot',bootSession:result.sessionToken,csrfToken:result.csrfToken});}
 // Boot is passkey only (2026-10-29, provisional): step-up asserts the boot passkey against a fresh challenge.
 const stepUp=async b=>{const begun=await admin.bootLoginBegin({},b);return admin.bootStepUp({method:'passkey',challengeId:begun.challengeId,response:{id:'boot-passkey',ok:true}},b);};
 return {clock,config,repository,store,identity,admin,ctx,boot,stepUp,close:()=>stores.forEach(s=>s.close())};
}
