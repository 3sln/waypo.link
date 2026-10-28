// Intent-kind declarative schemas; unknown data and display controls are refused, never stripped.
import {jcs,strictJSON,plain,scalarString,textEncoder} from '../core/strict-json.mjs';
import {exact,origin,uuid,IntentFault} from './format.mjs';
import {canonicalContactLink} from '../links/preview.mjs';
import {sessionBodyValid} from './sessions.mjs';
const controls=/[\p{Cc}\p{Bidi_Control}\u2028\u2029\u200b\ufeff]/u;
const text=(v,n)=>typeof v==='string'&&scalarString(v)&&[...v].length<=n;
const display=(v,n)=>text(v,n)&&v.length>0&&!controls.test(v);
const tags=v=>{try{return /^(?:x(?:-[a-z0-9]{1,8})+|[a-z]{2,8}(?:-[a-z0-9]{1,8})*)$/i.test(v)&&(!v.toLowerCase().startsWith('x-')?Intl.getCanonicalLocales(v).length===1:true);}catch{return false;}};
const map=(v,n)=>plain(v)&&Object.hasOwn(v,'en')&&Object.keys(v).length<=8&&new Set(Object.keys(v).map(k=>k.toLowerCase())).size===Object.keys(v).length&&Object.entries(v).every(([k,x])=>tags(k)&&display(x,n));
const list=v=>Array.isArray(v)&&v.length<=64&&new Set(v).size===v.length&&v.every(x=>display(x,80));
const url=(v,{line=false}={})=>{try{const u=new URL(v);return typeof v==='string'&&u.protocol==='https:'&&!u.username&&!u.password&&!v.includes('#')&&u.href===v&&(!line||!v.includes('?')&&v.length<=256);}catch{return false;}};
/** The https-url format rule (intents §4.2), also deciding whether a `capability` value under `origin` display shows its origin. */
export const httpsURLValue=v=>url(v);
const field=v=>{
 if(!plain(v))return false;
 if(v.type==='string')return exact(v,['type','maxLength'],['format'])&&Number.isSafeInteger(v.maxLength)&&v.maxLength>=1&&v.maxLength<=4352&&(v.format===undefined||['https-url','uuid','handle','contact-link','capability'].includes(v.format));
 if(v.type==='integer')return exact(v,['type','minimum','maximum'])&&Number.isSafeInteger(v.minimum)&&Number.isSafeInteger(v.maximum)&&v.minimum<=v.maximum;
 if(v.type==='enum')return exact(v,['type','values'],['extensible'])&&(v.extensible===undefined||typeof v.extensible==='boolean')&&Array.isArray(v.values)&&v.values.length>=1&&v.values.length<=64&&new Set(v.values).size===v.values.length&&v.values.every(x=>text(x,64));
 return ['boolean','principal'].includes(v.type)&&exact(v,['type']);
};
export function validateIntentKind(input){try{
 const b=strictJSON(jcs(input,{maxDepth:8}),{maxDepth:8});
 if(!exact(b,['id','title','summary','publisher','effect','data','disclosure','capability'],['max_bytes','supersedes','session'])||!url(b.id,{line:true})||!origin(b.publisher)||new URL(b.id).origin!==b.publisher||!map(b.title,80)||!map(b.summary,280)||!['view','save','join','send'].includes(b.effect)||typeof b.capability!=='boolean')throw 0;
 if(b.max_bytes!==undefined&&(!Number.isSafeInteger(b.max_bytes)||b.max_bytes<64||b.max_bytes>4480)||b.supersedes!==undefined&&!url(b.supersedes,{line:true}))throw 0;
 const s=b.data,d=b.disclosure;if(!exact(s,['type','properties','required'])||s.type!=='object'||!plain(s.properties)||Object.keys(s.properties).length>16||!Object.entries(s.properties).every(([k,v])=>/^[a-z][a-z0-9_]{0,31}$/.test(k)&&field(v))||!Array.isArray(s.required)||!s.required.every((k,i)=>Object.hasOwn(s.properties,k)&&(i===0||s.required[i-1]<k)))throw 0;
 if(!exact(d,['categories','fields'])||!list(d.categories)||!plain(d.fields)||Object.keys(d.fields).length!==Object.keys(s.properties).length)throw 0;
 for(const [k,f]of Object.entries(s.properties)){const x=d.fields[k];if(!exact(x,['title','categories','display'])||!map(x.title,80)||!list(x.categories)||!['value','origin','presence'].includes(x.display))throw 0;
  // A capability field (contacts spike §4.2, CR-I2; provisional, unsigned) is a bearer secret: it forces `capability: true`
  // and is displayed only by `presence` or `origin`, like a contact link. Its bound is the field's own maxLength.
  if(['contact-link','capability'].includes(f.format)&&(!b.capability||x.display==='value'))throw 0;
  if(x.display==='origin'&&(!['https-url','contact-link','capability'].includes(f.format)||f.type!=='string'))throw 0;
  if(x.display==='value'&&f.type==='string'&&(f.maxLength>120||f.format!==undefined&&!['uuid','handle'].includes(f.format)))throw 0;
 }
 // Signaling AMD-SG-I1 (proposed, unsigned): an optional `session` member makes this a session kind (sessions.mjs).
 if(!sessionBodyValid(b))throw 0;
 return b;
 }catch{throw new IntentFault('intent_kind_invalid');}}
export function validateIntentData(body,input){const b=validateIntentKind(body);try{
 const data=strictJSON(jcs(input,{maxDepth:8}),{maxDepth:8});if(!plain(data)||textEncoder.encode(jcs(data)).length>(b.max_bytes??4480)||b.data.required.some(k=>!Object.hasOwn(data,k)))throw 0;
 for(const [k,v]of Object.entries(data)){if(!Object.hasOwn(b.data.properties,k))throw 0;const f=b.data.properties[k];
  if(f.type==='string'){if(!text(v,f.maxLength)||b.disclosure.fields[k].display==='value'&&controls.test(v))throw 0;
   if(f.format==='uuid'&&!uuid(v)||f.format==='https-url'&&!url(v)||f.format==='handle'&&!/^[a-z0-9][a-z0-9_.-]{0,63}@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(v))throw 0;
   if(f.format==='contact-link'){if(!url(v))throw 0;const c=canonicalContactLink(new URL(v).origin,v);if(!c||c.link!==v)throw 0;}
   // A capability value is any string within maxLength (intents §4.2); its origin shows only when it is an https-url.
  }else if(f.type==='integer'){if(!Number.isSafeInteger(v)||v<f.minimum||v>f.maximum)throw 0;}
  else if(f.type==='boolean'){if(typeof v!=='boolean')throw 0;}
  else if(f.type==='enum'){if(typeof v!=='string'||!scalarString(v)||!f.values.includes(v)&&!f.extensible||b.disclosure.fields[k].display==='value'&&controls.test(v))throw 0;}
  else if(!exact(v,['iss','sub'])||!origin(v.iss)||!uuid(v.sub))throw 0;
 }return data;
 }catch{throw new IntentFault('intent_malformed');}}
