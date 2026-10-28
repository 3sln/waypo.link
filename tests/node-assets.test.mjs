// Node ASSETS port (apps/node/assets.mjs, review L1): encoded separators, backslashes, malformed encoding, case
// variants, traversal, sibling-prefix directories and symlinks never serve anything outside the exact root path.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNodeAssets} from '../apps/node/assets.mjs';

test('Node assets: serves exact paths under the root and refuses encoded, folded, malformed or escaping ones',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'3sln-assets-')),root=join(directory,'public');t.after(()=>rm(directory,{recursive:true,force:true}));
 await mkdir(join(root,'embed','assets'),{recursive:true});await mkdir(join(directory,'public-evil'));
 await writeFile(join(root,'index.html'),'<!doctype html>');await writeFile(join(root,'embed','sw.js'),'self.x=1');await writeFile(join(root,'embed','assets','a b.js'),'export{}');
 await writeFile(join(directory,'secret.txt'),'secret');await writeFile(join(directory,'public-evil','x.js'),'evil');
 await symlink(join(directory,'secret.txt'),join(root,'link.txt'));
 const assets=createNodeAssets(root),get=path=>assets.fetch(new Request('http://localhost:8788'+path));
 const index=await get('/');assert.equal(index.status,200);assert.equal(index.headers.get('Content-Type'),'text/html; charset=utf-8');
 const sw=await get('/embed/sw.js');assert.equal(sw.status,200);assert.equal(await sw.text(),'self.x=1');assert.equal(sw.headers.get('Content-Type'),'text/javascript');
 assert.equal((await get('/embed/assets/a%20b.js')).status,200,'ordinary percent-encoding still decodes');
 for(const path of ['/embed%2Fsw.js','/embed%2fsw.js','/embed%5Csw.js','/embed%5csw.js','/EMBED/sw.js','/embed/SW.js','/%65mbed/SW.JS','/%zz','/embed/%E0%A4%A','/embed/sw.js%00','/..%2Fsecret.txt','/%2E%2E/secret.txt','/../public-evil/x.js','/link.txt','/embed','/embed/','/missing.js'])
  assert.equal((await get(path)).status,404,path);
 // WHATWG URL parsing folds a raw `\` into `/` for http(s) before the port sees it; the port still refuses any that remain.
 assert.equal(new URL('http://localhost:8788/embed\\sw.js').pathname,'/embed/sw.js');
 // A raw (unnormalised) request URL cannot climb out either.
 assert.equal((await assets.fetch({url:'http://localhost:8788/../secret.txt'})).status,404);
 assert.equal((await createNodeAssets(join(directory,'absent')).fetch(new Request('http://localhost:8788/'))).status,404,'a missing root serves nothing');
});
