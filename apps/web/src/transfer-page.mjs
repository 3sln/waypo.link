import {Engine,Provider,dodo,watch,queryCell} from './shared/stack.mjs';
import {createAPI} from './providers/api.mjs';
import {createTransferRecovery} from './providers/transfer-recovery.mjs';
import RecoveryFileProvider from './providers/recovery-file.mjs';
import {createTransferPort,TransferIntent,TransferView} from './bl/transfer-flow.mjs';
import render from './ui/transfer-page.mjs';
import {resolveLocale} from './shared/i18n.mjs';
let preferredLocale;try{preferredLocale=JSON.parse(localStorage.getItem('personal-space-preferences')??'{}')?.locale;}catch{}
const langQuery=new URLSearchParams(location.search),explicitLocale=langQuery.getAll('lang').length===1&&['en','es'].includes(langQuery.get('lang'))?langQuery.get('lang'):undefined;
const root=document.getElementById('app'),locale=resolveLocale(explicitLocale??preferredLocale??navigator.language),path=location.pathname,mode=document.documentElement.dataset.transferMode??(path.includes('dispute')?'dispute':path.includes('successor')?'successor':path.includes('transfer-in')?'in':path.startsWith('/moved/')?'redirect':path.includes('transfer-moved')?'moved':'out');document.documentElement.lang=locale;
const recoveryProvider=new RecoveryFileProvider(),recovery=mode==='in'?createTransferRecovery():await recoveryProvider.obtain(),bootNode=document.getElementById('transfer-package');let boot=null;try{if(bootNode)boot=JSON.parse(bootNode.textContent);}catch{}bootNode?.remove();
const port=createTransferPort({mode,api:createAPI({storage:sessionStorage}),location,document,window,recovery,boot}),engine=new Engine({providers:{transfer:Provider.fromSingleton(port)}}),dispatch=(action,input)=>engine.dispatch(new TransferIntent(action,input));boot=null;window.addEventListener('message',event=>dispatch('security-result',{source:event.source,origin:event.origin,data:event.data}));
dodo.reconcile(root,[watch(queryCell(engine.query(new TransferView())),s=>render(s,{locale,dispatch}))]);dispatch('load');window.addEventListener('pagehide',()=>{port.dispose();recoveryProvider.dispose();engine.dispose();},{once:true});
