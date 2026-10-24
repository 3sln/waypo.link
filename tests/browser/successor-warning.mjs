// Wargame F7 (DEVLOG 2026-10-23): the successor review page shows the "old provider still serves this identity"
// warning for exactly the pending rows the engine marked, and acknowledgeSourceActive is sent only for such a row,
// only after its warning was rendered and acknowledged.
import test from 'node:test';import assert from 'node:assert/strict';
import {Engine,Provider} from '../../vendor/ngin/index.js';
import {createTransferPort,TransferIntent} from '../../apps/web/src/bl/transfer-flow.mjs';
import render from '../../apps/web/src/ui/transfer-page.mjs';
const SUB='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ISS='https://old.example',ORIGIN='https://home.example';
const find=(n,p,out=[])=>{if(!n||typeof n!=='object')return out;if(p(n))out.push(n);for(const v of Object.values(n))find(v,p,out);return out;};
const text=n=>JSON.stringify(n);
function fixture({pending,adopt=()=>({outcome:'adopted'})}){
 const calls=[],win={history:{replaceState(){}},location:{assign(){}}};win.top=win;let rows=pending;
 const api={setContext(){},get:async path=>{calls.push({path});if(path==='/api/session')return {authenticated:true,account:{id:SUB}};return {origin:{iss:ISS,sub:SUB},pending:structuredClone(rows)};},request:async(path,input)=>{calls.push({path,input});const out=adopt(input);if(out?.outcome==='confirmation-required')rows=rows.map(r=>r.digest===input.digest?{...r,oldHostServing:true}:r);return out;}};
 const port=createTransferPort({mode:'successor',api,location:new URL(ORIGIN+'/account/successors#iss='+encodeURIComponent(ISS)+'&sub='+SUB),window:win,document:{querySelectorAll:()=>[]},recovery:{cancel(){}}}),engine=new Engine({providers:{transfer:Provider.fromSingleton(port)}});
 return {port,engine,calls,adopts:()=>calls.filter(c=>c.path==='/api/account/successors/adopt'),act:async(action,input)=>{await engine.dispatch(new TransferIntent(action,input)).next('complete');},page:()=>render(port.snapshot(),{dispatch(){}})};
}
const serving={digest:'d-serving',seq:1,reason:'unattested',oldProviderConfirmed:false,oldHost:ISS,newHost:'https://new.example',oldHostServing:true};
const quiet={digest:'d-quiet',seq:1,reason:'unattested',oldProviderConfirmed:false,oldHost:ISS,newHost:'https://other.example',oldHostServing:false};

test('the source-active warning and its acknowledgement render only for rows the engine marked as still served',async t=>{
 const f=fixture({pending:[serving,quiet]});t.after(()=>f.engine.dispose());await f.act('load');
 const articles=find(f.page(),n=>n.tag==='article');assert.equal(articles.length,2);
 const [a,b]=articles;assert.match(text(a),/source-active/);assert.match(text(a),/acknowledgeSourceActive/);
 assert.doesNotMatch(text(b),/source-active/);assert.doesNotMatch(text(b),/acknowledgeSourceActive/);
});

test('submitting the rendered form sends acknowledgeSourceActive only when the warning checkbox was ticked',async t=>{
 const sent=[];const f=fixture({pending:[serving,quiet]});t.after(()=>f.engine.dispose());await f.act('load');
 const page=render(f.port.snapshot(),{dispatch:(action,input)=>sent.push({action,input})});
 const forms=find(page,n=>n.tag==='form');assert.equal(forms.length,2);
 const submit=(form,elements)=>form.hooks.submit({preventDefault(){},currentTarget:{checkValidity:()=>true,elements}});
 submit(forms[0],{confirm:{checked:true},acknowledgeSourceActive:{checked:false}});
 submit(forms[0],{confirm:{checked:true},acknowledgeSourceActive:{checked:true}});
 submit(forms[1],{confirm:{checked:true}});
 assert.deepEqual(sent.map(s=>s.input),[{id:'d-serving',confirm:true,acknowledgeSourceActive:false},{id:'d-serving',confirm:true,acknowledgeSourceActive:true},{id:'d-quiet',confirm:true}]);
});

test('adopt refuses a still-served row without the acknowledgement and never sends the flag for an unmarked row',async t=>{
 const f=fixture({pending:[serving,quiet]});t.after(()=>f.engine.dispose());await f.act('load');
 await f.act('adopt',{id:'d-serving',confirm:true});
 assert.equal(f.port.snapshot().error,'source_active_confirmation_required');assert.equal(f.adopts().length,0,'no request without the acknowledgement');
 await f.act('adopt',{id:'d-quiet',confirm:true,acknowledgeSourceActive:true});
 assert.equal(f.adopts().length,1);assert.equal(Object.hasOwn(f.adopts()[0].input,'acknowledgeSourceActive'),false,'an unmarked row never acknowledges a warning it did not show');
 await f.act('adopt',{id:'d-serving',confirm:true,acknowledgeSourceActive:true});
 assert.equal(f.adopts()[1].input.acknowledgeSourceActive,true);
 await f.act('adopt',{id:'unknown',confirm:true,acknowledgeSourceActive:true});
 assert.equal(f.port.snapshot().error,'not_found');assert.equal(f.adopts().length,2);
});

test('when the engine finds the old host serving at confirm time, the page re-reads and shows the warning before any acknowledgement',async t=>{
 const f=fixture({pending:[quiet],adopt:input=>input.acknowledgeSourceActive===true?{outcome:'adopted'}:{outcome:'confirmation-required',reason:'source-active'}});t.after(()=>f.engine.dispose());await f.act('load');
 assert.doesNotMatch(text(f.page()),/source-active/);
 await f.act('adopt',{id:'d-quiet',confirm:true});
 assert.equal(f.adopts().length,1);assert.equal(f.adopts()[0].input.acknowledgeSourceActive,undefined);
 assert.equal(f.port.snapshot().error,'source_active_confirmation_required');assert.match(text(f.page()),/source-active/);
 await f.act('adopt',{id:'d-quiet',confirm:true,acknowledgeSourceActive:true});
 assert.equal(f.adopts()[1].input.acknowledgeSourceActive,true);
});
