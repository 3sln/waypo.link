// Generalized from messaging-protocol/encoding.mjs; its nonnegative-number profile and callers stay unchanged.
// Artefacts §3: no normalization, duplicate names, noncharacters, lone surrogates or non-decimal safe integers.
export class StrictJSONFault extends Error {constructor(code='malformed'){super(code);this.name='StrictJSONFault';this.code=code;}}
const bad=(code)=>{throw new StrictJSONFault(code);};
export const textEncoder=new TextEncoder();
const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
export const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
export function scalarString(v){
 if(typeof v!=='string'||!v.isWellFormed())return false;
 for(const c of v){const n=c.codePointAt(0);if(n>=0xfdd0&&n<=0xfdef||(n&0xffff)>=0xfffe)return false;}return true;
}
export function strictJSON(source,{maxBytes=262144,maxDepth=32,maxMembers=Infinity}={}){
 let input=source;
 if(source instanceof Uint8Array){if(source.byteLength>maxBytes)bad('too_large');try{input=decoder.decode(source);}catch{bad();}}
 else if(typeof input!=='string')bad();
 else if(textEncoder.encode(input).byteLength>maxBytes)bad('too_large');
 if(input.startsWith('\ufeff'))bad();let i=0,members=0;
 const count=()=>{if(++members>maxMembers)bad('too_large');};
 const ws=()=>{while(i<input.length&&' \t\n\r'.includes(input[i]))i++;};
 const token=re=>{re.lastIndex=i;const m=re.exec(input);if(!m)bad();i=re.lastIndex;return m[0];};
 const string=()=>{const v=JSON.parse(token(/"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y));if(!scalarString(v))bad();return v;};
 const value=depth=>{
  if(depth>maxDepth)bad();ws();const c=input[i];
  if(c==='"')return string();
  if(c==='{'){i++;const o={};ws();if(input[i]==='}'){i++;return o;}for(;;){ws();if(input[i]!=='"')bad();const k=string();if(Object.hasOwn(o,k))bad();count();ws();if(input[i++]!==':')bad();Object.defineProperty(o,k,{value:value(depth+1),enumerable:true,writable:true,configurable:true});ws();const n=input[i++];if(n==='}')return o;if(n!==',')bad();}}
  if(c==='['){i++;const a=[];ws();if(input[i]===']'){i++;return a;}for(;;){count();a.push(value(depth+1));ws();const n=input[i++];if(n===']')return a;if(n!==',')bad();}}
  const literal=token(/true|false|null|-?(?:0|[1-9][0-9]{0,15})(?![0-9.eE+-])/y);
  if(literal==='true')return true;if(literal==='false')return false;if(literal==='null')return null;
  const n=Number(literal);if(!Number.isSafeInteger(n)||Object.is(n,-0))bad();return n;
 };
 const result=value(0);ws();if(i!==input.length)bad();return result;
}
// Refuse non-JSON JS values, getters, hidden members, sparse arrays and symbols instead of dropping them.
// Sorted UTF-16 keys and JSON.stringify string escaping are RFC 8785 on this integer-only profile.
export function jcs(value,{maxDepth=32,maxMembers=Infinity}={}){
 let members=0;const active=new Set();
 const encode=(v,depth)=>{
  if(depth>maxDepth)bad();
  if(v===null||v===true||v===false)return String(v);
  if(typeof v==='string'){if(!scalarString(v))bad();return JSON.stringify(v);}
  if(typeof v==='number'){if(!Number.isSafeInteger(v)||Object.is(v,-0))bad();return String(v);}
  if(!Array.isArray(v)&&!plain(v)||active.has(v))bad();active.add(v);
  const keys=Reflect.ownKeys(v),array=Array.isArray(v);
  if(array&&(Object.getPrototypeOf(v)!==Array.prototype||keys.length!==v.length+1))bad();
  const names=array?Array.from({length:v.length},(_,i)=>String(i)):keys.sort((a,b)=>typeof a==='string'&&typeof b==='string'?(a<b?-1:a>b?1:0):0),parts=[];
  for(const k of names){const d=Object.getOwnPropertyDescriptor(v,k);if(typeof k!=='string'||!scalarString(k)||!d||!d.enumerable||!Object.hasOwn(d,'value'))bad();if(++members>maxMembers)bad('too_large');const s=encode(d.value,depth+1);parts.push(array?s:`${JSON.stringify(k)}:${s}`);}
  active.delete(v);return array?`[${parts.join(',')}]`:`{${parts.join(',')}}`;
 };return encode(value,0);
}
export const sameValue=(a,b)=>jcs(a)===jcs(b);
