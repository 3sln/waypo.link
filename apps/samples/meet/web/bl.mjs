// Meet business logic (ngin Actions; no DOM). Pattern shown: a public join link anyone can open signed out (the guest
// view); signing in is needed to call, and the call itself is a signaling session between two people on different
// providers. The `meetings` provider (main.mjs) does the signaling and WebRTC work; actions keep the state.
import {AppAction,createState,createAppEngine} from '../../kit/web/engine.mjs';

/** phase: home | guest | lobby | approval | joining | ringing | connecting | in-call | ended | unavailable */
export function initialState({locale='en',theme='system'}={}){
 return {locale,theme,account:null,signIn:false,route:{name:'home'},draft:'',meeting:null,phase:'home',incoming:null,approval:null,
  chat:[],peer:null,startedAt:null,endedAt:null,endReason:null,busy:false,error:null,recent:[],toast:null,connection:null,name:''};
}
const persist=(local,s)=>local.save({locale:s.locale,theme:s.theme,recent:s.recent.slice(0,6),name:s.name});
const toast=(s,key,vars)=>{s.toast={key,vars,at:Date.now()};};
/** How this person appears to others in a call: the name they gave Meet, else the account label. */
const label=s=>s.name.trim()||s.account?.label||'';
class MeetAction extends AppAction {static deps=['state','local','meetings','clock'];}

export class Load extends MeetAction {async run({state,local}){const s=state.value,saved=await local.load();if(saved)Object.assign(s,{locale:saved.locale??s.locale,theme:saved.theme??s.theme,recent:Array.isArray(saved.recent)?saved.recent:[],name:typeof saved.name==='string'?saved.name.slice(0,60):''});}}
export class Preference extends MeetAction {async run({state,local}){const s=state.value;if(['system','light','dark'].includes(this.input.theme))s.theme=this.input.theme;if(['en','es'].includes(this.input.locale))s.locale=this.input.locale;await persist(local,s);}}
export class DismissToast extends MeetAction {run({state}){state.value.toast=null;}}
export class Panel extends MeetAction {run({state}){state.value.signIn=!!this.input.signIn;}}
export class Draft extends MeetAction {run({state}){state.value.draft=String(this.input.title??'').slice(0,80);}}
export class Name extends MeetAction {async run({state,local}){const s=state.value;s.name=String(this.input.name??'').slice(0,60);await persist(local,s);}}

/** The page the URL names: home, or a meeting (/j/<id>) whose public card the server returns. */
export class Route extends MeetAction {
 async run({state,meetings}){const s=state.value,id=this.input.meeting??null;
  if(!id){s.route={name:'home'};if(!['lobby','ringing','connecting','in-call'].includes(s.phase)||s.meeting?.role!=='host')s.phase='home';return;}
  s.route={name:'meeting',id};
  if(s.meeting?.id===id&&s.phase!=='home')return;
  const card=await meetings.card(id);
  if(!card||card.ended){s.meeting=card?{...card,role:'guest'}:null;s.phase='unavailable';return;}
  s.meeting={...card,role:s.meeting?.id===id?s.meeting.role:'guest'};s.phase=s.account?'lobby':'guest';
 }
}
export class Connected extends MeetAction {
 run({state}){const s=state.value,{issuer,subject,label:name}=this.input;s.account={issuer,subject,label:name};s.signIn=false;
  if(s.route.name==='meeting'&&s.meeting&&s.phase==='guest')s.phase='lobby';}
}
export class Disconnected extends MeetAction {run({state}){const s=state.value;s.account=null;if(s.route.name==='meeting'&&s.meeting&&!['ended','unavailable'].includes(s.phase))s.phase='guest';else if(s.route.name==='home')s.phase='home';}}

/** Host: register an endpoint, mint an offer, publish the meeting. */
export class CreateMeeting extends MeetAction {
 async run({state,local,meetings,clock}){const s=state.value;if(!s.account||s.busy)return;const title=s.draft.trim()||null;if(!title)return void toast(s,'toast.needTitle');
  s.busy=true;s.error=null;
  try{const created=await meetings.create({title,host:{...s.account,label:label(s)}});
   s.meeting={id:created.id,title,host:{label:label(s),issuer:s.account.issuer},link:created.link,role:'host',expiresAt:created.expiresAt};
   s.route={name:'meeting',id:created.id};s.phase='lobby';s.draft='';s.chat=[];s.endReason=null;
   s.recent=[{id:created.id,title,at:clock.now()},...s.recent.filter(m=>m.id!==created.id)].slice(0,6);await persist(local,s);return {id:created.id,link:created.link};
  }catch(error){return fault(s,error);}finally{s.busy=false;}}
}
/** Guest: ask the server for the offer, open the session to the host, invite. */
export class Join extends MeetAction {
 async run({state,meetings}){const s=state.value;if(!s.account||!s.meeting||s.busy)return;s.busy=true;s.error=null;s.chat=[];s.endReason=null;s.phase='joining';
  try{await meetings.join({meeting:s.meeting.id,label:label(s)});}catch(error){return fault(s,error);}finally{s.busy=false;}}
}
function fault(s,error){
 const code=error?.code??null;
 if(code==='approval_required'){s.phase='approval';s.approval={url:error.url};return {approval:true};}
 if(code==='ended'){s.phase='unavailable';return {ended:true};}
 s.error={code,message:String(error?.message??error).slice(0,240)};s.phase=s.meeting?(s.account?'lobby':'guest'):'home';toast(s,'toast.failed');return {error:s.error};
}
export class ApprovalDone extends MeetAction {
 async run(resources){const s=resources.state.value;s.approval=null;s.phase=s.meeting?'lobby':'home';
  // Retry what needed the approval: publishing the meeting (host) or joining it (guest).
  if(!s.meeting)return CreateMeeting.prototype.run.call({input:{}},resources);
  if(s.meeting.role==='guest')return Join.prototype.run.call({input:{}},resources);}
}
/** Host: someone asked to join (an `invite` event matched the meeting's offer). */
export class Incoming extends MeetAction {run({state}){const s=state.value;if(['in-call','connecting'].includes(s.phase))return;s.incoming={sid:this.input.sid,label:this.input.label??null,issuer:this.input.issuer};s.phase='ringing';}}
export class Accept extends MeetAction {
 async run({state,meetings}){const s=state.value;if(!s.incoming||s.busy)return;s.busy=true;const incoming=s.incoming;s.peer={label:incoming.label,issuer:incoming.issuer};s.incoming=null;s.phase='connecting';s.chat=[];
  try{await meetings.accept({sid:incoming.sid,label:label(s)});}catch(error){return fault(s,error);}finally{s.busy=false;}}
}
export class Decline extends MeetAction {async run({state,meetings}){const s=state.value;if(!s.incoming)return;const incoming=s.incoming;s.incoming=null;s.phase='lobby';await meetings.decline({sid:incoming.sid}).catch(()=>{});toast(s,'toast.declined');}}
/** Every change the call reports (main.mjs `emit`). */
export class CallEvent extends MeetAction {
 run({state,clock}){const s=state.value,e=this.input;
  if(e.state==='ringing'&&s.phase==='joining')s.phase='ringing';
  if(e.state==='connecting'&&['joining','ringing','connecting'].includes(s.phase))s.phase='connecting';
  if(e.state==='in-call'&&s.phase!=='ended'){s.phase='in-call';s.startedAt??=clock.now();}
  if(e.connection)s.connection=e.connection;
  if(e.peer)s.peer={...s.peer,...e.peer};
  if(e.state==='ended'&&s.phase!=='ended'){s.phase='ended';s.endedAt=clock.now();s.endReason=e.reason??'closed';s.incoming=null;}
  if(e.chat){if(e.chat.hello){if(e.chat.from)s.peer={...s.peer,label:e.chat.from};s.chat.push({system:'joined',from:e.chat.from,at:clock.now()});}else s.chat.push({text:e.chat.text,mine:!!e.chat.mine,from:e.chat.from??null,at:clock.now()});s.chat=s.chat.slice(-40);}
  if(e.error){s.error={code:e.error.code??null,message:String(e.error.message??'').slice(0,240)};}
 }
}
export class Say extends MeetAction {run({state,meetings}){const text=String(this.input.text??'').trim().slice(0,500);if(text)meetings.say(text);}}
export class HangUp extends MeetAction {async run({state,meetings}){const s=state.value;await meetings.hangUp();if(s.phase!=='ended'){s.phase='ended';s.endedAt=Date.now();s.endReason='closed';}}}
export class Leave extends MeetAction {async run({state,meetings}){const s=state.value;await meetings.leave?.();s.meeting=null;s.phase='home';s.route={name:'home'};s.peer=null;s.chat=[];s.startedAt=null;s.endedAt=null;s.endReason=null;s.connection=null;}}
export class Copied extends MeetAction {run({state}){toast(state.value,'toast.copied');}}

export const OPERATIONS=Object.freeze({load:Load,preference:Preference,dismissToast:DismissToast,panel:Panel,draft:Draft,name:Name,route:Route,connected:Connected,disconnected:Disconnected,
 createMeeting:CreateMeeting,join:Join,approvalDone:ApprovalDone,incoming:Incoming,accept:Accept,decline:Decline,callEvent:CallEvent,say:Say,hangUp:HangUp,leave:Leave,copied:Copied});
export function createMeetEngine({local,meetings,clock={now:()=>Date.now()},locale}={}){
 return createAppEngine({state:createState(initialState({locale})),providers:{local,meetings,clock},operations:OPERATIONS});
}
