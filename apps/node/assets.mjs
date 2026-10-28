// Node ASSETS port: serves the built static tree (default `.output/public`) the way the Worker assets binding would.
// Refuses encoded `/` or `\` (%2F, %5C in any case), raw or decoded backslashes, NUL, malformed percent-encoding and
// any path whose canonical on-disk location is not exactly the requested one under the root (no escapes, symlinks or
// case-folded matches on case-insensitive filesystems) (review L1).
import {readFile} from 'node:fs/promises';
import {realpath as realpathCallback} from 'node:fs';
import {promisify} from 'node:util';
import {resolve,extname,sep} from 'node:path';
const TYPES={'.html':'text/html; charset=utf-8','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.md':'text/markdown; charset=utf-8','.txt':'text/plain; charset=utf-8'};
// The native realpath returns the on-disk spelling, so a case-folded match differs from the requested path.
const canonical=promisify(realpathCallback.native);
const notFound=()=>new Response('Not found',{status:404});
export function createNodeAssets(root='.output/public'){
 const base=resolve(root);
 return {fetch:async request=>{
  let path;
  try{
   const raw=new URL(request.url).pathname;if(/%(2f|5c|00)/i.test(raw)||raw.includes('\\'))return notFound();
   const pathname=decodeURIComponent(raw);if(pathname.includes('\\')||pathname.includes('\0'))return notFound();
   path=resolve(base,pathname==='/'?'index.html':'.'+pathname);if(!path.startsWith(base+sep))return notFound();
   const realBase=await canonical(base);if(await canonical(path)!==realBase+path.slice(base.length))return notFound();
  }catch{return notFound();}
  try{const data=await readFile(path);return new Response(data,{headers:{'Content-Type':TYPES[extname(path)]||'application/octet-stream','Cache-Control':'no-cache'}});}catch(error){if(['ENOENT','EISDIR'].includes(error.code))return notFound();throw error;}
 }};
}
