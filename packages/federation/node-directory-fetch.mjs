// ORG-7 Node directory egress, derived from the reviewed node-metadata-fetch policy.
// Directory discovery needs query strings; connect to screened IPv4 with original-host TLS.
// Optional Node-only presentation-metadata egress. Disabled unless explicitly
// injected by the operator. IPv6 is deliberately unavailable until a reviewed
// global-address classifier is provided. Resolve A records only so dual-stack
// hosts remain usable; injected resolvers returning IPv6 fail closed.
import {lookup as nodeLookup} from 'node:dns/promises';
import {request as nodeRequest} from 'node:https';
import {isIP} from 'node:net';
import {directoryURL} from './directory.mjs';
import {MAX_MOVES_DOCUMENT_BYTES} from '../identity/document-budget.mjs';

function publicIPv4(address){
 if(isIP(address)!==4)return false;
 const [a,b,c]=address.split('.').map(Number);
 return !(a===0||a===10||a===127||a>=224||a===100&&b>=64&&b<=127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2||b===88&&c===99)||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
}
function positive(value,max,label){if(!Number.isSafeInteger(value)||value<1||value>max)throw new Error(`Invalid metadata ${label}.`);return value;}
/** Budgets (wargame 2026-10-23 F1, provisional; review follow-up; RTC-e review F1/F3). The budget state is
 * process-wide: nodeDirectoryEgress shares ONE state across every allowlist it builds a fetcher for, so alternating
 * allowlists (ORG_FOREIGN_ISSUERS, RTC_FOREIGN_ISSUERS) never reset it. Every request names
 * `budget: {tenant, priority, allowance}` in its init (IdentityDirectory does; a request without one is an anonymous
 * interactive request):
 *  - the two groups are isolated: `interactive` requests together and the background group (`background`, `claimed`,
 *    `linked`) together are each capped at half of every global window (minute and day) and half of the concurrency,
 *    so each group is guaranteed the other half. Inside the background group, `claimed` and `linked` are each capped
 *    at a quarter of the group's windows, so `background` (refresh-ahead of verified peers and members) keeps at least
 *    half of them whatever claims arrive;
 *  - `interactive`: per (tenant, origin) at most TENANT_INTERACTIVE per minute and per hour;
 *  - `background`: per tenant ACROSS ALL ORIGINS at most `allowance` per minute (the directory's roster-scaled limit),
 *    clamped server-side to a quarter of the background minute window, and at most an eighth of the background day
 *    window per UTC day (the tenant's daily share). `claimed` and `linked` each have their own per-tenant counters at a
 *    third of those, so a claim flood at one writer never spends that writer's background allowance. Per-tenant state
 *    is fixed-window counters.
 * There is no flat process-wide day budget that one caller can spend for 24 h. */
export const NODE_DIRECTORY_BUDGETS=Object.freeze({perMinute:600,perDay:100000,tenantInteractive:{minute:10,hour:60},backgroundAllowance:30,tenantMinuteShare:4,tenantDayShare:8,claimShare:4,claimTenantShare:3,maxTenants:4096});
const GROUP={interactive:'interactive',background:'background',claimed:'background',linked:'background'};
/** The process-wide admission state (RTC-e review F3): one per nodeDirectoryEgress, shared by its fetchers. */
export function createNodeDirectoryBudget({maxConcurrent=8,maxRequestsPerMinute=NODE_DIRECTORY_BUDGETS.perMinute,maxRequestsPerDay=NODE_DIRECTORY_BUDGETS.perDay}={}){
 positive(maxConcurrent,16,'concurrency');positive(maxRequestsPerMinute,6000,'request rate');positive(maxRequestsPerDay,1000000,'daily request rate');
 const half=n=>Math.max(1,Math.floor(n/2)),classMinute=half(maxRequestsPerMinute),classDay=half(maxRequestsPerDay),classConcurrent=half(maxConcurrent);
 const claimMinute=Math.max(1,Math.floor(classMinute/NODE_DIRECTORY_BUDGETS.claimShare)),claimDay=Math.max(1,Math.floor(classDay/NODE_DIRECTORY_BUDGETS.claimShare));
 const tenantMinuteMax=Math.max(1,Math.floor(classMinute/NODE_DIRECTORY_BUDGETS.tenantMinuteShare)),tenantDayMax=Math.max(1,Math.floor(classDay/NODE_DIRECTORY_BUDGETS.tenantDayShare));
 const windows={interactive:[],background:[],claimed:[],linked:[]},tenants=new Map(),active={interactive:0,background:0};
 const recent=(list,now,ms)=>{let n=0;for(let i=list.length-1;i>=0&&list[i]>now-ms;i--)n++;return n;};
 // Fixed-window counter: {minute,minuteCount,hour,hourCount,day,dayCount}.
 const counter=(key,now)=>{const c=tenants.get(key)??{},minute=Math.floor(now/60000),hour=Math.floor(now/3600000),day=Math.floor(now/86400000);
  if(c.minute!==minute){c.minute=minute;c.minuteCount=0;}if(c.hour!==hour){c.hour=hour;c.hourCount=0;}if(c.day!==day){c.day=day;c.dayCount=0;}return c;};
 /** Admits one request or returns false; records it on admission. Returns the concurrency group to release. */
 function admit(budget,origin,now){
  for(const list of Object.values(windows))while(list.length&&list[0]<=now-86400000)list.shift();
  const priority=Object.hasOwn(GROUP,budget?.priority)?budget.priority:'interactive',group=GROUP[priority],interactive=group==='interactive';
  const tenant=typeof budget?.tenant==='string'&&budget.tenant.length<=256?budget.tenant:'',key=interactive?'i\n'+tenant+'\n'+origin:(priority==='background'?'b':priority[0])+'\n'+tenant;
  if(active[group]>=classConcurrent)return false;
  const groupLists=interactive?[windows.interactive]:[windows.background,windows.claimed,windows.linked];
  if(groupLists.reduce((n,l)=>n+l.length,0)>=classDay||groupLists.reduce((n,l)=>n+recent(l,now,60000),0)>=classMinute)return false;
  if((priority==='claimed'||priority==='linked')&&(windows[priority].length>=claimDay||recent(windows[priority],now,60000)>=claimMinute))return false;
  const c=counter(key,now);
  if(interactive){if(c.minuteCount>=NODE_DIRECTORY_BUDGETS.tenantInteractive.minute||c.hourCount>=NODE_DIRECTORY_BUDGETS.tenantInteractive.hour)return false;}
  else{const allowance=Number.isSafeInteger(budget?.allowance)&&budget.allowance>0?budget.allowance:NODE_DIRECTORY_BUDGETS.backgroundAllowance,share=priority==='background'?1:NODE_DIRECTORY_BUDGETS.claimTenantShare;
   if(c.minuteCount>=Math.max(1,Math.floor(Math.min(tenantMinuteMax,allowance)/share))||c.dayCount>=Math.max(1,Math.floor(tenantDayMax/share)))return false;}
  c.minuteCount++;c.hourCount++;c.dayCount++;tenants.delete(key);tenants.set(key,c);while(tenants.size>NODE_DIRECTORY_BUDGETS.maxTenants)tenants.delete(tenants.keys().next().value);
  windows[interactive?'interactive':priority].push(now);active[group]++;return group;
 }
 return Object.freeze({admit,release:group=>{active[group]--;}});
}
export function createNodeDirectoryFetch({allowedOrigins,lookup=nodeLookup,request=nodeRequest,timeoutMs=1500,maxBytes=MAX_MOVES_DOCUMENT_BYTES,maxConcurrent=8,maxRequestsPerMinute=NODE_DIRECTORY_BUDGETS.perMinute,maxRequestsPerDay=NODE_DIRECTORY_BUDGETS.perDay,clock=()=>Date.now(),budget}={}){
 if(!Array.isArray(allowedOrigins)||!allowedOrigins.length)throw new Error('Registered metadata origins are required.');
 const origins=new Set(allowedOrigins.map(value=>{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/'||u.port&&u.port!=='443')throw new Error('Metadata origins must be HTTPS on port 443.');return u.origin;}));
 positive(timeoutMs,1500,'timeout');positive(maxBytes,MAX_MOVES_DOCUMENT_BYTES,'body limit');
 const budgets=budget??createNodeDirectoryBudget({maxConcurrent,maxRequestsPerMinute,maxRequestsPerDay});
 return async function publicFetch(value,options={}){
  const u=new URL(value);
  if(!directoryURL(value)||!origins.has(u.origin)||isIP(u.hostname.replace(/^\[|\]$/g,''))===6)throw new Error('Metadata URL is outside the registered public HTTPS policy.');
  if(options.method!==undefined&&options.method!=='GET')throw new Error('Metadata permits GET only.');
  const accept=new Headers(options.headers).get('Accept')??'application/json';
  if(!['application/json'].includes(accept))throw new Error('Unsupported metadata Accept header.');
  if(options.signal?.aborted)throw new Error('Metadata request aborted.');
  const now=clock();if(!Number.isFinite(now))throw new Error('Metadata clock unavailable.');
  const admitted=budgets.admit(options.budget,u.origin,now);if(!admitted)throw Object.assign(new Error('Metadata egress budget exhausted.'),{code:'rate_limited'});
  try{return await new Promise((resolve,reject)=>{
   let req,res,done=false;const abort=()=>finish(new Error('Metadata request aborted.'));
   const timer=setTimeout(()=>finish(new Error('Metadata request timed out.')),timeoutMs);
   function finish(error,response){if(done)return;done=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);if(error){res?.destroy();req?.destroy();reject(error);}else resolve(response);}
   options.signal?.addEventListener('abort',abort,{once:true});
   Promise.resolve().then(()=>lookup(u.hostname,{all:true,family:4,verbatim:true})).then(records=>{
    if(done)return;
    if(!Array.isArray(records)||!records.length||records.length>64||records.some(r=>r.family!==4||!publicIPv4(r.address)))throw new Error('Metadata DNS must contain only globally routable IPv4 addresses; IPv6 is not supported.');
    const selected=records[0].address;
    const pinnedLookup=(_hostname,opts,callback)=>{if(typeof opts==='function'){callback=opts;opts={};}if(opts?.all)callback(null,[{address:selected,family:4}]);else callback(null,selected,4);};
    req=request({protocol:'https:',hostname:u.hostname,port:443,path:u.pathname+u.search,method:'GET',servername:u.hostname,agent:false,rejectUnauthorized:true,lookup:pinnedLookup,headers:{Host:u.host,Accept:accept,'Accept-Encoding':'identity'}},incoming=>{
     res=incoming;if(done){res.destroy();return;}
     const length=res.headers['content-length'],encoding=res.headers['content-encoding'];
     if(![200,404,410].includes(res.statusCode)||encoding&&encoding.toLowerCase()!=='identity'||length!==undefined&&(typeof length!=='string'||!/^\d+$/.test(length)||Number(length)>maxBytes)){finish(new Error('Metadata response rejected.'));return;}
     let size=0;const chunks=[];
     res.on('data',chunk=>{if(done)return;size+=chunk.length;if(size>maxBytes){finish(new Error('Metadata response exceeds limits.'));return;}chunks.push(Buffer.from(chunk));});
     res.once('error',error=>finish(error));res.once('aborted',()=>finish(new Error('Metadata response interrupted.')));
     res.once('end',()=>{if(done)return;try{const headers=new Headers();for(const key of ['content-type','content-length','cache-control'])if(typeof res.headers[key]==='string')headers.set(key,res.headers[key]);finish(null,new Response(Buffer.concat(chunks,size),{status:res.statusCode,headers}));}catch(error){finish(error);}});
    });
    req.once('error',error=>finish(error));req.end();
   }).catch(error=>finish(error));
  });}finally{budgets.release(admitted);}
 };
}
/** The Node adapter's DIRECTORY_EGRESS (packages/runtime/account/foreign-directory.mjs): issuers -> a budgeted fetcher
 * for that allowlist. RTC-e review F3: every fetcher shares ONE process-wide budget state, and fetchers are cached per
 * allowlist (bounded), so alternating allowlists never reset a tenant's or a class's budget. An empty allowlist dials
 * nothing. */
export function nodeDirectoryEgress(options={}){
 const {maxConcurrent,maxRequestsPerMinute,maxRequestsPerDay}=options,budget=options.budget??createNodeDirectoryBudget({...maxConcurrent!==undefined?{maxConcurrent}:{},...maxRequestsPerMinute!==undefined?{maxRequestsPerMinute}:{},...maxRequestsPerDay!==undefined?{maxRequestsPerDay}:{}});
 const ports=new Map(),none=async()=>{throw new Error('No directory issuer is allowed.');};
 return issuers=>{if(!issuers.length)return none;const k=JSON.stringify(issuers);let port=ports.get(k);
  if(!port){port=createNodeDirectoryFetch({...options,allowedOrigins:issuers,budget});ports.set(k,port);while(ports.size>16)ports.delete(ports.keys().next().value);}
  return port;};
}
