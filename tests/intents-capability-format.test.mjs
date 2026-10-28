// The generic `capability` string format (contacts-and-links spike §4.2, CR-I2, CR-C0; provisional, unsigned): a bearer
// secret that forces `capability: true`, is displayed only by `presence` or `origin`, and is bounded by its own maxLength.
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateIntentKind,validateIntentData} from '../packages/intents/schema.mjs';
import {intentDisclosure} from '../packages/intents/router.mjs';

const kind=({format='capability',maxLength=512,display='presence',capability=true}={})=>({id:'https://spec.bindle.example/intents/capability-test/v1',title:{en:'Test'},summary:{en:'Carries a secret'},publisher:'https://spec.bindle.example',effect:'join',capability,data:{type:'object',properties:{token:{type:'string',maxLength,format}},required:['token']},disclosure:{categories:[],fields:{token:{title:{en:'Invitation'},categories:[],display}}}});
const kindInvalid=body=>assert.throws(()=>validateIntentKind(body),e=>e.code==='intent_kind_invalid');
const dataInvalid=(body,data)=>assert.throws(()=>validateIntentData(body,data),e=>e.code==='intent_malformed');

test('kind: capability forces capability:true and presence or origin display',()=>{
 for(const display of ['presence','origin'])assert.ok(validateIntentKind(kind({display})));
 kindInvalid(kind({capability:false}));kindInvalid(kind({display:'value'}));kindInvalid(kind({display:'value',maxLength:64}));
 kindInvalid(kind({format:'secret'}));
 // The field's own bound, inside the string field limits.
 assert.ok(validateIntentKind(kind({maxLength:1})));assert.ok(validateIntentKind(kind({maxLength:4352})));kindInvalid(kind({maxLength:0}));kindInvalid(kind({maxLength:4353}));
});

test('data: any string within maxLength; under origin display only an https-url value shows its origin',()=>{
 for(const display of ['presence','origin']){
  const body=validateIntentKind(kind({maxLength:32,display}));
  for(const token of ['opaque-secret','x','a b c','https://host.example/invite','x'.repeat(32)])assert.deepEqual(validateIntentData(body,{token}),{token});
  for(const data of [{token:'x'.repeat(33)},{token:7},{token:'\ud800'},{},{token:'x',extra:'y'}])dataInvalid(body,data);
 }
 const origin=validateIntentKind(kind({display:'origin'})),presence=validateIntentKind(kind());
 assert.deepEqual(intentDisclosure(origin,{token:'https://host.example/invite/abc'}),{token:'https://host.example'});
 for(const token of ['opaque-secret','http://host.example/invite','https://host.example/invite#frag','https://user@host.example/x'])assert.deepEqual(intentDisclosure(origin,{token}),{token:true},token);
 assert.deepEqual(intentDisclosure(presence,{token:'https://host.example/invite/abc'}),{token:true});
});

test('contact-link keeps its own rules until CR-C3 removes it',()=>{
 assert.ok(validateIntentKind(kind({format:'contact-link',maxLength:4352,display:'origin'})));
 kindInvalid(kind({format:'contact-link',capability:false}));
});
