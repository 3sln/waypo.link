// Sample app server skeleton (sample-only code; not a product, not part of the SDK). One request handler per sample:
// static files from an allowlist of repository directories (the sample's own web/, this kit's web/, and the public
// SDK and stack sources it imports, served at their repository paths so relative imports resolve unchanged), the
// OAuth client-id metadata document at /bindle/client.json, and the sample's single-page routes. No cookies, no
// server-side sessions: the samples are browser apps; only Bindle providers hold accounts.
import {readFile,stat} from 'node:fs/promises';
import {resolve,normalize,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const REPO=resolve(fileURLToPath(new URL('../../..',import.meta.url)));
const TYPES={'.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.ico':'image/x-icon','.txt':'text/plain; charset=utf-8'};
/** Directories served at their repository paths. Everything else is 404. */
const SHARED=['packages/sdk/src','packages/i18n','packages/core','vendor/dodo','vendor/ngin','apps/samples/kit/web'];

export function securityHeaders({frameAncestors="'none'"}={}){
 return {'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Opener-Policy':'same-origin-allow-popups','Permissions-Policy':'camera=(), microphone=(), geolocation=()',
  // Providers are discovered at run time, so connect-src and frame-src allow any HTTPS origin (docs/integration.md CSP).
  'Content-Security-Policy':`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self' https:; frame-src https:; form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors ${frameAncestors}`};
}

/**
 * @param {object} options
 * @param {string} options.origin  the sample's https origin (an .example host)
 * @param {string} options.web     repository-relative directory of the sample's web files
 * @param {(origin:string)=>object} options.metadata  client-id metadata document builder
 * @param {string[]} options.pages  app routes answered with web/index.html (the SPA shell)
 * @param {(req,res,url)=>Promise<boolean>|boolean} [options.api] the sample's own endpoints, if it genuinely needs any
 * @param {(entry:object)=>void} [options.log]
 */
export function createAppServer({origin,web,metadata,pages=['/'],api,log=()=>{}}){
 const roots=[...SHARED,web].map(dir=>({prefix:'/'+dir+'/',path:resolve(REPO,dir)}));
 const shell=resolve(REPO,web,'index.html');
 const send=(res,status,headers,body)=>{res.writeHead(status,{...securityHeaders(),...headers});res.end(body);};
 return async function handle(req,res){
  const started=Date.now();let url;
  try{url=new URL(req.url,origin);}catch{return send(res,400,{'Content-Type':'text/plain'},'bad request');}
  res.once('finish',()=>log({method:req.method,path:url.pathname,status:res.statusCode,ms:Date.now()-started}));
  try{
   if(req.headers.host!==new URL(origin).host)return send(res,421,{'Content-Type':'text/plain'},'misdirected');
   if(api&&await api(req,res,url))return;
   if(!['GET','HEAD'].includes(req.method))return send(res,405,{Allow:'GET, HEAD','Content-Type':'text/plain'},'method not allowed');
   if(url.pathname==='/bindle/client.json')return send(res,200,{'Content-Type':'application/json','Cache-Control':'public, max-age=3600','Access-Control-Allow-Origin':'*'},JSON.stringify(metadata(origin)));
   if(pages.includes(url.pathname)){const body=await readFile(shell);return send(res,200,{'Content-Type':TYPES['.html'],'Cache-Control':'no-store'},req.method==='HEAD'?undefined:body);}
   const root=roots.find(r=>url.pathname.startsWith(r.prefix));if(!root)return send(res,404,{'Content-Type':'text/plain'},'not found');
   const file=normalize(resolve(root.path,decodeURIComponent(url.pathname.slice(root.prefix.length))));
   if(file!==root.path&&!file.startsWith(root.path+sep)||!TYPES[extname(file)])return send(res,404,{'Content-Type':'text/plain'},'not found');
   let info;try{info=await stat(file);}catch{info=null;}if(!info?.isFile())return send(res,404,{'Content-Type':'text/plain'},'not found');
   return send(res,200,{'Content-Type':TYPES[extname(file)],'Cache-Control':'no-cache'},req.method==='HEAD'?undefined:await readFile(file));
  }catch(error){log({method:req.method,path:url.pathname,status:500,error:String(error?.message??error).slice(0,200)});if(!res.headersSent)send(res,500,{'Content-Type':'text/plain'},'internal error');else res.destroy();}
 };
}
