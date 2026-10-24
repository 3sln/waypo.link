// D092 phase 1: owner control plane only; no retention execution or outbound notices.
// M2: behind OVER_QUOTA_RETENTION_ENABLED. With the flag off and no persisted episode the route answers exactly as
// before it existed; a persisted episode stays readable (like deletion and exports status), never writable.
import {json,body,routeFlags,consume,pseudonym} from './shared.mjs';
const ROOT='/api/account/retention',KEEP=ROOT+'/keep',VIEWED=ROOT+'/viewed';
export const allowedMethods=path=>path===ROOT?['GET']:[KEEP,VIEWED].includes(path)?['POST']:null;
// Runs before capacity admission so suspended owners keep read/export access; its own per-owner budget bounds it.
export const admission={exempt:path=>[ROOT,KEEP,VIEWED].includes(path)};
export const RETENTION_ROUTE_BUDGET=Object.freeze({windowMs:60000,limit:30});
async function admit(env,owner){try{const secret=env.SESSION_COOKIE_KEY??env.KEY_ENCRYPTION_KEY;if(typeof secret!=='string'||!secret)return false;return await consume(env,'retention:'+await pseudonym(owner,secret),RETENTION_ROUTE_BUDGET.windowMs,RETENTION_ROUTE_BUDGET.limit);}catch{return false;}}
const notFound=()=>json({error:'not_found'},404);
export const stages={async beforeActivity({request,env,path,url,id,object}){
 if(!allowedMethods(path))return;
 if(url.search)return json({error:'invalid_request'},400);
 const enabled=routeFlags(env,{subject:{kind:'account',owner:id}}).enabled('OVER_QUOTA_RETENTION_ENABLED');
 // N4: with the flag off the uniform 404 is decided before the owner's request budget is spent.
 if(!enabled&&(path!==ROOT||!await object.retentionHasEpisode(id)))return notFound();
 if(!await admit(env,id))return json({error:'rate_limited',message:'Please wait before trying again.'},429,{'Retry-After':'60'});
 if(path===VIEWED){const input=await body(request,128);if(Object.keys(input).length)return json({error:'invalid_request'},400);return json(await object.retentionViewed(id));}
 if(path===ROOT){try{return json(await object.retentionStatus(id));}catch(error){if(error?.code==='not_found')return notFound();throw error;}}
 return json(await object.retentionKeep(id,await body(request,65536)));
}};
