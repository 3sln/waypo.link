import {disposableEmailDomains,disposableEmailSource} from './vendor/disposable-email-domains/domains.mjs';
const MAX_OVERRIDES=256;
// Stable forwarding aliases are not throwaway inboxes. Explicit operator rules
// can correct false positives without changing the protocol or a user's account.
export const PRIVACY_EMAIL_DOMAINS=Object.freeze(['icloud.com','privaterelay.appleid.com','mozmail.com','relay.firefox.com','duck.com','addy.io','anonaddy.com','anonaddy.me','simplelogin.com','simplelogin.co','simplelogin.io','slmail.me','slmails.com','silomails.com','aleeas.com','8shield.net','passmail.net','passmail.com']);
const base=new Set([...disposableEmailDomains,'mail.tm',...disposableEmailSource.mailTmActiveDomains]),privacy=new Set(PRIVACY_EMAIL_DOMAINS);
export function canonicalEmailDomain(value){
 if(typeof value!=='string'||value.length>253||!value||/[\s\u0000-\u001f\u007f@/:?#%\\\[\]]/u.test(value))return null;
 let domain;try{domain=new URL('https://'+value).hostname.toLowerCase().replace(/\.$/,'');}catch{return null;}
 if(domain.length>253||!domain.includes('.')||domain.split('.').some(label=>label.length<1||label.length>63||!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)))return null;return domain;
}
export function emailDomain(value){if(typeof value!=='string'||value.length>254||!/^\S+@[^\s@]+$/.test(value)||value.indexOf('@')!==value.lastIndexOf('@'))return null;return canonicalEmailDomain(value.slice(value.lastIndexOf('@')+1));}
const parents=domain=>{const labels=domain.split('.');return labels.slice(0,-1).map((_,index)=>labels.slice(index).join('.'));};
export function validateHostedEmailSignupPolicy(value){
 if(value===undefined)return {revision:'bundled-'+disposableEmailSource.upstreamCommit.slice(0,12),allowDomains:[],denyDomains:[]};
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['revision','allowDomains','denyDomains'].includes(key))||typeof value.revision!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(value.revision))throw TypeError('Explicit bounded hosted signup-email policy required');
 const result={revision:value.revision};for(const field of ['allowDomains','denyDomains']){const entries=value[field]??[];if(!Array.isArray(entries)||entries.length>MAX_OVERRIDES)throw TypeError('Bounded email domain overrides required');const normalized=entries.map(canonicalEmailDomain);if(normalized.some(x=>x===null)||new Set(normalized).size!==normalized.length)throw TypeError('Canonical unique email domains required');result[field]=normalized;}
 if(result.allowDomains.some(domain=>result.denyDomains.includes(domain)))throw TypeError('Conflicting email domain overrides');return result;
}
export function createHostedEmailSignupGuard(settings){
 const policy=validateHostedEmailSignupPolicy(settings),rules=new Map([...policy.allowDomains.map(domain=>[domain,true]),...policy.denyDomains.map(domain=>[domain,false])]);
 return ({email})=>{if(email===null)return true;const domain=emailDomain(email);if(!domain)return false;const candidates=parents(domain);for(const candidate of candidates)if(rules.has(candidate))return rules.get(candidate);if(candidates.some(candidate=>privacy.has(candidate)))return true;return !candidates.some(candidate=>base.has(candidate));};
}
