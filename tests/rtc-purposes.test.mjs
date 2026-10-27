// RTC-b: the rtc-purpose artefact kind: body rules, growth table, registration and pinning (docs/spec/rtc-signaling.md
// §3.4, §15; artefacts §6.3, §6.4).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SqliteMetadata} from '../apps/node/resources.mjs';
import {verifyChain,versionRecord,versionDigest,DEFAULT_KINDS,validateAdditive} from '../packages/core/artefacts.mjs';
import {configuredArtefacts,configuredArtefactDocuments,registeredArtefact} from '../packages/runtime/artefact-pins.mjs';
import {validatePurpose,purposeAdditive,purposeWidens,validateInviteForPurpose,validateContext,projectContext,purposeDisclosure,purposeReference,registeredPurpose,REGISTERED_PURPOSES,RTC_PURPOSE_REFERENCES,RTC_PURPOSE_KIND,PURPOSE_KINDS} from '../packages/rtc/purposes.mjs';
import {forEachSeed} from './helpers/chaos.mjs';

const clone=structuredClone,files=['call','screen-share','file-transfer','device-sync'];
const documents=await Promise.all(files.map(async name=>JSON.parse(await readFile(new URL(`../docs/artefacts/rtc-purposes/${name}-v1.json`,import.meta.url),'utf8'))));
const body=i=>clone(documents[i].versions[0].body),[CALL,SCREEN,FILES,SYNC]=[0,1,2,3];
const invalid=(edit,from=CALL,label)=>{const b=body(from);edit(b);assert.throws(()=>validatePurpose(b),{code:'rtc_purpose_invalid'},label);};

test('registered purpose envelopes verify, match the bundled snapshots and their pinned digests',async()=>{
 for(const [i,envelope] of documents.entries()){
  assert.equal(envelope.kind,RTC_PURPOSE_KIND);const result=await verifyChain(envelope,{validateBody:b=>{validatePurpose(b);return true;}});
  assert.equal(result.digest,RTC_PURPOSE_REFERENCES[i].digest,envelope.id);assert.equal(result.id,RTC_PURPOSE_REFERENCES[i].artefact);assert.deepEqual(envelope,REGISTERED_PURPOSES[i]);
  assert.equal(await versionDigest(versionRecord({id:envelope.id,kind:RTC_PURPOSE_KIND},envelope.versions[0])),RTC_PURPOSE_REFERENCES[i].digest);
 }
 assert.deepEqual(purposeDisclosure(body(FILES)).context,['bytes','files']);assert.equal(purposeDisclosure(body(SYNC),'es').title,'Sincronizar tus dispositivos');
});

test('body rules (§3.4): exact members, publisher, media, alert, parties, auto_accept, categories and context',()=>{
 for(const b of [0,1,2,3].map(body))validatePurpose(b);
 invalid(b=>{b.extra=1;},CALL,'unknown member');invalid(b=>{delete b.categories;},CALL,'missing member');invalid(b=>{b.publisher='https://other.example';},CALL,'publisher is the origin of id');
 invalid(b=>{b.id='https://spec.bindle.example/rtc-purposes/call/v1?x=1';});invalid(b=>{b.id='http://spec.bindle.example/rtc-purposes/call/v1';});invalid(b=>{b.supersedes='nope';});
 invalid(b=>{b.media=[];});invalid(b=>{b.media=['video','audio'];},CALL,'ascending');invalid(b=>{b.media=['audio','audio'];});invalid(b=>{b.media=['hologram'];});
 invalid(b=>{b.alert='yes';});invalid(b=>{b.alert=false;},CALL,'alert false needs parties self');invalid(b=>{b.parties='everyone';});invalid(b=>{b.auto_accept='always';});
 invalid(b=>{b.auto_accept='self';},CALL,'auto_accept self needs parties self');invalid(b=>{b.auto_accept='self';b.parties='other';});
 invalid(b=>{b.categories=['secret'];});invalid(b=>{b.categories=['public','money'];},CALL,'ascending categories');invalid(b=>{b.categories=['money','money'];});
 invalid(b=>{b.title={fr:'Appel'};},CALL,'title needs en');invalid(b=>{b.title={en:'Call\u202e'};},CALL,'no bidi controls');invalid(b=>{b.summary={en:'x'.repeat(281)};});
 invalid(b=>{b.context={data:{type:'object',properties:{},required:[]}};},CALL,'context has data and disclosure');
 invalid(b=>{b.context.data.properties.link={type:'string',maxLength:200,format:'contact-link'};b.context.disclosure.fields.link={title:{en:'Link'},categories:[],display:'origin'};},FILES,'no contact-link context field');
 invalid(b=>{for(let i=0;i<7;i++){b.context.data.properties['p'+i]={type:'boolean'};b.context.disclosure.fields['p'+i]={title:{en:'P'},categories:[],display:'value'};}},FILES,'at most 8 context properties');
 invalid(b=>{b.context.disclosure.fields.files.title.en='x'.repeat(80);b.context.disclosure.fields.bytes.title={en:'y'.repeat(80),es:'z'.repeat(80),de:'w'.repeat(80),fr:'v'.repeat(80),it:'u'.repeat(80),pt:'t'.repeat(80),nl:'s'.repeat(80),sv:'r'.repeat(80)};b.context.disclosure.categories=Array.from({length:64},(_,i)=>'category-number-'+i);},FILES,'at most 2,048 context bytes');
 invalid(b=>{delete b.context.disclosure.fields.files;},FILES,'every context property is disclosed');invalid(b=>{b.context.data.required=['files','bytes'];},FILES,'required sorted');
 const ok=body(SYNC);ok.supersedes='https://spec.bindle.example/rtc-purposes/sync/v0';validatePurpose(ok);
});

test('growth table: translations and optional disclosed context members only; frozen members never change',()=>{
 const check=(from,edit,wanted)=>{const old=body(from),next=clone(old);edit(next);assert.equal(purposeAdditive(old,next).additive,wanted,JSON.stringify(next).slice(0,120));return next;};
 check(CALL,b=>{b.title.fr='Appel';},true);check(CALL,b=>{b.summary.de='Anrufe';},true);check(FILES,b=>{b.context.disclosure.fields.files.title.fr='Fichiers';},true);
 check(CALL,b=>{b.title.en='Ring';},false);check(CALL,b=>{b.title.ES='x';},false);check(CALL,b=>{b.title.bad_tag='x';},false);
 const grown=check(FILES,b=>{b.context.data.properties.kind={type:'enum',values:['photo','video']};b.context.disclosure.fields.kind={title:{en:'Kind'},categories:[],display:'value'};},true);assert.equal(purposeWidens(body(FILES),grown),true,'added disclosure is a widening');
 assert.equal(purposeWidens(body(CALL),check(CALL,b=>{b.title.fr='Appel';},true)),false);
 check(FILES,b=>{b.context.data.properties.kind={type:'boolean'};},false);check(FILES,b=>{b.context.data.properties.kind={type:'boolean'};b.context.disclosure.fields.kind={title:{en:'K'},categories:[],display:'value'};b.context.data.required.push('kind');},false);
 for(const edit of [b=>{b.media=['audio','data','screen','video'];},b=>{b.alert=false;b.parties='self';},b=>{b.parties='other';},b=>{b.auto_accept='self';b.parties='self';},b=>{b.categories=['money','personal-data'];},b=>{b.context={data:{type:'object',properties:{n:{type:'boolean'}},required:[]},disclosure:{categories:[],fields:{n:{title:{en:'N'},categories:[],display:'value'}}}};},b=>{b.supersedes='https://spec.bindle.example/rtc-purposes/old/v1';},b=>{b.publisher='https://spec.bindle.example';b.extra=1;}])check(CALL,edit,false);
 check(FILES,b=>{b.context.data.properties.files.maximum=32;},false);check(FILES,b=>{b.context.disclosure.fields.files.display='presence';},false);
 // The kind is deliberately unknown to DEFAULT_KINDS until the table is signed (artefacts §6.4).
 assert.equal(Object.hasOwn(DEFAULT_KINDS,RTC_PURPOSE_KIND),false);assert.deepEqual(validateAdditive(RTC_PURPOSE_KIND,body(CALL),body(CALL)),{known:false,additive:null,changes:[]});assert.equal(validateAdditive(RTC_PURPOSE_KIND,body(CALL),body(CALL),{kinds:PURPOSE_KINDS}).additive,true);
});

test('invites against a purpose: media subset, parties and context; projection to an older version',()=>{
 const call=body(CALL),files=body(FILES),sync=body(SYNC),inv=(extra={})=>({media:['audio','video'],context:null,...extra});
 assert.ok(validateInviteForPurpose(inv(),call,{ownEntity:false}));assert.throws(()=>validateInviteForPurpose(inv({media:['screen']}),call,{ownEntity:false}),{code:'rtc_media_not_permitted'});
 assert.throws(()=>validateInviteForPurpose(inv({media:['data']}),sync,{ownEntity:false}),{code:'rtc_parties_not_permitted'},'device-sync is own devices only');assert.ok(validateInviteForPurpose(inv({media:['data']}),sync,{ownEntity:true}));
 assert.throws(()=>validateInviteForPurpose(inv({context:{x:1}}),call,{ownEntity:true}),{code:'rtc_context_invalid'},'no context for a context-free purpose');
 assert.deepEqual(validateContext(files,{files:2,bytes:10}),{files:2,bytes:10});assert.equal(validateContext(files,null),null);
 for(const context of [{files:0,bytes:1},{files:2},{files:2,bytes:1,name:'secret.pdf'},{files:'2',bytes:1},{files:2,bytes:1e13}])assert.throws(()=>validateContext(files,context),{code:'rtc_context_invalid'},JSON.stringify(context));
 const grown=clone(files);grown.context.data.properties.kind={type:'enum',values:['photo']};grown.context.disclosure.fields.kind={title:{en:'Kind'},categories:[],display:'value'};
 assert.deepEqual(projectContext({files:1,bytes:5,kind:'photo'},grown,files),{files:1,bytes:5});assert.equal(projectContext(null,grown,files),null);
 assert.deepEqual(purposeReference({purpose:RTC_PURPOSE_REFERENCES[0].artefact,version:1,digest:RTC_PURPOSE_REFERENCES[0].digest}),{purpose:RTC_PURPOSE_REFERENCES[0].artefact,version:1,digest:RTC_PURPOSE_REFERENCES[0].digest});
 assert.throws(()=>purposeReference({purpose:RTC_PURPOSE_REFERENCES[0].artefact}),{code:'rtc_purpose_invalid'},'latest is not a reference');
});

test('registration and pinning: exact provider-held references pin; latest, junk and invalid bodies do not',async t=>{
 const db=new SqliteMetadata(':memory:'),config={ARTEFACT_VERSIONS_ENABLED:'true'},artefacts=configuredArtefacts({config,store:db});t.after(async()=>{await artefacts.engine.dispose();db.close();});
 for(const ref of RTC_PURPOSE_REFERENCES){assert.ok(registeredArtefact(config,ref.artefact));assert.deepEqual(registeredPurpose(ref.artefact),ref);const pin=await artefacts.pin({...ref,kind:RTC_PURPOSE_KIND});assert.equal(pin.kind,RTC_PURPOSE_KIND);assert.deepEqual(pin.reference,ref);assert.equal(pin.head,0,'unknown kind: the head never advances');
  assert.deepEqual((await artefacts.resolve({...ref,kind:RTC_PURPOSE_KIND})).reference,ref);}
 await assert.rejects(artefacts.pin({artefact:RTC_PURPOSE_REFERENCES[0].artefact,kind:RTC_PURPOSE_KIND}),{code:'artefact_unverifiable'},'URL-only requests never pin an unknown kind');
 await assert.rejects(artefacts.pin({artefact:'https://spec.bindle.example/rtc-purposes/junk/v1',version:1,digest:RTC_PURPOSE_REFERENCES[0].digest,kind:RTC_PURPOSE_KIND}),e=>['artefact_unregistered','artefact_digest_mismatch','artefact_unavailable'].includes(e.code),'an unregistered line never pins');
 await assert.rejects(artefacts.pin({...RTC_PURPOSE_REFERENCES[0],digest:RTC_PURPOSE_REFERENCES[1].digest,kind:RTC_PURPOSE_KIND}),{code:'artefact_digest_mismatch'});
 await assert.rejects(artefacts.pin({...RTC_PURPOSE_REFERENCES[0],kind:'intent'}),{code:'artefact_invalid'},'kind must match');
 assert.equal(registeredPurpose('https://spec.bindle.example/rtc-purposes/junk/v1'),null);
 // An operator-registered envelope whose body is not a valid purpose is refused by the kind validator.
 const bad=body(CALL);bad.auto_accept='self';const id='https://spec.bindle.example/rtc-purposes/bad/v1';bad.id=id;const entry={version:1,prev:null,body:bad},digest=await versionDigest(versionRecord({id,kind:RTC_PURPOSE_KIND},entry));
 const db2=new SqliteMetadata(':memory:'),config2={ARTEFACT_VERSIONS_ENABLED:'true',FEDERATION_SCHEMAS:{[id]:{bindle_artefact:1,id,kind:RTC_PURPOSE_KIND,versions:[entry]}}},a2=configuredArtefacts({config:config2,store:db2});t.after(async()=>{await a2.engine.dispose();db2.close();});
 assert.ok(Object.hasOwn(configuredArtefactDocuments(config2),id));await assert.rejects(a2.pin({artefact:id,version:1,digest,kind:RTC_PURPOSE_KIND}),{code:'artefact_invalid'});
});

test('seeded mutation: any accepted body keeps the cross-member invariants',async()=>{
 const edits=[b=>{b.alert=!b.alert;},b=>{b.parties=['self','other','any'][Math.abs(b.media.length)%3];},b=>{b.auto_accept=b.auto_accept==='self'?'never':'self';},b=>{b.media=b.media.slice(1);},b=>{b.media=[...b.media].reverse();},b=>{b.categories=[];},b=>{b.context=null;},b=>{b.publisher='https://evil.example';}];
 await forEachSeed(80,async random=>{const b=body(random.int(4));for(let i=0,n=1+random.int(3);i<n;i++)random.pick(edits)(b);let v=null;try{v=validatePurpose(b);}catch(e){assert.equal(e.code,'rtc_purpose_invalid');}
  if(v){if(v.alert===false)assert.equal(v.parties,'self');if(v.auto_accept==='self')assert.equal(v.parties,'self');assert.ok(v.media.length>=1);assert.equal(new URL(v.id).origin,v.publisher);}});
});
