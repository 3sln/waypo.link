// Simulation network (docs/architecture/simulation-and-sample-apps-spike.md §3.2). Test-only: nothing here is imported
// by production code, and nothing here relaxes a production policy.
//
// - A per-run CA and one leaf certificate whose SANs are every simulation host (openssl, as tests/browser/islands-sw.mjs
//   does), kept in a temporary directory that is removed when the run ends.
// - One HTTPS listener per service on a loopback port, and a name map {host → port}.
// - A CONNECT proxy for browsers: it tunnels only the map's hosts on port 443 (plus the third-party Turnstile stub, see
//   below) and refuses and records everything else, which is also the browser half of the egress check (G3).
// - The server half: `lookup` answers a fixed public sentinel address for map hosts and fails (and records) any other
//   name; `request` checks that the caller's own DNS pin chose that sentinel and port 443, then dials the map's loopback
//   port with the run CA as the only trust anchor and the original name for SNI and certificate checks. Providers get
//   this pair only through their existing injection seams (DIRECTORY_DNS_LOOKUP / DIRECTORY_HTTPS_REQUEST and friends),
//   so their screening (public IPv4 only, DNS pinned into TLS, port 443, no redirects, bounds) runs unchanged.
// - A third-party stand-in for Cloudflare Turnstile (spike §2.6 "mocks only for third-party resources outside Bindle"):
//   the widget script served to browsers at challenges.cloudflare.com and the siteverify answer given to the in-process
//   providers' global fetch. Tokens are single use and bound to the page host and action, as the real service's are.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {createServer as createHTTPSServer,request as httpsRequest} from 'node:https';
import {createServer,connect} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';

const run=promisify(execFile);
/** The public sentinel the DNS seam answers. It is never dialled: `request` replaces it with the loopback port. */
export const SENTINEL='8.8.8.8';
export const TURNSTILE_HOST='challenges.cloudflare.com';

async function makeCertificates(directory,hosts,label){
 const p=name=>join(directory,name);
 await run('openssl',['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:prime256v1','-nodes','-days','2','-subj',`/CN=3sln simulation CA ${label}`,'-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign','-keyout',p('ca.key'),'-out',p('ca.pem')]);
 await run('openssl',['req','-new','-newkey','ec','-pkeyopt','ec_paramgen_curve:prime256v1','-nodes','-subj','/CN=simulation.example','-keyout',p('leaf.key'),'-out',p('leaf.csr')]);
 await writeFile(p('leaf.ext'),`basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=${hosts.map(h=>'DNS:'+h).join(',')}\n`);
 await run('openssl',['x509','-req','-in',p('leaf.csr'),'-CA',p('ca.pem'),'-CAkey',p('ca.key'),'-CAcreateserial','-days','2','-out',p('leaf.pem'),'-extfile',p('leaf.ext')]);
 const [ca,key,cert]=await Promise.all([readFile(p('ca.pem'),'utf8'),readFile(p('leaf.key'),'utf8'),readFile(p('leaf.pem'),'utf8')]);
 return {ca,key,cert:cert+ca};
}

const listen=(server,host='127.0.0.1',port=0)=>new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,host,()=>ok(server.address().port));});
const b64u=value=>Buffer.from(value).toString('base64url');

/** The Turnstile stand-in's widget script: render() calls back with a host- and action-bound one-time token. */
const turnstileScript=`(()=>{const widgets=new Map();let n=0;const b64=s=>btoa(s).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
const issue=w=>{const nonce=crypto.getRandomValues(new Uint8Array(12)).reduce((s,b)=>s+b.toString(16).padStart(2,'0'),'');const token='sim1.'+b64(JSON.stringify({h:location.hostname,a:w.options.action||'',n:nonce}));queueMicrotask(()=>{try{w.options.callback?.(token);}catch{}});};
window.turnstile={render(node,options={}){const id='sim-'+(++n);const w={node,options};widgets.set(id,w);issue(w);return id;},reset(id){const w=widgets.get(id);if(w)issue(w);},remove(id){widgets.delete(id);},getResponse(){return undefined;},execute(id){const w=widgets.get(id);if(w)issue(w);},ready(fn){queueMicrotask(fn);}};
const s=document.currentScript;const p=s&&new URL(s.src).searchParams.get('onload');if(p&&typeof window[p]==='function')queueMicrotask(()=>window[p]());})();`;

export async function createNetwork({hosts,runId='run'}={}){
 const directory=await mkdtemp(join(tmpdir(),'3sln-sim-'));
 const allHosts=[...new Set([...hosts,TURNSTILE_HOST])];
 const tls=await makeCertificates(directory,allHosts,runId);
 const map=new Map(),servers=[],held=new Set(),events=[],violations=[],spentTokens=new Set();
 const record=(kind,detail)=>{const entry={kind,...detail,at:Date.now()};events.push(entry);if(events.length>20000)events.shift();return entry;};
 const violation=(kind,detail)=>{violations.push(record(kind,detail));};

 /** Serves `names` (exact hosts) with `handler(req,res)` over HTTPS on one loopback port. */
 async function serve(names,handler){
  for(const name of names)if(!allHosts.includes(name))throw new Error(`Host ${name} is not in the simulation certificate.`);
  const server=createHTTPSServer({key:tls.key,cert:tls.cert},handler);server.keepAliveTimeout=1000;
  const port=await listen(server);servers.push(server);for(const name of names)map.set(name,port);return {server,port};
 }

 // Turnstile stand-in for browsers (script only; the siteverify half is `turnstileVerify` below).
 await serve([TURNSTILE_HOST],(req,res)=>{
  const url=new URL(req.url,'https://'+TURNSTILE_HOST);
  if(req.method==='GET'&&url.pathname==='/turnstile/v0/api.js'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Cross-Origin-Resource-Policy':'cross-origin'});res.end(turnstileScript);return;}
  res.writeHead(404,{'Content-Type':'text/plain'});res.end('not found');
 });

 // ---- browser side: CONNECT proxy ---------------------------------------------------------------------------------
 // Hosts a browser may try on its own that are not part of the run (component updates, safe browsing). They are refused
 // like every other name, but recorded as `browser-noise` rather than as egress violations.
 const browserNoise=[/(^|\.)googleapis\.com$/,/(^|\.)gvt1\.com$/,/(^|\.)google\.com$/,/(^|\.)gstatic\.com$/,/(^|\.)mozilla\.(com|net|org)$/,/(^|\.)firefox\.com$/,/(^|\.)mozaws\.net$/];
 // Each simulated person browses through their own proxy port, which stands for their own network address: tunnels
 // remember (by the loopback port they dial from) which address they carry, and the HTTPS listeners hand it to the
 // providers in the operator's trusted client-IP header (TRUSTED_CLIENT_IP_HEADER, as a reverse proxy would).
 const tunnelAddress=new Map(),proxies=[];
 function makeProxy(clientIp){return createServer(socket=>{socket.on('error',()=>{});socket.once('data',head=>{
  const text=head.toString('latin1'),match=/^CONNECT ([^ :]+):(\d+) HTTP\/1\.[01]\r\n/.exec(text);
  if(!match){const target=/^[A-Z]+ (\S+)/.exec(text)?.[1]??'?';violation('proxy-refused',{target,reason:'not-connect'});socket.end('HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\n\r\n');return;}
  const [,host,portText]=match,port=map.get(host);
  if(!port||portText!=='443'){const noise=browserNoise.some(re=>re.test(host));(noise?record:violation)(noise?'browser-noise':'proxy-refused',{target:`${host}:${portText}`});socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');return;}
  if(held.has(host)){record('proxy-held',{target:host});socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');return;}
  record('proxy-tunnel',{target:host});
  const upstream=connect(port,'127.0.0.1',()=>{if(clientIp)tunnelAddress.set(upstream.localPort,clientIp);socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');socket.pipe(upstream);upstream.pipe(socket);});
  upstream.on('close',()=>tunnelAddress.delete(upstream.localPort));
  upstream.on('error',()=>socket.destroy());socket.on('close',()=>upstream.destroy());
 });});}
 const proxy=makeProxy(null);proxies.push(proxy);
 const proxyPort=await listen(proxy,process.env.SIM_PROXY_HOST||'127.0.0.1',Number(process.env.SIM_PROXY_PORT??0));
 /** A proxy for one person, carrying `clientIp` as their network address. Returns its http:// URL. */
 async function personProxy(clientIp){const server=makeProxy(clientIp);proxies.push(server);return `http://127.0.0.1:${await listen(server)}`;}
 /** The address a browser connection carries (or null for server-to-server and unproxied traffic). */
 const clientAddress=socket=>tunnelAddress.get(socket.remotePort)??null;

 // ---- server side: DNS and socket seams -----------------------------------------------------------------------------
 /** `lookup(host,{all:true,family:4})` for the providers' injected DNS port. */
 function lookup(host,options){
  if(!map.has(host)||host===TURNSTILE_HOST){violation('dns-refused',{target:host});return Promise.reject(Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`),{code:'ENOTFOUND'}));}
  if(held.has(host)){record('dns-held',{target:host});return Promise.reject(Object.assign(new Error(`getaddrinfo EAI_AGAIN ${host}`),{code:'EAI_AGAIN'}));}
  record('dns',{target:host});
  return Promise.resolve(options?.all===false?{address:SENTINEL,family:4}:[{address:SENTINEL,family:4}]);
 }
 /** `request(options,callback)` with node:https's shape for the providers' injected socket port. */
 function request(options,callback){
  const host=options.hostname??options.host,port=map.get(host);
  // The policy code pins its own resolution into the connection; it must have chosen our sentinel on port 443.
  let pinned=null;try{options.lookup?.(host,{all:false},(error,address)=>{pinned=error?null:address;});}catch{}
  if(!port||Number(options.port??443)!==443||pinned!==SENTINEL||options.protocol&&options.protocol!=='https:'){
   violation('socket-refused',{target:`${host}:${options.port}`,pinned});
   const req=httpsRequest({host:'127.0.0.1',port:1,method:'GET'});queueMicrotask(()=>req.destroy(Object.assign(new Error('ECONNREFUSED'),{code:'ECONNREFUSED'})));return req;
  }
  if(held.has(host)){record('socket-held',{target:host});const req=httpsRequest({host:'127.0.0.1',port:1,method:'GET'});queueMicrotask(()=>req.destroy(Object.assign(new Error('ECONNREFUSED'),{code:'ECONNREFUSED'})));return req;}
  record('socket',{target:host,method:options.method??'GET',path:String(options.path??'/').split('?')[0]});
  const loopback=(_h,o,cb)=>{if(typeof o==='function'){cb=o;o={};}if(o?.all)cb(null,[{address:'127.0.0.1',family:4}]);else cb(null,'127.0.0.1',4);};
  return httpsRequest({...options,port,lookup:loopback,ca:tls.ca,servername:options.servername??host,rejectUnauthorized:true,agent:false},callback);
 }
 /** A WHATWG-style fetch over the same seams, for the simulation's own API actors (never handed to providers).
  * `init.clientIp` gives the request that actor's own address (the providers' trusted client-IP header). */
 async function simFetch(input,init={}){
  const url=new URL(typeof input==='string'?input:input.url),port=map.get(url.hostname);
  if(!port||url.protocol!=='https:'||url.port&&url.port!=='443')throw Object.assign(new Error(`The simulation network has no host ${url.host}.`),{code:'ENOTFOUND'});
  const headers=new Headers(init.headers??{});if(!headers.has('host'))headers.set('host',url.host);
  let body=init.body;if(body instanceof URLSearchParams){body=body.toString();if(!headers.has('content-type'))headers.set('content-type','application/x-www-form-urlencoded');}
  if(typeof body==='string')body=Buffer.from(body);else if(body instanceof Uint8Array)body=Buffer.from(body);else if(body instanceof ArrayBuffer)body=Buffer.from(body);
  return new Promise((resolve,reject)=>{
   const req=httpsRequest({host:'127.0.0.1',port,method:init.method??'GET',path:url.pathname+url.search,servername:url.hostname,ca:tls.ca,rejectUnauthorized:true,agent:false,headers:Object.fromEntries(headers)},res=>{
    const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{const out=new Headers();for(const [k,v]of Object.entries(res.headers)){if(Array.isArray(v))for(const item of v)out.append(k,item);else if(v!==undefined)out.set(k,v);}resolve(new Response([204,304].includes(res.statusCode)?null:Buffer.concat(chunks),{status:res.statusCode,headers:out}));});res.on('error',reject);
   });req.on('error',reject);
   // An API actor's own network address (as a person's proxy carries it): mapped before any request byte is sent.
   if(init.clientIp)req.on('socket',socket=>socket.once('connect',()=>{tunnelAddress.set(socket.localPort,init.clientIp);socket.once('close',()=>tunnelAddress.delete(socket.localPort));}));
   if(init.signal)init.signal.addEventListener('abort',()=>req.destroy(new Error('aborted')),{once:true});req.end(body);
  });
 }

 // ---- Turnstile siteverify stand-in on the process's global fetch ---------------------------------------------------
 // The providers run in this process and call the global fetch only for siteverify. Every other global fetch from the
 // process is refused and recorded (G3): server-to-server traffic must go through the injected seams.
 const originalFetch=globalThis.fetch;
 function turnstileVerify(body){
  let token;try{token=JSON.parse(body).response;}catch{return {success:false,'error-codes':['bad-request']};}
  if(typeof token!=='string'||!token.startsWith('sim1.')||spentTokens.has(token))return {success:false,'error-codes':[spentTokens.has(token)?'timeout-or-duplicate':'invalid-input-response']};
  let claims;try{claims=JSON.parse(Buffer.from(token.slice(5),'base64url').toString('utf8'));}catch{return {success:false,'error-codes':['invalid-input-response']};}
  spentTokens.add(token);record('turnstile-verify',{host:claims.h,action:claims.a});
  return {success:true,hostname:claims.h,action:claims.a,challenge_ts:new Date().toISOString()};
 }
 globalThis.fetch=async(input,init={})=>{
  const url=new URL(typeof input==='string'||input instanceof URL?String(input):input.url);
  if(url.origin==='https://'+TURNSTILE_HOST&&url.pathname==='/turnstile/v0/siteverify'){const body=typeof init.body==='string'?init.body:input instanceof Request?await input.text():'';return Response.json(turnstileVerify(body));}
  violation('global-fetch-refused',{target:url.host});throw Object.assign(new TypeError('fetch failed'),{cause:{code:'ENOTFOUND'}});
 };
 /** A Turnstile token for an API actor (what the widget would hand the page on `host` for `action`). */
 const turnstileToken=(host,action='')=>'sim1.'+b64u(JSON.stringify({h:host,a:action,n:randomBytes(12).toString('hex')}));

 return {
  directory,ca:tls.ca,map,proxyPort,proxyServer:`http://127.0.0.1:${proxyPort}`,events,violations,held,
  serve,lookup,request,fetch:simFetch,turnstileToken,personProxy,clientAddress,
  hold:host=>held.add(host),release:host=>held.delete(host),
  async close(){globalThis.fetch=originalFetch;for(const server of proxies)server.close();for(const server of servers){server.closeAllConnections?.();server.close();}await rm(directory,{recursive:true,force:true});}
 };
}
