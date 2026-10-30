// Notes sample, engine level (apps/samples/notes/web/bl.mjs): switching between two held accounts never mixes their
// notes, while the first sign-in from signed out still merges the device's notes into the account (local-first).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotesEngine,INDEX_KEY,noteKey} from '../apps/samples/notes/web/bl.mjs';

function world(){
 const stores=new Map(),saved={value:null};let current=null;
 const storeFor=key=>{if(!stores.has(key))stores.set(key,new Map());return stores.get(key);};
 const remote={ready:()=>!!current,preferences:async()=>({values:{}}),
  async read(key){const v=storeFor(current).get(key);return v?{version:v.version,value:structuredClone(v.value)}:null;},
  async write(key,value,version){const store=storeFor(current),now=store.get(key);if((now?.version??null)!==(version??null))throw Object.assign(new Error('conflict'),{code:'conflict'});const next=(now?.version??0)+1;store.set(key,{version:next,value:structuredClone(value)});return next;},
  async remove(key){storeFor(current).delete(key);return true;}};
 const local={load:async()=>saved.value,save:async v=>{saved.value=structuredClone(v);}};
 let t=1000,n=0;
 const engine=createNotesEngine({local,remote,grants:{},clock:{now:()=>++t},ids:{next:()=>`id-${++n}`}});
 return {engine,stores,storeFor,use:key=>{current=key;},saved};
}
const titles=(engine)=>engine.read().notes.filter(x=>!x.deleted).map(x=>x.title).sort();
const stored=(w,key)=>Object.keys(w.storeFor(key).get(INDEX_KEY)?.value.notes??{}).map(id=>w.storeFor(key).get(noteKey(id))?.value.title).sort();

test('signing in from signed out merges the device notes into the account',async()=>{
 const w=world();await w.engine.run('load');
 const id=(await w.engine.run('create'))?.id??w.engine.read().notes.at(-1).id;await w.engine.run('edit',{id,title:'Local'});
 w.use('A');await w.engine.run('connected',{issuer:'https://alpha.example',subject:'a',label:'a'});
 assert.deepEqual(stored(w,'A'),['Local']);
});

test('switching accounts parks the outgoing notes and restores the incoming ones without mixing',async()=>{
 const w=world();await w.engine.run('load');
 w.use('A');await w.engine.run('connected',{issuer:'https://alpha.example',subject:'a',label:'a'});
 await w.engine.run('create');await w.engine.run('edit',{id:w.engine.read().notes.at(-1).id,title:'Work plan'});await w.engine.run('sync');
 w.use('B');await w.engine.run('connected',{issuer:'https://alpha.example',subject:'b',label:'b'});
 assert.deepEqual(titles(w.engine),[],'the second account starts without the first account\'s notes');
 assert.deepEqual(stored(w,'B'),[],'nothing of account A was written to account B');
 await w.engine.run('create');await w.engine.run('edit',{id:w.engine.read().notes.at(-1).id,title:'Personal'});await w.engine.run('sync');
 w.use('A');await w.engine.run('connected',{issuer:'https://alpha.example',subject:'a',label:'a'});
 assert.deepEqual(titles(w.engine),['Work plan']);
 assert.deepEqual(stored(w,'A'),['Work plan']);assert.deepEqual(stored(w,'B'),['Personal']);
 assert.ok(w.saved.value.others['https://alpha.example b'],'the parked notes survive a reload');
});
