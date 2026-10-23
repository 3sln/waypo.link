// Top-level, explicit member consent. The opener is pinned to a registered app origin before any key is accepted.
import {Action,Query} from '../shared/stack.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function certifyRequest(location){const p=new URL(location.href).searchParams,state=p.get('state');if(!state||!/^[A-Za-z0-9_-]{32,128}$/.test(state))throw Error('Invalid acquisition state.');return {state,client_id:p.get('client_id'),redirect_uri:p.get('redirect_uri'),aud:p.get('aud')};}
export class CertifyMemberView extends Query{static deps=['certify'];fetch({certify}){return certify.snapshot();}boot({certify},{notify,engineFeed}){this.feed=engineFeed;this.paint=()=>notify(certify.snapshot());engineFeed.addEventListener('certify-changed',this.paint);this.paint();}kill(){this.feed.removeEventListener('certify-changed',this.paint);}}
// Phases: loading -> review -> (approve) signing -> complete | failed; cancel from loading/review/signing.
// Review L1: nothing reaches the app, not even `ready` with the subject, until the member confirms. Review M1: the app
// signs its proof only after that confirmation, a retryable refusal asks once more for a fresh proof, and a final
// failure is told to the app (`bindle:member-error`) instead of leaving it waiting.
const RETRYABLE=new Set(['invalid_request','delegation_conflict','temporarily_unavailable','unavailable']);
export class CertifyMemberIntent extends Action{
 static deps=['certify'];constructor(action,input){super();this.action=action;this.input=input;}
 async execute({certify},{engineFeed}){const publish=patch=>{certify.patch(patch);engineFeed.dispatchEvent(new Event('certify-changed'));};if(certify.snapshot().busy)return;publish({busy:true,error:null});try{
  if(this.action==='load'){const value=await certify.load();publish({view:value,phase:'review'});}
  else if(this.action==='approve'){const value=certify.snapshot();if(value.phase!=='review'||this.input?.confirm!==true)throw Error('Review and confirm before issuing.');publish({phase:'signing',key:null,retried:false});certify.ready(value.view);}
  else if(this.action==='key'){
   const value=certify.snapshot();if(value.phase!=='signing'||value.key||!certify.accepts(this.input,value.view))return;
   const key={delegate:this.input.data.delegate,proof:this.input.data.proof};publish({key});
   let result;try{result=await certify.issue(key);}catch(error){
    const code=error?.code??null;publish({key:null});
    if(!value.retried&&RETRYABLE.has(code)){publish({retried:true});certify.ready(value.view);return;}
    publish({phase:'failed'});certify.fail();throw error;
   }
   publish({key:null,phase:'complete'});certify.result(result);
  }
  else if(this.action==='cancel'){const value=certify.snapshot();if(!['loading','review','signing'].includes(value.phase))return;publish({key:null,phase:'canceled'});certify.cancel();}
 }catch(error){publish({error:error.code??error.message??'unavailable'});}finally{publish({busy:false});}}
}
// The provider is deliberately small: transport and browser effects, no app policy or consent decisions.
export function createCertifyPort({api,location,opener,window}){const request=certifyRequest(location);let state={phase:'loading',busy:false,key:null,error:null,view:null,retried:false};const send=(type,extra={})=>{if(!state.view||!opener)return;opener.postMessage({type,state:request.state,...extra},state.view.client.origin);};return {
 snapshot:()=>structuredClone(state),patch:patch=>{state={...state,...patch};},
 async load(){if(!opener||window.top!==window)throw Error('Open this consent page from the requesting app.');const config=await api.get('/api/config');const session=await api.get('/api/session');const features=session.features??session.account?.consoleFeatures??config;if(features.organizationsEnabled!==true||features.memberCertificatesEnabled!==true)throw Error('Member certificates are unavailable.');if(!session.authenticated||session.account?.kind==='organization'||!uuid.test(session.account?.id??''))throw Error('Sign in to your personal account in the console, then restart from the app.');api.setContext(session);const q=new URLSearchParams({client_id:request.client_id,redirect_uri:request.redirect_uri,aud:request.aud});const view=await api.get('/api/member-certificates/acquire?'+q);if(view.redirectUri!==request.redirect_uri||view.subject!==session.account.id||view.issuer!==location.origin||view.aud!==request.aud||view.client?.client_id!==request.client_id||new URL(view.redirectUri).origin!==view.client.origin)throw Error('The acquisition context changed.');return view;},
 ready:view=>send('bindle:member-ready',{subject:view.subject,issuer:view.issuer,aud:view.aud,client:view.client}),
 accepts:(event,view)=>event.source===opener&&event.origin===view.client.origin&&event.data?.type==='bindle:member-key'&&event.data.state===request.state,
 issue:key=>api.request('/api/member-certificates/acquire',{client_id:request.client_id,redirect_uri:request.redirect_uri,aud:request.aud,...key,consent:true}),
 result:result=>send('bindle:member-result',{result}),fail:()=>send('bindle:member-error',{code:'acquisition_failed'}),cancel:()=>send('bindle:member-error',{code:'canceled'})
 };}
