import test from 'node:test';
import assert from 'node:assert/strict';
import {acquireMemberCertificate,createMemberProof} from '../src/member.mjs';
import {createKey} from '../src/dpop.mjs';
import {memberPopInput} from '../../identity/member-certificates.mjs';
const ISSUER='https://home.example',AUD=ISSUER+'/identity/dddddddd-dddd-4ddd-8ddd-dddddddddddd',SUBJECT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',CLIENT='https://app.example/client.json',REDIRECT='https://app.example/callback',ACCESS='https://spec.bindle.example/purposes/member-access/v1';
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
function fixture(){
 let listener,opened,closed=false;const messages=[];
 const popup={get closed(){return closed;},close(){closed=true;},postMessage(data,origin){messages.push({data,origin});}},win={location:{origin:'https://app.example'},open(url){opened=new URL(url);return popup;},addEventListener(name,fn){listener=fn;},removeEventListener(){listener=null;}};
 const request=()=>acquireMemberCertificate({issuer:ISSUER,aud:AUD,clientId:CLIENT,redirectUri:REDIRECT,window:win});
 const emit=async(data,extra={})=>listener?.({source:popup,origin:ISSUER,data:{state:opened.searchParams.get('state'),...data},...extra});
 return {win,popup,messages,request,emit,get opened(){return opened;},get listening(){return !!listener;}};
}
test('member proof matches the issuer profile and the private holder key cannot be exported',async()=>{
 const holder=await createKey(),args={aud:AUD,clientId:CLIENT,issuer:ISSUER,subject:SUBJECT},proof=await createMemberProof(holder,{...args,clock:()=>1800000000000});
 const publicKey=await crypto.subtle.importKey('jwk',holder.jwk,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 assert.equal(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},publicKey,Buffer.from(proof.signature,'base64url'),memberPopInput({...args,iat:proof.iat,jkt:holder.jkt})),true);
 assert.equal(holder.privateKey.extractable,false);await assert.rejects(crypto.subtle.exportKey('jwk',holder.privateKey));
});
test('popup delivery checks window, origin, state and exact certificate holder/client/audience binding',async()=>{
 const f=fixture(),pending=f.request(),state=f.opened.searchParams.get('state');assert.equal(state.length,43);assert.equal(f.opened.pathname,'/console');assert.equal(f.opened.searchParams.get('member_certify'),'1');
 const ready={type:'bindle:member-ready',subject:SUBJECT,issuer:ISSUER,aud:AUD,client:{client_id:CLIENT,origin:'https://app.example'}};
 await f.emit(ready,{origin:'https://evil.example'});await f.emit(ready,{source:{}});await f.emit({...ready,state:'wrong'});assert.equal(f.messages.length,0);
 await f.emit(ready);assert.equal(f.messages.length,1);const {data:key,origin}=f.messages[0];assert.equal(origin,ISSUER);assert.equal(key.type,'bindle:member-key');assert.equal(key.state,state);assert.ok(key.proof.signature);assert.equal(key.delegate.d,undefined);
 const jwk=key.delegate,jkt=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({crv:'P-256',kty:'EC',x:jwk.x,y:jwk.y})))).toString('base64url');
 const body={bindle:'member-certificate',v:1,iss:ISSUER,sub:SUBJECT,aud:AUD,client:ready.client,cnf:{jkt},purposes:[ACCESS],iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+660,aep:0};
 const certificate=encode({alg:'ES256'})+'.'+encode(body)+'.signature';await f.emit({type:'bindle:member-result',result:{certificate,status:'status'}});const result=await pending;assert.equal(result.certificate,certificate);assert.equal(result.holder.jkt,jkt);assert.equal(result.holder.privateKey.extractable,false);assert.equal(f.listening,false);assert.equal(f.popup.closed,true);
});
test('popup denial, forged results and invalid origin configuration reject and clean up',async()=>{
 const blocked=fixture();blocked.win.open=()=>null;await assert.rejects(blocked.request(),{code:'popup_blocked'});
 const f=fixture(),pending=f.request();await f.emit({type:'bindle:member-result',certificate:'forged'});await assert.rejects(pending,{code:'invalid_response'});assert.equal(f.listening,false);
 const canceled=fixture(),request=canceled.request();await canceled.emit({type:'bindle:member-error',code:'canceled'});await assert.rejects(request,{code:'canceled'});
 await assert.rejects(acquireMemberCertificate({issuer:ISSUER,aud:AUD,clientId:CLIENT,redirectUri:'https://evil.example/callback',window:fixture().win}),{code:'invalid_request'});
});
