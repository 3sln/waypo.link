/**
 * widens(before,after,{name,internalAccounts}) -> boolean for release-gate checks.
 * Records must first pass validateRecord(name,...). Missing before means off.
 * This is conservative: false proves no audience expansion, true may require an
 * acknowledgement for an equivalent/reordered expression. Pure metadata edits
 * (revision and lifecycle timestamps) do not widen. A changed running experiment
 * or salt does; stopping may expose normal unsafe rules. Internal exemption requires a server-verified
 * Set/array of account UUIDs: strings in a record never establish provenance.
 * Exemption applies only when every possibly unsafe path explicitly restricts
 * accounts to that set, with safe fallthrough and no retention/experiment.
 * Snapshot and flags.for(ctx) contracts: snapshot.mjs and evaluate.mjs.
 */
import {getFlag} from './registry.mjs';
import {canonical} from '../core/primitives.mjs';
import {timeValue} from './snapshot.mjs';
const same=(a,b)=>canonical(a)===canonical(b);
const subset=(a,b)=>a.every(value=>b.includes(value));
function narrower(a,b){
 for(const key of ['accounts','clients','shards','countries','subdivisions'])if(b[key]!==undefined&&(a[key]===undefined||!subset(a[key].map(String),b[key].map(String))))return false;
 if(b.subject!==undefined&&a.subject!==b.subject)return false;
 const aw=a.window??{},bw=b.window??{};if(bw.from!==undefined&&(aw.from===undefined||timeValue(aw.from)<timeValue(bw.from))||bw.until!==undefined&&(aw.until===undefined||timeValue(aw.until)>timeValue(bw.until)))return false;
 return true;
}
function internalOnly(record,safe,verified){
 const ids=verified instanceof Set?verified:new Set(verified??[]);
 if(!ids.size||record.fallthrough!==safe||record.retainExisting||record.experiment?.status==='running')return false;
 return (record.rules??[]).every(rule=>rule.serve.value===safe||rule.serve.percent===0||rule.when.accounts?.length>0&&rule.when.accounts.every(owner=>ids.has(owner)));
}
export function widens(before,after,{name,internalAccounts}={}){
 const safe=name?getFlag(name).safe:false;
 if(!after?.on)return false;
 if(name&&getFlag(name).narrowOnly)return false;
 if(internalOnly(after,safe,internalAccounts))return false;
 if(!before?.on)return true;
 if(before.onValue!==after.onValue||before.salt!==after.salt)return true;
 if(after.fallthrough!==safe&&before.fallthrough!==after.fallthrough||after.retainExisting&&!before.retainExisting)return true;
 for(const key of ['accounts','clients'])if(!subset(before.deny?.[key]??[],after.deny?.[key]??[]))return true;
 if(after.experiment?.status==='running'&&(before.experiment?.status!=='running'||!same(before.experiment,after.experiment)))return true;
 if(before.experiment?.status==='running'&&after.experiment?.status!=='running'&&(after.fallthrough!==safe||after.retainExisting||(after.rules??[]).some(r=>r.serve.value!==safe&&r.serve.percent!==0)))return true;
 const old=before.rules??[],next=after.rules??[];
 // Preserve order and every old safe rule: removing a safe first match can expose
 // a later unsafe rule or fallthrough. Only a safe suffix may be removed freely.
 if(old.length!==next.length)return true;
 for(let i=0;i<next.length;i++){
  const a=next[i],b=old[i];if(same(a,b))continue;
  if(a.serve.value===safe&&b.serve.value!==safe&&same(a.when,b.when))continue;
  if(a.serve.value!==safe&&a.serve.value===b.serve.value&&narrower(a.when,b.when)&&(a.serve.percent??10000)<=(b.serve.percent??10000)&&after.fallthrough===safe&&next.slice(i+1).every(r=>r.serve.value===safe))continue;
  return true;
 }return false;
}
