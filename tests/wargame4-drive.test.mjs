// Wargame 4 L7/L8 (Drive): disconnect sweeps the resource's rows (keeping AU-S6 producer evidence), abandoned OAuth
// state is pruned and dropped with its session, and a refresh that lists extra scopes needs reauthorization.
import test from 'node:test';
import assert from 'node:assert/strict';
import {GoogleDriveService} from '../packages/storage/google-drive.mjs';

const scope='https://www.googleapis.com/auth/drive.file',bytes=s=>new TextEncoder().encode(s);
class Metadata {
 rows=new Map(); tail=Promise.resolve();
 async get(k){return structuredClone(this.rows.get(k));}
 async put(k,v){this.rows.set(k,structuredClone(v));}
 async delete(k){this.rows.delete(k);}
 async list({prefix='',limit=Infinity,startAfter=''}={}){return new Map([...this.rows].filter(([k])=>k.startsWith(prefix)&&k>startAfter).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit));}
 async transaction(fn){const prior=this.tail;let done;this.tail=new Promise(r=>done=r);await prior;const snapshot=structuredClone(this.rows);try{return await fn(this);}catch(e){this.rows=snapshot;throw e;}finally{done();}}
}
function harness(){
 const metadata=new Metadata(),files=new Map(),calls=[];let next=0,now=1000000;
 const h={metadata,files,calls,hook:null,advance:n=>{now+=n;}};
 const fetcher=async(input,options={})=>{
  const url=new URL(input);calls.push({url,options});
  if(h.hook){const intercepted=await h.hook(url,options);if(intercepted)return intercepted;}
  if(url.hostname==='oauth2.googleapis.com')return url.pathname==='/revoke'?new Response(''):Response.json({access_token:'access',refresh_token:'refresh',token_type:'Bearer',expires_in:3600,scope});
  if(url.pathname==='/drive/v3/about')return Response.json({user:{permissionId:'principal_1'}});if(url.pathname.endsWith('/generateIds'))return Response.json({ids:['file_'+(++next)]});
  if(options.method==='POST'&&url.pathname==='/drive/v3/files'){const m=JSON.parse(options.body);files.set(m.id,{...m,owners:[{permissionId:'principal_1'}],capabilities:{canAddChildren:true},bytes:new Uint8Array(),trashed:false});return Response.json({id:m.id});}
  if(url.pathname==='/upload/drive/v3/files'){
   const raw=new TextDecoder().decode(options.body),start=raw.indexOf('{'),end=raw.indexOf('\r\n--',start),m=JSON.parse(raw.slice(start,end)),mediaStart=raw.indexOf('\r\n\r\n',end)+4,mediaEnd=raw.lastIndexOf('\r\n--');
   files.set(m.id,{id:m.id,bytes:bytes(raw.slice(mediaStart,mediaEnd)),parents:m.parents,mimeType:m.mimeType,version:'1',trashed:false});return Response.json({id:m.id});
  }
  const id=url.pathname.split('/').at(-1),file=files.get(id);if(!file)return new Response('',{status:404});
  return url.searchParams.get('alt')==='media'?new Response(file.bytes):Response.json({...file,bytes:undefined,size:String(file.bytes.length)});
 };
 h.service=new GoogleDriveService({metadata,fetcher,clock:()=>now,config:{APP_ORIGIN:'https://identity.example',GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'secret',KEY_ENCRYPTION_KEY:btoa('k'.repeat(32))}});
 h.clone=()=>new GoogleDriveService({metadata,fetcher,clock:()=>now,config:h.service.config});
 return h;
}
async function begin(h,session='session'){const start=await h.service.begin('owner',session);return {state:new URL(start.url).searchParams.get('state'),code:'code'};}
async function connect(h){return h.service.complete('owner','session',await begin(h));}

test('Drive: connect/write/disconnect cycles do not grow account metadata without bound',async()=>{
 const h=harness();
 for(let cycle=0;cycle<3;cycle++){
  const r=await connect(h);
  for(let i=0;i<5;i++)await h.service.put('owner',r.id,{key:'k'+i,bytes:bytes('v'),condition:{absent:true}});
  const a=await h.service.get('owner',r.id,{key:'k0'});await h.service.put('owner',r.id,{key:'k0',bytes:bytes('w'),condition:{version:a.version}});
  assert.deepEqual(await h.service.disconnect('owner',r.id),{deleted:true,providerRevoked:false,localOnly:true});
 }
 assert.equal((await h.metadata.list({prefix:'resource/'})).size,0);
 const orphan=[...(await h.metadata.list({prefix:'drive/'})).keys()];
 // The resource cap (100) counts only live resource/ rows, so each cycle adds up to 10,000 mappings + 10,000 retained rows forever.
 assert.equal(orphan.length,0,'orphaned rows after disconnect: '+orphan.length+' e.g. '+orphan.slice(0,3).join(', '));
});

test('Drive: abandoned OAuth begins from expired sessions are reclaimed',async()=>{
 const h=harness();
 for(let i=0;i<20;i++)await h.service.begin('owner','session-'+i);
 h.advance(86400000);
 // Starting a fresh connection long after the others expired should not leave the expired sealed PKCE verifiers behind.
 await h.service.begin('owner','fresh-session');
 const rows=(await h.metadata.list({prefix:'drive/oauth/'})).size;
 assert.ok(rows<=1,'expired sealed OAuth state rows retained: '+rows);
});

test('Drive: disconnect keeps only rows with producer evidence (AU-S6 "not deletable here")',async()=>{
 const h=harness(),r=await connect(h);
 await h.service.put('owner',r.id,{key:'mine',bytes:bytes('v'),condition:{absent:true}});
 const path=await h.service.path(r.id,'app-made');await h.metadata.put(path,{key:'app-made',fileId:'f',version:'v',producer:{connection:'app',generation:1,prefix:''},size:1});
 await h.service.disconnect('owner',r.id);
 assert.deepEqual([...(await h.metadata.list({prefix:'drive/'})).keys()],[path]);
});

test('Drive: a large removed resource is swept in bounded batches across calls',async()=>{
 const h=harness(),r=await connect(h);
 for(let i=0;i<2500;i++)await h.metadata.put(`drive/object/${r.id}/k${String(i).padStart(5,'0')}`,{key:'k'+i,fileId:'f'+i,version:'v'});
 let deletes=0;const del=h.metadata.delete.bind(h.metadata);h.metadata.delete=async k=>{deletes++;return del(k);};
 await h.service.disconnect('owner',r.id);
 assert.ok(deletes<=1100,'one call deletes at most ten batches: '+deletes);assert.ok((await h.metadata.list({prefix:'drive/removed/'})).size===1,'the marker keeps the remainder');
 for(let i=0;i<5&&(await h.metadata.list({prefix:'drive/removed/'})).size;i++)await h.service.sweepRemoved();
 assert.equal((await h.metadata.list({prefix:'drive/'})).size,0);
});

test('Drive: a revoked session drops its pending OAuth state',async()=>{
 const h=harness();await h.service.begin('owner','session-a');await h.service.begin('owner','session-b');
 await h.service.forgetSessions(['session-a']);
 assert.equal((await h.metadata.list({prefix:'drive/oauth/'})).size,1);
 await assert.rejects(h.service.complete('owner','session-a',{state:'x',code:'code'}),{code:'oauth_expired'});
});

test('Drive: a refresh that lists extra scopes moves the resource to reauthorization_required',async()=>{
 const h=harness(),r=await connect(h);h.advance(3600000);
 h.hook=async url=>url.hostname==='oauth2.googleapis.com'&&url.pathname==='/token'?Response.json({access_token:'access2',token_type:'Bearer',expires_in:3600,scope:scope+' https://www.googleapis.com/auth/drive'}):null;
 await assert.rejects(h.service.access('owner',r.id),{code:'scope_denied'});
 assert.equal((await h.metadata.get('resource/'+r.id)).status,'reauthorization_required');
});

test('review: kept producer rows never stall the sweep (the cursor persists in the marker across calls)',async()=>{
 const h=harness(),pad=n=>String(n).padStart(5,'0');
 await h.metadata.put('drive/removed/resA',{owner:'owner',removedAt:1});await h.metadata.put('drive/removed/resB',{owner:'owner',removedAt:1});
 for(let i=0;i<1000;i++)await h.metadata.put(`drive/object/resA/a${pad(i)}`,{producer:{connection:'app',generation:1}});
 for(let i=0;i<50;i++)await h.metadata.put(`drive/object/resA/z${pad(i)}`,{key:'plain'});
 for(let i=0;i<5;i++)await h.metadata.put(`drive/retained/resA/r${i}`,{});await h.metadata.put('drive/usage/resA',{objects:1050});
 await h.metadata.put('drive/object/resB/x',{key:'plain'});await h.metadata.put('drive/usage/resB',{objects:1});
 for(let call=0;call<5;call++)await h.service.sweepRemoved();
 const left=[...(await h.metadata.list({prefix:'drive/'})).keys()].filter(k=>!k.startsWith('drive/object/resA/a'));
 assert.deepEqual(left,[],'the sweep finishes past 1,000 kept rows');assert.equal((await h.metadata.list({prefix:'drive/object/resA/a'})).size,1000);
});

test('review: folder journals of failed connects (sealed tokens) are pruned after a bounded age',async()=>{
 const h=harness(),sealed=await h.service.seal({owner:'owner',resourceId:'r1',generation:1,folderId:'f',tokens:{refresh_token:'secret'},createdAt:1000000});
 await h.metadata.put('drive/folder-pending/r1',sealed);await h.service.begin('owner','s1');
 assert.equal((await h.metadata.list({prefix:'drive/folder-pending/'})).size,1,'a recent journal is kept');
 h.advance(7*86400000);await h.service.begin('owner','s2');
 assert.equal((await h.metadata.list({prefix:'drive/folder-pending/'})).size,0);
});
