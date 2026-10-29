// Node transport for fetchPresignedItem (item-classification/v1 §5.2 rule 2; draft, provisional, unsigned; review M4).
// The address check runs inside the socket's own name lookup, so the address checked is the address connected to, on
// every connection attempt, retries included: a rebinding answer between a pre-check and the connection cannot slip
// through. No connection is pooled or reused. Node only (node:http, node:https, node:dns, node:net, node:stream); it
// lives outside src/ so the browser asset build never sees it.
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import {Readable} from 'node:stream';
import {nonPublicAddress,CHECKS_CONNECTED_ADDRESS} from '../src/item-classification-fetch.mjs';

const refused=hostname=>Object.assign(new Error(`Refused a non-public address for ${hostname}`),{code:'ENONPUBLIC'});
/**
 * A `lookup` (the node:net signature) that resolves through `resolve` (default dns.lookup), refuses when any answer is
 * not allowed, and otherwise hands the socket exactly the checked address(es).
 */
export function guardedLookup({resolve=dns.lookup,allowed=address=>!nonPublicAddress(address)}={}){
 return (hostname,options,callback)=>{
  if(typeof options==='function'){callback=options;options={};}
  resolve(hostname,{...options,all:true},(error,answers)=>{
   if(error)return callback(error);
   const list=(Array.isArray(answers)?answers:[{address:answers,family:net.isIP(answers)}]).map(a=>({address:a.address,family:a.family??net.isIP(a.address)}));
   if(!list.length||list.some(a=>!allowed(a.address)))return callback(refused(hostname));
   if(options?.all)return callback(null,list);
   callback(null,list[0].address,list[0].family);
  });
 };
}
/**
 * A fetch-shaped transport for fetchPresignedItem: one request, never a redirect, no pooled connection, the connected
 * address checked at connect time. `resolve` and `allowed` are injectable for tests; by default every non-public
 * address (nonPublicAddress) is refused, including an IP-literal host, which node:net connects to without a lookup.
 */
export function nodeGuardedFetch({resolve,allowed=address=>!nonPublicAddress(address)}={}){
 const lookup=guardedLookup({resolve,allowed});
 const fetch=(href,init={})=>new Promise((resolvePromise,reject)=>{
  let url;try{url=new URL(href);}catch(error){return reject(error);}
  const transport=url.protocol==='https:'?https:url.protocol==='http:'?http:null;if(!transport)return reject(new TypeError('Unsupported protocol'));
  const host=url.hostname.replace(/^\[|\]$/g,'');
  if(net.isIP(host)&&!allowed(host))return reject(refused(host));
  if((init.method??'GET')!=='GET')return reject(new TypeError('Only GET is supported'));
  const request=transport.request(url,{method:'GET',agent:false,lookup,headers:{...init.headers??{}},signal:init.signal},response=>{
   const headers=new Headers();for(const [name,value]of Object.entries(response.headers))if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(', '):String(value));
   const status=response.statusCode??0,noBody=status===204||status===304||status>=300&&status<400;
   if(noBody)response.resume();
   resolvePromise({status,headers,redirected:false,type:'basic',body:noBody?null:Readable.toWeb(response)});
  });
  request.on('error',reject);request.end();
 });
 fetch[CHECKS_CONNECTED_ADDRESS]=true;
 return fetch;
}
