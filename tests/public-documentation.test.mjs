import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';import {publicDocumentation,publicMarkdown,publicationProblems,movedDocumentation} from '../scripts/public-docs.mjs';
test('public documentation uses an explicit English developer allowlist and cleans prior tracking artifacts',async()=>{const out=await mkdtemp(join(tmpdir(),'3sln-public-docs-'));try{await mkdir(join(out,'docs/release'),{recursive:true});await writeFile(join(out,'docs/release/private-audit.html'),'private tracking');await writeFile(join(out,'DEVLOG.md'),'private tracking');const result=spawnSync(process.execPath,['scripts/build-docs.mjs'],{cwd:process.cwd(),env:{...process.env,PUBLIC_DOCS_OUTPUT:out},encoding:'utf8'});assert.equal(result.status,0,result.stderr);const index=await readFile(join(out,'docs/index.html'),'utf8'),agent=await readFile(join(out,'llms.txt'),'utf8');assert.match(index,/<html lang="en">/);assert.match(index,/Protocol and discovery/);assert.match(index,/Application integration/);assert.doesNotMatch(index+agent,/DEVLOG|Independent reviews|docs\/release|docs\/architecture|walkthrough|docs\/implementation\.md/);await assert.rejects(access(join(out,'DEVLOG.md')));await assert.rejects(access(join(out,'docs/release/private-audit.html')));for(const page of publicDocumentation){await access(join(out,page.source));await access(join(out,page.source.replace(/\.md$/,'.html')));}await access(join(out,'artefacts/contracts/object-storage/v1.json'));assert.match(await readFile(join(out,'docs/spec/protocol.html'),'utf8'),/Discovery and login/);}finally{await rm(out,{recursive:true,force:true});}});
test('published views omit signoff tracking and unpublished links while preserving normative code and content',()=>{const code='```json\n{"contract":"https://example.org/spec","note":"DEVLOG is opaque data"}\n```\n';const source='# Protocol\n\nPublic requirement MUST remain.\n\nHuman reviewer ___ / Date ___ / Outcome ___.\n\n'+code+'\nSee [security](security.md) and [internal audit](../release/audit.md).\n\n## Sign-off checkpoints\n\nPrivate tracking content.\n\n## Standards references\n\nNormative references.\n';const result=publicMarkdown(source,'docs/spec/protocol.md');assert.match(result,/Public requirement MUST remain/);assert.ok(result.includes(code));assert.match(result,/\[security\]\(security.md\)/);assert.doesNotMatch(result,/\[internal audit\]|Private tracking|reviewer ___|Sign-off checkpoints/);assert.match(result,/Normative references/);assert.throws(()=>publicMarkdown('private','DEVLOG.md'),/outside the public allowlist/);});

const published=async source=>publicMarkdown(await readFile(source,'utf8'),source);
test('actual public docs retain financial, delivery and identity requirements from mixed review paragraphs',async()=>{
 const billing=await published('docs/deployment/billing.md');
 for(const rule of [/Authenticate the bounded raw body before deciding to ignore an event/,/Empty customer subscription state must still reach a known account/,/Disable customer portal plan updates/,/This setting affects the whole Polar organization/,/zero-total or entirely account-credit-funded order does not create/])assert.match(billing,rule);
 const email=await published('docs/deployment/email.md');
 for(const rule of [/A retry can send duplicate mail/,/explicit duplicate-tolerant retry policy/,/Email Sending onboards each subdomain separately/,/Setup codes expire in ten minutes/])assert.match(email,rule);
 const names=await published('docs/3sln/accounts/identity-names.md'),recovery=await published('docs/3sln/accounts/recovery-identity.md');
 assert.match(names,/stable \*\*UUIDv4\*\*/);assert.match(names,/Names never recycle/);assert.match(names,/verified paid subscription history/);assert.match(recovery,/a recovery file contains no handle or name assignment/);
 const storage=await published('docs/3sln/services/storage.md');assert.match(storage,/Listing requests fail before storage or provider requests/);assert.match(storage,/must never be enabled directly from an untrusted configuration flag/);
});
test('actual public docs omit review tables and operator history but retain standalone wire and host guidance',async()=>{
 for(const source of ['docs/3sln/accounts/sign-in-and-sessions.md','docs/3sln/services/mcp-service.md','docs/3sln/services/storage.md','docs/deployment/identity-backups.md']){
  const text=await published(source);assert.doesNotMatch(text,/Reviewer|review checkpoint|operator-secrets|has been provisioned with Wrangler|Human review|Outcome: ___/i,source);
 }
 const wire=await published('docs/spec/federation-implementation.md');assert.match(wire,/grant_type=authorization_code/);assert.match(wire,/client_id/);assert.match(wire,/resource token is independently attenuated/);
 assert.match(await published('docs/spec/protocol.md'),/\[OAuth and RPC wire profile\]\(federation-implementation\.md\)/);
 assert.doesNotMatch(await published('docs/3sln/accounts/approve-a-sign-in.md'),/Implementation slices and file ownership|Decisions are provisional until signed off in\./);
 const identity=await published('docs/deployment/identity-backups.md');assert.match(identity,/Node reads `RECOVERY_SIGNING_KEY`/);assert.match(identity,/SIGNUP_CONTACT_REQUIRED=true/);
});

test('every current spec, extension and reference-service document is published under its group, with resolvable links',async()=>{
 assert.deepEqual(publicationProblems(),[]);
 const groups=new Set(publicDocumentation.map(page=>page.group));
 for(const group of ['Start here','Bindle core','Bindle extensions','3sln.me reference service','Hosting'])assert.ok(groups.has(group),group);
 for(const page of publicDocumentation){
  assert.ok(!page.source.startsWith('docs/spec/superseded/'),page.source);
  if(page.source.startsWith('docs/spec/extensions/'))assert.equal(page.group,'Bindle extensions',page.source);
  else if(page.source.startsWith('docs/spec/'))assert.equal(page.group,'Bindle core',page.source);
  else if(page.source.startsWith('docs/3sln/'))assert.equal(page.group,'3sln.me reference service',page.source);
 }
 for(const [from,to] of Object.entries(movedDocumentation)){assert.ok(publicDocumentation.some(page=>page.source===to),to);assert.ok(!publicDocumentation.some(page=>page.source===from),from);}
});
test('the publication check fails on unlisted specs, links to unpublished specs and Bindle links into apps',()=>{
 const docs={'docs/spec/protocol.md':'# P\n\n> **Group:** Bindle core\n\nSee [draft](extensions/secret.md) and [app](../../apps/parlay/docs/legacy/messaging.md).\n'};
 const read=file=>{if(file in docs)return docs[file];throw new Error('missing');};
 const list=root=>root==='docs/spec'?['docs/spec/protocol.md','docs/spec/extensions/secret.md']:[];
 const problems=publicationProblems(read,list).join('\n');
 assert.match(problems,/docs\/spec\/extensions\/secret\.md is a specification .* not in the public allowlist/);
 assert.match(problems,/docs\/spec\/protocol\.md links to unpublished docs\/spec\/extensions\/secret\.md/);
 assert.match(problems,/\(Bindle\) links into application documents/);
 assert.match(problems,/docs\/spec\/auth\.md is allowlisted but missing/);
});
test('published pages keep their group and draft status visible while dropping reviewer bookkeeping',async()=>{
 for(const page of publicDocumentation){const text=await published(page.source);assert.match(text,/^# .+\n+> \*\*Group:\*\* /,page.source);assert.match(text,/> \*\*Status:\*\* \S/,page.source);assert.doesNotMatch(text,/Reviewer:? ___/,page.source);}
 assert.match(await published('docs/spec/extensions/signaling.md'),/\*\*Status:\*\* draft, revision 3\.2; the engine phase is implemented locally behind default-off flags \(2026-10-28\)/);
 // The superseded copies were retired (2026-10-29): old locations redirect only to a live successor, and beaming (no successor) has no redirect.
 assert.equal(movedDocumentation['docs/spec/extensions/links.md'],'docs/spec/extensions/organizations-link-envelope.md');assert.equal(movedDocumentation['docs/spec/superseded/rtc-signaling.md'],'docs/spec/extensions/signaling.md');assert.equal(movedDocumentation['docs/spec/superseded/extensions-rev2.md'],'docs/spec/extensions.md');assert.ok(!('docs/spec/beaming.md' in movedDocumentation)&&!('docs/spec/superseded/beaming.md' in movedDocumentation));
 const device=await published('docs/spec/extensions/device-authorization.md');assert.match(device,/\*\*Does not cover:\*\* session handoff/);assert.match(device,/approve-a-sign-in\.md/);
 const signin=await published('docs/3sln/accounts/sign-in-and-sessions.md');assert.match(signin,/Device authorization does not replace or supersede anything here/);
 const source='# T\n\n> **Group:** Bindle core\n>\n> **Status:** draft; Reviewer ___ Date ___ Outcome ___ stays in the header.\n\nThe rule is proposed (approved provisionally 2026-10-20; DEVLOG "Example entry"). Reviewer ___ / date ___ / outcome ___.\n\n| ID | Decision | Sign-off |\n| --- | --- | --- |\n| X-1 | Keep it. | Reviewer ___ Date ___ Outcome ___ |\n';
 const result=publicMarkdown(source,'docs/spec/protocol.md');
 assert.match(result,/The rule is proposed \(approved provisionally 2026-10-20\)\./);assert.match(result,/\| X-1 \| Keep it\. \| unsigned \|/);assert.match(result,/\*\*Status:\*\* draft; Reviewer ___/);assert.doesNotMatch(result.replace(/^[\s\S]*?stays in the header\./,''),/Reviewer|DEVLOG/);
});
