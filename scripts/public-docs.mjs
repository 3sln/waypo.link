import path from 'node:path';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {marked} from 'marked';
// Explicit publication boundary. Adding a development document cannot publish it,
// but every specification under docs/spec/ and every reference-service document
// under docs/3sln/ must be listed (checked by publicationProblems).
export const groupDescriptions=Object.freeze({
 'Start here':'Guides for application developers and self-hosters.',
 'Bindle core':'The conformance floor and the extension mechanism. Every Bindle provider and client implements these. All are drafts.',
 'Bindle extensions':'Optional, Bindle-published extensions. A provider declares the ones it implements. Each page states whether it is a draft, proposed or implemented anywhere; several are not implemented.',
 '3sln.me reference service':'How the 3sln.me reference service implements and operates Bindle: its own sign-in, accounts, services and release gates. Not part of the Bindle specification; other providers may choose differently.',
 'Hosting':'Operator configuration for the reference service. Configuration alone does not establish working delivery or provider conformance.',
 'Superseded (for reference)':'Kept so that older references resolve. Do not implement these.',
});
export const publicDocumentation=Object.freeze([
 ['Start here','docs/integration.md','Application integration'],
 ['Start here','docs/self-hosting.md','Self-hosting'],
 ['Start here','docs/modules.md','Portal modules and commands'],
 ['Bindle core','docs/spec/protocol.md','Protocol and discovery'],
 ['Bindle core','docs/spec/auth.md','Authentication and application authorization'],
 ['Bindle core','docs/spec/federation-implementation.md','OAuth and RPC wire profile'],
 ['Bindle core','docs/spec/contracts.md','Resources and preference fragments'],
 ['Bindle core','docs/spec/extensions.md','Extensions and resource-field attributes (draft, unimplemented)'],
 ['Bindle core','docs/spec/artefacts.md','Public artefacts and integrity references'],
 ['Bindle core','docs/spec/keys.md','Signed objects and signature domains (draft)'],
 ['Bindle core','docs/spec/security.md','Security model'],
 ['Bindle extensions','docs/spec/extensions/device-authorization.md','Device authorization for CLIs and TV apps (proposed)'],
 ['Bindle extensions','docs/spec/extensions/incremental-authorization.md','Incremental authorization (draft)'],
 ['Bindle extensions','docs/spec/extensions/integrations.md','Integrations and brokered resources (draft)'],
 ['Bindle extensions','docs/spec/extensions/resource-contributions.md','Application connections and tools (proposal)'],
 ['Bindle extensions','docs/spec/extensions/app-metadata.md','Application metadata'],
 ['Bindle extensions','docs/spec/extensions/events.md','Event buses (draft)'],
 ['Bindle extensions','docs/spec/extensions/intents.md','Intent links and handlers (draft)'],
 ['Bindle extensions','docs/spec/extensions/links.md','Link envelope (draft, being split)'],
 ['Bindle extensions','docs/spec/extensions/identity-portability.md','Identity portability (draft)'],
 ['Bindle extensions','docs/spec/extensions/app-removal.md','App removal and subject deletion (proposed)'],
 ['Bindle extensions','docs/spec/extensions/organizations.md','Organizations and relations (skeleton)'],
 ['Bindle extensions','docs/spec/extensions/signaling.md','Signaling (draft, unimplemented)'],
 ['Bindle extensions','docs/spec/extensions/messaging.md','Bindle Messaging (draft)'],
 ['Bindle extensions','docs/spec/extensions/message-content.md','Message content (draft)'],
 ['3sln.me reference service','docs/3sln/accounts/sign-in-and-sessions.md','Sign-in, passkeys and sessions'],
 ['3sln.me reference service','docs/3sln/accounts/approve-a-sign-in.md','Approve a sign-in: session handoff and app sign-in with a code'],
 ['3sln.me reference service','docs/3sln/accounts/identity-names.md','Identity names'],
 ['3sln.me reference service','docs/3sln/accounts/recovery-identity.md','Identity recovery'],
 ['3sln.me reference service','docs/3sln/accounts/recovery-file.md','Recovery file format'],
 ['3sln.me reference service','docs/3sln/accounts/account-lifecycle.md','Account lifecycle'],
 ['3sln.me reference service','docs/3sln/services/storage.md','Object storage'],
 ['3sln.me reference service','docs/3sln/services/app-messages.md','Messages from connected apps'],
 ['3sln.me reference service','docs/3sln/services/activity.md','Activity from apps (draft)'],
 ['3sln.me reference service','docs/3sln/services/notifications.md','Notifications'],
 ['3sln.me reference service','docs/3sln/services/omni-search.md','Search'],
 ['3sln.me reference service','docs/3sln/services/mcp-service.md','Agent connections (MCP)'],
 ['3sln.me reference service','docs/3sln/services/browser-automation.md','Browser automation'],
 ['3sln.me reference service','docs/3sln/release-gates.md','Security policy and release gates'],
 ['3sln.me reference service','docs/profiles/components-v1.md','Components profile (provisional)'],
 ['Hosting','docs/deployment/client-build.md','Client builds'],
 ['Hosting','docs/deployment/federation.md','Provider federation configuration'],
 ['Hosting','docs/deployment/google-drive.md','Google Drive configuration'],
 ['Hosting','docs/deployment/mcp.md','Agent endpoint configuration'],
 ['Hosting','docs/deployment/email.md','Email configuration'],
 ['Hosting','docs/deployment/identity-backups.md','Identity authority and signup configuration'],
 ['Hosting','docs/deployment/billing.md','Billing configuration'],
 ['Superseded (for reference)','docs/spec/superseded/rtc-signaling.md','RTC signaling (superseded by Signaling)'],
 ['Superseded (for reference)','docs/spec/superseded/beaming.md','Beaming (superseded)'],
 ['Superseded (for reference)','docs/spec/superseded/extensions-rev2.md','Extensions revision 2 (frozen copy)'],
 ['Superseded (for reference)','docs/spec/superseded/signaling-rev2.1.md','Signaling revision 2.1 (frozen copy)'],
].map(([group,source,title])=>Object.freeze({group,source,title})));
// Locations that moved in the 2026-10-27 documentation split (old docs/spec/ paths,
// some previously published and some referenced by the contract registry).
// The build writes a small redirect page at each old location so existing links keep working.
export const movedDocumentation=Object.freeze({
 'docs/spec/device-login.md':'docs/3sln/accounts/sign-in-and-sessions.md',
 'docs/spec/identity-names.md':'docs/3sln/accounts/identity-names.md',
 'docs/spec/recovery-identity.md':'docs/3sln/accounts/recovery-identity.md',
 'docs/spec/recovery-file.md':'docs/3sln/accounts/recovery-file.md',
 'docs/spec/storage.md':'docs/3sln/services/storage.md',
 'docs/spec/app-messages.md':'docs/3sln/services/app-messages.md',
 'docs/spec/mcp-service.md':'docs/3sln/services/mcp-service.md',
 'docs/spec/browser-automation.md':'docs/3sln/services/browser-automation.md',
 'docs/spec/omni-search.md':'docs/3sln/services/omni-search.md',
 'docs/spec/notifications.md':'docs/3sln/services/notifications.md',
 'docs/spec/device-authorization.md':'docs/spec/extensions/device-authorization.md',
 'docs/spec/resource-contributions.md':'docs/spec/extensions/resource-contributions.md',
 'docs/spec/app-metadata.md':'docs/spec/extensions/app-metadata.md',
 'docs/spec/message-content.md':'docs/spec/extensions/message-content.md',
 'docs/spec/intents.md':'docs/spec/extensions/intents.md',
 'docs/spec/links.md':'docs/spec/extensions/links.md',
 'docs/spec/events.md':'docs/spec/extensions/events.md',
 'docs/spec/integrations.md':'docs/spec/extensions/integrations.md',
 'docs/spec/incremental-authorization.md':'docs/spec/extensions/incremental-authorization.md',
 'docs/spec/identity-portability.md':'docs/spec/extensions/identity-portability.md',
 'docs/spec/app-removal.md':'docs/spec/extensions/app-removal.md',
 'docs/spec/signaling.md':'docs/spec/extensions/signaling.md',
 'docs/spec/messaging.md':'docs/spec/extensions/messaging.md',
 'docs/spec/organizations.md':'docs/spec/extensions/organizations.md',
 'docs/spec/account-lifecycle.md':'docs/3sln/accounts/account-lifecycle.md',
 'docs/spec/activity.md':'docs/3sln/services/activity.md',
 'docs/spec/rtc-signaling.md':'docs/spec/superseded/rtc-signaling.md',
 'docs/spec/beaming.md':'docs/spec/superseded/beaming.md',
});
const sources=new Set(publicDocumentation.map(page=>page.source));
// Directories whose every Markdown file must be published, and whose files
// published pages may not link to unless published.
const specRoots=['docs/spec','docs/3sln','docs/profiles'];
const bindleGroups=new Set(['Bindle core','Bindle extensions']);
const sectionNumber='(?:\\d+[a-z]?(?:\\.\\d+)*\\.?\\s+)?';
const internalSections=new RegExp(`^${sectionNumber}(?:Sign-off checkpoints|Evidence and review|Evidence and gates|Verification and remaining release gates|Release verification|Current live verification|Operator provisioning history|Local verification history|Validation|Implementation slices and file ownership|Review reconciliation)$`,'i');
const trackingSentence=/(?:DEVLOG|release-status\.json|reviewer\s*[:/]?\s*___|decision sign.off|human (?:review|sign.off)|reviewer fields|reviewer \/ date|local service fixtures|independent.*(?:audit|review).*(?:passed|recorded)|validation.*\d+\/\d+)/i;
// The fixed document header (Group / Status / Covers / Does not cover) is always
// published unchanged, so draft, unimplemented and provisional status stays visible.
const isHeader=raw=>/^>\s*\*\*Group:\*\*/.test(raw);
// A tracking sentence that also states a status (draft, provisional, unsigned...)
// keeps the status: only the bookkeeping fragments are removed from it.
const statusWord=/\b(?:proposed|provisional|unsigned|draft|superseded|not implemented|unimplemented|pending|withdrawn|approved)\b/i;
const signoffBlank=/(?:Human\s+)?[Rr]eviewer\s*:?\s*_+\s*\/?\s*[Dd]ate\s*:?\s*_+\s*\/?\s*[Oo]utcome\s*:?\s*_+/g;
const ownerApproval=/Reviewer:? owner \(in session\)\s*Date:? (\d{4}-\d{2}-\d{2})\s*Outcome:? approved(?:\s*\(DEVLOG[^)]*\))?/g;
const withoutBookkeeping=sentence=>sentence
 .replace(ownerApproval,'owner-approved $1')
 .replace(/[;,]?\s*(?:see\s+)?(?:the\s+)?\[[^\]]*\]\([^)]*DEVLOG[^)]*\)/gi,'')
 .replace(/[;,]?\s*(?:(?:recorded|tracked) in\s+|in\s+|see\s+)?DEVLOG(?:\.md)?(?:,?\s+(?:entry\s+)?(?:"[^"]*"|“[^”]*”|\d{4}-\d{2}-\d{2}|[A-Z][\w-]*(?=\s+")))*/gi,'')
 .replace(signoffBlank,'')
 .replace(/\(\s*[;,]?\s*\)/g,'').replace(/\(\s*[;,]\s*/g,'(').replace(/\s*[;,]\s*\)/g,')').replace(/\s+([.,;:])/g,'$1');
const scrub=text=>{
 const trailing=text.match(/\s*$/)?.[0]||'';
 const kept=text.trimEnd().split(/(?<=[.!?])\s+(?=[A-Z`\[*])/).map(sentence=>{
  if(!trackingSentence.test(sentence))return sentence;
  if(!statusWord.test(sentence))return '';
  const cleaned=withoutBookkeeping(sentence);
  return trackingSentence.test(cleaned)?'':cleaned;
 }).filter(Boolean).join(' ');
 return kept?kept+trailing:'';
};
const resolveLink=(source,link)=>link.startsWith('/')?link.slice(1):path.posix.normalize(path.posix.join(path.posix.dirname(source),link));
const markdownLinks=text=>[...text.matchAll(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map(match=>({whole:match[0],label:match[1],target:match[2]}));
export function publicMarkdown(markdown,source){
 if(!sources.has(source))throw new TypeError('Document is outside the public allowlist.');
 const output=[];let skippedDepth=0;
 for(const token of marked.lexer(markdown)){
  if(token.type==='heading'){
   if(skippedDepth&&token.depth<=skippedDepth)skippedDepth=0;
   if(!skippedDepth&&internalSections.test(token.text)){skippedDepth=token.depth;continue;}
  }
  if(skippedDepth)continue;
  if(token.type==='table'&&token.header.some(cell=>/reviewer|review checkpoint/i.test(cell.text)))continue;
  let text=token.raw;
  // Decision tables keep each row's sign-off state as one word, not blank reviewer fields.
  if(token.type==='table')text=text.replace(ownerApproval,'owner-approved $1').replace(signoffBlank,'unsigned').split('\n').map(line=>trackingSentence.test(line)?withoutBookkeeping(line):line).join('\n');
  // Mixed paragraphs often contain both operational requirements and review
  // bookkeeping. Remove only the tracking sentences, never the whole paragraph.
  if(token.type==='paragraph'){text=scrub(text);if(!text)continue;}
  // List items carry requirements, so they are never dropped; only bookkeeping fragments go.
  if(token.type==='list')text=text.split('\n').map(line=>trackingSentence.test(line)?line.replace(/^(\s*)(.*)$/,(whole,indent,body)=>indent+withoutBookkeeping(body)):line).join('\n');
  // Blockquotes (amendment notes) get the same treatment, line by line, except the header.
  if(token.type==='blockquote'&&!isHeader(text)){
   const lines=text.split('\n').map(line=>{const body=line.replace(/^>\s?/,'');if(!body.trim())return line;const kept=scrub(body);return kept?'> '+kept:null;}).filter(line=>line!==null);
   if(!lines.some(line=>line.replace(/^>\s?/,'').trim()))continue;
   text=lines.join('\n');if(!text.endsWith('\n'))text+='\n';
  }
  // Keep code byte-for-byte; presentation links to unpublished tracking pages
  // become ordinary text rather than broken or accidentally public URLs.
  if(token.type!=='code')for(const {whole,label,target} of markdownLinks(text)){
   if(/^(?:https?:|#|mailto:)/.test(target))continue;
   const link=target.split('#')[0];
   if(!link.endsWith('.md'))continue;
   if(!sources.has(resolveLink(source,link)))text=text.replace(whole,label);
  }
  output.push(text);
 }
 return output.join('');
}
const walk=dir=>existsSync(dir)?readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{const full=path.posix.join(dir,entry.name);return entry.isDirectory()?walk(full):entry.name.endsWith('.md')?[full]:[];}):[];
const header=markdown=>{const match=markdown.match(/^# .+\n+((?:>.*\n)+)/);return match&&isHeader(match[1])?match[1]:null;};
export function documentStatus(markdown){const block=header(markdown);const status=block?.match(/\*\*Status:\*\*\s*([^\n]+)/)?.[1]||'';return status.split(/(?<=[.;])\s/)[0].replace(/[.;]$/,'');}
// Build-time publication check. Returns a list of problems; the build fails if any exist.
export function publicationProblems(read=file=>readFileSync(file,'utf8'),list=walk){
 const problems=[];
 for(const root of specRoots)for(const file of list(root))if(!sources.has(file))problems.push(`${file} is a specification or reference-service document but is not in the public allowlist`);
 for(const page of publicDocumentation){
  let markdown;try{markdown=read(page.source);}catch{problems.push(`${page.source} is allowlisted but missing`);continue;}
  if(!header(markdown))problems.push(`${page.source} lacks the Group / Status / Covers / Does not cover header`);
  let fence=false;
  for(const line of markdown.split('\n')){
   if(/^\s*```/.test(line)){fence=!fence;continue;}
   if(fence)continue;
   for(const {target} of markdownLinks(line)){
    if(/^(?:[a-z]+:|#)/i.test(target))continue;
    const link=target.split('#')[0];
    const resolved=resolveLink(page.source,link);
    if(bindleGroups.has(page.group)&&resolved.startsWith('apps/'))problems.push(`${page.source} (Bindle) links into application documents: ${target}`);
    if(!link.endsWith('.md'))continue;
    if(specRoots.some(root=>resolved.startsWith(root+'/'))&&!sources.has(resolved))problems.push(`${page.source} links to unpublished ${resolved}`);
    if(!link.startsWith('/')&&!existsSync(resolved))problems.push(`${page.source} links to missing ${resolved}`);
   }
  }
 }
 return problems;
}
