// Contract value checks for Bindle CBOR values (docs/spec/contracts.md; CBOR spike revision 2 §2.5, §6 items 3 and 6;
// provisional, unsigned). Used by compileContractVersion (packages/federation/integrations.mjs) and the contract lint.
// Rules: `type: "integer"` is any integer the profile carries (a safe-range number or a bigint; an integral number beyond
// ±(2^53-1) can only have come from a float, so it is not an integer); `type: "number"` adds floats, never decimals;
// `type: "object"` is a plain map, never a Uint8Array, typed array or codec class; `type: "string"` never accepts bytes.
// `x-type` ("bytes", "decimal", "typed-array", "ndarray"), `x-table`, `x-minimum`/`x-maximum` are the subset keywords.
// Every comparison is exact: integers compare as JavaScript number/bigint (exact), and decimals, decimal-string bounds
// and floats against them compare as exact rationals in bigint. Nothing ever goes through Number() or parseFloat.
import {BindleDecimal,NDArray,Float16Bytes,sameValue,LIMITS} from '../core/cbor.mjs';

export const X_TYPES=Object.freeze(['bytes','decimal','typed-array','ndarray']);
export const X_KEYWORDS=Object.freeze(['x-type','x-element','x-shape','x-table','x-minimum','x-maximum']);
const DECIMAL_BOUND=/^(-?)(0|[1-9][0-9]*)(?:\.([0-9]*[1-9]))?$/;
const HAS_FLOAT16=typeof globalThis.Float16Array==='function';
const ELEMENTS=Object.freeze({i8:Int8Array,u16:Uint16Array,u32:Uint32Array,u64:BigUint64Array,i16:Int16Array,i32:Int32Array,i64:BigInt64Array,f16:HAS_FLOAT16?globalThis.Float16Array:null,f32:Float32Array,f64:Float64Array});
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const unverifiable=()=>{throw Object.assign(new Error('artefact_unverifiable'),{code:'artefact_unverifiable'});};

/** Equality by deterministic encoding (const, enum, uniqueItems). A value outside the profile equals nothing. */
export const sameContractValue=(a,b)=>{try{return sameValue(a,b);}catch{return false;}};

export const isInteger=v=>Number.isSafeInteger(v)||typeof v==='bigint';
export const isNumber=v=>typeof v==='bigint'||typeof v==='number'&&Number.isFinite(v);
export const isBytes=v=>v instanceof Uint8Array&&Object.getPrototypeOf(v)===Uint8Array.prototype;
export const isDecimal=v=>v instanceof BindleDecimal;
const isFloat16=v=>v instanceof Float16Bytes||HAS_FLOAT16&&Object.getPrototypeOf(v)===globalThis.Float16Array.prototype;
export const typedMatches=(element,v)=>{if(!Object.hasOwn(ELEMENTS,element))return false;if(element==='f16')return v!==null&&typeof v==='object'&&isFloat16(v);return v!==null&&typeof v==='object'&&Object.getPrototypeOf(v)===ELEMENTS[element].prototype;};
const lengthOf=v=>Array.isArray(v)?v.length:v!==null&&typeof v==='object'&&(ArrayBuffer.isView(v)||v instanceof Float16Bytes)&&!(v instanceof DataView)&&!isBytes(v)?v.length:-1;

// Exact rationals {n, d} with d > 0n.
const pow10=k=>10n**BigInt(k);
const scratch=new DataView(new ArrayBuffer(8));
function floatRational(x){
 scratch.setFloat64(0,x);const hi=scratch.getUint32(0),lo=scratch.getUint32(4),sign=hi>>>31?-1n:1n,exp=(hi>>>20)&0x7ff;
 let mantissa=(BigInt(hi&0xfffff)<<32n)|BigInt(lo),e;
 if(exp===0)e=-1074;else{mantissa|=1n<<52n;e=exp-1075;}
 return e>=0?{n:sign*(mantissa<<BigInt(e)),d:1n}:{n:sign*mantissa,d:1n<<BigInt(-e)};
}
/** A contract value or bound as an exact rational, or null when it is not numeric. */
export function rational(v){
 if(typeof v==='bigint')return {n:v,d:1n};
 if(typeof v==='number'){if(!Number.isFinite(v))return null;return Number.isSafeInteger(v)?{n:BigInt(v),d:1n}:floatRational(v);}
 if(v instanceof BindleDecimal)return {n:v.mantissa,d:pow10(-v.exponent)};
 return null;
}
/** An exact decimal-string bound (x-minimum/x-maximum). Bounded in length so 10^k stays cheap (spike §6 item 2). */
export function decimalBound(text){
 const m=typeof text==='string'&&text.length<=400?DECIMAL_BOUND.exec(text):null;if(!m)unverifiable();
 const fraction=m[3]??'',n=BigInt(m[2]+fraction);return {n:m[1]?-n:n,d:pow10(fraction.length)};
}
const compare=(a,b)=>{const left=a.n*b.d,right=b.n*a.d;return left<right?-1:left>right?1:0;};

/** Structural checks of one schema node's CBOR keywords; throws artefact_unverifiable on a malformed node. */
export function checkCBORKeywords(s){
 const xt=s['x-type'];
 if(xt!==undefined){if(!X_TYPES.includes(xt)||Object.hasOwn(s,'type'))unverifiable();}
 if(Object.hasOwn(s,'x-element')){if(xt!=='typed-array'&&xt!=='ndarray'||!Object.hasOwn(ELEMENTS,s['x-element']))unverifiable();}
 else if(xt==='typed-array'||xt==='ndarray')unverifiable();
 if(Object.hasOwn(s,'x-shape')){const shape=s['x-shape'];if(xt!=='ndarray'||!Array.isArray(shape)||shape.length<1||shape.length>LIMITS.maxDimensions||shape.some(d=>d!==null&&!(Number.isSafeInteger(d)&&d>0)))unverifiable();}
 if(Object.hasOwn(s,'x-minimum')){if(Object.hasOwn(s,'minimum'))unverifiable();decimalBound(s['x-minimum']);}
 if(Object.hasOwn(s,'x-maximum')){if(Object.hasOwn(s,'maximum'))unverifiable();decimalBound(s['x-maximum']);}
 if(Object.hasOwn(s,'x-table')){const t=s['x-table'];if(s.type!=='object'||!plain(t)||Object.keys(t).some(k=>!['columns','maxRows'].includes(k))||!plain(t.columns)||!Object.keys(t.columns).length||!Number.isSafeInteger(t.maxRows)||t.maxRows<0)unverifiable();}
}

/** The `type` keyword for one JSON Schema type name against a CBOR value. */
export function typeMatches(t,v){
 switch(t){
  case 'null':return v===null;
  case 'boolean':return typeof v==='boolean';
  case 'string':return typeof v==='string';
  case 'array':return Array.isArray(v);
  case 'object':return plain(v);
  case 'integer':return isInteger(v);
  case 'number':return isNumber(v);
  default:return false;
 }
}

/** `x-type` value check (structure already verified); `check(schema, value)` validates nested schemas. */
export function xTypeMatches(s,v){
 switch(s['x-type']){
  case undefined:return true;
  case 'bytes':return isBytes(v)&&(s.minLength===undefined||v.byteLength>=s.minLength)&&(s.maxLength===undefined||v.byteLength<=s.maxLength);
  case 'decimal':return isDecimal(v)||isInteger(v);
  case 'typed-array':return typedMatches(s['x-element'],v)&&(s.minItems===undefined||v.length>=s.minItems)&&(s.maxItems===undefined||v.length<=s.maxItems);
  case 'ndarray':{
   if(!(v instanceof NDArray)||!typedMatches(s['x-element'],v.data))return false;
   const shape=s['x-shape'];return shape===undefined||shape.length===v.shape.length&&shape.every((d,i)=>d===null||d===v.shape[i]);
  }
  default:return false;
 }
}

/** `x-table`: exactly the declared columns, each valid, all of equal length at most maxRows. */
export function tableMatches(s,v,check){
 const t=s['x-table'];if(t===undefined)return true;if(!plain(v))return false;
 const names=Object.keys(t.columns),keys=Object.keys(v);if(keys.length!==names.length||names.some(n=>!Object.hasOwn(v,n)))return false;
 let rows=-1;for(const name of names){const column=v[name],length=lengthOf(column);if(length<0||length>t.maxRows||rows>=0&&length!==rows)return false;rows=length;if(!check(t.columns[name],column))return false;}
 return true;
}

/** Numeric keywords against an integer, float or decimal value; exact. Non-numeric values pass (other keywords apply). */
export function numericMatches(s,v){
 const r=rational(v);if(!r)return true;
 const bound=(key,test)=>{if(s[key]===undefined)return true;const b=rational(s[key]);if(!b)unverifiable();return test(compare(r,b));};
 if(!bound('minimum',c=>c>=0)||!bound('maximum',c=>c<=0)||!bound('exclusiveMinimum',c=>c>0)||!bound('exclusiveMaximum',c=>c<0))return false;
 if(s['x-minimum']!==undefined&&compare(r,decimalBound(s['x-minimum']))<0)return false;
 if(s['x-maximum']!==undefined&&compare(r,decimalBound(s['x-maximum']))>0)return false;
 if(s.multipleOf!==undefined){
  if(typeof v==='number'&&typeof s.multipleOf==='number')return Number.isInteger(v/s.multipleOf);// numbers: unchanged JSON Schema behaviour
  const m=rational(s.multipleOf);if(!m||m.n<=0n)unverifiable();
  if((r.n*m.d)%(r.d*m.n)!==0n)return false;
 }
 return true;
}
