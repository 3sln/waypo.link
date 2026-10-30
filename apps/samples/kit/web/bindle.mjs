// Thin helpers over the public @3sln/bindle SDK for the samples (sample-only; anything generic here is a candidate for
// the SDK by separate decision, core-scope rule). Every call goes through BindleClient: discovery, DPoP, CBOR RPC.
export const STORAGE_CONTRACT='https://3sln.me/artefacts/contracts/object-storage/v1';
export const APP_MESSAGES_FRAGMENT='https://3sln.me/artefacts/preferences/app-messages/v1';
export const APP_MESSAGES_CONTRACT='https://3sln.me/artefacts/contracts/app-messages/v1';
const APP_REMOVAL='https://spec.bindle.example/extensions/app-removal/v1';
const coded=(message,code)=>Object.assign(new Error(message),{code});
const encoder=new TextEncoder(),decoder=new TextDecoder();
const stale=error=>/Read the preference fragment again|credential expired|assignment changed/.test(error?.message??'');

/** The first resource reference of `field` in `fragment`, re-read whenever the SDK says the reference went stale. */
export function resourceField(client,fragment,field){
 let ref=null;
 const reference=async()=>{if(ref)return ref;const prefs=await client.readPreferences(fragment),value=prefs.values?.[field];ref=Array.isArray(value)?value[0]:value;if(!ref?.id)throw coded('No storage is assigned to this app.','no_resource');return ref;};
 return {
  reference,forget(){ref=null;},
  async call(contract,method,args){
   try{return (await client.callResource(await reference(),{contract,method,args})).result;}
   catch(error){if(!stale(error))throw error;ref=null;return (await client.callResource(await reference(),{contract,method,args})).result;}
  }
 };
}

/** JSON documents in object-storage/v1 with optimistic versions (the contract has no listing and requires conditions). */
export function jsonStore(client,fragment,field){
 const resource=resourceField(client,fragment,field),call=(method,args)=>resource.call(STORAGE_CONTRACT,method,args);
 const notFound=error=>error?.code==='not_found'||/not found/i.test(error?.message??'');
 return {
  resource,
  capabilities:()=>call('capabilities',{}),
  async read(key){try{const result=await call('get',{key});return {version:result.object.version,value:JSON.parse(decoder.decode(result.data))};}catch(error){if(notFound(error))return null;throw error;}},
  async write(key,value,version){const result=await call('put',{key,data:encoder.encode(JSON.stringify(value)),contentType:'application/json',condition:version?{version}:{absent:true}});return result?.object?.version??result?.version??null;},
  async remove(key,version){try{await call('delete',{key,version});return true;}catch(error){if(notFound(error))return false;throw error;}},
  /** Binary objects (CBOR byte strings on the wire). */
  async readBytes(key){try{const result=await call('get',{key});return {version:result.object.version,contentType:result.object.contentType??'application/octet-stream',bytes:result.data};}catch(error){if(notFound(error))return null;throw error;}},
  async writeBytes(key,bytes,contentType,version){const result=await call('put',{key,data:bytes,contentType,condition:version?{version}:{absent:true}});return result?.object?.version??result?.version??null;}
 };
}

/** Sends one app message through the granted app-messages reference (createOwn). */
export async function sendAppMessage(client,{subject,body}){
 const prefs=await client.readPreferences(APP_MESSAGES_FRAGMENT),value=prefs.values?.messages,ref=Array.isArray(value)?value[0]:value;
 if(!ref?.id)throw coded('App messages are not enabled for this app.','no_resource');
 return client.userMessage(ref,{subject,body});
}

/** A label for the signed-in account: the granted handle when the provider shared one, else the provider's host
 * (an app learns no handle unless the person grants a profile). */
export function accountLabel(session){
 if(!session)return '';
 if(session.profile?.handle)return session.profile.handle;
 try{return new URL(session.issuer).host;}catch{return session.issuer;}
}

// ---- clean removal (app-removal §6.3), browser-only app ---------------------------------------------------------
const b64=text=>Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-text.length%4)%4)),c=>c.charCodeAt(0));
const part=(token,index)=>JSON.parse(decoder.decode(b64(token.split('.')[index])));
export const b64url=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

/** Parses a removal request without trusting it (step 1). Returns {header, claims} or null. */
export function peekRemoval(token){
 try{if(typeof token!=='string'||token.length>8192||token.split('.').length!==3)return null;const header=part(token,0),claims=part(token,1);if(header.alg!=='ES256'||header.typ!=='bindle-removal+jwt')return null;return {header,claims};}catch{return null;}
}
/**
 * Steps 3–6: verifies the signature with the issuer's declared app-removal key set, the audience, purpose, time and
 * return URI. `knownSubjects` is the app's local relationship list (step 2); an unknown (iss, sub) never fetches.
 */
export async function verifyRemoval(token,{clientId,knownSubjects=[],fetcher=fetch,now=Date.now(),seen}){
 const peeked=peekRemoval(token);if(!peeked)return null;const {header,claims}=peeked,b=claims.bindle;
 if(!knownSubjects.some(s=>s.issuer===claims.iss&&s.subject===claims.sub))return null;
 let issuer;try{issuer=new URL(claims.iss);if(issuer.protocol!=='https:'||issuer.origin!==claims.iss)return null;}catch{return null;}
 const manifest=await (await fetcher(issuer.origin+'/.well-known/bindle/manifest.json',{credentials:'omit',redirect:'error',cache:'no-cache'})).json();
 const declared=(manifest.extensions??[]).find(e=>e?.spec===APP_REMOVAL)?.options;if(!declared?.jwks_uri||new URL(declared.jwks_uri).origin!==issuer.origin)return null;
 const jwks=await (await fetcher(declared.jwks_uri,{credentials:'omit',redirect:'error',cache:'no-cache'})).json(),key=(jwks.keys??[]).filter(k=>k.kid===header.kid);if(key.length!==1)return null;
 const verifyKey=await crypto.subtle.importKey('jwk',{kty:key[0].kty,crv:key[0].crv,x:key[0].x,y:key[0].y},{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 const [h,p,s]=token.split('.');if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},verifyKey,b64(s),encoder.encode(h+'.'+p)))return null;
 const seconds=Math.floor(now/1000);
 if(claims.aud!==clientId||b?.purpose!=='remove'||claims.iat>seconds+30||claims.exp<=seconds-30)return null;
 if(seen?.has?.(claims.jti))return null;seen?.add?.(claims.jti);
 let ret;try{ret=new URL(b.return_uri);}catch{return null;}
 if(ret.origin!==issuer.origin||ret.username||ret.password||ret.hash||b.return_uri!==declared.return_uri)return null;
 return {issuer:claims.iss,subject:claims.sub,removal:b.removal,returnUri:b.return_uri,cleanupBy:b.cleanup_by};
}
/** The front-channel return (§6.5): navigate top-level to return_uri with the outcome and an optional result. */
export function removalReturnUrl({returnUri,removal},outcome,result){
 const url=new URL(returnUri);url.searchParams.set('removal',removal);url.searchParams.set('outcome',outcome);
 if(result)url.searchParams.set('result',b64url(encoder.encode(JSON.stringify({v:1,...result}))));
 return url.href;
}
