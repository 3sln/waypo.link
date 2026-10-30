// Board business logic (ngin Actions; no DOM). Pattern shown: sign-in required (the view is behind <bindle-gate>);
// boards live in storage the person chooses; every change is announced on a personal event bus so other open boards
// follow live; assigning a card to yourself sends an app message to your provider inbox; an organization context comes
// from a member certificate the person's home provider issues (acquireMemberCertificate), exchanged at the
// organization's provider for a member-context token.
import {AppAction,createState,createAppEngine} from '../../kit/web/engine.mjs';

export const BOARD_KEY='boards/main.json';
export const COLUMNS=['todo','doing','done'];
const MAX_CARDS=200,MAX_TITLE=120;

export function initialState({locale='en',theme='system'}={}){
 return {locale,theme,ready:false,account:null,storage:'idle',board:null,version:null,error:null,
  live:{status:'off',cursor:null,received:0,flash:null},drafts:{},toast:null,panel:null,
  org:{phase:'none',address:'',handle:null,host:null,identity:null,exp:null,error:null}};
}
const persist=(local,s)=>local.save({locale:s.locale,theme:s.theme});
const toast=(s,key,vars)=>{s.toast={key,vars,at:Date.now()};};
const clean=text=>String(text??'').replace(/\s+/g,' ').trim().slice(0,MAX_TITLE);
/** A new person's first board: three empty columns (the seed is deterministic so a replay matches). */
export function emptyBoard(){return {v:1,rev:0,title:'',columns:COLUMNS.map(id=>({id,cards:[]}))};}
export const findCard=(board,id)=>{for(const column of board?.columns??[]){const card=column.cards.find(c=>c.id===id);if(card)return {column,card};}return null;};

class BoardAction extends AppAction {static deps=['state','local','clock','ids','remote','bus','messages','directory','member'];}

export class Load extends BoardAction {async run({state,local}){const s=state.value,saved=await local.load();if(saved){s.locale=saved.locale??s.locale;s.theme=saved.theme??s.theme;}s.ready=true;}}
export class Preference extends BoardAction {async run({state,local}){const s=state.value;if(['system','light','dark'].includes(this.input.theme))s.theme=this.input.theme;if(['en','es'].includes(this.input.locale))s.locale=this.input.locale;await persist(local,s);}}
export class Panel extends BoardAction {run({state}){state.value.panel=['org'].includes(this.input.panel)?this.input.panel:null;}}
export class DismissToast extends BoardAction {run({state}){state.value.toast=null;}}
export class Draft extends BoardAction {run({state}){state.value.drafts[this.input.column]=String(this.input.text??'').slice(0,MAX_TITLE);}}

/** Signed in: load (or create) the board from the person's storage. */
export class Connected extends BoardAction {
 async run(resources){const s=resources.state.value,{issuer,subject,label}=this.input;
  const switched=s.account&&(s.account.issuer!==issuer||s.account.subject!==subject);
  s.account={issuer,subject,label};if(switched){s.board=null;s.version=null;s.org=initialState().org;s.live=initialState().live;}
  return load(resources,{create:true});}
}
export class Disconnected extends BoardAction {run({state}){const s=state.value;s.account=null;s.board=null;s.version=null;s.storage='idle';s.live=initialState().live;s.org=initialState().org;s.panel=null;}}
export class Refresh extends BoardAction {run(resources){return load(resources,{create:false});}}

async function load({state,remote},{create}){
 const s=state.value;if(!s.account)return;s.storage=s.board?'ready':'loading';
 try{let doc=await remote.read(BOARD_KEY);
  if(!doc&&create){const version=await remote.write(BOARD_KEY,emptyBoard(),null).catch(error=>{if(error?.code==='conflict')return null;throw error;});doc=version?{value:emptyBoard(),version}:await remote.read(BOARD_KEY);}
  if(doc){s.board=doc.value;s.version=doc.version;}s.storage='ready';s.error=null;return {rev:s.board?.rev??null};
 }catch(error){s.storage='error';s.error=String(error?.message??error).slice(0,200);return {error:s.error};}
}
/** Read-modify-write with the storage contract's optimistic versions; `change(board)` returns the bus record or null. */
async function mutate({state,remote,bus},change){
 const s=state.value;
 for(let attempt=0;attempt<4;attempt++){
  const doc=await remote.read(BOARD_KEY),board=doc?.value??emptyBoard(),record=change(board);if(!record)return null;
  board.rev=(board.rev??0)+1;record.data.rev=board.rev;
  try{const version=await remote.write(BOARD_KEY,board,doc?.version??null);s.board=board;s.version=version;}
  catch(error){if(error?.code==='conflict'&&attempt<3)continue;throw error;}
  // The record is a hint for other open boards; the board document stays the source of truth.
  await bus.publish(record.type,record.data).catch(()=>{s.live={...s.live,status:'error'};});
  return record;
 }
}
export class AddCard extends BoardAction {
 async run(resources){const s=resources.state.value,column=this.input.column,title=clean(this.input.title??s.drafts[column]);if(!s.account||!COLUMNS.includes(column)||!title)return;
  const id=resources.ids.next();
  try{const record=await mutate(resources,board=>{const target=board.columns.find(c=>c.id===column);if(!target||board.columns.reduce((n,c)=>n+c.cards.length,0)>=MAX_CARDS)return null;target.cards.push({id,title,assignee:null,updatedAt:resources.clock.now()});return {type:'added',data:{card:id,column,title}};});
   s.drafts[column]='';return record?{id}:{refused:true};}
  catch(error){s.error=String(error?.message??error).slice(0,200);toast(s,'toast.saveFailed');return {error:s.error};}}
}
export class MoveCard extends BoardAction {
 async run(resources){const s=resources.state.value,{card,to}=this.input;if(!s.account||!COLUMNS.includes(to))return;
  try{const record=await mutate(resources,board=>{const found=findCard(board,card);if(!found||found.column.id===to)return null;found.column.cards=found.column.cards.filter(c=>c.id!==card);found.card.updatedAt=resources.clock.now();board.columns.find(c=>c.id===to).cards.push(found.card);return {type:'moved',data:{card,column:to,title:found.card.title}};});
   return record?{moved:true}:{unchanged:true};}
  catch(error){s.error=String(error?.message??error).slice(0,200);toast(s,'toast.saveFailed');return {error:s.error};}}
}
/** "Assign to me": the card names the person, and Board sends them an app message (createOwn) as a reminder. */
export class Assign extends BoardAction {
 async run(resources){const s=resources.state.value,{card,subject,body}=this.input;if(!s.account)return;
  let title=null;
  try{await mutate(resources,board=>{const found=findCard(board,card);if(!found||found.card.assignee?.subject===s.account.subject)return null;title=found.card.title;found.card.assignee={subject:s.account.subject,label:s.account.label};found.card.updatedAt=resources.clock.now();return {type:'assigned',data:{card,title}};});}
  catch(error){s.error=String(error?.message??error).slice(0,200);toast(s,'toast.saveFailed');return {error:s.error};}
  if(!title)return {unchanged:true};
  try{await resources.messages.send({subject:subject(title),body:body(title)});toast(s,'toast.assigned',{title});return {sent:true};}
  catch(error){s.error=String(error?.message??error).slice(0,200);toast(s,'toast.messageFailed');return {sent:false,error:s.error};}
 }
}
/** Live updates from the bus. A record is a hint that the board changed: Board reloads the document (the source of
 * truth) and highlights what moved, so it never depends on the record's payload. */
export class Live extends BoardAction {run({state}){const s=state.value;s.live={...s.live,...this.input};}}
export class RemoteChange extends BoardAction {
 async run(resources){const s=resources.state.value,record=this.input.record;s.live={...s.live,received:s.live.received+1,cursor:this.input.cursor??s.live.cursor};
  if(!s.account)return {ignored:true};
  const before=new Map((s.board?.columns??[]).flatMap(c=>c.cards.map(card=>[card.id,c.id+'|'+(card.assignee?.subject??'')])));
  const rev=s.board?.rev??0;await load(resources,{create:false});if((s.board?.rev??0)===rev)return {unchanged:true};
  const changed=(s.board?.columns??[]).flatMap(c=>c.cards.map(card=>({card:card.id,key:c.id+'|'+(card.assignee?.subject??'')}))).find(x=>before.get(x.card)!==x.key);
  s.live={...s.live,flash:changed?{card:changed.card,type:record?.type??'changed',at:Date.now()}:null};return {applied:s.board.rev,payload:record?.data??null};}
}

// ---- organization context ------------------------------------------------------------------------------------------
// The organization chooser (org-context spike OC-4, OC-11) is not built yet, so the person names their organization
// ("tell us where your organization is", OC-5): Board resolves the address through that provider's public directory.
export class OrgAddress extends BoardAction {run({state}){state.value.org={...state.value.org,address:String(this.input.address??'').slice(0,300),error:null};}}
export class FindOrg extends BoardAction {
 async run({state,directory}){const s=state.value,address=s.org.address.trim().replace(/^@/,'');const at=address.lastIndexOf('@');
  if(at<1||at===address.length-1){s.org={...s.org,phase:'none',error:'address'};return;}
  s.org={...s.org,phase:'finding',error:null};
  try{const found=await directory.resolve(address.slice(0,at),address.slice(at+1));
   s.org={...s.org,phase:'found',handle:address.slice(0,at),host:address.slice(at+1),identity:found.identity,error:null};return {identity:found.identity};}
  catch{s.org={...s.org,phase:'none',error:'not-found'};}}
}
export class OrgCertifying extends BoardAction {run({state}){state.value.org={...state.value.org,phase:'certifying',error:null};}}
/** The certificate is held (popup consent done); now the member-context token at the organization's provider. */
export class OrgCertified extends BoardAction {
 async run({state,member}){const s=state.value;s.org={...s.org,phase:'exchanging',exp:this.input.exp,error:null};
  try{const token=await member.exchange();s.org={...s.org,phase:'member',error:null};return {token:!!token};}
  catch(error){
   // `invalid_grant` is the organization's only answer for every refusal (organizations §5.3): most often the
   // organization has not connected Board yet. Board keeps the certificate and says so plainly.
   s.org={...s.org,phase:'pending',error:error?.code==='invalid_grant'?'not-connected':'failed'};return {error:error?.code??'failed'};}}
}
export class OrgFailed extends BoardAction {run({state}){const s=state.value;s.org={...s.org,phase:s.org.identity?'found':'none',error:this.input.code==='canceled'?'canceled':'certify'};}}
export class LeaveOrg extends BoardAction {run({state}){state.value.org=initialState().org;}}

export const OPERATIONS=Object.freeze({load:Load,preference:Preference,panel:Panel,dismissToast:DismissToast,draft:Draft,connected:Connected,disconnected:Disconnected,refresh:Refresh,
 addCard:AddCard,moveCard:MoveCard,assign:Assign,live:Live,remoteChange:RemoteChange,orgAddress:OrgAddress,findOrg:FindOrg,orgCertifying:OrgCertifying,orgCertified:OrgCertified,orgFailed:OrgFailed,leaveOrg:LeaveOrg});
export function createBoardEngine({local,clock={now:()=>Date.now()},ids={next:()=>crypto.randomUUID()},remote,bus,messages,directory,member,locale}={}){
 return createAppEngine({state:createState(initialState({locale})),providers:{local,clock,ids,remote,bus,messages,directory,member},operations:OPERATIONS});
}
