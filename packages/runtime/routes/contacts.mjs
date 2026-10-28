// HTTP routes of slice 3, contact links (docs/architecture/app-engine.md §12): link previews (oEmbed, avatar), the public
// contact-link landing page and contact-profile representation, the opener's audience response and developer contact
// (GET eligibility, POST a principal-bound invitation; contacts spike CR-C5, packages/runtime/developer-contact.mjs).
// Legacy messaging representations and owner contact management left the core on 2026-10-27 (DEVLOG "Messaging removed
// from core; Parlay rename; BB-CUT reset"): the composer, intake metadata, JSON inspection, token mints, signed-link
// POST delivery, /api/contacts*, /api/contact-links and /api/links/envelope. The contact-link ingress descriptor (its
// withdrawn messaging-address consumer replaced by the messaging-mailbox feature; kept until contacts phase 4) is
// answered by routes/links.mjs in the edge stage. POST to a contact link is 405 (Allow: GET, HEAD, OPTIONS).
// Stage handlers and route-module shape: packages/runtime/routes/index.mjs.
import {flagsFor} from '../../flags/read.mjs';
import {developerContactRoutes} from '../developer-contact.mjs';
import {CONTACT_PROFILE_MIME,selectContactRepresentation} from '../../links/profile.mjs';
import {parseLinkQuery,parseLinkMeta} from '../../links/envelope.mjs';
import {contactPreview,injectPreview,oembed} from '../../links/preview.mjs';
import {UUID as uuidPattern} from '../../core/primitives.mjs';
import {json,publicUnknown,contactUnknown,body,limit,securePage,brandPage,privateHeaders,accountHandle,signedContactPath} from './shared.mjs';

// Owner-permitted profile for a verified link, behind a per-network bound; failures fall back to the generic card.
const previewProfile=(env,request,local)=>async canonical=>{if(!await limit(env,{operation:'contact-preview',remoteIP:request.headers.get('CF-Connecting-IP')||(local?'127.0.0.1':'unknown')}))throw new Error('limited');const recipient=await env.IDENTITY_REPOSITORY.get(canonical.sub);if(!recipient||recipient.status!=='active'||recipient.handle!==canonical.handle)throw new Error('unavailable');return accountHandle(env,canonical.sub).contactProfile(canonical.sub,canonical.link);};

export function allowedMethods(path){
 if(path==='/api/developer-contact')return ['GET','POST'];
 if(path==='/api/links/respond')return ['POST'];
 return null;
}
// The opener operation is not refused for capacity. Neither is developer contact's POST (an invitation mint on the
// developer identity's Parlay, nothing stored in this account), so a full account can still reach support.
export const admission={exempt:path=>path==='/api/links/respond'||path==='/api/developer-contact'};
export const stages={
 async public({request,env,url,path,local}){
   // Public, credentialless previews: oEmbed and the link-scoped avatar redirect (never deliver or evaluate data).
   const avatarPath=/^(\/users\/[^/]+\/contact\/[a-f0-9-]{36})\/avatar$/.exec(path);
   if(path==='/oembed'||avatarPath){
    const previewHeaders={...privateHeaders,'Access-Control-Allow-Origin':'*','X-Robots-Tag':'noindex, nofollow'};
    if(!['GET','HEAD'].includes(request.method))return json({error:'method_not_allowed'},405,{...previewHeaders,Allow:'GET, HEAD'});
    if(avatarPath){const preview=await contactPreview({env,intentLinksEnabled:flagsFor(env).enabled('INTENT_LINKS_ENABLED'),target:env.APP_ORIGIN+avatarPath[1]+url.search,profile:previewProfile(env,request,local)});if(!preview.verified)return publicUnknown(previewHeaders,request);return new Response(null,{status:302,headers:{...previewHeaders,Location:preview.avatarURL??preview.image}});}
    const targets=url.searchParams.getAll('url');if(targets.length!==1||targets[0].length>18000||url.searchParams.getAll('format').some(f=>f!=='json'))return json({error:url.searchParams.has('format')&&url.searchParams.get('format')!=='json'?'not_implemented':'invalid_request'},url.searchParams.get('format')&&url.searchParams.get('format')!=='json'?501:400,previewHeaders);
    const preview=await contactPreview({env,intentLinksEnabled:flagsFor(env).enabled('INTENT_LINKS_ENABLED'),target:targets[0],profile:previewProfile(env,request,local)}),value=oembed(preview);return new Response(request.method==='HEAD'?null:JSON.stringify(value),{status:preview.verified?200:404,headers:{...previewHeaders,'Content-Type':'application/json'}});
   }
   const signedContact=signedContactPath.exec(path);
   if(signedContact){
    const publicHeaders={Vary:'Accept, Accept-Language','Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, HEAD, OPTIONS','Access-Control-Allow-Headers':'Accept, Accept-Language','X-Robots-Tag':'noindex, nofollow, nosnippet'};
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...privateHeaders,...publicHeaders}});
    if(!['GET','HEAD'].includes(request.method))return json({error:'method_not_allowed'},405,{...publicHeaders,Allow:'GET, HEAD, OPTIONS'});
    // One raw-query parser takes every routing decision (links §2; review finding #7).
    let query;try{query=parseLinkQuery(request.url);}catch{return json({error:'link_malformed',message:'This contact link is malformed.'},400,publicHeaders);}
    const refused=()=>publicUnknown(publicHeaders,request);
    const representation=selectContactRepresentation(request.headers.get('Accept')||'*/*');
    // bindle_data is evaluated by no core representation (the messaging app evaluates audiences through the links
    // contract), so it is malformed everywhere here (links §7.2).
    if(query.data!==undefined)return json({error:'link_malformed',message:'Remove the response from this link before continuing.'},400,publicHeaders);
    // The landing page is identical for every link and evaluates nothing; its own calls verify.
     if(request.method==='GET'&&representation==='text/html'){const page=await securePage(await brandPage(await env.ASSETS.fetch(new Request(new URL('/console.html',url),request)),env));const headers=new Headers(page.headers);for(const [key,value]of Object.entries(publicHeaders))headers.set(key,value);
      // Only this page may fetch other providers' public manifests (handle discovery, links §6.4); still no credentials.
      headers.set('Content-Security-Policy',headers.get('Content-Security-Policy').replace("connect-src 'self'",`connect-src 'self' https:${local?' http://localhost:*':''}`).replace("form-action 'self'",flagsFor(env).enabled('INTENT_LINKS_ENABLED')?`form-action https:${local?' http://localhost:*':''}`:"form-action 'self'"));if(!page.ok||!headers.get('Content-Type')?.includes('text/html'))return new Response(page.body,{status:page.status,headers});const preview=await contactPreview({env,intentLinksEnabled:flagsFor(env).enabled('INTENT_LINKS_ENABLED'),target:request.url,profile:previewProfile(env,request,local)});return new Response(injectPreview(await page.text(),preview),{status:preview.verified?page.status:404,headers});}
    if(representation!==CONTACT_PROFILE_MIME)return json({error:'not_acceptable'},406,publicHeaders);
    let sub;if(query.form==='link'){try{const claims=parseLinkMeta(query.meta).claims;if(claims.aud===env.APP_ORIGIN+path)sub=claims.sub;}catch{}}
    if(typeof sub!=='string'||!uuidPattern.test(sub))return refused();
    if(!await limit(env,{operation:'contact-preview',remoteIP:request.headers.get('CF-Connecting-IP')||(local?'127.0.0.1':'unknown')}))return json({error:'rate_limited'},429,{...publicHeaders,'Retry-After':'60'});
    // The identity is looked up only after the caller's own budget (wargame round 3 L1), so the limiter is not an
    // account-state oracle.
    const recipient=await env.IDENTITY_REPOSITORY.get(sub);if(!recipient||recipient.status!=='active'||recipient.handle!==signedContact[1])return refused();
    try{
     const profile=await accountHandle(env,sub).contactProfile(sub,request.url);
     return request.method==='HEAD'?new Response(null,{headers:{...privateHeaders,...publicHeaders,'Content-Type':CONTACT_PROFILE_MIME}}):json(profile,200,{...publicHeaders,'Content-Type':CONTACT_PROFILE_MIME});
    }catch(error){if(contactUnknown(error))return refused();throw error;}
   }
 },
 async owner({request,env,path,owner,id,object,context}){
    const developerContactResponse=await developerContactRoutes({path,request,env,owner,object,accountHandle,body,json,limit,remoteIP:context.remoteIP});if(developerContactResponse)return developerContactResponse;
    // Opener operation: explicit, authenticated, CSRF-checked and rate-limited per user (links §9).
    if(path==='/api/links/respond'){if(!await limit(env,{operation:'link-respond',remoteIP:context.remoteIP,handle:id}))return json({error:'rate_limited',message:'Please wait before trying again.'},429,{'Retry-After':'60'});const input=await body(request,32768);if(Object.keys(input).join()!=='link'||typeof input.link!=='string')return json({error:'invalid_request'},400);return json(await object.signLinkResponse(id,owner.account.handle,input.link));}
 },
};
