// INT-9: intent data remains in one in-memory flow. Navigation and receipt never perform an effect.
// Bindle Messaging `connect` (messaging §4.1–§4.2, contacts spike phase 3; provisional, unsigned): receipt validates locally
// and fetches nothing; the first armed confirmation only verifies (invites.inspect); only a second, re-armed confirmation
// redeems (invites.redeem). The token is a bearer secret: it stays in this in-memory flow and is never stored or logged.
import {Action} from '../../../../vendor/ngin/index.js';
import {decodeIntent} from '../../../../packages/intents/format.mjs';
import {validateIntentData} from '../../../../packages/intents/schema.mjs';
const definitions=[{"bindle_artefact":1,"id":"https://spec.bindle.example/intents/open-conversation/v1","kind":"intent","versions":[{"version":1,"prev":null,"body":{"id":"https://spec.bindle.example/intents/open-conversation/v1","title":{"en":"Open a conversation"},"summary":{"en":"Opens this conversation in the messaging app you choose, if you are one of its participants."},"publisher":"https://spec.bindle.example","effect":"view","capability":false,"data":{"type":"object","properties":{"conversation":{"type":"string","maxLength":36,"format":"uuid"},"creator":{"type":"principal"},"profile":{"type":"string","maxLength":256,"format":"https-url"}},"required":["conversation","creator","profile"]},"disclosure":{"categories":["personal-data"],"fields":{"conversation":{"title":{"en":"Conversation"},"categories":["personal-data"],"display":"presence"},"creator":{"title":{"en":"Started by"},"categories":["personal-data"],"display":"value"},"profile":{"title":{"en":"Messaging standard"},"categories":[],"display":"origin"}}}}}]},{"bindle_artefact":1,"id":"https://spec.bindle.example/messaging/v1/intents/connect","kind":"intent","versions":[{"version":1,"prev":null,"body":{"id":"https://spec.bindle.example/messaging/v1/intents/connect","title":{"en":"Accept an invitation","es":"Aceptar una invitación"},"summary":{"en":"After you confirm, lets the person who invited you message you in the messaging app you choose. Your app tells them which account accepted.","es":"Cuando confirmas, permite que la persona que te invitó te escriba en la aplicación de mensajes que elijas. Tu aplicación le indica qué cuenta aceptó."},"publisher":"https://spec.bindle.example","effect":"send","capability":true,"data":{"type":"object","properties":{"inviter":{"type":"principal"},"token":{"type":"string","maxLength":43,"format":"capability"},"delegation":{"type":"string","maxLength":2048},"expires_at":{"type":"integer","minimum":0,"maximum":9007199254740991},"hint":{"type":"enum","values":["no-reply"]}},"required":["delegation","inviter","token"]},"disclosure":{"categories":["personal-data","send-as-you"],"fields":{"inviter":{"title":{"en":"Invited by","es":"Te invita"},"categories":["personal-data"],"display":"value"},"token":{"title":{"en":"Invitation code","es":"Código de invitación"},"categories":[],"display":"presence"},"delegation":{"title":{"en":"Inviter’s app certificate","es":"Certificado de la aplicación de quien invita"},"categories":["personal-data"],"display":"presence"},"expires_at":{"title":{"en":"Expires","es":"Caduca"},"categories":[],"display":"value"},"hint":{"title":{"en":"The inviter says you won't be able to reply","es":"Quien invita dice que no podrás responder"},"categories":[],"display":"value"}}}}}]}],digests=['sha256-BVp7Z5PiP2NNpO9cb-mxI_8uyZWO1PKJ5PsKgPZNU70','sha256-oCyJ6fKE_vJrmdRY5bF5U_R8t_pfE2HZoZy81yG7H-g'];
export const CONNECT_KIND='https://spec.bindle.example/messaging/v1/intents/connect';
export const CONNECT_REFERENCE=Object.freeze({artefact:CONNECT_KIND,version:1,digest:digests[definitions.findIndex(d=>d.id===CONNECT_KIND)]});
/** Short handler name of a pinned kind id ('connect' or 'open-conversation'). The contact-link kinds send-message and
 * add-contact were removed with contact links (contacts spike phase 4); a link naming them is refused on receipt. */
export const intentKindName=id=>id===CONNECT_KIND?'connect':String(id).split('/').at(-2);
const ARM_MS=800,FLOW_MS=3600000,B64=/^[A-Za-z0-9_-]+$/;
// Failure categories rendered as fixed text (ui/locale.mjs); `used` and `unverifiable` end the flow, `unavailable` re-arms.
const CONNECT_FAILURES=Object.freeze({invite_used:'used',invite_expired:'used',invalid_input:'used',invite_unverifiable:'unverifiable'});
const fail=()=>{throw Object.assign(new Error('Intent unavailable'),{code:'intent_kind_invalid'});};
const malformed=()=>{throw Object.assign(new Error('Intent unavailable'),{code:'intent_malformed'});};
class IntentAction extends Action {
 async execute(resources,{dispatchFeed,engineFeed}){if(!resources.state.enabled||!resources.state.intentLinksEnabled)throw Object.assign(new Error('Disabled'),{code:'not_found'});try{const result=await this.run(resources);resources.state.value.intentError=null;dispatchFeed.dispatchEvent(new CustomEvent('result',{detail:result??null}));}catch(error){resources.state.value.intentError=true;throw error;}finally{engineFeed.dispatchEvent(new Event('web-changed'));}}
}
export class ReceiveAppIntent extends IntentAction {
 static deps=['state','browser'];constructor(input={}){super();this.input=input;}
 run({state,browser}){const intent=decodeIntent(this.input.value),index=definitions.findIndex(d=>d.id===intent.kind.artefact);if(index<0||intent.kind.version!==1||intent.kind.digest!==digests[index])fail();validateIntentData(definitions[index].versions[0].body,intent.data);
  const now=browser.now(),flow={intent,actor:browser.owner,armedAt:now+ARM_MS,expiresAt:now+FLOW_MS};
  // Messaging §4.2 step 1: the data shape and expiry are checked here, locally. Nothing is fetched or sent.
  if(intent.kind.artefact===CONNECT_KIND){const d=intent.data;if(!/^[A-Za-z0-9_-]{22,43}$/.test(d.token)||d.delegation.split('.').length!==3||!d.delegation.split('.').every(part=>B64.test(part)))malformed();
   if(d.expires_at!==undefined&&d.expires_at*1000<=now)Object.assign(flow,{error:'used',terminal:true});}
  state.value.intentFlow=flow;}
}
export class ConfirmAppIntent extends IntentAction {
 static deps=['state','browser','mailbox'];constructor(input={}){super();this.input=input;}
 async run({state,browser,mailbox}){const flow=state.value.intentFlow;if(!state.enabled||!state.intentLinksEnabled||!flow||flow.busy||flow.terminal||browser.now()<flow.armedAt||browser.now()>=flow.expiresAt||!state.value.online)return;flow.busy=true;
 try{const {intent}=flow,kind=intentKindName(intent.kind.artefact),call=(name,input,id)=>mailbox.run(name,{input,...id?{id}:{}});
  if(kind==='connect'){
   try{
    if(!flow.inspected){
     // Steps 2–4: verification only. The engine verifies the certificate, its jkt status and its ingress; nothing is sent.
     const r=await call('invites.inspect',{data:intent.data});
     flow.inspected={handle:typeof r?.handle==='string'&&r.handle?r.handle:null,host:typeof r?.host==='string'&&r.host?r.host:new URL(intent.data.inviter.iss).host,hint:r?.hint==='no-reply'||intent.data.hint==='no-reply'?'no-reply':null,alreadyContact:r?.alreadyContact===true,pending:Boolean(r?.pending)};
     flow.error=null;flow.armedAt=browser.now()+ARM_MS;return {inspected:true};
    }
    // Step 5: only this second, re-armed explicit confirmation admits the inviter and sends the redemption.
    const r=await call('invites.redeem',{data:intent.data});
    if(state.value.intentFlow===flow)state.value.intentFlow=null;
    Object.assign(state.value,{section:'conversations',detail:null,page:0,notice:r?.state==='accepted'?'invite-accepted':'invite-pending'});return {state:r?.state??'pending'};
   }catch(error){
    const category=CONNECT_FAILURES[error?.code]??'unavailable';flow.error=category;
    if(category==='unavailable')flow.armedAt=browser.now()+ARM_MS;else flow.terminal=true;return {error:category};
   }
  }
  if(kind==='open-conversation'){if(intent.data.profile!=='https://spec.bindle.example/messaging/v1')fail();const result=await call('conversations.get',{conversationId:intent.data.conversation,limit:40});if(result.creator?.issuer!==intent.data.creator.iss||result.creator?.subject!==intent.data.creator.sub)fail();state.value.detail=result;state.value.section='conversations';}
  else fail();
  if(state.value.intentFlow===flow)state.value.intentFlow=null;
 }finally{flow.busy=false;}}
}
export class DiscardAppIntent extends Action {
 static deps=['state'];execute({state},{dispatchFeed,engineFeed}){if(!state.enabled)throw Object.assign(new Error('Disabled'),{code:'not_found'});state.value.intentFlow=null;dispatchFeed.dispatchEvent(new CustomEvent('result',{detail:null}));engineFeed.dispatchEvent(new Event('web-changed'));}
}
