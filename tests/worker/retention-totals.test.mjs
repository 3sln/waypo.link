import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,Log,LogLevel,convertV4MiniflareOptions} from 'miniflare';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const source=`
import {DurableObject} from 'cloudflare:workers';
import {AccountItemIndex} from './packages/runtime/item-index.mjs';
export class Probe extends DurableObject {
 async run(size){
  const sql=this.ctx.storage.sql,index=new AccountItemIndex(sql);
  this.ctx.storage.transactionSync(()=>{for(let i=0;i<size;i++)sql.exec('INSERT INTO inbox_catalog VALUES(?,?,?,?,?,?,?)','m'+i,'owner',i,'c'+i%5,1,0,JSON.stringify({size:1}));});
  let rows=0,bytes=0;index.sql={exec:(q,...args)=>{const cursor=sql.exec(q,...args),result=[...cursor];rows+=cursor.rowsRead;bytes+=new TextEncoder().encode(JSON.stringify(result)).length;return result;}};
  const totals=index.unitBytes('owner');return {rows,bytes,totals};
 }
}
export default {async fetch(request,env){const size=Number(new URL(request.url).pathname.slice(1));return Response.json(await env.PROBE.get(env.PROBE.idFromName(String(size))).run(size));}};`;
test('workerd retention SQL totals have flat actual rowsRead at 100 and 10000 messages',{timeout:90000},async t=>{
 const temporary=await mkdtemp(path.join(tmpdir(),'retention-totals-worker-'));t.after(()=>rm(temporary,{recursive:true,force:true}));const out=path.join(temporary,'probe.mjs');
 await build({stdin:{contents:source,resolveDir:process.cwd(),sourcefile:'retention-totals-probe.mjs'},outfile:out,bundle:true,format:'esm',platform:'browser',conditions:['workerd','worker','browser'],external:['cloudflare:workers','node:*'],target:'es2022',logLevel:'silent'});
 const mf=new Miniflare(convertV4MiniflareOptions({name:'retention-totals-probe',modulesRoot:temporary,modules:[{type:'ESModule',path:out}],compatibilityDate:'2026-10-11',compatibilityFlags:['nodejs_compat'],log:new Log(LogLevel.ERROR),durableObjects:{PROBE:{className:'Probe',useSQLite:true}}}));t.after(()=>mf.dispose());const results=[];
 for(const n of [100,10000]){const response=await mf.dispatchFetch('https://totals.example/'+n);assert.equal(response.status,200,await response.clone().text());const r=await response.json();assert.equal(Object.values(r.totals.collections).reduce((a,b)=>a+b,0),n);results.push(r);}
 assert.equal(results[0].rows,results[1].rows);assert.ok(results[1].rows<=10);assert.ok(results[1].bytes<=results[0].bytes+20);
});
