// Remove the capability before importing the UI or making any request.
let rawURL=location.href,rawHash=location.hash.slice(1),query=new URLSearchParams(location.search),fragment=new URLSearchParams(location.hash.slice(1)),hidden=document.querySelector('input[name="bintent"],input[name="legacy"]');
let expiresAt=Date.now()+3600000,legacy=null,hiddenLegacy=hidden?.name==='legacy'?hidden.value:null,value=hidden?.name==='legacy'?null:hidden?.value??fragment.get('bintent')??query.get('bintent'),placement=hidden?(hidden.dataset.placement??'post'):fragment.has('bintent')?'fragment':'query';
let invalid=query.getAll('bintent').length>1||fragment.getAll('bintent').length>1||query.has('bintent')&&fragment.has('bintent');
if(hidden){hidden.value='';hidden.remove();}history.replaceState(null,'',location.pathname+(query.get('lang')==='es'?'?lang=es':''));
if(hiddenLegacy||!hidden&&(query.has('bintent')||rawHash))try{
 const codec=await import('../../../packages/intents/format.mjs');
 if(hiddenLegacy||rawHash.startsWith('legacy=')){const scheme=hiddenLegacy??decodeURIComponent(rawHash.slice(7)),{parseLegacyIntent}=await import('../../../packages/intents/legacy.mjs');({legacy}=parseLegacyIntent(scheme));value=null;placement='fragment';}
 else if(location.pathname==='/i/contact'){const wire=/^bintent=([A-Za-z0-9_.-]+)(?:&bintent_iss=[^&]*)?$/.exec(rawHash);if(!wire)throw new Error();codec.decodeIntent(wire[1]);value=wire[1];placement='fragment';}
 else if(/^(?:web|web%|%77)/i.test(rawHash)){try{({value,placement}=codec.parseProtocolIntent(rawHash,{now:0}));}catch{const decoded=decodeURIComponent(rawHash),match=/^web\+bindle:\/\/(send-message|add-contact)\?contact-url=([^&]+)$/.exec(decoded);if(!match)throw new Error();const contact=decodeURIComponent(match[2]),{contactIntentValue}=await import('../../../packages/links/preview.mjs');try{value=contactIntentValue(match[1],contact);placement='fragment';}catch{const {parseLegacyIntent}=await import('../../../packages/intents/legacy.mjs');const parsed=parseLegacyIntent(decoded);legacy=parsed.legacy;value=null;placement='fragment';}}}
 else ({value,placement}=codec.parseIntentURL(rawURL.replace(/^http:/,'https:'),{now:0}));
}catch{invalid=true;value=null;legacy=null;}
if(!value&&!legacy&&!invalid)try{const saved=JSON.parse(sessionStorage.getItem('3sln-intent-continuation'));sessionStorage.removeItem('3sln-intent-continuation');if(saved?.expires>Date.now()){value=saved.value;legacy=saved.legacy??null;placement=saved.placement;expiresAt=saved.expires;}}catch{}
rawURL=null;rawHash=null;hiddenLegacy=null;for(const key of [...query.keys()])if(!['lang','settings'].includes(key))query.delete(key);for(const key of [...fragment.keys()])fragment.delete(key);
const {mountIntent}=await import('./ui/intent-entry.mjs');mountIntent({value:invalid?null:value,legacy:invalid?null:legacy,placement,expiresAt,locale:query.get('lang')==='es'||!query.has('lang')&&navigator.language.startsWith('es')?'es':'en',settings:query.has('settings'),handler:location.pathname==='/i/contact',navigation:document.querySelector('meta[name="intent-navigation"]')?.content});

value=null;legacy=null;
