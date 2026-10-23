import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateAdditive,verifyChain} from '../packages/core/artefacts.mjs';
import {validateIntentKind} from '../packages/intents/schema.mjs';
const clone=structuredClone;
const documents=await Promise.all(['send-message','add-contact','open-conversation'].map(async name=>JSON.parse(await readFile(new URL(`../docs/artefacts/intents/${name}-v1.json`,import.meta.url),'utf8'))));
const body=()=>clone(documents[0].versions[0].body),check=(old,edit,wanted=true)=>{const next=clone(old);edit(next);assert.equal(validateAdditive('intent',old,next).additive,wanted);return next;};
test('registered intent envelopes have valid schema and verified chains',async()=>{for(const envelope of documents){assert.equal(envelope.kind,'intent');const result=await verifyChain(envelope,{validateBody:validateIntentKind});assert.equal(result.body.id,envelope.id);assert.equal(result.version,1);}});
test('intent growth pairs new optional fields with disclosures, preserving frozen consent',()=>{
 const old=body(),add=b=>{b.data.properties.note={type:'string',maxLength:120};b.disclosure.fields.note={title:{en:'Note'},categories:['personal-data'],display:'value'};};
 check(old,add);check(old,b=>{b.data.properties.note={type:'boolean'};},false);check(old,b=>{b.disclosure.fields.note={title:{en:'Note'},categories:[],display:'presence'};},false);check(old,b=>{add(b);b.data.required.push('note');},false);
 for(const edit of [b=>{b.effect='view';},b=>{b.capability=false;},b=>{b.max_bytes=100;},b=>b.disclosure.categories.push('personal-data'),b=>{b.data.properties.contact.maxLength=4000;},b=>{b.disclosure.fields.contact.display='value';},b=>{delete b.data.properties.contact;},b=>{b.data.required=[];}])check(old,edit,false);
 const plain=clone(documents[2].versions[0].body);check(plain,b=>{b.data.properties.contact={type:'string',maxLength:4352,format:'contact-link'};b.disclosure.fields.contact={title:{en:'Contact'},categories:[],display:'origin'};},false);
});
test('intent translations only add valid new language tags and cannot rewrite text',()=>{
 for(const path of [b=>b.title,b=>b.summary,b=>b.disclosure.fields.contact.title]){check(body(),b=>{path(b).es='Texto';});for(const edit of [b=>{path(b).en='Changed';},b=>{path(b).bad_tag='Text';},b=>{path(b).EN='Text';},b=>{path(b).es='\u202e';}])check(body(),edit,false);}
});
test('intent enum additions require original extensibility and unique valid values',()=>{
 const old=body();old.data.properties.mode={type:'enum',values:['one'],extensible:true};old.disclosure.fields.mode={title:{en:'Mode'},categories:[],display:'value'};
 check(old,b=>b.data.properties.mode.values.push('two'));for(const value of ['one',7])check(old,b=>b.data.properties.mode.values.push(value),false);check(old,b=>b.data.properties.mode.values.push('two','two'),false);
 const frozen=clone(old);frozen.data.properties.mode.extensible=false;check(frozen,b=>b.data.properties.mode.values.push('two'),false);check(frozen,b=>{b.data.properties.mode.extensible=true;b.data.properties.mode.values.push('two');},false);
});
