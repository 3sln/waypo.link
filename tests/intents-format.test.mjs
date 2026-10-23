import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeIntent,decodeIntent,parseIntentURL,parseProtocolIntent} from '../packages/intents/format.mjs';
import {validateIntentKind,validateIntentData} from '../packages/intents/schema.mjs';
import {projectIntent} from '../packages/intents/project.mjs';
const kind={artefact:'https://spec.bindle.example/intents/test/v1',version:1,digest:'sha256-'+ 'A'.repeat(43)},intent={bintent:1,kind,data:{name:'hello'}};
const body={id:kind.artefact,title:{en:'Test'},summary:{en:'Shows this text'},publisher:'https://spec.bindle.example',effect:'view',capability:false,data:{type:'object',properties:{name:{type:'string',maxLength:120}},required:['name']},disclosure:{categories:[],fields:{name:{title:{en:'Name'},categories:[],display:'value'}}}};
const raw=s=>Buffer.from(s).toString('base64url'),bad=fn=>assert.throws(fn,e=>e.code==='intent_malformed');
test('intent canonical round trip, both placements and exactly once protocol substitution',()=>{
 const value=encodeIntent(intent);assert.deepEqual(decodeIntent(value),intent);for(const [url,placement]of [[`https://host.example/i?unrelated=x&bintent=${value}`,'query'],[`https://host.example/i#bintent=${value}`,'fragment']])assert.deepEqual(parseIntentURL(url),{intent,value,placement});
 assert.deepEqual(parseProtocolIntent(encodeURIComponent(`web+bindle://intent?bintent=${value}`)),{intent,value,placement:'scheme'});bad(()=>parseProtocolIntent(encodeURIComponent(encodeURIComponent(`web+bindle://intent?bintent=${value}`))));
 for(const suffix of ['&x=1','#x','/'])bad(()=>parseProtocolIntent(encodeURIComponent(`web+bindle://intent?bintent=${value}${suffix}`)));
});
test('noncanonical JSON, integer lexemes, duplicate and unknown members and unsafe unicode refused',()=>{
 const text=Buffer.from(encodeIntent(intent),'base64url').toString();for(const value of [' '+text,JSON.stringify(intent),text.replace('hello','\\u0068ello'),text.replace('"bintent":1','"bintent":1.0'),text.replace('"bintent":1','"bintent":1e0'),text.replace('"bintent":1','"bintent":-0'),text.replace('"hello"','"hello","name":"other"'),text.replace('"hello"','"\\ud800"'),text.replace('"hello"','"\\uffff"')])bad(()=>decodeIntent(raw(value)));
 for(const extra of [{minter:{iss:'https://bad.example',sub:'x'}},{unknown:true}])bad(()=>encodeIntent({...intent,...extra}));for(const key of ['version','digest']){const copy=structuredClone(intent);delete copy.kind[key];bad(()=>encodeIntent(copy));}
});
test('raw URL names, mixing, padding, percent encoding and bounds fail closed',()=>{
 const v=encodeIntent(intent);for(const query of [`Bintent=${v}`,`%62intent=${v}`,`bintent=${v}&bintent=${v}`,`bintent=${v}&bindle_meta=x`,`bintent=${v}&s%69g=x`,`bintent=${v}=`,`bintent=${v}%20`,`bintent=${v}+`,`bintent=${v}#bintent=${v}`])bad(()=>parseIntentURL('https://host.example/i?'+query));
 bad(()=>decodeIntent('A'.repeat(6401)));bad(()=>parseIntentURL('https://host.example/'+ 'x'.repeat(8192)));bad(()=>encodeIntent({...intent,data:{x:'x'.repeat(4480)}}));bad(()=>encodeIntent({...intent,data:{x:1.5}}));bad(()=>encodeIntent({...intent,data:{x:-0}}));
 assert.throws(()=>decodeIntent(encodeIntent({...intent,exp:4000000000}),{now:4000000000}),e=>e.code==='intent_expired');
});
test('signed wire shape gives no unverified attribution',()=>{
 const signed={...intent,iat:1,minter:{iss:'https://sender.example',sub:'00000000-0000-0000-0000-000000000001'}},head={alg:'ES256',kid:'https://sender.example/key',typ:'bindle-intent+jwt'},value=raw(JSON.stringify(head))+'.'+raw(JSON.stringify(signed))+'.'+Buffer.alloc(64).toString('base64url');assert.deepEqual(decodeIntent(value),intent);bad(()=>decodeIntent(value.replace(raw(JSON.stringify(head)),raw(JSON.stringify({...head,typ:'JWT'})))));
});
test('kind and data strict validation, display controls and capability invariants',()=>{
 assert.deepEqual(validateIntentKind(body),body);assert.deepEqual(validateIntentData(body,intent.data),intent.data);
 for(const data of [{},{name:'x',unknown:1},{name:'\u202ehello'},{name:'x'.repeat(121)},JSON.parse('{"name":"hello","toString":{"iss":"https://host.example","sub":"00000000-0000-0000-0000-000000000001"}}')])bad(()=>validateIntentData(body,data));
 const invalid=[];let x=structuredClone(body);x.publisher='https://evil.example';invalid.push(x);x=structuredClone(body);x.data.properties.name.format='contact-link';invalid.push(x);x=structuredClone(body);x.disclosure.fields.name.display='origin';invalid.push(x);x=structuredClone(body);x.data.required=['name','name'];invalid.push(x);for(const b of invalid)assert.throws(()=>validateIntentKind(b),e=>e.code==='intent_kind_invalid');
});
test('projection needs verified additivity and drops undefined members and attribution',()=>{
 const newer=structuredClone(body);newer.data.properties.extra={type:'boolean'};newer.disclosure.fields.extra={title:{en:'Extra'},categories:[],display:'value'};
 const incoming={...intent,data:{...intent.data,extra:true},iat:1,minter:{iss:'https://sender.example',sub:'claim'}};assert.throws(()=>projectIntent(incoming,newer,body),e=>e.code==='intent_kind_invalid');assert.deepEqual(projectIntent(incoming,newer,body,{additive:true,reference:kind}),intent);
});
test('seeded bounded byte mutation never leaks parser exceptions',()=>{let seed=1009;const value=encodeIntent(intent);for(let i=0;i<500;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const position=seed%value.length,mutated=value.slice(0,position)+'!'+value.slice(position+1);bad(()=>decodeIntent(mutated));}});
test('exact data byte and depth bounds and all declarative field types',()=>{
 const at={...intent,data:{x:'x'.repeat(4472)}},signed={...at,iat:1,minter:{iss:'https://sender.example',sub:'00000000-0000-0000-0000-000000000001'}},head=raw(JSON.stringify({alg:'ES256',kid:'key',typ:'bindle-intent+jwt'})),wire=v=>head+'.'+raw(JSON.stringify(v))+'.'+Buffer.alloc(64).toString('base64url');assert.equal(Buffer.byteLength(JSON.stringify(at.data)),4480);assert.deepEqual(decodeIntent(wire(signed)),at);bad(()=>decodeIntent(wire({...signed,data:{x:'x'.repeat(4473)}})));
 let data='x';for(let i=0;i<9;i++)data={x:data};bad(()=>encodeIntent({...intent,data}));
 for(const [field,good,wrong]of [[{type:'integer',minimum:-2,maximum:2},-2,3],[{type:'boolean'},true,'true'],[{type:'enum',values:['a']},'a','b'],[{type:'principal'},{iss:'https://host.example',sub:'00000000-0000-0000-0000-000000000001'},{iss:'https://host.example/path',sub:'00000000-0000-0000-0000-000000000001'}],[{type:'string',maxLength:100,format:'https-url'},'https://host.example/path','https://host.example/path#secret'],[{type:'string',maxLength:100,format:'uuid'},'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000A'],[{type:'string',maxLength:100,format:'handle'},'alice@host.example','alice@HOST.example']]){
  const b=structuredClone(body);b.data.properties.name=field;b.disclosure.fields.name.display='presence';assert.deepEqual(validateIntentData(b,{name:good}),{name:good});bad(()=>validateIntentData(b,{name:wrong}));
 }
 const b=structuredClone(body);b.data.properties.name.maxLength=2;assert.deepEqual(validateIntentData(b,{name:'😀😀'}),{name:'😀😀'});bad(()=>validateIntentData(b,{name:'😀😀😀'}));
});
