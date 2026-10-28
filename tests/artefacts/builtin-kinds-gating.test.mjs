// Cleanup audit 2026-10-27 (item 3): the messaging intent kinds are operator-pinned only behind the flag of the feature
// that uses them, so a default deployment registers none of them. Signaling rev 3.2 (§3.4, §15, Appendix C.2): core
// registers no session kinds at all (the four rtc-purpose documents are removed; a kind is published by the app that
// needs it), so even with the signaling flags on, no session kind is registered.
import test from 'node:test';import assert from 'node:assert/strict';
import {configuredArtefactDocuments,registeredArtefact} from '../../packages/runtime/artefact-pins.mjs';
import {REGISTERED_INTENT_REFERENCES} from '../../packages/intents/registered.mjs';
import {SIGNALING_CONTRACT} from '../../packages/signaling/extension.mjs';
const intents=REGISTERED_INTENT_REFERENCES.map(r=>r.artefact);
// The retired rtc-purpose lines (docs/artefacts/rtc-purposes/*, removed with signaling rev 3.2).
const retired=['call','screen-share','file-transfer','device-sync'].map(p=>`https://spec.bindle.example/rtc-purposes/${p}/v1`);
const visible=(config,ids)=>ids.map(id=>[registeredArtefact(config,id),Object.hasOwn(configuredArtefactDocuments(config),id),Object.hasOwn(configuredArtefactDocuments(config),id+'/envelope')].every(Boolean));
const none=list=>list.every(v=>v===false),all=list=>list.every(v=>v===true);
const SIGNALING={ARTEFACT_VERSIONS_ENABLED:'true',EXTENSIONS_ENABLED:'true',SESSION_KINDS_ENABLED:'true',SIGNALING_ENABLED:'true'};
/** Every registered document that is a session kind (an intent kind body with a `session` member, AMD-SG-I1). */
const sessionKinds=config=>Object.entries(configuredArtefactDocuments(config)).filter(([,doc])=>{const bodies=Array.isArray(doc?.versions)?doc.versions.map(v=>v.body):[doc];return bodies.some(b=>b&&typeof b==='object'&&Object.hasOwn(b,'session'));}).map(([id])=>id);
test('a default deployment registers no built-in intent kind or session kind',()=>{
 for(const config of [{},{ARTEFACT_VERSIONS_ENABLED:'true'},{ARTEFACT_VERSIONS_ENABLED:'true',EXTENSIONS_ENABLED:'true'}]){
  assert.ok(none(visible(config,intents)),'intent kinds');assert.ok(none(visible(config,retired)),'retired rtc purposes');
  assert.ok(!Reflect.ownKeys(configuredArtefactDocuments(config)).some(key=>[...intents,...retired].some(id=>key.startsWith(id))));
  assert.deepEqual(sessionKinds(config),[]);
 }
});
test('intent kinds follow INTENT_LINKS_ENABLED; core registers no session kind under SIGNALING_ENABLED',()=>{
 const links={ARTEFACT_VERSIONS_ENABLED:'true',INTENT_LINKS_ENABLED:'true'};assert.ok(all(visible(links,intents)));assert.deepEqual(sessionKinds(links),[]);
 assert.ok(none(visible(SIGNALING,intents)),'signaling never registers the messaging intent kinds');assert.ok(none(visible(SIGNALING,retired)),'nor any rtc purpose');
 assert.deepEqual(sessionKinds(SIGNALING),[],'no session kind is registered');
 // What signaling does add is its first-party contract (signaling §10), not a kind.
 const keys=Reflect.ownKeys(configuredArtefactDocuments(SIGNALING));assert.ok(keys.includes(SIGNALING_CONTRACT)&&keys.includes(SIGNALING_CONTRACT+'/envelope'));
 assert.ok(!keys.some(k=>/rtc/.test(k)),'nothing named rtc');
});
test('a flag change on the same config object takes effect at the next lookup',()=>{
 const config={ARTEFACT_VERSIONS_ENABLED:'true'};assert.ok(none(visible(config,intents)));
 config.INTENT_LINKS_ENABLED='true';assert.ok(all(visible(config,intents)));
 config.INTENT_LINKS_ENABLED='false';Object.assign(config,SIGNALING);assert.ok(none(visible(config,intents)));assert.deepEqual(sessionKinds(config),[]);
 assert.ok(Object.hasOwn(configuredArtefactDocuments(config),SIGNALING_CONTRACT),'the signaling flag took effect too');
});
