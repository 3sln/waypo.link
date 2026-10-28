// Cleanup audit 2026-10-27 (item 3): the messaging intent kinds and the rtc-purpose lines are operator-pinned only
// behind the flags of the features that use them, so a default deployment registers none of them.
import test from 'node:test';import assert from 'node:assert/strict';
import {configuredArtefactDocuments,registeredArtefact} from '../../packages/runtime/artefact-pins.mjs';
import {REGISTERED_INTENT_REFERENCES} from '../../packages/intents/registered.mjs';
import {RTC_PURPOSE_REFERENCES} from '../../packages/rtc/purposes.mjs';
const intents=REGISTERED_INTENT_REFERENCES.map(r=>r.artefact),purposes=RTC_PURPOSE_REFERENCES.map(r=>r.artefact);
const visible=(config,ids)=>ids.map(id=>[registeredArtefact(config,id),Object.hasOwn(configuredArtefactDocuments(config),id),Object.hasOwn(configuredArtefactDocuments(config),id+'/envelope')].every(Boolean));
const none=list=>list.every(v=>v===false),all=list=>list.every(v=>v===true);
test('a default deployment registers no built-in intent kind or rtc purpose',()=>{
 for(const config of [{},{ARTEFACT_VERSIONS_ENABLED:'true'},{ARTEFACT_VERSIONS_ENABLED:'true',EXTENSIONS_ENABLED:'true'}]){
  assert.ok(none(visible(config,intents)),'intent kinds');assert.ok(none(visible(config,purposes)),'rtc purposes');
  assert.ok(!Reflect.ownKeys(configuredArtefactDocuments(config)).some(key=>[...intents,...purposes].some(id=>key.startsWith(id))));
 }
});
test('intent kinds follow INTENT_LINKS_ENABLED; rtc purposes follow RTC_SIGNALING_ENABLED',()=>{
 const links={ARTEFACT_VERSIONS_ENABLED:'true',INTENT_LINKS_ENABLED:'true'};assert.ok(all(visible(links,intents)));assert.ok(none(visible(links,purposes)));
 const rtc={RTC_SIGNALING_ENABLED:'true'};assert.ok(all(visible(rtc,purposes)));assert.ok(none(visible(rtc,intents)));
});
test('a flag change on the same config object takes effect at the next lookup',()=>{
 const config={ARTEFACT_VERSIONS_ENABLED:'true'};assert.ok(none(visible(config,intents)));
 config.INTENT_LINKS_ENABLED='true';assert.ok(all(visible(config,intents)));
 config.INTENT_LINKS_ENABLED='false';config.RTC_SIGNALING_ENABLED='true';assert.ok(none(visible(config,intents)));assert.ok(all(visible(config,purposes)));
});
