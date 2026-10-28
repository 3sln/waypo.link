// INT-5. Public transport only renders; owner decisions use the router's origin/session/CSRF checks.
import {EXT,declare} from '../../core/extensions.mjs';
import {createAppEngine,read} from '../../app/engine.mjs';
import {systemClock,cryptoRandom,nullAudit} from '../../app/providers.mjs';
import {ReceiveIntent,viewerActivated} from '../../intents/router.mjs';
import {parseLegacyIntent} from '../../intents/legacy.mjs';
import {parseProtocolIntent,encodeIntent} from '../../intents/format.mjs';
import {registeredIntent} from '../../intents/registered.mjs';
import {canonicalContactLink} from '../../links/preview.mjs';
function parseIntent(value){try{const u=new URL(value);if(u.protocol!=='web+bindle:'||!['send-message','add-contact'].includes(u.host)||u.pathname||u.hash||u.username||u.password||[...u.searchParams.keys()].join()!=='contact-url')return null;const link=u.searchParams.get('contact-url'),contact=new URL(link);return canonicalContactLink(contact.origin,link)?.link===link?{link,intent:u.host}:null;}catch{return null;}}
import {flagGlobal,flagEnabled,json,privateHeaders,bytesOf,body,securePage} from './shared.mjs';
// Attribute-safe escaping; every insertion below uses a replacer function so `$&`, `$'` and "$`" stay literal (F3).
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const part=v=>btoa(String.fromCharCode(...new TextEncoder().encode(v))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
async function signature(env,value){const secret=env.KEY_ENCRYPTION_KEY;if(typeof secret!=='string'||!secret)return null;const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return part(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value)))));}
// The activation ticket is bound to the intent value when the server rendered it (POST and query bootstraps). A
// fragment or legacy intent is not available to the server in the form the page later submits, so its ticket stays
// unbound; COOP keeps an opener from re-driving such a page.
const intentDigest=async value=>part(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))));
async function ticket(env,request,intent=''){const value=part(JSON.stringify({at:Date.now(),activated:viewerActivated(request.headers),...intent?{intent:await intentDigest(intent)}:{}})),sig=await signature(env,value);return sig?value+'.'+sig:'';}
async function activation(env,value,intent){try{if(typeof value!=='string'||value.length>1024)return false;const [payload,sig,...extra]=value.split('.');if(extra.length||!sig||await signature(env,payload)!==sig)return false;const decoded=JSON.parse(atob(payload.replaceAll('-','+').replaceAll('_','/')));if(decoded.intent!==undefined&&(typeof intent!=='string'||!intent||decoded.intent!==await intentDigest(intent)))return false;return decoded.activated===true&&decoded.at<=Date.now()&&decoded.at>Date.now()-3600000;}catch{return false;}}
// Web app manifest members this module owns. site.mjs serves /manifest.webmanifest (branding, Cache-Control) and merges
// these in, so one handler answers in both flag states. Off: the static manifest's legacy `/console?intent=%s` handler.
export function intentManifestMembers(env){return flagGlobal(env,'INTENT_LINKS_ENABLED')?{protocol_handlers:[{protocol:'web+bindle',url:'/i#%s'}]}:{};}
/** The intent-links extension entry (extensions rev 3.2 §2.8), as a list for withExtensionEntries. */
export function intentFeature(env){return flagGlobal(env,'INTENT_LINKS_ENABLED')?[declare(EXT.intentLinks,{endpoint:env.APP_ORIGIN+'/i'})]:[];}
export const allowedMethods=path=>path==='/i'||path==='/i/contact'?['GET','HEAD','POST']:path==='/api/intents/records'?['GET']: /^\/api\/intents\/(resolve|decide|exclude|ignore|remove)$/.test(path)?['POST']:null;
async function receive(input){const engine=createAppEngine({providers:{clock:systemClock,random:cryptoRandom,audit:nullAudit}});try{return await read(engine,new ReceiveIntent({input}));}finally{await engine.dispose();}}
async function page(request,env,url,{value='',placement='',legacy='',status=200,error=false}={}){
 let source=await env.ASSETS.fetch(new Request(new URL('/intent.html',url),{method:'GET'}));if([307,308].includes(source.status)){const canonical=new URL(source.headers.get('Location')??'',url);if(canonical.origin!==url.origin||canonical.pathname!=='/intent'||canonical.search||canonical.hash)return json({error:'intent_page_unavailable'},503);source=await env.ASSETS.fetch(new Request(canonical,{method:'GET'}));}if(!source.ok)return json({error:'intent_page_unavailable'},503);
 const meta=(error?'<meta name="intent-error" content="invalid_link">':'')+'<meta name="intent-navigation" content="'+escape(await ticket(env,request,legacy?'':value))+'"></head>',bootstrap=!value&&!legacy?'<body>':'<body><input type="hidden" id="intent-bootstrap" name="'+(legacy?'legacy':'bintent')+'" value="'+escape(legacy||value)+'" data-placement="'+escape(placement)+'" data-legacy="'+escape(legacy)+'">';
 const text=(await source.text()).replace('</head>',()=>meta).replace('<body>',()=>bootstrap);
 const response=await securePage(new Response(text,{headers:{'Content-Type':'text/html; charset=utf-8'}}),false,false,{keepPolicy:true}),headers=new Headers(response.headers);headers.set('Content-Security-Policy',(headers.get('Content-Security-Policy')??"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action https:").replace(/form-action[^;]*/g,()=>'form-action https:').replace(/connect-src[^;]*/g,()=>"connect-src 'self' https:"));headers.set('Cache-Control','no-store');headers.set('Referrer-Policy','no-referrer');headers.set('Cross-Origin-Opener-Policy','same-origin');headers.set('X-Robots-Tag','noindex, nofollow, nosnippet');return new Response(request.method==='HEAD'?null:response.body,{status,headers});
}

function prefersJSON(request){const ranges=(request.headers.get('Accept')??'').split(',').map(value=>{const [type,...parameters]=value.trim().toLowerCase().split(';');const q=parameters.find(p=>p.trim().startsWith('q='));return {type:type.trim(),q:q?Number(q.trim().slice(2)):1};});const quality=type=>{const matches=ranges.map(r=>({...r,specificity:r.type===type?2:r.type===type.split('/')[0]+'/*'?1:r.type==='*/*'?0:-1})).filter(r=>r.specificity>=0);const specificity=Math.max(-1,...matches.map(r=>r.specificity));return Math.max(0,...matches.filter(r=>r.specificity===specificity).map(r=>Number.isFinite(r.q)&&r.q>=0&&r.q<=1?r.q:0));};return quality('application/json')>quality('text/html');}
const invalidPage=(request,env,url,code='intent_malformed',status=400)=>prefersJSON(request)?json({error:code},status):page(request,env,url,{status,error:true});
export const stages={
 async public({request,env,url,path}){
  if(!flagGlobal(env,'INTENT_LINKS_ENABLED'))return;
  if(path==='/console'&&['GET','HEAD'].includes(request.method)){
   const names=['bindle_intent','intent'].filter(k=>url.searchParams.has(k));if(names.length===1&&url.searchParams.getAll(names[0]).length===1){
    const legacy=parseIntent(url.searchParams.get(names[0]));if(legacy?.intent&&legacy?.link){const ref=registeredIntent(legacy.intent);if(ref)try{return page(request,env,url,{value:encodeIntent({bintent:1,kind:ref,data:{contact:legacy.link}}),placement:'fragment'});}catch{try{parseLegacyIntent({intent:legacy.intent,contact:legacy.link});return page(request,env,url,{legacy:url.searchParams.get(names[0]),placement:'legacy'});}catch{/* Existing malformed legacy links retain their old response. */}}}
   }
   return;
  }
  if(path!=='/i'&&path!=='/i/contact')return;
  if(!['GET','HEAD','POST'].includes(request.method))return json({error:'method_not_allowed'},405,{Allow:'GET, HEAD, POST'});
  try{
   if(request.method==='POST'){
    if(request.headers.get('Content-Type')?.split(';')[0]!=='application/x-www-form-urlencoded')return invalidPage(request,env,url);
    const raw=new TextDecoder('utf-8',{fatal:true}).decode(await bytesOf(request,7300));if(!/^bintent=[A-Za-z0-9_.-]+$/.test(raw))return invalidPage(request,env,url);
    const value=raw.slice(8);await receive({value,placement:'post'});return page(request,env,url,{value,placement:'post'});
   }
   if([...url.searchParams.keys()].some(k=>k.toLowerCase()==='bintent')){const parsed=await receive({url:request.url});return page(request,env,url,parsed);}
   // Fragment capabilities and protocol substitutions are consumed by the entry script.
   if([...url.searchParams.keys()].some(k=>!['settings','lang'].includes(k)))return invalidPage(request,env,url);
   return page(request,env,url);
  }catch(e){return invalidPage(request,env,url,e.code??'intent_malformed',e.code==='intent_expired'?410:400);}
 },
 async beforeActivity({request,env,path,id,object}){
  if(!path.startsWith('/api/intents/'))return;
  // Session handler approvals (signaling AMD-SG-I1) are served by routes/signaling-owner.mjs in the owner stage.
  if(path.startsWith('/api/intents/session-'))return;
  const reverse=path.endsWith('/records')||path.endsWith('/remove');if(!reverse&&!flagEnabled(env,'INTENT_LINKS_ENABLED',{request,subject:{kind:'account',owner:id}}))return json({error:'not_found'},404);
  const name=path.split('/').at(-1),operation={resolve:'intents.resolve',decide:'intents.decide',exclude:'intents.exclude',ignore:'intents.ignore',records:'intents.records',remove:'intents.remove'}[name];if(!operation)return json({error:'not_found'},404);
  const input=request.method==='GET'?{}:await body(request,24576);delete input.activated;if(name==='resolve')input.activated=await activation(env,input.navigation,input.value);delete input.navigation;
  try{return json(await object.intentsOwner(id,{operation,input}));}catch(e){if(e.code?.startsWith('intent_'))return json({error:e.code},e.status??(e.code==='intent_kind_unavailable'?503:e.code==='intent_kind_retracted'||e.code==='intent_expired'?410:400));throw e;}
 }
};
