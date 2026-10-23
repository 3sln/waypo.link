// PORT-6/7: encrypted, purpose-bound page capabilities. No reverse index or public subject lookup.
import {encryptSecret,decryptSecret} from './secrets.mjs';
import {isUUID} from '../core/primitives.mjs';
import {RedirectExtensionService} from '../billing/redirect-extension.mjs';
import {flagGlobal} from './routes/shared.mjs';
const encode=value=>btoa(String.fromCharCode(...value)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const decode=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
export async function redirectCapability(env,account){
 if(account?.status!=='moved'||typeof account.moved?.statementDigest!=='string')return null;
 const sealed=await encryptSecret(['redirect',account.id,account.moved.statementDigest],env.KEY_ENCRYPTION_KEY),iv=Uint8Array.from(atob(sealed.iv),c=>c.charCodeAt(0)),cipher=Uint8Array.from(atob(sealed.ciphertext),c=>c.charCodeAt(0));
 return encode(new Uint8Array([...iv,...cipher]));
}
export async function resolveRedirect(env,id){
 if(typeof id!=='string'||!/^[A-Za-z0-9_-]{64,240}$/.test(id))return null;
 try{const bytes=decode(id),base64=value=>btoa(String.fromCharCode(...value)),value=await decryptSecret({version:1,iv:base64(bytes.slice(0,12)),ciphertext:base64(bytes.slice(12))},env.KEY_ENCRYPTION_KEY);
  if(!Array.isArray(value)||value.length!==3||value[0]!=='redirect'||!isUUID(value[1])||typeof value[2]!=='string')return null;
  const account=await env.IDENTITY_REPOSITORY.get(value[1]);return account?.status==='moved'&&account.moved?.statementDigest===value[2]?account:null;
 }catch{return null;}
}
export function redirectExtensionService(env){
 const service=new RedirectExtensionService({config:env,repository:env.IDENTITY_REPOSITORY,resolve:id=>resolveRedirect(env,id),client:env.REDIRECT_EXTENSION_CLIENT,now:typeof env.MOVED_CLOCK==='function'?env.MOVED_CLOCK:Date.now,dueIndex:env.REDIRECT_EXTENSION_DUE,enabled:()=>{try{service.configuration();return flagGlobal(env,'REDIRECT_EXTENSION_ENABLED');}catch{return false;}}});return service;
}
