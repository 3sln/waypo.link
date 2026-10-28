// Remove the capability before importing the UI or making any request. Only `bintent` is accepted (query, fragment,
// server POST substitution, or the web+bindle scheme substitution); the legacy contact-url forms were removed in
// contacts phase 4.
let rawURL=location.href,rawHash=location.hash.slice(1),query=new URLSearchParams(location.search),fragment=new URLSearchParams(location.hash.slice(1)),hidden=document.querySelector('input[name="bintent"]');
let expiresAt=Date.now()+3600000,value=hidden?.value??fragment.get('bintent')??query.get('bintent'),placement=hidden?(hidden.dataset.placement??'post'):fragment.has('bintent')?'fragment':'query';
let invalid=!!document.querySelector('meta[name="intent-error"]')||query.getAll('bintent').length>1||fragment.getAll('bintent').length>1||query.has('bintent')&&fragment.has('bintent');
if(hidden){hidden.value='';hidden.remove();}history.replaceState(null,'',location.pathname+(query.get('lang')==='es'?'?lang=es':''));
if(!hidden&&(query.has('bintent')||rawHash))try{
 const codec=await import('../../../packages/intents/format.mjs');
 if(/^(?:web|web%|%77)/i.test(rawHash))({value,placement}=codec.parseProtocolIntent(rawHash,{now:0}));
 else ({value,placement}=codec.parseIntentURL(rawURL.replace(/^http:/,'https:'),{now:0}));
}catch{invalid=true;value=null;}
if(!value&&!invalid)try{const saved=JSON.parse(sessionStorage.getItem('3sln-intent-continuation'));sessionStorage.removeItem('3sln-intent-continuation');if(saved?.expires>Date.now()&&typeof saved.value==='string'){value=saved.value;placement=saved.placement;expiresAt=saved.expires;}}catch{}
rawURL=null;rawHash=null;for(const key of [...query.keys()])if(!['lang','settings'].includes(key))query.delete(key);for(const key of [...fragment.keys()])fragment.delete(key);
const {mountIntent}=await import('./ui/intent-entry.mjs');mountIntent({value:invalid?null:value,placement,expiresAt,locale:query.get('lang')==='es'||!query.has('lang')&&navigator.language.startsWith('es')?'es':'en',settings:query.has('settings'),navigation:document.querySelector('meta[name="intent-navigation"]')?.content});

value=null;
