// Soft passkeys for simulated people (spike §2.6: allowed and recorded). One `Keyring` per person holds one
// tests/helpers/soft-passkey.mjs authenticator per relying party, so a person with accounts on alpha and beta signs in
// to each with its own credential from the same browser context. The real adapter verification still runs.
import {softAuthenticator} from '../helpers/soft-passkey.mjs';

export class Keyring {
 constructor(){this.byRp=new Map();}
 for(origin){const rp=new URL(origin).hostname;if(!this.byRp.has(rp))this.byRp.set(rp,softAuthenticator({origin}));return this.byRp.get(rp);}
 count(){let n=0;for(const a of this.byRp.values())n+=a.credentials.size;return n;}
 /** Routes WebAuthn calls of every page in `context` to this keyring (by RP ID). */
 async attach(context){
  await context.exposeBinding('__simPasskeyCreate',({frame},options)=>this.for(new URL(frame.url()).origin).register(options));
  await context.exposeBinding('__simPasskeyGet',({frame},options)=>{const a=this.for(new URL(frame.url()).origin);return a.authenticate(options,options.allowCredentials?.find(c=>a.credentials.has(c.id))?.id);});
  await context.addInitScript(()=>{
   const enc=value=>{const bytes=value instanceof ArrayBuffer?new Uint8Array(value):new Uint8Array(value.buffer,value.byteOffset,value.byteLength);let text='';for(const byte of bytes)text+=String.fromCharCode(byte);return btoa(text).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
   const plain=publicKey=>{const out={...publicKey,challenge:enc(publicKey.challenge)};if(publicKey.user)out.user={...publicKey.user,id:enc(publicKey.user.id)};for(const name of ['allowCredentials','excludeCredentials'])if(publicKey[name])out[name]=publicKey[name].map(item=>({...item,id:enc(item.id)}));return out;};
   const wrap=json=>({id:json.id,type:'public-key',toJSON:()=>json});
   const proto=globalThis.CredentialsContainer?.prototype;if(!proto)return;const get=proto.get,create=proto.create;
   proto.get=async function(options){if(!options?.publicKey)return get.call(this,options);return wrap(await globalThis.__simPasskeyGet(plain(options.publicKey)));};
   proto.create=async function(options){if(!options?.publicKey)return create.call(this,options);return wrap(await globalThis.__simPasskeyCreate(plain(options.publicKey)));};
   // Conditional mediation would wait for a person; the soft keyring always answers explicit requests instead.
   if(globalThis.PublicKeyCredential)globalThis.PublicKeyCredential.isConditionalMediationAvailable=async()=>false;
  });
 }
}
