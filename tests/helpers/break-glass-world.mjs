// ORG-12a/12c break-glass fixture over tests/helpers/org-world.mjs: an organization owned by A with three 3sln.me admins
// (B, C, E) of more than 30 days' tenure, the in-memory owner-channels port and claim ledger, and helpers that drive the
// production engine operations. Loopback fixtures and an offline Polar model: local behaviour only, never notification
// delivery or provider conformance.
import assert from 'node:assert/strict';
import {world,p,A,B,C,E,DAY,ORG} from './org-world.mjs';
import {BREAK_GLASS,BREAK_GLASS_OPEN} from '../../packages/orgs/break-glass.mjs';

export {A,B,C,E,DAY,ORG,p};
export const OP1='0f000000-0000-4000-8000-000000000001',OP2='0f000000-0000-4000-8000-000000000002',OP3='0f000000-0000-4000-8000-000000000003',OP4='0f000000-0000-4000-8000-000000000004';
export const rejects=(promise,code)=>assert.rejects(promise,e=>e.code===code||assert.fail(`expected ${code}, got ${e.code}: ${e.message}`));

export async function bgWorld(seed=1,{admins=[B,C,E],tenure=31*DAY,...options}={}){
 const w=await world(seed,options);
 for(const sub of admins)await w.join(sub,[{power:'admin'}]);
 w.clock.advance(tenure);await w.sync();
 const claim=async()=>{const s=await w.summary();return s.breakGlass?.id?w.metadata.get('org/claim/'+s.breakGlass.id):null;};
 const start=(by=B,candidate=by,input={},extra={})=>w.run('orgs.breakglass-start',by,{candidate:p(candidate),category:'owner-unreachable',statement:'The owner has not answered in months.',confirm:true,...input},extra);
 const id=async()=>(await claim()).id;
 const cosign=async(sub,extra={})=>w.run('orgs.breakglass-cosign',sub,{claim:await id()},extra);
 const accept=async(sub,extra={})=>w.run('orgs.breakglass-accept',sub,{claim:await id()},extra);
 /** The candidate reviews the disclosure, gets a checkout and pays it; the webhook settles it. */
 const checkout=async(candidate)=>{const c=await claim(),view=await w.run('orgs.breakglass',candidate);const d=view.claim.disclosure[0];return w.run('orgs.breakglass-checkout',candidate,{claim:c.id,disclosure:d.digest,confirm:true});};
 const pay=async(candidate)=>{await checkout(candidate);const k=w.polar.checkoutBy(x=>x.metadata?.['3sln_me_org_purpose']==='break-glass');const paid=w.polar.pay(k.id);await w.webhook();return paid;};
 /** A paid Track A claim by B (candidate) and C (co-signer). */
 const trackA=async({by=B,candidate=by,cosigner=C}={})=>{await start(by,candidate);if(candidate!==by)await accept(candidate);await cosign(cosigner);await pay(candidate);return claim();};
 /** Owner proofs, relative to the claim's T1. */
 const tier0=c=>({verification:{sessionCreatedAt:c.createdAt-1000}});
 const tier1=c=>({verification:{stepUpAt:w.clock.now(),enrolledAt:c.createdAt-30*DAY,securityChangedAt:c.createdAt-90*DAY}});
 const abort=async(extra)=>{const c=await claim();return w.run('orgs.breakglass-abort',A,{claim:c.id},extra??tier0(c));};
 /** An operator decision with a valid assertion for exactly this scope (override `assertion` to test refusals). */
 const resolve=async(operator,decision,input={})=>{const claim=input.claim??await id(),assertion=input.assertion??await w.operatorAssertion(operator,{process:claim,decision,exclude:input.exclude??[],kind:'break-glass'});return w.run('orgs.breakglass-resolve','system',{claim,operator,decision,...input,assertion});};
 /** Steps the clock through the 72 h reminder to `at`, delivering owner notices on the way (as the alarm would). */
 const reach=async at=>{const c=await claim();if(c?.waitEndsAt&&w.clock.now()<c.waitEndsAt-BREAK_GLASS.REMINDER_BEFORE_MS&&at>=c.waitEndsAt-BREAK_GLASS.REMINDER_BEFORE_MS){w.clock.set(c.waitEndsAt-BREAK_GLASS.REMINDER_BEFORE_MS);await w.sync();await settle();}w.clock.set(at);await settle();return w.sync();};
 const proceed=async(a=OP1,b=OP2,input={})=>{await resolve(a,'proceed',input);return resolve(b,'proceed',input);};
 /** Drains the ownership outbox (refunds, owner notices, ledger updates) until it is empty or stuck. */
 const settle=async()=>{for(let i=0;i<8;i++){const out=await w.drain();if(!out.pending||!out.done)break;}};
 const tokens=(event)=>w.ownerChannels.sent.filter(n=>n.abort&&(!event||n.event===event)).map(n=>n.abort);
 const audits=async()=>[...(await w.metadata.list({prefix:'org/audit/'})).values()];
 const refundsOf=sub=>w.polar.effects.refunds.filter(x=>x.subscription===sub);
 const acceptOffer=w.accept; // the transfer acceptance; `accept` below is the candidate's
 return Object.assign(w,{acceptOffer,claim,start,cosign,accept,checkout,pay,trackA,tier0,tier1,abort,resolve,proceed,settle,tokens,audits,refundsOf,reach,BREAK_GLASS,BREAK_GLASS_OPEN});
}
