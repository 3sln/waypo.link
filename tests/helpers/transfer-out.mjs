// Engine-level fixture for identity transfer-out (PORT-2). One account over the shared memory engine, a real
// IdentityRepository (SQLite in memory) behind transferIdentityPort, a real attestation key and recording fake ports.
import {createTestEngine,OWNER} from './app-engine.mjs';
import {SqliteMetadata} from '../../apps/node/resources.mjs';
import {IdentityRepository} from '../../packages/runtime/accounts.mjs';
import {IdentityCrypto} from '../../packages/identity/crypto.mjs';
import {key} from '../../packages/core/records.mjs';
import {signMoveStatement} from '../../packages/identity/succession.mjs';
import {TransferOutService,transferIdentityPort,attestorFromJwk,transferDueIndex,identityURI,TRANSFER_KEY,LOCK_KEY,
 BeginTransferOut,AuthorizeTransferOut,AuthorizeWaitingTransferOut,ReceiveMoveStatement,CancelTransferOut,DisputeTransferOut,ElevateTransferOut,SupportTransferOut,TransferRestartChoice,StepTransferOut,TransferOutStatus} from '../../packages/identity/transfer-out.mjs';

export const DAY=86400000,HOUR=3600000,MINUTE=60000;
export const ISSUER='https://source.example',DEST='https://dest.example',REDIRECT=`${DEST}/from/source/`,HANDLE='mover.one',EMAIL='owner@mover.example';
export {OWNER,TRANSFER_KEY,LOCK_KEY};
const P256={name:'ECDSA',namedCurve:'P-256'};
export async function keyPair(){const pair=await crypto.subtle.generateKey(P256,true,['sign','verify']);const {kty,crv,x,y}=await crypto.subtle.exportKey('jwk',pair.publicKey);return {...pair,publicJwk:{kty,crv,x,y},privateJwk:await crypto.subtle.exportKey('jwk',pair.privateKey)};}

/** `options`: seed, identity overrides, notice acceptance policy, attestor (false for none), hold, flags. */
export async function transferFixture(t,{seed=1,identity:overrides={},accept=true,attestor:withAttestor=true,push=true,clockStart}={}){
 const f=await createTestEngine({seed});const clock=f.clock;if(clockStart)clock.set(clockStart);
 const idDb=new SqliteMetadata(':memory:'),dueDb=new SqliteMetadata(':memory:');
 const repository=new IdentityRepository({metadata:idDb,config:{}}),hashing=new IdentityCrypto();
 const now=clock.now(),token=`${OWNER}.${'r'.repeat(43)}`;
 const record={id:OWNER,handle:HANDLE,assignmentId:'assignment-1',status:'active',createdAt:now-90*DAY,revision:1,
  verifiedEmail:EMAIL,emailVerifiedAt:now-60*DAY,emailLoginEnabled:true,passwordHash:'hash',
  sessions:[{id:'s-old',createdAt:now-30*DAY,expiresAt:now+400*DAY,hash:'h1',credentialId:'pk-old'},{id:'s-two',createdAt:now-20*DAY,expiresAt:now+400*DAY,hash:'h2'}],
  credentials:[{id:'pk-old',createdAt:now-60*DAY},{id:'pk-two',createdAt:now-50*DAY}],
  recoveryHash:await hashing.hash('recovery',token),recoveryIssuedAt:now-10*DAY,recoveryBackupVersion:2,recoveryKeyKid:'kid-1',
  security:{epoch:3,changedAt:now-20*DAY},audit:[],challenges:[],emailChallenges:[],...overrides};
 if(!await repository.create(record))throw new Error('fixture identity');
 await idDb.put(`email/${EMAIL}`,OWNER);
 const signing=await keyPair(),attestation=await keyPair();
 const events=[],notices=[],logs=[],effects={revoked:0,severed:0,erased:0,purged:0,destroyed:0};
 const state={currentKid:'kid-1',keysMatch:true,hold:{held:false},accept,purgeAfter:1,flags:{enabled:true,background:true,global:true}};
 const identity=transferIdentityPort(repository,{clock:clock.now});
 const ports={
  issuer:ISSUER,identity,
  keys:{current:async()=>({kid:state.currentKid,publicJwk:signing.publicJwk}),matches:async(owner,keychain)=>state.keysMatch&&keychain?.ok===true,destroy:async()=>{effects.destroyed++;events.push('keys.destroy');}},
  notices:{async deliver(input){notices.push(input);events.push(`notice.${input.kind}`);return {accepted:typeof state.accept==='function'?state.accept(input):state.accept};}},
  attestor:withAttestor?attestorFromJwk({kid:'att-1',jwk:attestation.privateJwk}):null,
  hold:async()=>{if(state.hold instanceof Error)throw state.hold;return state.hold;},
  effects:{revokeDelegations:async()=>{effects.revoked++;events.push('delegations');},severConnections:async()=>{effects.severed++;events.push('connections');},eraseGrants:async()=>{effects.erased++;events.push('grants');return {federation:'erased'};},
   purge:async()=>{effects.purged++;events.push('purge');return effects.purged>=state.purgeAfter?{done:true}:{done:false};}},
  due:transferDueIndex(dueDb),
 };
 const flags={for:()=>({enabled:()=>state.flags.enabled,background:()=>state.flags.background,global:()=>state.flags.global})};
 const service=new TransferOutService({executor:{metadata:f.metadata},ports,flags,clock,random:{uuid:()=>crypto.randomUUID(),bytes:n=>crypto.getRandomValues(new Uint8Array(n))},log:event=>logs.push(event)});
 const engine=await createTestEngine({seed,clock,providers:{lifecycle:service}});
 t?.after?.(async()=>{await engine.dispose();await f.dispose();idDb.close();dueDb.close();});
 await f.metadata.put('owner',OWNER);
 if(push)await f.metadata.put(key('push-subscription',OWNER,'p1'),{id:'p1',owner:OWNER,endpoint:'https://push.example/p1',keys:{p256dh:'k',auth:'a'}});
 const credential={recoveryToken:token,keychain:{ok:true}};
 const owner=(extra={})=>({kind:'owner',owner:OWNER,stepUpAt:clock.now()-1000,sessionId:'s-old',sessionCreatedAt:clock.now()-30*DAY,credentialId:'pk-old',...extra});
 const fx={f,engine,service,repository,idDb,dueDb,clock,events,notices,logs,effects,state,ports,signing,attestation,token,credential,metadata:f.metadata,owner,
  get:()=>f.metadata.get(TRANSFER_KEY),lock:()=>f.metadata.get(LOCK_KEY),identityRecord:()=>repository.get(OWNER),
  begin:(input={},actor={})=>engine.perform(new BeginTransferOut({actor:owner(actor),input:{destination:DEST,...input}})),
  authorize:(input={},actor={})=>engine.perform(new AuthorizeTransferOut({actor:owner(actor),input:{...credential,confirm:true,...input}})),
  async start(input={},actor={}){const draft=await fx.begin({},actor);return fx.authorize({draft:draft.draft,...input},actor);},
  waiting:(input={})=>engine.perform(new AuthorizeWaitingTransferOut({actor:{kind:'credential',owner:OWNER},input:{...credential,destination:DEST,confirm:true,...input}})),
  statement:input=>engine.perform(new ReceiveMoveStatement({actor:{kind:'system',owner:OWNER,reason:'test'},input})),
  cancel:(actor=owner(),input)=>engine.perform(new CancelTransferOut({actor,input})),
  dispute:(input,actor)=>engine.perform(new DisputeTransferOut({actor:actor??{kind:'dispute-link',owner:OWNER},input})),
  elevate:(input,actor={})=>engine.perform(new ElevateTransferOut({actor:owner(actor),input:{...credential,...input}})),
  support:input=>engine.perform(new SupportTransferOut({actor:{kind:'system',owner:OWNER,reason:'support'},input})),
  restartChoice:(choice,actor={})=>engine.perform(new TransferRestartChoice({actor:owner(actor),input:{choice}})),
  step:()=>engine.perform(new StepTransferOut({actor:{kind:'system',owner:OWNER,reason:'test'}})),
  status:()=>engine.read(new TransferOutStatus({actor:{kind:'owner',owner:OWNER}})),
  /** A signed move statement for the current transfer; `payload` overrides members. */
  async sign({payload={},kid=state.currentKid,key=signing.privateKey}={}){
   const at=Math.floor(clock.now()/1000);
   return signMoveStatement({kid,payload:{bindle:'identity-move',v:1,sub:OWNER,kind:'person',seq:1,prev:null,from:{iss:ISSUER,identity:identityURI(ISSUER,OWNER)},to:{iss:DEST,identity:`${DEST}/identity/${OWNER}`},iat:at,...payload}},key);
  },
  /** POSTs the move body; repeats the identical body (spec §5.2 idempotency) unless `statementOptions` or `fresh`. */
  async post(extra={},statementOptions,{fresh=false}={}){const record=await fx.get();if(statementOptions||fresh||!fx.body||fx.body.transfer!==record?.transfer?.id)fx.body={statement:await fx.sign(statementOptions),transfer:record?.transfer?.id??'x'.repeat(32),redirect_base:REDIRECT};return fx.statement({...fx.body,...extra});},
  /** The dispute token the latest notice to `kind` ('email'|'push') carried. */
  tokenFor(kind='email'){const notice=[...notices].reverse().find(n=>n.disputeToken&&(kind==='email'?n.channel.email:n.channel.push));return notice?.disputeToken;},
  async bumpSecurity(at=clock.now()){const account=await repository.get(OWNER);const next={...account,security:{epoch:account.security.epoch+1,changedAt:at},revision:account.revision+1};if(!await repository.compareAndSwap(OWNER,account.revision,next))throw new Error('bump');},
  async patchIdentity(mutate){const account=await repository.get(OWNER);const next=mutate(structuredClone(account));next.revision=account.revision+1;if(!await repository.compareAndSwap(OWNER,account.revision,next))throw new Error('patch');},
  /** Steps until the record leaves `pending` waiting or `limit` steps. */
  async runUntil(predicate,{limit=20,advance=HOUR}={}){for(let i=0;i<limit;i++){const record=await fx.get();if(predicate(record))return record;clock.advance(advance);await fx.step();}return fx.get();},
 };
 return fx;
}
