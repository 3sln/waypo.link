// Migration-only intake. Oversized old contact links never become app-handler intents.
import {canonicalContactLink} from '../links/preview.mjs';
import {registeredIntent} from './registered.mjs';
import {IntentFault,exact} from './format.mjs';
export function parseLegacyIntent(input){
 let legacy=input;
 try{
  if(typeof input==='string'){if(input.length>55000)throw Error();const u=new URL(input);if(u.protocol!=='web+bindle:'||u.username||u.password||u.port||u.pathname||u.hash||[...u.searchParams.keys()].join()!=='contact-url')throw Error();legacy={intent:u.host,contact:u.searchParams.get('contact-url')};}
  if(!exact(legacy,['intent','contact'])||!['send-message','add-contact'].includes(legacy.intent)||typeof legacy.contact!=='string'||legacy.contact.length>18000)throw Error();
  const u=new URL(legacy.contact);if(u.protocol!=='https:'||canonicalContactLink(u.origin,legacy.contact)?.link!==legacy.contact)throw Error();
  return {legacy:{...legacy},intent:{bintent:1,kind:{...registeredIntent(legacy.intent)},data:{contact:legacy.contact}}};
 }catch{throw new IntentFault('intent_malformed');}
}
export const legacyIntentScheme=legacy=>'web+bindle://'+legacy.intent+'?contact-url='+encodeURIComponent(legacy.contact);
