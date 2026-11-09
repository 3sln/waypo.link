// Manual maintenance only. Never imported by the serving application.
import {createHash} from 'node:crypto';
import {writeFile,rename} from 'node:fs/promises';
import {canonicalEmailDomain} from '../signup-email-policy.mjs';
const args=process.argv.slice(2),commit=args.find(x=>x.startsWith('--commit='))?.slice(9);
if(!/^[a-f0-9]{40}$/.test(commit??'')||args.some(x=>x!=='--write'&&!x.startsWith('--commit=')))throw Error('Usage: node scripts/update-disposable-email-domains.mjs --commit=<reviewed Git SHA> [--write]');
async function read(url,json=false){const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(10000),headers:{Accept:json?'application/ld+json':'text/plain'}});if(!response.ok)throw Error('Source unavailable');let size=0,parts=[];for await(const chunk of response.body){size+=chunk.length;if(size>4000000)throw Error('Source exceeds bound');parts.push(chunk);}const text=Buffer.concat(parts).toString('utf8');return json?JSON.parse(text):text;}
const upstreamUrl=`https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/${commit}/disposable_email_blocklist.conf`,raw=await read(upstreamUrl),license=await read(`https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/${commit}/LICENSE.txt`);
if(!license.includes('CC0 1.0 Universal'))throw Error('Review changed source license');
const domains=raw.split(/\r?\n/).filter(Boolean);if(domains.length<1000||domains.length>100000||domains.some(x=>canonicalEmailDomain(x)!==x)||new Set(domains).size!==domains.length)throw Error('Review invalid or unexpectedly sized source');
let active=[],page=1;
while(page<=8){const data=await read(`https://api.mail.tm/domains?page=${page}`,true);if(!Array.isArray(data['hydra:member']))throw Error('Invalid Mail.tm domain response');for(const item of data['hydra:member'])if(item.isActive===true&&item.isPrivate===false){const domain=canonicalEmailDomain(item.domain);if(!domain)throw Error('Invalid Mail.tm domain');active.push(domain);}if(!data['hydra:view']?.['hydra:next'])break;page++;}
if(page>8||!active.length||active.length>240)throw Error('Review Mail.tm pagination or empty active domains');
active=[...new Set(active)].sort();const source={upstreamCommit:commit,upstreamSha256:createHash('sha256').update(raw).digest('hex'),upstreamUrl,license:'CC0-1.0',fetchedAt:new Date().toISOString(),mailTmActiveDomains:active};
const output='// Vendored local policy data; see README.md and LICENSE.txt.\nexport const disposableEmailSource=Object.freeze('+JSON.stringify(source,null,2)+');\nexport const disposableEmailDomains=Object.freeze('+JSON.stringify(domains.sort(),null,2)+');\n';
if(args.includes('--write')){const target=new URL('../vendor/disposable-email-domains/domains.mjs',import.meta.url),temporary=new URL('../vendor/disposable-email-domains/domains.mjs.tmp',import.meta.url);await writeFile(temporary,output);await writeFile(new URL('../vendor/disposable-email-domains/LICENSE.txt',import.meta.url),license);await rename(temporary,target);}
console.log(JSON.stringify({write:args.includes('--write'),domains:domains.length,...source},null,2));
