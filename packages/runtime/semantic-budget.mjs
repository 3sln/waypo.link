/** Portable, conservative admission ledger. These are estimates of semantic
 * provider work, not a Cloudflare-wide dollar billing cap. Reservations are
 * committed before external calls and never refunded on ambiguous failures.
 * Two independent ledgers share one authority: `semantic` (embedding/vector work,
 * owner and upsert stock) and `ai` (AI inference money shared by the classifier and future AI services; it never
 * consumes a semantic owner admission). Each owner may spend at most a configured
 * share (default 10%) of either ledger's daily and monthly partition allowance,
 * so one account cannot pause work for the rest of its partition (provisional,
 * DEVLOG 2026-10-23). */
export const SEMANTIC_GLOBAL_DEFAULTS=Object.freeze({monthlyMicroUSD:5000000,dailyMicroUSD:500000,maxOwners:1000,maxUpserts:2000000,ownerSharePercent:10});
export const AI_GLOBAL_DEFAULTS=Object.freeze({monthlyMicroUSD:5000000,dailyMicroUSD:500000,ownerSharePercent:10});
const counter=value=>{if(!Number.isSafeInteger(value)||value<0)throw new SemanticBudgetError();return value;};
const positive=(value,fallback)=>{const number=value===undefined?fallback:Number(value);if(!Number.isSafeInteger(number)||number<1)throw new TypeError('Invalid semantic budget configuration');return number;};
const percent=(value,fallback)=>{const number=positive(value,fallback);if(number>100)throw new TypeError('Invalid semantic budget configuration');return number;};
const share=(limit,pct)=>Math.floor(limit*pct/100);
// One prepaid lease per ledger: LeasedSemanticSpend refills 128 microUSD; an ai request (classifier) reserves at most 3,000.
// A configuration whose owner share cannot hold one lease would refuse every owner, so it is rejected outright.
export const SEMANTIC_LEASE_MICRO_USD=Object.freeze({semantic:128,ai:3000});
export class SemanticBudgetError extends Error{constructor(){super('Semantic search is paused by the service budget. Text search remains available.');this.name='SemanticBudgetError';this.code='semantic_global_budget';this.status=429;}}
export class GlobalSemanticBudget {
 constructor({metadata,config={},clock=()=>Date.now()}){this.metadata=metadata;this.clock=clock;
  const semantic={monthlyMicroUSD:positive(config.SEMANTIC_GLOBAL_MONTHLY_MICRO_USD,SEMANTIC_GLOBAL_DEFAULTS.monthlyMicroUSD),dailyMicroUSD:positive(config.SEMANTIC_GLOBAL_DAILY_MICRO_USD,SEMANTIC_GLOBAL_DEFAULTS.dailyMicroUSD),maxOwners:positive(config.SEMANTIC_GLOBAL_MAX_OWNERS,SEMANTIC_GLOBAL_DEFAULTS.maxOwners),maxUpserts:positive(config.SEMANTIC_GLOBAL_MAX_UPSERTS,SEMANTIC_GLOBAL_DEFAULTS.maxUpserts)},semanticShare=percent(config.SEMANTIC_OWNER_SHARE_PERCENT,SEMANTIC_GLOBAL_DEFAULTS.ownerSharePercent);
  const ai={monthlyMicroUSD:positive(config.AI_GLOBAL_MONTHLY_MICRO_USD,AI_GLOBAL_DEFAULTS.monthlyMicroUSD),dailyMicroUSD:positive(config.AI_GLOBAL_DAILY_MICRO_USD,AI_GLOBAL_DEFAULTS.dailyMicroUSD)},aiShare=percent(config.AI_OWNER_SHARE_PERCENT,AI_GLOBAL_DEFAULTS.ownerSharePercent);
  this.limits={...semantic,ownerDailyMicroUSD:share(semantic.dailyMicroUSD,semanticShare),ownerMonthlyMicroUSD:share(semantic.monthlyMicroUSD,semanticShare)};
  this.ledgers={semantic:{prefix:'semantic',stock:true,maxLease:1000,...this.limits},ai:{prefix:'ai',stock:false,maxLease:SEMANTIC_LEASE_MICRO_USD.ai,...ai,ownerDailyMicroUSD:share(ai.dailyMicroUSD,aiShare),ownerMonthlyMicroUSD:share(ai.monthlyMicroUSD,aiShare)}};
  for(const [name,ledger] of Object.entries(this.ledgers))if(Math.min(ledger.ownerDailyMicroUSD,ledger.ownerMonthlyMicroUSD)<SEMANTIC_LEASE_MICRO_USD[name])throw new TypeError(`Invalid semantic budget configuration: the ${name} owner share is below one lease`);}
 async reserve({operation,units,owner}){
  if(!['embed','query','upsert'].includes(operation)||!Number.isSafeInteger(units)||units<1||units>(operation==='embed'?512:384)||typeof owner!=='string'||!/^[a-f0-9-]{36}$/i.test(owner))throw new SemanticBudgetError();
  // Round UP using conservative neuron-derived embedding rate, ignoring any
  // caller-provided price. Vector operation always reserves all384dimensions.
  const amount=operation==='embed'?11:4;
  return this.admit(owner,amount,operation==='upsert'?1:0);
 }
 async reserveLease({owner,microUSD,upsertSlots,ledger='semantic'}){if(typeof owner!=='string'||!/^[a-f0-9-]{36}$/i.test(owner)||!Number.isSafeInteger(microUSD)||microUSD<0||microUSD>(this.ledgers[ledger]?.maxLease??0)||!Number.isSafeInteger(upsertSlots)||upsertSlots<0||upsertSlots>16||microUSD+upsertSlots===0||!['semantic','ai'].includes(ledger)||ledger==='ai'&&(upsertSlots!==0||microUSD<1))throw new SemanticBudgetError();const grant=await this.admit(owner,microUSD,upsertSlots,true,ledger);return ledger==='semantic'?grant:{...grant,ledger};}
 async admit(owner,amount,upserts,lease=false,ledger='semantic'){
  const limits=this.ledgers[ledger],prefix=limits.prefix;
  return this.metadata.transaction(async tx=>{
   const now=new Date(this.clock()),day=now.toISOString().slice(0,10),month=day.slice(0,7);
   let stock=null,admitted=true;
   if(limits.stock){stock=await tx.get('semantic/stock')||{owners:0,upserts:0};admitted=await tx.get(`semantic/owner/${owner}`);counter(stock.owners);counter(stock.upserts);if(admitted!==undefined&&admitted!==null&&admitted!==true)throw new SemanticBudgetError();}
   let daily=await tx.get(`${prefix}/day`),monthly=await tx.get(`${prefix}/month`);for(const window of [daily,monthly])if(window){counter(window.microUSD);counter(window.calls);if(typeof window.period!=='string')throw new SemanticBudgetError();}if(daily?.period!==day)daily={period:day,microUSD:0,calls:0};if(monthly?.period!==month)monthly={period:month,microUSD:0,calls:0};
   // Per-owner share of this partition's money windows. Corrupt rows fail closed.
   const spentKey=`${prefix}/owner-spend/${owner}`,spent=await tx.get(spentKey);
   if(spent!==undefined&&spent!==null&&(typeof spent!=='object'||typeof spent.day!=='string'||typeof spent.month!=='string'||!Number.isSafeInteger(spent.dayMicroUSD)||spent.dayMicroUSD<0||!Number.isSafeInteger(spent.monthMicroUSD)||spent.monthMicroUSD<0))throw new SemanticBudgetError();
   const ownerDay=(spent?.day===day?spent.dayMicroUSD:0)+amount,ownerMonth=(spent?.month===month?spent.monthMicroUSD:0)+amount;
   if(daily.microUSD+amount>limits.dailyMicroUSD||monthly.microUSD+amount>limits.monthlyMicroUSD||ownerDay>limits.ownerDailyMicroUSD||ownerMonth>limits.ownerMonthlyMicroUSD)throw new SemanticBudgetError();
   if(limits.stock){if(!admitted&&stock.owners>=limits.maxOwners||stock.upserts+upserts>limits.maxUpserts)throw new SemanticBudgetError();if(!admitted){await tx.put(`semantic/owner/${owner}`,true);stock.owners++;}stock.upserts+=upserts;await tx.put('semantic/stock',stock);}
   await tx.put(spentKey,{day,month,dayMicroUSD:ownerDay,monthMicroUSD:ownerMonth});
   await tx.put(`${prefix}/day`,{period:day,microUSD:daily.microUSD+amount,calls:daily.calls+1});await tx.put(`${prefix}/month`,{period:month,microUSD:monthly.microUSD+amount,calls:monthly.calls+1});return lease?{day,month,microUSD:amount,upsertSlots:upserts}:true;
  });
 }
}
