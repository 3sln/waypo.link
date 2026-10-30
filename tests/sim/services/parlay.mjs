// Parlay (apps/parlay) in the simulation world at https://messages.example: the real Node shell (createNodeShell with
// its own SQLite directory per run, assets from .output/parlay-public built by `npm run build:assets`), mounted on the
// simulation network. Its trusted ports come from tests/sim/parlay-adapter.mjs (see there for what is real and what
// is a recorded stand-in).
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createNodeShell} from '../../../apps/parlay/node/server.mjs';
import {httpError} from '../../../apps/parlay/worker/http.mjs';
import {createParlayAdapter,PARLAY_ORIGIN,PARLAY_CLIENT_ID,PARLAY_INGRESS} from '../parlay-adapter.mjs';

const REPO=fileURLToPath(new URL('../../..',import.meta.url));
const state={adapter:null};
const readBody=req=>new Promise((ok,fail)=>{const chunks=[];let size=0;req.on('data',c=>{size+=c.length;if(size>8*1024*1024){fail(new Error('too large'));req.destroy();}else chunks.push(c);});req.on('end',()=>ok(Buffer.concat(chunks)));req.on('error',fail);});

export default {
 name:'parlay',
 hosts:['messages.example'],
 appOrigins:[PARLAY_ORIGIN],
 /**
  * KEY_DELEGATION_ENABLED on (the `sim` profile keeps it off): Parlay's invitations, receipts and conversation
  * envelopes are signed by an app-held delegate key that the person's provider certifies (key-delegation.v1), and
  * receivers check the delegation status route. Without it no invitation can be created or checked.
  * DELEGATION_SLOT_OCCUPANT: the provider's documented occupant port, answered for people who enrolled in Parlay,
  * because Parlay cannot install through provider consent yet (expected-pending `parlay.installs-through-consent`).
  */
 providerConfig:()=>({KEY_DELEGATION_ENABLED:'true',DELEGATION_SLOT_OCCUPANT:async query=>state.adapter?.occupant(query)??null}),
 async start(network,{providers,log}){
  const directory=await mkdtemp(join(tmpdir(),'3sln-sim-parlay-'));
  const adapter=createParlayAdapter({network,providers:()=>providers});await adapter.init();state.adapter=adapter;
  let shell;
  try{
   shell=await createNodeShell({directory,PARLAY_ENABLED:true,INTENT_LINKS_ENABLED:true,services:adapter.services,egress:adapter.egress,
    secret:randomBytes(32).toString('base64url'),clientId:PARLAY_CLIENT_ID,assetsDirectory:resolve(REPO,'.output/parlay-public'),
    trustedClientIpHeader:'x-sim-client-ip'});
  }catch(error){await rm(directory,{recursive:true,force:true});throw error;}
  await network.serve(['messages.example'],async(req,res)=>{
   const started=Date.now(),path=String(req.url).split('?')[0];
   res.once('finish',()=>log({method:req.method,path,status:res.statusCode,ms:Date.now()-started}));
   try{
    delete req.headers['x-sim-client-ip'];const address=network.clientAddress(req.socket);if(address)req.headers['x-sim-client-ip']=address;
    const body=['GET','HEAD'].includes(req.method)?undefined:await readBody(req);
    const headers=new Headers();for(const [k,v] of Object.entries(req.headers))if(!k.startsWith(':'))headers.set(k,Array.isArray(v)?v.join(', '):v);
    const response=await shell.fetch(new Request(new URL(req.url,PARLAY_ORIGIN),{method:req.method,headers,body}),{remoteAddress:req.socket.remoteAddress});
    const out={};response.headers.forEach((v,k)=>{out[k]=v;});res.writeHead(response.status,out);
    res.end(response.body&&req.method!=='HEAD'?Buffer.from(await response.arrayBuffer()):undefined);
   }catch(error){const response=httpError(error);const out={};response.headers.forEach((v,k)=>{out[k]=v;});if(!res.headersSent)res.writeHead(response.status,out);res.end(await response.text());}
  });
  return {origin:PARLAY_ORIGIN,ingress:PARLAY_INGRESS,shell,adapter,
   /**
    * What Parlay's (missing) installation would do for one person: record the connection, configure the mailbox for
    * the person's principal and its ingress, and acquire the first delegate certificate from their provider.
    * Returns the person's app credential for Parlay's sign-in form.
    */
   async enrol({issuer,subject}){
    const credential=adapter.enrol({issuer,subject});
    await shell.provision(subject,{receive:{principal:{issuer,subject,identityURI:`${issuer}/identity/${subject}`},ingress:PARLAY_INGRESS},authorization:{revision:1,active:true,recipients:[]}});
    const mailbox=await shell.mailbox(subject);await mailbox.run(subject,'shell.delegation-renew',{});
    return credential;
   },
   describe:()=>({origin:PARLAY_ORIGIN,shell:'apps/parlay/node/server.mjs createNodeShell, in process (PARLAY_ENABLED, INTENT_LINKS_ENABLED)',ports:'tests/sim/parlay-adapter.mjs',providerConfig:['KEY_DELEGATION_ENABLED=true','DELEGATION_SLOT_OCCUPANT (port)']}),
   async close(){state.adapter=null;await shell.close().catch(()=>{});await rm(directory,{recursive:true,force:true});}};
 }
};
