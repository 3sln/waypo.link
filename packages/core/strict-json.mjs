// Generalized from messaging-protocol/encoding.mjs; its nonnegative-number profile and callers stay unchanged.
// Artefacts §3: no normalization, duplicate names, noncharacters, lone surrogates or non-decimal safe integers.
import {fail as recordFail} from './records.mjs';
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

// The signed-object profile helpers (contacts-and-links spike §4.1 and CR-C0; provisional, unsigned). They moved here
// unchanged from packages/links/envelope.mjs (strictIJSON, plainObject, exactMembers) and packages/links/author-proof.mjs
// (ijsonJCS), so identity, federation and signaling never import packages/links. They keep their
// original semantics and fault codes, which differ from strictJSON/jcs above: strictIJSON admits finite non-integer
// numbers and noncharacters, nests at most 8 deep and throws MessagingFault('invalid_json'); ijsonJCS admits
// noncharacters and throws MessagingFault(code). Merging the two profiles would change verdicts, so it waits for a
// reviewed change.
/** Strict I-JSON (RFC 7493): duplicate names at any depth, lone surrogates, non-safe integers, non-finite numbers,
 * nesting deeper than 8 and trailing data are rejected with MessagingFault('invalid_json'). */
export function strictIJSON(text) {
  let i = 0;
  const bad = () => recordFail('invalid_json'), ws = () => { while (i < text.length && ' \t\n\r'.includes(text[i])) i++; };
  const string = () => {
    let out = ''; i++;
    for (;;) {
      if (i >= text.length) bad();
      const char = text[i++], code = char.charCodeAt(0);
      if (char === '"') return out;
      if (code < 32) bad();
      if (char !== '\\') { out += char; continue; }
      const escape = text[i++];
      if (escape === 'u') {
        const unit = hex4();
        if (unit >= 0xdc00 && unit <= 0xdfff) bad();
        if (unit >= 0xd800 && unit <= 0xdbff) { if (text[i] !== '\\' || text[i+1] !== 'u') bad(); i += 2; const low = hex4(); if (low < 0xdc00 || low > 0xdfff) bad(); out += String.fromCharCode(unit, low); }
        else out += String.fromCharCode(unit);
      } else { const mapped = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }[escape]; if (mapped === undefined) bad(); out += mapped; }
    }
  };
  const hex4 = () => { const digits = text.slice(i, i + 4); if (!/^[0-9A-Fa-f]{4}$/.test(digits)) bad(); i += 4; return parseInt(digits, 16); };
  const value = depth => {
    if (depth > 8) bad(); ws();
    const char = text[i];
    if (char === '{') {
      i++; const entries = [], names = new Set(); ws();
      if (text[i] === '}') { i++; return {}; }
      for (;;) {
        ws(); if (text[i] !== '"') bad();
        const name = string(); if (names.has(name)) bad(); names.add(name);
        ws(); if (text[i++] !== ':') bad();
        entries.push([name, value(depth + 1)]); ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i++] !== '}') bad();
        // fromEntries defines own data properties; "__proto__" cannot alter the prototype.
        return Object.fromEntries(entries);
      }
    }
    if (char === '[') {
      i++; const items = []; ws();
      if (text[i] === ']') { i++; return items; }
      for (;;) { items.push(value(depth + 1)); ws(); if (text[i] === ',') { i++; continue; } if (text[i++] !== ']') bad(); return items; }
    }
    if (char === '"') return string();
    for (const [word, literal] of [['true', true], ['false', false], ['null', null]]) if (text.startsWith(word, i)) { i += word.length; return literal; }
    const match = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y; match.lastIndex = i;
    const number = match.exec(text); if (!number) bad(); i = match.lastIndex;
    const result = Number(number[0]);
    if (!Number.isFinite(result) || Object.is(result, -0) || (Number.isInteger(result) && !Number.isSafeInteger(result))) bad();
    return result;
  };
  if (typeof text !== 'string') bad();
  const result = value(0); ws(); if (i !== text.length) bad();
  return result;
}
/** Any non-null, non-array object (the signed-object profile's reading; `plain` above is stricter about prototypes). */
export const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
/** Every `required` member present and nothing outside `required` and `optional`. */
export const exactMembers = (value, required, optional = []) => plainObject(value) && required.every(name => Object.hasOwn(value, name)) && Object.keys(value).every(name => required.includes(name) || optional.includes(name));
const ijsonPlain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
/** RFC 8785 over the I-JSON the Bindle Messaging profile admits (safe integers, well-formed strings, plain objects,
 * depth at most 32). Anything else throws MessagingFault(`code`). */
export function ijsonJCS(value, { code = 'invalid_json' } = {}) {
  const invalid = () => recordFail(code);
  const encode = (v, depth) => {
    if (depth > 32) invalid();
    if (v === null || v === true || v === false) return String(v);
    if (typeof v === 'string') { if (!v.isWellFormed()) invalid(); return JSON.stringify(v); }
    if (typeof v === 'number') { if (!Number.isSafeInteger(v) || Object.is(v, -0)) invalid(); return String(v); }
    if (Array.isArray(v)) return `[${Array.from(v, x => encode(x, depth + 1)).join(',')}]`;
    if (ijsonPlain(v)) return `{${Object.keys(v).sort().map(k => `${encode(k, 0)}:${encode(v[k], depth + 1)}`).join(',')}}`;
    invalid();
  };
  return encode(value, 0);
}
