// Photos business logic (ngin Actions; no DOM). Pattern shown: a public gallery anyone can browse signed out; signing
// in unlocks a personal library, and Photos asks for storage only when the person adds their first photo.
import {AppAction,createState,createAppEngine} from '../../kit/web/engine.mjs';

export const LIBRARY_FRAGMENT='https://photos.example/fragments/library/v1';
export const INDEX_KEY='index.json',photoKey=id=>`photos/${id}`;
const MAX_BYTES=900*1024;
export function initialState({locale='en',theme='system'}={}){
 return {locale,theme,tab:'explore',viewer:null,account:null,lastAccount:null,storage:'none',wanted:false,photos:[],busy:false,toast:null,error:null,signIn:false};
}
const persist=(local,s)=>local.save({locale:s.locale,theme:s.theme,lastAccount:s.lastAccount,wanted:s.wanted});
const toast=(s,key,vars)=>{s.toast={key,vars,at:Date.now()};};
class PhotosAction extends AppAction {static deps=['state','local','clock','ids','remote','grants'];}

export class Load extends PhotosAction {async run({state,local}){const s=state.value,saved=await local.load();if(saved){Object.assign(s,{locale:saved.locale??s.locale,theme:saved.theme??s.theme,lastAccount:saved.lastAccount??null,wanted:saved.wanted===true});}}}
export class Tab extends PhotosAction {run({state}){const s=state.value;if(['explore','library'].includes(this.input.tab))s.tab=this.input.tab;s.viewer=null;}}
export class View extends PhotosAction {run({state}){state.value.viewer=this.input.viewer??null;}}
export class Panel extends PhotosAction {run({state}){state.value.signIn=!!this.input.signIn;}}
export class Preference extends PhotosAction {async run({state,local}){const s=state.value;if(['system','light','dark'].includes(this.input.theme))s.theme=this.input.theme;if(['en','es'].includes(this.input.locale))s.locale=this.input.locale;await persist(local,s);}}
export class DismissToast extends PhotosAction {run({state}){state.value.toast=null;}}

/** Signed in. Storage is granted only if this session already carries the library fragment. */
export class Connected extends PhotosAction {
 async run(resources){const {state,local}=resources,s=state.value,{issuer,subject,label,fragments=[]}=this.input;
  s.account={issuer,subject,label};s.lastAccount={issuer,subject,label};s.signIn=false;s.storage=fragments.includes(LIBRARY_FRAGMENT)?'granted':'none';
  await persist(local,s);if(s.storage==='granted')return refresh(resources);}
}
export class Disconnected extends PhotosAction {async run({state}){const s=state.value;s.account=null;s.storage='none';s.photos=[];if(s.tab==='library')s.tab='explore';}}

/** Incremental authorization: the library fragment, requested from the "add photos" action only. */
export class RequestStorage extends PhotosAction {
 async run({state,local,grants}){const s=state.value;if(!s.account)return;s.wanted=true;s.storage='requesting';await persist(local,s);
  try{const result=await grants.requestStorage();if(result==='redirecting')return {redirecting:true};
   s.storage=result==='granted'?'granted':'none';toast(s,result==='granted'?'toast.storageOn':'toast.storageDeclined');return {result};
  }catch(error){s.storage='none';s.error=String(error?.message??error).slice(0,200);return {error:s.error};}}
}
export class StorageResult extends PhotosAction {run({state}){const s=state.value;s.storage=this.input.declined?'none':'reconnect';toast(s,this.input.declined?'toast.storageDeclined':'toast.storageReconnect');}}
export class Refresh extends PhotosAction {run(resources){return refresh(resources);}}

async function refresh({state,remote}){
 const s=state.value;if(!s.account||s.storage!=='granted'||!remote.ready())return;
 const index=await remote.read(INDEX_KEY);s.photos=(index?.value?.photos??[]).slice().sort((a,b)=>b.addedAt-a.addedAt);return {count:s.photos.length};
}
export class Upload extends PhotosAction {
 async run({state,remote,clock,ids}){const s=state.value,{title,type,bytes}=this.input;if(!s.account||s.storage!=='granted')return;
  if(!(bytes instanceof Uint8Array)||!/^image\/(png|jpeg|webp)$/.test(type))return void toast(s,'toast.unsupported');
  if(bytes.length>MAX_BYTES)return void toast(s,'toast.tooLarge');
  s.busy=true;
  try{const id=ids.next();await remote.writeBytes(photoKey(id),bytes,type);
   for(let attempt=0;attempt<3;attempt++){const index=await remote.read(INDEX_KEY),photos=index?.value?.photos??[];photos.push({id,title:String(title||'').slice(0,80),type,size:bytes.length,addedAt:clock.now()});
    try{await remote.write(INDEX_KEY,{v:1,photos},index?.version);break;}catch(error){if(error?.code!=='conflict'||attempt===2)throw error;}}
   await refresh({state,remote});toast(s,'toast.added');return {id};
  }catch(error){s.error=String(error?.message??error).slice(0,200);toast(s,'toast.uploadFailed');return {error:s.error};}
  finally{s.busy=false;}}
}
export class Remove extends PhotosAction {
 async run({state,remote}){const s=state.value,id=this.input.id;if(!s.account)return;
  const index=await remote.read(INDEX_KEY),photos=(index?.value?.photos??[]).filter(p=>p.id!==id),object=await remote.readBytes(photoKey(id));
  await remote.write(INDEX_KEY,{v:1,photos},index?.version);if(object)await remote.remove(photoKey(id),object.version);
  s.viewer=null;await refresh({state,remote});toast(s,'toast.removed');}
}
export const OPERATIONS=Object.freeze({load:Load,tab:Tab,view:View,panel:Panel,preference:Preference,dismissToast:DismissToast,connected:Connected,disconnected:Disconnected,requestStorage:RequestStorage,storageResult:StorageResult,refresh:Refresh,upload:Upload,remove:Remove});
export function createPhotosEngine({local,clock={now:()=>Date.now()},ids={next:()=>crypto.randomUUID()},remote,grants,locale}={}){
 return createAppEngine({state:createState(initialState({locale})),providers:{local,clock,ids,remote,grants},operations:OPERATIONS});
}
