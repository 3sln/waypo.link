// AU-S4. Owner mutations use the shared session/CSRF boundary. Returns are bound to a per-removal HttpOnly
// __Host- cookie; an unbound return is read-only until an explicit owner confirmation POST. No app URLs are trusted
// from request bodies. Back-channel admission reads only local connection pins before any key fetch.
import {json,body,bytesOf,accountHandle,jwsPart,privateHeaders,routeFlags,consume,pseudonym} from './shared.mjs';
import {parseRemovalReturn} from '../../federation/removal.mjs';
export const REMOVAL_RETURN='/api/apps/removal/return',REMOVAL_COMPLETE='/bindle/removal/complete',ROOT='/api/apps/removal';
const actions=new Map([['start','app-removal.start'],['reissue','app-removal.reissue'],['cancel','app-removal.cancel'],['force','app-removal.force'],['confirm','app-removal.complete']]);
const cookieName=id=>'__Host-removal-'+id;
const binding=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
const cookie=(request,id)=>{const name=cookieName(id)+'=',found=(request.headers.get('Cookie')??'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(name));return found.length===1?found[0].slice(name.length):undefined;};
const routed=id=>typeof id==='string'&&/^([a-f0-9-]{36})\.[a-f0-9-]{36}$/.test(id)?id.slice(0,36):null;
export const allowedMethods=path=>path===ROOT?['GET']:path===REMOVAL_RETURN?['GET']:path===REMOVAL_COMPLETE?['POST']:path.startsWith(ROOT+'/')&&actions.has(path.slice(ROOT.length+1))?['POST']:null;
export const admission={exempt:path=>allowedMethods(path)!==null};
async function admit(env,source){try{const secret=env.SESSION_COOKIE_KEY??env.KEY_ENCRYPTION_KEY;if(typeof secret!=='string'||!secret)return false;return await consume(env,'app-removal:'+await pseudonym(source,secret),60000,30);}catch{return false;}}
// Wargame F2: the failure budget counts only failed verifications of a removal that matched a local, open,
// back-channel removal for that client. It is keyed by the removal (which names its owner) and the client, so an
// attacker who opens their own removal of the same app spends only their own budget (review follow-up 1). An
// unverified `iss` alone never spends it, and a success never charges it. The pre-verification gate is a peek.
async function removalFailures(env,removal,clientId,{peek=false}={}){try{const secret=env.SESSION_COOKIE_KEY??env.KEY_ENCRYPTION_KEY;if(typeof secret!=='string'||!secret)return false;return await env.ABUSE.consume('app-removal:removal-failure:'+await pseudonym(removal+'\n'+clientId,secret),{windowMs:60000,limit:30,...peek?{peek:true}:{}});}catch{return false;}}
const humanReturn=request=>{const params=new URL(request.url).searchParams,owner=routed(params.get('removal'));return new Response(null,{status:303,headers:{Location:'/console?'+(owner?'account='+owner+'&':'')+'removal_return='+encodeURIComponent(params.toString()),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});};
export const stages={
 async public({request,env,path}){
  if(path===REMOVAL_RETURN&&request.method==='GET'&&request.headers.get('Accept')?.includes('text/html'))return humanReturn(request);
  if(path!==REMOVAL_COMPLETE)return;if(request.method!=='POST')return json({error:'method_not_allowed'},405,{Allow:'POST'});
  const accepted=()=>json({},202);if(!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded'))return json({error:'invalid_request'},400);
  let raw;try{raw=new TextDecoder('utf-8',{fatal:true}).decode(await bytesOf(request,8192));}catch{return json({error:'invalid_request'},400);}
  const p=new URLSearchParams(raw),parsed=parseRemovalReturn(p,{backChannel:true});if(!parsed||p.get('client_assertion_type')!=='urn:ietf:params:oauth:client-assertion-type:jwt-bearer'||!p.get('client_assertion'))return json({error:'invalid_request'},400);
  const claims=jwsPart(p.get('client_assertion'),1),removal=claims?.bindle_removal,owner=routed(removal),clientId=claims?.iss;
  if(!await admit(env,'ip:'+(request.headers.get('CF-Connecting-IP')??'unknown'))||typeof clientId!=='string'||!owner)return accepted();
  try{const object=accountHandle(env,owner),local=await object.appRemovalAdmission(owner,removal);if(!local||local.clientId!==clientId||parsed.removal&&parsed.removal!==removal)return accepted();
   if(!await removalFailures(env,removal,clientId,{peek:true}))return accepted();
   try{await env.FEDERATION_AUTHORITY.removalVerifyAssertion({owner,clientId,removal,assertion:p.get('client_assertion')});}catch{await removalFailures(env,removal,clientId);return accepted();}
   await object.appRemovalComplete(owner,clientId,{removal,outcome:parsed.outcome,...parsed.result?{result:parsed.result}:{}});}catch{/* Uniform accepted response, including unknown subjects and invalid credentials. */}return accepted();
 },
 async beforeActivity({request,env,path,object,id,context,owner}){
  if(!allowedMethods(path)||path===REMOVAL_COMPLETE)return;
  if(path===ROOT){const rows=await object.appRemovalOwner(id,{operation:'app-removal.list'}),subject={kind:'account',owner:id};let connections=[];try{if(typeof object.connectionsOwner==='function')connections=(await object.connectionsOwner(id,{operation:'connections.list'})).connections??[];}catch{/* Missing connection review hides new cleanup; reversal remains readable. */}return json({...rows,clean_enabled:routeFlags(env,{subject}).enabled('APP_CLEAN_REMOVAL_ENABLED'),clean_connections:Object.fromEntries(connections.map(c=>[c.id,routeFlags(env,{subject,client:{clientId:c.clientId}}).enabled('APP_CLEAN_REMOVAL_ENABLED')]))});}
  if(path===REMOVAL_RETURN){if(request.headers.get('Accept')?.includes('text/html'))return humanReturn(request);const parsed=parseRemovalReturn(new URL(request.url).searchParams);if(!parsed)return json({removal:null});const result=await object.appRemovalOwner(id,{operation:'app-removal.complete',input:{...parsed,binding:cookie(request,parsed.removal)}});return json({removal:result},200,{'Referrer-Policy':'no-referrer'});}
  if(request.headers.get('Origin')!==env.APP_ORIGIN||context.csrfToken!==owner.csrfToken)return json({error:'csrf'},403);
  const name=path.slice(ROOT.length+1),value=await body(request,8192);if(name==='confirm')value.confirmed=true;
  if(name==='start'||name==='reissue'){
   if(Object.hasOwn(value,'binding'))return json({error:'invalid_request'},400);const secret=binding(),row=await object.appRemovalOwner(id,{operation:actions.get(name),input:{...value,binding:secret}});
   const signed=await env.FEDERATION_AUTHORITY.removalSign({subject:`${env.APP_ORIGIN}/entities/${id}`,clientId:row.client_id,removal:row.removal,cleanupBy:Math.floor(row.cleanup_by/1000),returnUri:env.APP_ORIGIN+REMOVAL_RETURN,...row.confidential?{connection:row.connection,generation:row.generation}:{}}),navigation=new URL(row.declaration.uri);navigation.searchParams.set('removal_request',signed.token);
   return json({removal:row,navigation_uri:navigation.href},200,{'Set-Cookie':`${cookieName(row.removal)}=${secret}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000`,'Referrer-Policy':'no-referrer'});
  }
  return json({removal:await object.appRemovalOwner(id,{operation:actions.get(name),input:value})},200,privateHeaders);
 },
};
