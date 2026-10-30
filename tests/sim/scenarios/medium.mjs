// Scenario `medium` (spike §3.3 scales, nightly): everything `small` does through browsers, then a load phase of API
// actors over the providers' real HTTP routes: ≈60 people in all, 8 organizations of 10 members (on their own
// provider: foreign acceptance is expected-pending in Board), and ≈5,000 same-provider messages. Each load step has a
// time budget; exceeding it fails the step (recorded with the measured duration, so budgets can be tuned).
import * as small from './small.mjs';
import {pool,p95,apiSignUp,ownerClient} from '../load.mjs';

export const name='medium';
export const scale=Object.freeze({...small.scale,name:'medium',people:60,orgs:8,membersPerOrg:10,messages:5000,concurrency:8,
 budgets:{signupMs:240000,orgsMs:240000,messagesMs:420000}});
export const PART_NAMES=small.PART_NAMES;

export function define(run,world,options={}){
 const people=small.define(run,world,options),load={users:[],orgs:[],messages:null},random=run.random;
 const extra=scale.people-people.length,providers=['alpha','beta'];
 const config={};
 const timed=async(ctx,label,budget,fn)=>{const started=Date.now(),result=await fn(),ms=Date.now()-started;ctx.ledger.record('load','timing',label,{budgetMs:budget});run.timings??={};run.timings[label]={ms,budgetMs:budget,...result?.stats};if(ms>budget)throw new Error(`${label} took ${ms} ms (budget ${budget} ms).`);return result;};

 run.group('load');
 run.step('load.signup',{via:'api',kind:'load'},async ctx=>{
  for(const p of providers)config[p]=await (await ctx.world.network.fetch(world.providers[p].origin+'/api/config')).json();
  const plan=[...Array(extra)].map((_,i)=>({i,provider:providers[i%2],ip:`198.${18+(i>>7)}.${(i*37)%250+1}.${random.int(1,250)}`}));
  await timed(ctx,'load.signup',scale.budgets.signupMs,async()=>{
   const {results,ms}=await pool(plan,scale.concurrency,item=>apiSignUp(ctx.world,world.providers[item.provider],{ip:item.ip,config:config[item.provider]}));
   load.users=results;for(const [i,u] of results.entries())ctx.ledger.record('load',`account`,`load-user-${i+1}`,{provider:u.provider});
   return {stats:{count:results.length,p95Ms:p95(ms)}};
  });
 });

 run.step('load.orgs',{via:'api',kind:'load'},async ctx=>{
  const allow=ctx.world.services.board?.allowCreator;if(!allow)throw new Error('The Board service (organizations paid-check seam) is not running.');
  await timed(ctx,'load.orgs',scale.budgets.orgsMs,async()=>{
   const plans=[...Array(scale.orgs)].map((_,i)=>{const provider=providers[i%2],homed=load.users.filter(u=>u.provider===provider),start=(Math.floor(i/2)*scale.membersPerOrg)%homed.length;
    const members=[...Array(scale.membersPerOrg)].map((_,j)=>homed[(start+j)%homed.length]);return {i,provider,owner:members[0],invitees:members.slice(1)};});
   const timings=[];
   const {results}=await pool(plans,Math.max(1,Math.floor(scale.concurrency/2)),async plan=>{
    const provider=world.providers[plan.provider],owner=ownerClient(ctx.world,provider,plan.owner);allow(plan.owner.accountId);
    const created=await owner.post('/api/orgs',{request:crypto.randomUUID(),name:`Team ${plan.i+1}`});const org=created.organization;if(!org?.id)throw new Error('Organization creation answered '+JSON.stringify(created).slice(0,200));
    for(const member of plan.invitees){
     const started=Date.now();
     const invitation=await owner.post(`/api/orgs/${org.id}/invitations`,{invitee:member.principal});
     await ownerClient(ctx.world,provider,member).post(`/api/orgs/${org.id}/accept`,{invitation:invitation.meta??invitation.invitation});
     timings.push(Date.now()-started);
    }
    return {org,plan};
   });
   load.orgs=results;for(const r of results)ctx.ledger.record('load','org',`team-${r.plan.i+1}`,{provider:r.plan.provider,members:scale.membersPerOrg});
   return {stats:{orgs:results.length,memberships:timings.length,p95InviteAcceptMs:p95(timings)}};
  });
 });

 run.step('load.messages',{via:'api',kind:'load'},async ctx=>{
  const parlay=await import('../steps/parlay.mjs').catch(()=>null);
  if(typeof parlay?.loadMessages!=='function')throw new Error('No message load helper (tests/sim/steps/parlay.mjs loadMessages).');
  await timed(ctx,'load.messages',scale.budgets.messagesMs,async()=>{
   const result=await parlay.loadMessages(ctx.world,{owners:load.users.filter(u=>u.provider==='alpha'),count:scale.messages,concurrency:scale.concurrency,random});
   load.messages=result;ctx.ledger.record('load','messages','same-provider',{count:scale.messages});
   return {stats:result?.stats??{count:scale.messages}};
  });
 });

 run.group('invariant');
 run.step('invariant.load',{via:'api',kind:'invariant'},async ctx=>{
  // Rosters seen by each organization's owner list exactly the members the load phase admitted.
  for(const {org,plan} of load.orgs){
   const detail=await ownerClient(ctx.world,world.providers[plan.provider],plan.owner).get(`/api/orgs/${org.id}/members`).catch(error=>({error:error.message}));
   const members=detail.members??detail.memberships??detail.roster;
   if(!Array.isArray(members))throw new Error(`Roster of Team ${plan.i+1}: ${JSON.stringify(detail).slice(0,200)}`);
   if(members.length!==scale.membersPerOrg)throw new Error(`Team ${plan.i+1} lists ${members.length} members, expected ${scale.membersPerOrg}.`);
  }
  // Every load account is a live session on its own provider.
  const sample=load.users.filter((_,i)=>i%9===0);
  for(const u of sample){const session=await ownerClient(ctx.world,world.providers[u.provider],u).get('/api/session');if(session.account?.id!==u.accountId)throw new Error('A load account lost its session.');}
 });
 return people;
}
