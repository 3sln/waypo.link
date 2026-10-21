/**
 * Persisted snapshot: {v:1,version:nonnegative integer,issuedAt:epoch ms,flags:{NAME:
 * {rev,on:boolean,onValue:boolean,fallthrough:boolean,salt:string,retainExisting:false,
 * deny:{accounts:[owner UUID],clients:[verified client ID]},rules:[{when:{accounts?,
 * shards?:[0..63 or '00'..'63'],countries?:[ISO country],subdivisions?:['US-TX'],
 * clients?,subject?:'account'|'anonymous'|'system',window?:{from?,until?}},
 * serve:{value:boolean,percent?:0..10000}}],experiment:null|{id:UUID,status,
 * variants:[{key,weight}],eligibility:{percent,when?},variantSalt,startedAt?,
 * stoppedAt?,concludedAt?,winner?}}}}. Times accept epoch ms or ISO timestamps.
 * Missing deny/rules/experiment/retainExisting normalize to empty/null/false.
 * Variant zero serves registry.safe; every other variant serves record.onValue.
 * validateRecord(name,record,{before}) and validateSnapshot(value,{before}) throw
 * code=invalid_snapshot, returning detached frozen normalized values on success.
 * Running assignments (including the record salt) cannot change until stopped.
 * Compiled snapshots may be passed directly to evaluate/flags.for(ctx); see evaluate.mjs.
 */
import {getFlag} from './registry.mjs';
import {UUID,canonical} from '../core/primitives.mjs';
export const SNAPSHOT_MAX_BYTES=256*1024,RULE_LIMIT=32,LIST_LIMIT=1000;
const compiled=new WeakSet();
const fail=message=>{throw Object.assign(new TypeError(message),{code:'invalid_snapshot'});};
const plain=x=>x!==null&&typeof x==='object'&&(Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
function fields(x,allowed){if(!plain(x)||Object.keys(x).some(k=>!allowed.includes(k)))fail('Malformed flag record or rule.');}
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const text=x=>typeof x==='string'&&x.length>0&&x.length<=2048&&!/[\u0000-\u001f\u007f]/.test(x);
export const timeValue=value=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)&&Number.isFinite(Date.parse(value))?Date.parse(value):NaN;
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
function list(value,check,count){if(!Array.isArray(value)||value.some(x=>!check(x))||new Set(value).size!==value.length)fail('Malformed targeting list.');count.n+=value.length;if(count.n>LIST_LIMIT)fail('Too many targeting list entries.');}
const dimension=(f,d)=>{if(!f.dimensions.includes(d))fail(`Disallowed ${d} dimension for ${f.name}.`);};
function when(value,f,count,{experiment=false}={}){
 fields(value,['accounts','clients','shards','countries','subdivisions','subject','window']);
 const checks={accounts:['A',x=>typeof x==='string'&&UUID.test(x)],clients:['C',text],shards:['S',x=>integer(x,0,63)||typeof x==='string'&&/^(?:[0-5][0-9]|6[0-3])$/.test(x)],countries:['R',x=>typeof x==='string'&&/^[A-Z]{2}$/.test(x)&&x!=='XX'],subdivisions:['R',x=>typeof x==='string'&&/^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(x)&&!x.startsWith('XX-')]};
 for(const [key,[d,check]]of Object.entries(checks))if(Object.hasOwn(value,key)){dimension(f,d);if(experiment&&d==='R')fail('Experiments cannot target region.');list(value[key],check,count);}
 if(value.subject!==undefined&&!['account','anonymous','system'].includes(value.subject))fail('Invalid subject condition.');
 if(value.window!==undefined){dimension(f,'G');fields(value.window,['from','until']);const {from,until}=value.window;if(from===undefined&&until===undefined||from!==undefined&&!Number.isFinite(timeValue(from))||until!==undefined&&!Number.isFinite(timeValue(until))||from!==undefined&&until!==undefined&&timeValue(from)>=timeValue(until))fail('Invalid schedule window.');}
}
function validateExperiment(e,f,count){
 if(e===null)return;if(!f.experiment)fail('Experiments are forbidden for this flag.');
 fields(e,['id','status','variants','eligibility','variantSalt','startedAt','stoppedAt','concludedAt','winner']);
 if(typeof e.id!=='string'||!UUID.test(e.id)||!['draft','running','stopped','concluded'].includes(e.status)||!text(e.variantSalt))fail('Malformed experiment.');
 if(!Array.isArray(e.variants)||e.variants.length<2||e.variants.length>8)fail('Experiments need 2..8 variants.');
 for(const v of e.variants){fields(v,['key','weight']);if(!text(v.key)||v.key.length>64||!integer(v.weight,0,10000))fail('Invalid variant.');}
 if(new Set(e.variants.map(v=>v.key)).size!==e.variants.length||e.variants.reduce((n,v)=>n+v.weight,0)!==10000)fail('Variant weights must sum to 10000.');
 fields(e.eligibility,['percent','when']);if(!integer(e.eligibility.percent,0,10000))fail('Invalid experiment percentage.');if(e.eligibility.when!==undefined)when(e.eligibility.when,f,count,{experiment:true});
 for(const key of ['startedAt','stoppedAt','concludedAt'])if(e[key]!==undefined&&e[key]!==null&&!Number.isFinite(timeValue(e[key])))fail('Invalid experiment time.');
 if(e.status!=='draft'&&!Number.isFinite(timeValue(e.startedAt))||['stopped','concluded'].includes(e.status)&&!Number.isFinite(timeValue(e.stoppedAt))||e.status==='concluded'&&!Number.isFinite(timeValue(e.concludedAt)))fail('Missing experiment lifecycle time.');
 if(e.stoppedAt!=null&&timeValue(e.stoppedAt)<timeValue(e.startedAt)||e.concludedAt!=null&&timeValue(e.concludedAt)<timeValue(e.stoppedAt))fail('Invalid experiment time order.');
 if(e.winner!==undefined&&e.winner!==null&&!e.variants.some(v=>v.key===e.winner))fail('Unknown winning variant.');
}
export function validateRecord(name,input,{before=null}={}){
 const f=getFlag(name);if(f.class==='b')fail('Env-only capabilities cannot have console records.');
 fields(input,['rev','on','onValue','fallthrough','salt','retainExisting','deny','rules','experiment']);
 const r={retainExisting:false,deny:{accounts:[],clients:[]},rules:[],experiment:null,...input},count={n:0};
 if(!integer(r.rev,0,Number.MAX_SAFE_INTEGER)||typeof r.on!=='boolean'||r.onValue!==f.onValue||typeof r.fallthrough!=='boolean'||!text(r.salt)||typeof r.retainExisting!=='boolean'||r.retainExisting&&!f.retainExisting)fail('Malformed flag values.');
 fields(r.deny,['accounts','clients']);for(const [key,d]of [['accounts','A'],['clients','C']])if(r.deny[key]!==undefined){list(r.deny[key],key==='accounts'?x=>typeof x==='string'&&UUID.test(x):text,count);if(r.deny[key].length)dimension(f,d);}
 if(!Array.isArray(r.rules)||r.rules.length>RULE_LIMIT)fail('Too many rules.');
 for(const rule of r.rules){fields(rule,['when','serve']);when(rule.when,f,count);fields(rule.serve,['value','percent']);if(typeof rule.serve.value!=='boolean')fail('Invalid served value.');if(rule.serve.percent!==undefined){if(!integer(rule.serve.percent,0,10000))fail('Invalid percentage.');if(!f.dimensions.includes('P')&&!(f.dimensions.includes('C')&&rule.when.clients?.length&&!rule.when.accounts&&!rule.when.shards))fail('Disallowed percentage dimension.');}}
 validateExperiment(r.experiment,f,count);
 if(f.narrowOnly&&(r.onValue!==f.safe||r.fallthrough!==f.safe||r.rules.some(rule=>rule.serve.value!==f.safe)))fail('Narrow-only flag cannot select live behaviour.');
 if(before?.experiment?.status==='running'){
  const old=before.experiment,e=r.experiment;if(!e||old.id!==e.id||canonical([before.salt,old.variants,old.eligibility,old.variantSalt,old.startedAt])!==canonical([r.salt,e.variants,e.eligibility,e.variantSalt,e.startedAt]))fail('Running experiment assignment is frozen.');
 }
 // Detach caller-owned arrays before freezing; validating must not mutate input.
 return freeze(JSON.parse(JSON.stringify(r)));
}
export function validateSnapshot(input,{before=null}={}){
 if(compiled.has(input)&&!before)return input;
 fields(input,['v','version','issuedAt','flags']);
 if(input.v!==1||!integer(input.version,0,Number.MAX_SAFE_INTEGER)||!integer(input.issuedAt,0,Number.MAX_SAFE_INTEGER)||!plain(input.flags))fail('Malformed snapshot.');
 let encoded;try{encoded=JSON.stringify(input);}catch{fail('Snapshot is not JSON.');}if(new TextEncoder().encode(encoded).length>SNAPSHOT_MAX_BYTES)fail('Snapshot exceeds 256 KiB.');
 const flags={};let running=0;for(const [name,record]of Object.entries(input.flags)){const r=validateRecord(name,record,{before:before?.flags?.[name]});Object.defineProperty(flags,name,{value:r,enumerable:true});if(r.experiment?.status==='running')running++;}if(running>3)fail('At most three experiments may run.');
 const result=freeze({v:1,version:input.version,issuedAt:input.issuedAt,flags});compiled.add(result);return result;
}
export const compileSnapshot=validateSnapshot;
