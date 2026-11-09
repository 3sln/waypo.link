// PRIVATE required-human UI fixture; real production Worker/native SQLite.
// Read-only controls refuse cold applications; no auth/proof/permit seed port.
import entry,{HostedInstallation as ProductionInstallation} from '../worker.mjs';
import {HostedEmailBudget as ProductionEmailBudget} from '../email-budget-object.mjs';
import {budgetProjection} from './security-mail-profile.fixture.mjs';
export class HostedEmailBudget extends ProductionEmailBudget{async exhaustFixture(){if(this.env.ADAPTER_TEST_ONLY!=='true')throw Error('Private fixture disabled');await this.ready;for(let i=0;i<65;i++){try{await this.budget.chargeAttempt({attemptId:Date.now()+'.'+crypto.randomUUID().replaceAll('-',''),purpose:'identity-session-security',recipient:'drain-'+i+'@fixture.example'});}catch{break;}}return this.inspectFixture();}async inspectFixture(){if(this.env.ADAPTER_TEST_ONLY!=='true')throw Error('Private fixture disabled');await this.ready;const rows=this.ctx.storage.sql.exec("SELECT value FROM hosted_email_budget WHERE key LIKE 'email-budget/v1/%'").toArray();if(rows.length>1)throw Error('Bounded budget scope');return budgetProjection(rows[0]?JSON.parse(rows[0].value):null);}}
import {BOOTSTRAP_KEYS} from '../../../../waypo/packages/identity-core/index.mjs';
import {readBoundedJson} from '../../../../waypo/packages/auth/bounded-json.mjs';
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');
export class WaypoInstallation extends ProductionInstallation{
 constructor(ctx,env){super(ctx,{...env,EMAIL:{send:async message=>{const response=await env.EMAIL_UI_SEND.fetch(new Request('https://email-sending.invalid/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(message)}));if(!response.ok)throw Error('Synthetic external acceptance outage');return response.json();}}},{siteverifyTransport:(url,init)=>env.EMAIL_UI_SITEVERIFY.fetch(new Request(url,{...init,redirect:'manual'}))});this.privateEnv=env;this.privateStorage=ctx.storage;}
 async inspectHumanUi(input){
  if(this.privateEnv.ADAPTER_TEST_ONLY!=='true')throw Error('Private fixture disabled');
  if(exact(input,['kind'])&&input.kind==='state')return{initialized:Boolean(this.application),initializing:Boolean(this.applicationPending)};
  if(exact(input,['kind'])&&input.kind==='marker')return this.database.store.transaction(tx=>tx.get(BOOTSTRAP_KEYS.installation));
  if(!this.application||this.database.inNativeTransaction())throw Error('Passive initialized inspection required');
  return this.database.runExclusive(async()=>{
   if(this.database.inNativeTransaction())throw Error('No pending native transaction permitted');const sql=this.privateStorage.sql;
   if(exact(input,['kind'])&&input.kind==='snapshot'){
    const captured=this.privateStorage.transactionSync(()=>{const result={};for(const table of ['session','passkey','waypo_security_reviews_v1','waypo_security_proofs_v1','waypo_security_challenges_v1','waypo_security_lanes_v1']){const columns=table==='waypo_security_lanes_v1'?'ownerId,sessionId,human':'*',rows=[...sql.exec('SELECT '+columns+' FROM '+table+' LIMIT 257')].map(row=>JSON.stringify(row)).sort();if(rows.length>256||new TextEncoder().encode(JSON.stringify(rows)).byteLength>1048576)throw Error('Bounded native projection required');result[table]=rows;}return result;});
    const result={};for(const[table,rows]of Object.entries(captured))result[table]={count:rows.length,digest:await digest(rows)};return result;
   }
   if(exact(input,['kind','subject'])&&input.kind==='owner-counts'&&typeof input.subject==='string'&&input.subject.length>0&&input.subject.length<=256)return{passkey:[...sql.exec('SELECT count(*) AS n FROM passkey WHERE userId=?',input.subject)][0].n,session:[...sql.exec('SELECT count(*) AS n FROM session WHERE userId=?',input.subject)][0].n};
   throw Error('Fixed read-only inspection required');
  });
 }
}
export default{async fetch(request,env,ctx){
 const incoming=new URL(request.url);if(env.ADAPTER_TEST_ONLY!=='true'||!['127.0.0.1','localhost'].includes(incoming.hostname)||request.headers.get('x-waypo-fixture-secret')!==env.ADAPTER_CONTROL_SECRET)return new Response(null,{status:503});
 const config=JSON.parse(env.WAYPO_CONFIG),stub=env.INSTALLATION.get(env.INSTALLATION.idFromName(config.installationId));
 if(incoming.pathname==='/__control/provision'&&request.method==='POST'){try{return Response.json(await stub.provisionFromOperator());}catch{return Response.json({error:'provision_refused'},{status:400});}}
 if(incoming.pathname==='/__control/inspect'&&request.method==='POST'){try{return Response.json(await stub.inspectHumanUi(await readBoundedJson(request,{maxBytes:2048})));}catch{return Response.json({error:'inspection_refused'},{status:400});}}
 if(['/__control/budget','/__control/budget-drain'].includes(incoming.pathname)&&request.method==='POST'){try{const ledger=env.EMAIL_BUDGET.get(env.EMAIL_BUDGET.idFromName('waypo-email-fleet-v1'));return Response.json(await(incoming.pathname==='/__control/budget-drain'?ledger.exhaustFixture():ledger.inspectFixture()));}catch{return new Response(null,{status:400});}}
 const origin=request.headers.get('x-waypo-fixture-origin');if(![new URL(config.issuer).origin,new URL(config.adminUrl).origin,config.challengeOrigin].includes(origin)||incoming.pathname.startsWith('/__'))return new Response(null,{status:403});
 const headers=new Headers(request.headers);headers.delete('x-waypo-fixture-secret');headers.delete('x-waypo-fixture-origin');return entry.fetch(new Request(origin+incoming.pathname+incoming.search,{method:request.method,headers,cf:{country:'US'},...!['GET','HEAD'].includes(request.method)?{body:request.body}:{},redirect:'manual'}),env,ctx);
}};
