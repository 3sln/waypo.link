// No package, recovery file or transfer receipt enters this separate challenge document.
import {Engine,Provider,Action,Query,dodo,watch,queryCell} from './shared/stack.mjs';
import {h} from './ui/release-primitives.mjs';
const es=navigator.language.startsWith('es'),t=(en,spanish)=>es?spanish:en;document.documentElement.lang=es?'es':'en';
let state={phase:'loading'},widget,script,disposed=false;
const port={snapshot:()=>({...state}),publish(value,feed){state=value;feed.dispatchEvent(new Event('security-changed'));},async start(feed){
 if(window.top!==window||!window.opener)throw Error('Open this security check from the move page.');
 const response=await fetch('/api/config',{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Security check unavailable.');const config=await response.json();
 if(config.localDevelopment===true){this.send('local-browser-test-token');return;}
 if(!config.turnstileSiteKey)throw Error('Security check is not configured.');
 this.publish({phase:'challenge'},feed);await new Promise((resolve,reject)=>{script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;script.onload=resolve;script.onerror=reject;document.head.append(script);});
 if(disposed)return;widget=window.turnstile.render(document.getElementById('challenge'),{sitekey:config.turnstileSiteKey,size:'flexible',action:'signup',callback:token=>{if(!disposed)this.send(token);},'expired-callback':()=>this.publish({phase:'expired'},feed),'error-callback':()=>this.publish({phase:'error'},feed)});
 },send(token){if(typeof token!=='string'||token.length>2048)return;window.opener.postMessage({type:'transfer-security',token},location.origin);window.close();},dispose(){disposed=true;if(widget!==undefined)window.turnstile?.remove(widget);script?.remove();}};
class SecurityStart extends Action{static deps=['security'];async execute({security},{engineFeed}){try{await security.start(engineFeed);}catch{security.publish({phase:'error'},engineFeed);}}}
class SecurityView extends Query{static deps=['security'];fetch({security}){return security.snapshot();}boot({security},{engineFeed,notify}){this.feed=engineFeed;this.listener=()=>notify(security.snapshot());this.feed.addEventListener('security-changed',this.listener);this.listener();}kill(){this.feed.removeEventListener('security-changed',this.listener);}}
const engine=new Engine({providers:{security:Provider.fromSingleton(port)}});
dodo.reconcile(document.getElementById('app'),[watch(queryCell(engine.query(new SecurityView())),s=>h('main',h('h1',t('Security check','Verificación de seguridad')),h('p',t('Complete this check to continue moving your identity. This page has no identity package or recovery file.','Completa esta verificación para continuar. Esta página no contiene tu paquete de identidad ni archivo de recuperación.')),h('div').attrs({id:'challenge'}),['error','expired'].includes(s.phase)?h('p',t('The check could not complete. Close this window and retry from the move page.','No se pudo completar. Cierra esta ventana y vuelve a intentarlo.')).attrs({role:'alert'}):h('p',t('Waiting for the security check…','Esperando la verificación…')).attrs({role:'status'})))]);
engine.dispatch(new SecurityStart());window.addEventListener('pagehide',()=>{port.dispose();engine.dispose();},{once:true});
