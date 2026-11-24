import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createPolar} from '@polar-sh/sdk/2026-10';

// Actual maintained SDK -> loopback HTTP, never a vendor. Each operation's
// terminal error must not hide an additional charged wire attempt.
test('pinned merchant SDK sends one wire request on 503, 429 and lost response',async()=>{
 let fault='503';const received=[];
 const server=createServer((request,response)=>{const chunks=[];request.on('data',chunk=>chunks.push(chunk));request.on('end',()=>{received.push({method:request.method,path:request.url,body:Buffer.concat(chunks).toString()});if(fault==='network-loss'){request.socket.destroy();return;}response.writeHead(Number(fault),{'Content-Type':'application/json',...(fault==='429'?{'Retry-After':'0'}:{})});response.end('{"error":"injected_failure"}');});});
 try{server.listen(0,'127.0.0.1');await once(server,'listening');const sdk=createPolar({accessToken:'loopback-fixture-not-a-secret',organizationId:'fixture-org',environment:'sandbox',baseUrl:'http://127.0.0.1:'+server.address().port,timeout:1});
  for(fault of ['503','429','network-loss'])for(const [method,path,invoke] of [
   ['POST','/v1/checkouts/',()=>sdk.checkouts.create({products:['fixture-product'],external_customer_id:'fixture-customer'})],
   ['POST','/v1/customer-sessions/',()=>sdk.customerSessions.create({external_customer_id:'fixture-customer'})],
   ['PATCH','/v1/subscriptions/fixture-subscription',()=>sdk.subscriptions.update('fixture-subscription',{cancel_at_period_end:true})],
   ['GET','/v1/checkouts/fixture-checkout',()=>sdk.checkouts.get('fixture-checkout')]
  ]){const before=received.length;await assert.rejects(invoke());assert.equal(received.length-before,1,fault+' '+method+' must have exactly one wire request');assert.equal(received.at(-1).method,method);assert.equal(received.at(-1).path,path);}
 }finally{server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
