// ORG-12b review L3: break-glass notice mail (apps/worker/email.mjs sendBreakGlassNotice). The organization's handle is
// owner-chosen, so it only ever appears as "your organization @handle" (and "tu organización @handle"), never on its own
// where it could read as the sender; links are validated, including the handle the abort page shows (review M2).
import test from 'node:test';
import assert from 'node:assert/strict';
import {mailTransport} from '../apps/worker/email.mjs';
import {OWNER_NOTICE_KIND_LIST} from '../packages/identity/owner-channels.mjs';

const ORIGIN='https://3sln.example',ORG='11111111-1111-4111-8111-111111111111',TOKEN=`bg1.${ORG}.${ORG}.${'a'.repeat(43)}`;
const transport=sent=>mailTransport({MAIL_ENABLED:'true',APP_ORIGIN:ORIGIN,EMAIL:{send:async message=>{sent.push(message);return {messageId:'m'};}}});
test('review L3: every notice names the organization only as “your organization @handle”, in both languages',async()=>{
 const sent=[],mail=transport(sent),handle='3sln-security';
 for(const event of OWNER_NOTICE_KIND_LIST)await mail.sendBreakGlassNotice({email:'owner@home.example',event,orgHandle:handle,abortUrl:null});
 assert.equal(sent.length,OWNER_NOTICE_KIND_LIST.length);
 for(const m of sent){
  assert.match(m.subject,/your organization @3sln-security\b/i,m.subject);assert.equal(m.subject.split('@3sln-security').length,2,'once, inside that phrase');
  assert.match(m.text,/tu organización @3sln-security/,'the Spanish half too');
  for(const at of [...m.text.matchAll(/@3sln-security/g)].map(x=>x.index))assert.match(m.text.slice(Math.max(0,at-18),at),/(your organization |tu organización )$/i,'never on its own');
  assert.equal(m.from,'security@3sln.example');
 }
 const bare=[];await transport(bare).sendBreakGlassNotice({email:'owner@home.example',event:'claim-started',orgHandle:null,abortUrl:null});assert.match(bare[0].subject,/your organization$/,'no dangling handle');
});
test('review M2: links carry the handle the page asks for; anything else is refused',async()=>{
 const sent=[],mail=transport(sent),url=`${ORIGIN}/org-claim/abort#org=${ORG}&token=${TOKEN}&handle=acme`;
 await mail.sendBreakGlassNotice({email:'owner@home.example',event:'claim-started',orgHandle:'acme',abortUrl:url});assert.ok(sent[0].text.includes(url));assert.ok(sent[0].text.includes(url.replace('abort#','abort?lang=es#')));
 for(const bad of [`${ORIGIN}/org-claim/abort#org=${ORG}&token=${TOKEN}&handle=<b>`,`https://evil.example/org-claim/abort#org=${ORG}&token=${TOKEN}`,`${ORIGIN}/org-claim/abort?org=${ORG}&token=${TOKEN}`])
  await assert.rejects(mail.sendBreakGlassNotice({email:'owner@home.example',event:'claim-started',orgHandle:'acme',abortUrl:bad}));
 await assert.rejects(mail.sendBreakGlassNotice({email:'owner@home.example',event:'claim-started',orgHandle:'a b',abortUrl:null}));
});
