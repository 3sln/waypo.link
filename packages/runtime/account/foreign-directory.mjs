// ORG-7 runtime instance for ORG-4 foreign member-certificate issuers. Each adapter injects DIRECTORY_EGRESS
// (issuers -> fetch over its reviewed SSRF-screened egress: packages/federation/node-directory-fetch.mjs,
// apps/worker/directory-fetch.mjs). A directory exists only while DIRECTORY_ENABLED and, for the organization,
// ORG_FOREIGN_MEMBERS_ENABLED are on; IdentityDirectory re-reads DIRECTORY_ENABLED on every call. The issuer allowlist
// ORG_FOREIGN_ISSUERS (a JSON array of https origins) is empty by default and any invalid entry empties it. Pins live in
// the organization's account store. This opens no production egress gate.
import {IdentityDirectory,directoryURL} from '../../federation/directory.mjs';
import {flagsFor,siteGlobal} from '../../flags/read.mjs';

export function foreignIssuers(config){
 let list=config?.ORG_FOREIGN_ISSUERS;if(typeof list==='string'){try{list=JSON.parse(list);}catch{return [];}}
 return Array.isArray(list)&&list.length<=64&&list.every(o=>typeof o==='string'&&directoryURL(o+'/')?.origin===o)?[...new Set(list)]:[];
}
export function foreignDirectoryEnabled(config,owner){
 try{return typeof config?.DIRECTORY_EGRESS==='function'&&siteGlobal(config,'DIRECTORY_ENABLED')&&flagsFor(config,{subject:{kind:'account',owner}}).enabled('ORG_FOREIGN_MEMBERS_ENABLED');}catch{return false;}
}
const shared=new WeakMap();
/** The directory for `owner`, or null when gated off. `store`: the account store (transaction/put). Wargame 2026-10-23
 * F1: one directory per controller (keyed by its store), so its manifest cache, document cache and per-site limiter
 * persist across calls; it spends the shared egress as tenant `owner`. Rebuilt only when the config, owner or
 * allowlist changes. */
export function foreignDirectory(config,{store,owner}){
 if(!foreignDirectoryEnabled(config,owner))return null;const issuers=foreignIssuers(config),key=JSON.stringify(issuers);
 const entry=store&&typeof store==='object'?shared.get(store):null;
 if(entry?.config===config&&entry.owner===owner&&entry.key===key)return entry.directory;
 const directory=new IdentityDirectory({config,issuers,tenant:typeof owner==='string'?owner:null,fetch:config.DIRECTORY_EGRESS(issuers),store:{transaction:fn=>store.transaction(tx=>fn({get:k=>tx.get(k),set:(k,v)=>tx.put(k,v)}))}});
 if(store&&typeof store==='object')shared.set(store,{config,owner,key,directory});return directory;
}
