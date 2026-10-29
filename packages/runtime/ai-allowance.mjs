// One AI allowance per plan (coordinator plan 2026-10-28, provisional and pending owner sign-off), shared by every
// 3sln.me AI service that spends 3sln.me's own money: today the built-in classifier; later describe and embed. Plan data,
// not code. Each account gets a monthly estimated-spend allowance in micro-USD; one app may use at most AI_APP_SHARE_PERCENT
// of it, so one app cannot exhaust another's; each service has its own per-minute call cap per plan. Free accounts get
// none. The service-wide `ai` ledger (packages/runtime/semantic-budget.mjs) stays the backstop across all accounts.
// Counters only: no content is ever written here.
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export const AI_PLAN_ALLOWANCE=freeze({paid:{monthlyMicroUSD:40000},plus:{monthlyMicroUSD:500000},ultra:{monthlyMicroUSD:5000000}});
export const AI_PLANS=Object.freeze(Object.keys(AI_PLAN_ALLOWANCE));
export const AI_APP_SHARE_PERCENT=50;
/** Per-service, per-plan call caps per UTC minute. A service that is not listed has no allowance. */
export const AI_SERVICE_MINUTE_CALLS=freeze({classify:{paid:5,plus:10,ultra:30}});
export const AI_USAGE='ai/usage/v1',AI_APP_USAGE='ai/usage/v1/app/';
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v),count=v=>Number.isSafeInteger(v)&&v>=0;
const refuse=(message,retryAfter)=>{throw Object.assign(new Error(message),{code:'rate_limited',status:429,retryAfter});};
const hex=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');
/** Seconds until the next UTC minute or month boundary. */
export function retryAfter(now,window){const d=new Date(now),next=window==='minute'?Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),d.getUTCHours(),d.getUTCMinutes()+1):window==='day'?Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()+1):Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1);return Math.max(1,Math.ceil((next-now)/1000));}
/** The limits of `plan` for `service`, or null (no allowance). */
export function aiLimits(plan,service){
 const allowance=AI_PLAN_ALLOWANCE[plan],minuteCalls=AI_SERVICE_MINUTE_CALLS[service]?.[plan];
 return allowance&&Number.isSafeInteger(minuteCalls)?{minuteCalls,monthlyMicroUSD:allowance.monthlyMicroUSD,appMonthlyMicroUSD:Math.floor(allowance.monthlyMicroUSD*AI_APP_SHARE_PERCENT/100)}:null;
}
/**
 * Checks and debits the shared allowance in one transaction: the account's monthly spend, this app's share and the
 * service's minute cap. A refusal writes nothing and is `rate_limited` with Retry-After (a no-effect code). A corrupt
 * counter fails closed.
 */
export async function reserveAIAllowance(store,{now,plan,service,clientId,microUSD}){
 const limits=aiLimits(plan,service);if(!limits)throw Object.assign(new Error('No AI allowance for this plan.'),{code:'forbidden',status:403});
 if(!Number.isSafeInteger(microUSD)||microUSD<1)throw new TypeError('Invalid AI spend estimate');
 const iso=new Date(now).toISOString(),month=iso.slice(0,7),minute=iso.slice(0,16),appKey=AI_APP_USAGE+await hex(String(clientId));
 await store.transaction(async tx=>{
  const account=await tx.get(AI_USAGE),app=await tx.get(appKey);
  const okAccount=account===undefined||plain(account)&&Object.keys(account).every(k=>['month','monthlyMicroUSD','services'].includes(k))&&typeof account.month==='string'&&count(account.monthlyMicroUSD)&&plain(account.services??{})&&Object.values(account.services??{}).every(s=>plain(s)&&typeof s.minute==='string'&&count(s.calls));
  const okApp=app===undefined||plain(app)&&Object.keys(app).every(k=>['month','monthlyMicroUSD'].includes(k))&&typeof app.month==='string'&&count(app.monthlyMicroUSD);
  if(!okAccount||!okApp)refuse('The AI allowance is unavailable.',retryAfter(now,'day'));
  const spent=(account?.month===month?account.monthlyMicroUSD:0)+microUSD,appSpent=(app?.month===month?app.monthlyMicroUSD:0)+microUSD,prior=account?.services?.[service],calls=(prior?.minute===minute?prior.calls:0)+1;
  if(spent>limits.monthlyMicroUSD||appSpent>limits.appMonthlyMicroUSD)refuse('The AI allowance is used up for this month.',retryAfter(now,'month'));
  if(calls>limits.minuteCalls)refuse('Too many AI requests; try again in a minute.',retryAfter(now,'minute'));
  await tx.put(AI_USAGE,{month,monthlyMicroUSD:spent,services:{...account?.month===month?account.services:{},[service]:{minute,calls}}});
  await tx.put(appKey,{month,monthlyMicroUSD:appSpent});
 });
}
/**
 * Credits back a debit made by reserveAIAllowance when the call is then refused before any effect (review M1, CR-X3-25:
 * covered-work admission refused, or the service-wide `ai` ledger refused the lease), so a refusal that claims no effect
 * leaves the owner's allowance as it was. Only counters of the same month (and minute, for the call cap) are credited; a
 * counter that rolled over in between is left alone, and nothing goes below zero. A crash between the debit and this
 * credit leaves the debit in place (fails closed, bounded by one call).
 */
export async function releaseAIAllowance(store,{now,service,clientId,microUSD}){
 if(!Number.isSafeInteger(microUSD)||microUSD<1)throw new TypeError('Invalid AI spend estimate');
 const iso=new Date(now).toISOString(),month=iso.slice(0,7),minute=iso.slice(0,16),appKey=AI_APP_USAGE+await hex(String(clientId));
 await store.transaction(async tx=>{
  const account=await tx.get(AI_USAGE),app=await tx.get(appKey);
  if(plain(account)&&account.month===month&&count(account.monthlyMicroUSD)){
   const prior=account.services?.[service],services={...account.services};
   if(plain(prior)&&prior.minute===minute&&count(prior.calls))services[service]={minute,calls:Math.max(0,prior.calls-1)};
   await tx.put(AI_USAGE,{...account,monthlyMicroUSD:Math.max(0,account.monthlyMicroUSD-microUSD),services});
  }
  if(plain(app)&&app.month===month&&count(app.monthlyMicroUSD))await tx.put(appKey,{month,monthlyMicroUSD:Math.max(0,app.monthlyMicroUSD-microUSD)});
 });
}
