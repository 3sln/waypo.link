// Deterministic, network-free item-classification/v1 test double (docs/spec/extensions/item-classification.md). It is
// a contract implementation for engine and Parlay tests, never a classifier: a label scores 0.95 when the decoded text
// (text/* items) contains its id, case-insensitively, else 0.02; non-text items score 0.5 for every label. It validates
// exactly as §3–§6 require (before any effect), fetches presigned URLs through fetchPresignedItem with an injected
// fetch double, and keeps no item, URL, tags, labels or scores: only counters, unless a test asks for a call log.
import {validateClassifyArgs,validateCapabilitiesArgs,validateCapabilities,refuseUnsupported,afterEffect,classificationError} from '../../packages/sdk/src/item-classification.mjs';
import {fetchPresignedItem,CHECKS_CONNECTED_ADDRESS} from '../../packages/sdk/src/item-classification-fetch.mjs';

export const TEXT_CAPABILITIES=Object.freeze({kinds:[{kind:'text',mediaTypes:['text/plain'],inputs:['inline','url'],maxBytes:65536}],maxLabels:16,model:{id:'test/double',version:'1'}});
const decoder=new TextDecoder();
/**
 * `capabilities`: the result `capabilities()` returns (validated on construction). `now()`: epoch ms. `fetch` and
 * `checkHost`: the transport and resolver doubles for URL items. `fail`: optional (method, args) => error code to
 * throw before any effect (simulating rate limits and the like). `afterFetch`: optional code thrown after the fetch,
 * which must surface as `indeterminate`. `log`: keep the validated arguments of each call (tests only).
 */
export function classifierDouble({capabilities=TEXT_CAPABILITIES,now=()=>Date.UTC(2026,9,28,12),fetch,checkHost=async()=>['8.8.8.8'],model=capabilities.model??{id:'test/double',version:'1'},fail,afterFetch,log=false}={}){
 const advertised=validateCapabilities(structuredClone(capabilities));if(!advertised)throw new TypeError('Invalid double capabilities');
 const double={counts:{capabilities:0,classify:0,fetched:0,refused:0},calls:[],
  async capabilities(args={}){validateCapabilitiesArgs(args);double.counts.capabilities++;const code=fail?.('capabilities',args);if(code)throw classificationError(code,'Refused.');return structuredClone(capabilities);},
  async classify(args){
   double.counts.classify++;
   // Everything up to here is validation: a refusal claims no effect (§6).
   const valid=validateClassifyArgs(args,{now:now()});
   try{refuseUnsupported(valid,advertised);}catch(error){double.counts.refused++;throw error;}
   const code=fail?.('classify',valid);if(code)throw classificationError(code,'Refused.');
   if(log)double.calls.push(structuredClone({...valid}));
   let bytes=valid.bytes;
   if(!bytes){bytes=await fetchPresignedItem(valid.item,{fetch,checkHost,now});double.counts.fetched++;}
   return afterEffect(async()=>{
    if(afterFetch)throw classificationError(afterFetch,'Refused late.');
    const text=valid.item.mediaType.startsWith('text/')?decoder.decode(bytes).toLowerCase():null;
    return {scores:Object.fromEntries(valid.labels.map(l=>[l.id,text===null?.5:text.includes(l.id.toLowerCase())?.95:.02])),model:{...model}};
   });
  },
 };
 return double;
}
/**
 * Presigned-URL fetch double: `objects` maps an href to {status=200, body (string|Uint8Array), headers={}, location}.
 * Records each request's method, redirect mode, credentials mode and header names; never touches the network, so it is
 * marked as checking the connected address (there is none).
 */
export function presignedFetchDouble(objects={}){
 const requests=[];
 const fetch=async(href,init={})=>{
  requests.push({href,method:init.method,redirect:init.redirect,credentials:init.credentials,referrerPolicy:init.referrerPolicy,headers:Object.keys(init.headers??{}).map(h=>h.toLowerCase()).sort()});
  const object=objects[href];if(!object)return new Response('missing',{status:404});
  if(object.throws)throw new TypeError('network');
  const body=typeof object.body==='string'?new TextEncoder().encode(object.body):object.body??new Uint8Array();
  const status=object.status??200,headers=new Headers(object.headers??{});if(object.location)headers.set('location',object.location);
  if(status>=300&&status<400&&init.redirect==='follow'&&object.location)return fetch(object.location,init);
  return new Response(status===204||status===304||status>=300&&status<400?null:body,{status,headers});
 };
 fetch[CHECKS_CONNECTED_ADDRESS]=true;
 return {fetch,requests};
}
/**
 * An application-side port over doubles (what a host adapter supplies to an app engine): `values` is the app's
 * approved projection of the item-classification fragment, `resources` maps resource URL -> double. Each call is a
 * separate dispatch with a fresh tx (recorded), as extensions §3.2 requires.
 */
export function classifierPort({values={},resources={}}={}){
 let tx=0;const dispatches=[];
 const target=resource=>{const r=resources[resource];if(!r)throw classificationError('not_found','Not found.');return r;};
 return {dispatches,
  async fields(){return structuredClone(values);},
  async capabilities(resource){dispatches.push({resource,method:'capabilities',tx:++tx});return target(resource).capabilities({});},
  async classify(resource,args){dispatches.push({resource,method:'classify',tx:++tx});return target(resource).classify(structuredClone(args));},
 };
}
