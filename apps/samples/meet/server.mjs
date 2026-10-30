// Meet sample server: static files, client metadata, the single-page routes, and the one thing Meet genuinely needs a
// server for: a meeting directory, so a join link (https://meet.example/j/<id>) can carry a meeting to someone else.
// A meeting record holds what the host published: a title, the host's display label and Bindle principal, and an open
// signaling offer (signaling §5.7: an invitation capability with a bounded number of uses that expires within 15
// minutes). The offer is handed only to someone who asks to join, never shown in the public meeting card.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {createAppServer,securityHeaders} from '../kit/server.mjs';
import {clientMetadata} from './metadata.mjs';

const SHELL=fileURLToPath(new URL('./web/index.html',import.meta.url));
const ID=/^[a-z0-9]{10}$/,MAX_MEETINGS=2000,MAX_BODY=8192;
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const https=value=>{try{const u=new URL(value);return u.protocol==='https:'&&u.origin===value;}catch{return false;}};

async function body(req){
 let size=0;const chunks=[];
 for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY)throw Object.assign(new Error('too large'),{status:413});chunks.push(chunk);}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createMeetServer({origin='https://meet.example',log,clock=()=>Date.now()}={}){
 const meetings=new Map();
 const json=(res,status,value)=>{res.writeHead(status,{...securityHeaders(),'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 const card=m=>({id:m.id,title:m.title,host:{label:m.host.label,issuer:m.host.issuer},createdAt:m.createdAt,expiresAt:m.expiresAt,ended:m.ended});
 async function api(req,res,url){
  if(req.method==='GET'&&/^\/j\/[a-z0-9]{10}$/.test(url.pathname)){res.writeHead(200,{...securityHeaders(),'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(await readFile(SHELL));return true;}
  if(!url.pathname.startsWith('/api/meetings'))return false;
  // Same-origin JSON only: the browser app is the only caller.
  if(req.method!=='GET'&&req.headers.origin!==origin){json(res,403,{error:'forbidden'});return true;}
  if(req.method==='POST'&&url.pathname==='/api/meetings'){
   let input;try{input=await body(req);}catch(error){json(res,error.status??400,{error:'invalid_request'});return true;}
   const h=input?.host;
   const problem=!text(input?.title,80)?'title':!h||!text(h.label,120)?'host label':!https(h.issuer)?'host issuer':!(typeof h.subject==='string'&&h.subject.length<=300&&(/^[0-9a-f-]{36}$/.test(h.subject)||h.subject.startsWith(h.issuer+'/')))?'host subject':typeof input.offer!=='string'||!/^[A-Za-z0-9_-]{16,64}$/.test(input.offer)?'offer':!Number.isSafeInteger(input.expiresAt)?'expiry':null;
   if(problem){json(res,400,{error:'invalid_request',field:problem});return true;}
   if(meetings.size>=MAX_MEETINGS)meetings.delete(meetings.keys().next().value);
   const id=[...randomBytes(10)].map(b=>'abcdefghijkmnpqrstuvwxyz23456789'[b%32]).join(''),hostKey=randomBytes(18).toString('base64url');
   meetings.set(id,{id,title:input.title.trim(),host:{label:h.label,issuer:h.issuer,subject:h.subject},offer:input.offer,hostKey,createdAt:clock(),expiresAt:input.expiresAt,ended:false});
   json(res,201,{id,hostKey,link:`${origin}/j/${id}`});return true;
  }
  const match=/^\/api\/meetings\/([a-z0-9]{10})(\/join|\/end)?$/.exec(url.pathname),m=match&&ID.test(match[1])?meetings.get(match[1]):null;
  if(!m){json(res,404,{error:'not_found'});return true;}
  if(req.method==='GET'&&!match[2]){json(res,200,card(m));return true;}
  // Asking to join hands over the host's principal and the offer (the invitation capability).
  if(req.method==='POST'&&match[2]==='/join'){if(m.ended||m.expiresAt<=clock()){json(res,410,{error:'ended'});return true;}json(res,200,{...card(m),host:{...card(m).host,subject:m.host.subject},offer:m.offer});return true;}
  if(req.method==='POST'&&match[2]==='/end'){let input;try{input=await body(req);}catch{input=null;}if(input?.hostKey!==m.hostKey){json(res,403,{error:'forbidden'});return true;}m.ended=true;json(res,200,card(m));return true;}
  json(res,405,{error:'method_not_allowed'});return true;
 }
 return createAppServer({origin,web:'apps/samples/meet/web',metadata:clientMetadata,pages:['/','/bindle/callback'],api,log});
}
