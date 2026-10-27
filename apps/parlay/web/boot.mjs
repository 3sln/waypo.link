import {h,reconcile} from '../../../vendor/dodo/index.js';
import {mountRemoval} from './removal.mjs';
import {mount} from './index.mjs';
let intentValue=(()=>/^#bintent=([A-Za-z0-9_.-]+)(?:&bintent_iss=[^&]*)?$/.exec(location.hash)?.[1])();setTimeout(()=>{intentValue=null;},3600000);if(location.hash)history.replaceState(null,'',location.pathname+location.search);
const root=document.querySelector('#app');let client,busy=false;
// The owner app credential stays in memory. Deployments can supply the same ordinary SDK token port
// through a same-document session event; this standalone shell also accepts an existing app credential.
async function connect(token){
 if(busy)return;busy=true;
 try{const response=await fetch('/api/web/session',{headers:{Authorization:'Bearer '+await token()},credentials:'omit',cache:'no-store',redirect:'error'});if(!response.ok)throw new Error('Sign in could not be verified.');const session=await response.json();await client?.dispose();client=await mount(root,{PARLAY_ENABLED:true,owner:session.owner,token,INTENT_LINKS_ENABLED:session.intentLinksEnabled===true,intentValue,archiveEnabled:session.archiveEnabled});intentValue=null;}
 catch{login('Sign in could not be verified.');}finally{busy=false;}
}
function login(error=''){reconcile(root,[h('form',h('h1','Parlay'),h('label','App credential',h('input').props({name:'credential',type:'password',required:true,autocomplete:'off'})),h('button','Sign in').props({type:'submit'}),h('p',error).attrs({role:'alert'})).on({submit:event=>{event.preventDefault();const credential=new FormData(event.currentTarget).get('credential');connect(async()=>credential);}})]);}
window.addEventListener('parlay-session',event=>{if(typeof event.detail?.token==='function')connect(event.detail.token);});if(location.pathname==='/bindle/remove')mountRemoval(root);else login();
