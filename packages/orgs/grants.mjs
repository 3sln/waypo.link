// ORG-3: pure, fail-closed live intersection. Times on grants are Unix seconds; the injected clock is ms.
const live=(value,now)=>value?.state==='live'&&(value.expires_at===undefined||value.expires_at>now/1000);
// principalKey and samePrincipal live in core (core-scope step 1); re-exported for packages/rtc and older importers.
export {principalKey,samePrincipal} from '../core/principals.mjs';
export function memberPowers(member,now){return live(member,now)&&!member.hold?(member.grants??[]).filter(g=>g.power==='admin'&&(g.expires_at===undefined||g.expires_at>now/1000)&&(g.notBefore??0)<=now).map(g=>g.power):[];}
/** Each ceiling is a contract -> method[] map. Governance is deliberately absent from this output. */
export function effectiveAuthority({member,application,resource,connections=[],imported,now}={}){
 if(!Number.isSafeInteger(now)||now<0||!live(member,now)||connections.some(c=>c?.state!=='connected'||c.expectedGeneration!==undefined&&c.generation!==c.expectedGeneration)||!application||!resource)return {};
 const ceilings=[application,resource.contracts,...imported?[imported]:[]],out=Object.create(null);
 for(const grant of member.grants??[]){if(grant.power||grant.resource!==resource.id||grant.expires_at!==undefined&&grant.expires_at<=now/1000)continue;
  for(const [contract,methods]of Object.entries(grant.methods??{}))if(Array.isArray(methods))for(const method of methods)if(ceilings.every(c=>Array.isArray(c?.[contract])&&c[contract].includes(method)))out[contract]=[...new Set([...(out[contract]??[]),method])].sort();
 }
 return Object.fromEntries(Object.entries(out).sort(([a],[b])=>a.localeCompare(b)));
}
export function effectiveMethods(input){return [...new Set(Object.values(effectiveAuthority(input)).flat())].sort();}
/** Projection descriptors contain only derived methods, never the grants or their provenance. */
export function memberResourceProjection(input,descriptor){const methods=effectiveAuthority(input);return Object.keys(methods).length?{...structuredClone(descriptor),contracts:Object.keys(methods),effective_methods:[...new Set(Object.values(methods).flat())].sort()}:null;}
export function normalizeMemberGrants(value){
 if(!Array.isArray(value)||value.length>256)throw new TypeError('Invalid member grants.');
 return value.map(g=>{if(!g||typeof g!=='object'||Array.isArray(g)||Object.keys(g).some(k=>!['power','resource','methods','expires_at'].includes(k))||g.expires_at!==undefined&&(!Number.isSafeInteger(g.expires_at)||g.expires_at<0))throw new TypeError('Invalid member grant.');
  if(g.power==='admin'&&Object.keys(g).every(k=>['power','expires_at'].includes(k)))return structuredClone(g);
  if(g.power!==undefined||typeof g.resource!=='string'||!g.resource||!g.methods||typeof g.methods!=='object'||Array.isArray(g.methods)||Object.entries(g.methods).some(([c,ms])=>!c||!Array.isArray(ms)||!ms.length||ms.some(m=>typeof m!=='string'||!m||m.length>128)))throw new TypeError('Invalid member grant.');return structuredClone(g);
 });
}
/** ORG-4 supplies resolve(context): an engine-backed live membership/generation check. The federation hook runs
 * for every token load (including dispatch reauthorization) and narrows the app grants used by both projections.
 * It never caches member grants in credentials. Missing composition fails closed for member-context tokens.
 */
export function organizationFederationPort({resolve,enabled=()=>false}){
 return {attach(service){
  const tokenRecord=service.tokenRecord.bind(service),projectV2=service.projectV2.bind(service);
  service.tokenRecord=async(tx,record)=>{
   const result=await tokenRecord(tx,record);if(!result.token.member)return result;
   if(!enabled(result.token.subject)||typeof resolve!=='function'||!Number.isSafeInteger(result.token.member.aep)||result.token.member.aep<0)throw Object.assign(new Error('Member authority unavailable.'),{code:'forbidden'});
   const context=await resolve(result.token.member,result.token);if(!context?.member||context.member.id!==(result.token.member.membership_id??result.token.member.membership?.id)||context.member.generation!==(result.token.member.generation??result.token.member.membership?.generation))throw Object.assign(new Error('Member authority unavailable.'),{code:'forbidden'});
   if(!live(context.member,service.clock())||result.token.member.aep<(context.member.aep??0))throw Object.assign(new Error('Member authority unavailable.'),{code:'forbidden'});
   const grants=[];for(const grant of result.grants){
    const scalar=structuredClone(grant);scalar.fields=grant.fields.filter(f=>!Object.hasOwn(grant.resources??{},f));scalar.methods={};scalar.resources={};grants.push(scalar);
    for(const [field,ids]of Object.entries(grant.resources??{}))for(const id of ids){const resource=await tx.get(`federation/resource/${id}`),methods=effectiveAuthority({member:context.member,application:grant.methods?.[field],resource,connections:context.connections,imported:context.imported?.[id],now:service.clock()});
     if(Object.keys(methods).length){const narrowed=structuredClone(grant);narrowed.fields=[field];narrowed.resources={[field]:[id]};narrowed.methods={[field]:methods};grants.push(narrowed);}
    }
   }
   // Member omissions are deliberate exclusions, never a prompt to widen the application's consent.
   for(const g of grants){g.assignedResources??=structuredClone(result.grants.find(original=>original.id===g.id)?.resources??{});g.approvedResources??=structuredClone(g.assignedResources);for(const[field,ids]of Object.entries(g.approvedResources))g.approvedResources[field]=ids.filter(id=>grants.some(other=>other.fragment===g.fragment&&other.resources?.[field]?.includes(id)));}
   return {...result,grants};
  };
  // Descriptors use attenuated references, so derive their methods from their stored child token, never raw ids.
  const decorate=async(tx,result,token)=>{if(!token?.member)return result;
   for(const value of Object.values(result.values??{}))for(const entry of Array.isArray(value)?value:[value])if(entry&&typeof entry==='object'&&Array.isArray(entry.contracts)){
    let methods=entry.methods;if(!methods&&entry.token){const loaded=await service.token(tx,entry.token);methods={};for(const g of loaded.grants)for(const[field,fields]of Object.entries(g.methods??{}))for(const[c,ms]of Object.entries(fields))if(g.resources?.[field]?.includes(loaded.token.attenuation?.resource)&&entry.contracts.includes(c))methods[c]=[...new Set([...(methods[c]??[]),...ms])];}
    entry.effective_methods=[...new Set(Object.values(methods??{}).flat())].sort();
   }return result;};
  service.projectV2=async(tx,input)=>decorate(tx,await projectV2(tx,input),input.token);
 }};
}
