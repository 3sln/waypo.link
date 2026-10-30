// Notes business logic: ngin Actions over named providers (state, local, clock, ids, remote, grants). No DOM here,
// so the whole app can be driven headless. Notes is local-first: every note lives on this device; signing in adds a
// synced copy in storage the user chose at their provider, and merges both ways (newest edit wins per note).
import {AppAction,createState,createAppEngine} from '../../kit/web/engine.mjs';

export const MESSAGES_FRAGMENT='https://3sln.me/artefacts/preferences/app-messages/v1';
export const INDEX_KEY='index.json',noteKey=id=>`notes/${id}.json`;
const visible=notes=>notes.filter(n=>!n.deleted);
export function initialState({locale='en',theme='system'}={}){
 return {locale,theme,notes:[],selected:null,query:'',view:'list',sort:'updated',
  account:null,lastAccount:null,others:{},sync:{status:'local',at:null,error:null},
  reminders:{enabled:false,wanted:false,busy:false,error:null},settings:false,signIn:false,toast:null,removal:null,ready:false};
}
export function sortedNotes(state){
 const q=state.query.trim().toLowerCase(),list=visible(state.notes).filter(n=>!q||(n.title+' '+n.body).toLowerCase().includes(q));
 return state.sort==='title'?list.sort((a,b)=>(a.title||'￿').localeCompare(b.title||'￿')||b.updatedAt-a.updatedAt):list.sort((a,b)=>b.updatedAt-a.updatedAt);
}
const persist=async(local,s)=>local.save({notes:s.notes,others:s.others,lastAccount:s.lastAccount,theme:s.theme,locale:s.locale,reminders:s.reminders.enabled,remindersWanted:s.reminders.wanted===true});
const toast=(s,key,vars)=>{s.toast={key,vars,at:Date.now()};};

class NotesAction extends AppAction {static deps=['state','local','clock','ids','remote','grants'];}

export class Load extends NotesAction {
 async run({state,local}){const s=state.value,saved=await local.load();if(saved){s.notes=saved.notes??[];s.others=saved.others&&typeof saved.others==='object'?saved.others:{};s.lastAccount=saved.lastAccount??null;s.theme=saved.theme??s.theme;s.locale=saved.locale??s.locale;s.reminders.enabled=saved.reminders===true;s.reminders.wanted=saved.remindersWanted===true;}s.ready=true;s.selected=sortedNotes(s)[0]?.id??null;}
}
export class Create extends NotesAction {
 async run({state,local,clock,ids}){const s=state.value,now=clock.now(),note={id:ids.next(),title:'',body:'',createdAt:now,updatedAt:now,dirty:true};s.notes.push(note);s.selected=note.id;s.view='editor';s.query='';await persist(local,s);return note.id;}
}
export class Edit extends NotesAction {
 async run({state,local,clock}){const s=state.value,note=s.notes.find(n=>n.id===this.input.id&&!n.deleted);if(!note)return;
  let changed=false;for(const field of ['title','body'])if(typeof this.input[field]==='string'&&this.input[field]!==note[field]){note[field]=this.input[field].slice(0,field==='title'?200:20000);changed=true;}
  if(changed){note.updatedAt=clock.now();note.dirty=true;if(s.account&&s.sync.status==='synced')s.sync.status='pending';await persist(local,s);}return changed;}
}
export class Remove extends NotesAction {
 async run({state,local,clock}){const s=state.value,note=s.notes.find(n=>n.id===this.input.id);if(!note)return;note.deleted=true;note.title='';note.body='';note.updatedAt=clock.now();note.dirty=true;
  s.selected=sortedNotes(s)[0]?.id??null;s.view='list';toast(s,'toast.deleted');await persist(local,s);}
}
export class Select extends NotesAction {run({state}){const s=state.value;if(this.input.id===null){s.view='list';return;}if(s.notes.some(n=>n.id===this.input.id&&!n.deleted)){s.selected=this.input.id;s.view='editor';}}}
export class Search extends NotesAction {run({state}){state.value.query=String(this.input.query??'').slice(0,100);}}
export class Panel extends NotesAction {run({state}){const s=state.value;if('settings' in this.input)s.settings=!!this.input.settings;if('signIn' in this.input)s.signIn=!!this.input.signIn;}}
export class Preference extends NotesAction {
 async run({state,local}){const s=state.value;if(['system','light','dark'].includes(this.input.theme))s.theme=this.input.theme;if(['en','es'].includes(this.input.locale))s.locale=this.input.locale;await persist(local,s);}
}
export class DismissToast extends NotesAction {run({state}){state.value.toast=null;}}

const accountKey=account=>`${account.issuer} ${account.subject}`;
/** A provider session became current. From signed out, the device's notes are merged into that account's copy (the
 * local-first promise). A switch between two held accounts never mixes them: the outgoing account's notes are parked
 * on this device under its key, and the incoming account's parked notes (if any) come back before syncing. */
export class Connected extends NotesAction {
 async run(resources){const {state,local}=resources,s=state.value,{issuer,subject,label}=this.input;
  const switched=s.account&&(s.account.issuer!==issuer||s.account.subject!==subject);
  if(switched){const incoming=accountKey({issuer,subject});s.others[accountKey(s.account)]=s.notes;s.notes=s.others[incoming]??[];delete s.others[incoming];s.selected=null;}
  s.account={issuer,subject,label};s.lastAccount={issuer,subject,label};s.signIn=false;
  // Reminders follow the session's actual grant: on when the app-messages fragment is granted, whatever the device remembered.
  if(Array.isArray(this.input.fragments))s.reminders={...s.reminders,enabled:this.input.fragments.includes(MESSAGES_FRAGMENT),busy:false,error:null};
  await persist(local,s);return sync(resources,{first:true});}
}
export class Disconnected extends NotesAction {
 async run({state,local}){const s=state.value;if(!s.account)return;s.account=null;s.sync={status:'local',at:null,error:null};s.reminders.busy=false;
  if(this.input.forget)s.lastAccount=null;await persist(local,s);}
}
export class Sync extends NotesAction {run(resources){return sync(resources,{});}}

async function sync({state,local,remote,clock},{first=false}){
 const s=state.value;if(!s.account||!remote.ready())return {skipped:true};
 if(s.sync.status==='syncing')return {busy:true};
 s.sync={...s.sync,status:'syncing',error:null};
 try{
  const prefs=await remote.preferences().catch(()=>null);if(prefs?.values?.sort&&['updated','title'].includes(prefs.values.sort))s.sort=prefs.values.sort;
  for(let attempt=0;attempt<3;attempt++){
   const index=await remote.read(INDEX_KEY),entries={...index?.value?.notes??{}};let changed=!index;
   const byId=new Map(s.notes.map(n=>[n.id,n]));
   for(const id of new Set([...byId.keys(),...Object.keys(entries)])){
    const mine=byId.get(id),theirs=entries[id];
    if(mine&&(!theirs||mine.updatedAt>theirs.updatedAt||mine.dirty&&mine.updatedAt>=theirs.updatedAt)){
     const current=await remote.read(noteKey(id));
     if(mine.deleted){if(current)await remote.remove(noteKey(id),current.version);}
     else await remote.write(noteKey(id),{v:1,id,title:mine.title,body:mine.body,createdAt:mine.createdAt,updatedAt:mine.updatedAt},current?.version);
     entries[id]={updatedAt:mine.updatedAt,...mine.deleted?{deleted:true}:{}};changed=true;
    }else if(theirs&&(!mine||theirs.updatedAt>mine.updatedAt)){
     if(theirs.deleted){if(mine)Object.assign(mine,{deleted:true,title:'',body:'',updatedAt:theirs.updatedAt});else s.notes.push({id,title:'',body:'',createdAt:theirs.updatedAt,updatedAt:theirs.updatedAt,deleted:true});}
     else{const doc=await remote.read(noteKey(id));if(doc){const value={id,title:doc.value.title??'',body:doc.value.body??'',createdAt:doc.value.createdAt??theirs.updatedAt,updatedAt:doc.value.updatedAt??theirs.updatedAt};if(mine)Object.assign(mine,value,{deleted:false});else s.notes.push(value);}}
    }
   }
   if(changed){try{await remote.write(INDEX_KEY,{v:1,notes:entries},index?.version);}catch(error){if(error?.code==='conflict'&&attempt<2)continue;throw error;}}
   break;
  }
  for(const note of s.notes)delete note.dirty;
  if(!s.selected||!s.notes.some(n=>n.id===s.selected&&!n.deleted))s.selected=sortedNotes(s)[0]?.id??null;
  s.sync={status:'synced',at:clock.now(),error:null};if(first){const count=visible(s.notes).length;toast(s,count===0?'toast.syncedEmpty':count===1?'toast.syncedOne':'toast.synced',{count});}
  await persist(local,s);return {synced:visible(s.notes).length};
 }catch(error){s.sync={status:error?.code==='offline'?'offline':'error',at:s.sync.at,error:String(error?.message??error).slice(0,200)};return {error:s.sync.error};}
}

/** Incremental authorization: ask for app messages only when the person turns reminders on. */
export class EnableReminders extends NotesAction {
 async run({state,local,grants}){const s=state.value;if(!s.account)return;s.reminders={...s.reminders,wanted:true,busy:true,error:null};await persist(local,s);
  try{const result=await grants.requestMessages();
   if(result==='redirecting')return {redirecting:true};
   s.reminders={enabled:result==='granted',wanted:result==='granted',busy:false,error:result==='granted'?null:'declined'};toast(s,result==='granted'?'toast.remindersOn':'toast.remindersDeclined');await persist(local,s);return {result};
  }catch(error){s.reminders={...s.reminders,busy:false,error:'failed'};return {error:error.message};}}
}
/** The outcome of a redirect-mode incremental request, read on the callback page. */
export class RemindersResult extends NotesAction {async run({state,local}){const s=state.value,granted=this.input.granted===true;s.reminders={enabled:granted,wanted:true,busy:false,error:granted?null:'declined'};toast(s,granted?'toast.remindersOn':'toast.remindersDeclined');await persist(local,s);}}
export class DisableReminders extends NotesAction {async run({state,local}){const s=state.value;s.reminders={enabled:false,wanted:false,busy:false,error:null};await persist(local,s);}}
export class Remind extends NotesAction {
 async run({state,grants}){const s=state.value,note=s.notes.find(n=>n.id===this.input.id&&!n.deleted);if(!note||!s.account)return;
  try{await grants.sendMessage({subject:this.input.subject,body:this.input.body});toast(s,'toast.reminderSent');return {sent:true};}
  catch(error){s.lastError=String(error?.message??error).slice(0,200);toast(s,'toast.reminderFailed');return {error:error.message};}}
}

export const OPERATIONS=Object.freeze({load:Load,create:Create,edit:Edit,remove:Remove,select:Select,search:Search,panel:Panel,preference:Preference,dismissToast:DismissToast,connected:Connected,disconnected:Disconnected,sync:Sync,enableReminders:EnableReminders,remindersResult:RemindersResult,disableReminders:DisableReminders,remind:Remind});
export function createNotesEngine({local,clock={now:()=>Date.now()},ids={next:()=>crypto.randomUUID()},remote,grants,locale,theme}={}){
 return createAppEngine({state:createState(initialState({locale,theme})),providers:{local,clock,ids,remote,grants},operations:OPERATIONS});
}
