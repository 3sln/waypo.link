import {Engine,Provider,dodo,watch,queryCell} from './shared/stack.mjs';
import {createAPI} from './providers/api.mjs';
import {createCertifyPort,CertifyMemberIntent,CertifyMemberView} from './bl/certify-member.mjs';
import certifyMember from './ui/certify-member.mjs';
const root=document.getElementById('app'),locale=navigator.language.startsWith('es')?'es':'en';document.documentElement.lang=locale;
try{const port=createCertifyPort({api:createAPI(),location,opener:window.opener,window}),engine=new Engine({providers:{certify:Provider.fromSingleton(port)}}),dispatch=(action,input)=>engine.dispatch(new CertifyMemberIntent(action,input));window.addEventListener('message',event=>{if(event.source===window.opener)dispatch('key',{source:event.source,origin:event.origin,data:event.data});});dodo.reconcile(root,[watch(queryCell(engine.query(new CertifyMemberView())),s=>certifyMember(s,{locale,dispatch}))]);dispatch('load');window.addEventListener('pagehide',()=>engine.dispose(),{once:true});}catch{dodo.reconcile(root,[dodo.h('main',dodo.h('h1','Invalid member certificate request'),dodo.h('a','Return to console').props({href:'/console'}))]);}
