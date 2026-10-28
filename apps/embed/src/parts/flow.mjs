// Island-initiated flows (profile §8; embed-islands §4.3–4.4). The intent comes only from the activated control.
// `prepare` is stored, never acted on, and consumed by one flow. `flow{ended}` follows every `flow{started}`
// exactly once with a generic outcome; `code` goes out only when the parent origin verified at init equals the
// origin of the flow's redirectUri, and only between started and ended. When delivery is impossible (no
// prepare, origin mismatch, sandboxed, popup unavailable) the island opens nothing and reports `unavailable`.
// v1 controls all use intent `login` (profile §5.4).
//
// Transport: always the frame-initiated popup, opened synchronously in the activation. Islands never delegate to
// FedCM (extensions rev 3.3 §2.7, CR-X3-33, provisional): the component origin creates authorization entries only.
import {openPopup,runPopupFlow} from '../bridge.mjs';
export function createFlows({model,send,worker,issuer,win=globalThis.window,refresh=()=>{}}){
  const end=(outcome,used)=>{model.flow=null;if(model.prepare===used)model.prepare=null;send({v:1,type:'flow',phase:'ended',outcome});refresh();};
  // The code goes to the app first; the claim is redeemed only for a binding whose code really reached it (IMPL-9).
  async function deliver(client,result,used){
    const delivered=send({v:1,type:'code',code:result.code,state:result.state,iss:result.iss});
    if(result.claim)try{await client.call('redeem',{claim:result.claim,delivered});}catch{}
    end('completed',used);
  }
  /** Call synchronously from a trusted, armed activation. */
  return function start(){
    if(model.flow)return;
    const prepare=model.prepare,deliverable=Boolean(prepare)&&(()=>{try{return new URL(prepare.redirectUri).origin===model.parentOrigin;}catch{return false;}})();
    model.flow='pending';send({v:1,type:'flow',phase:'started'});refresh();
    if(model.sandboxed||!deliverable){end('unavailable',prepare);return;}
    const popup=openPopup(win);if(!popup){end('unavailable',prepare);return;}
    (async()=>{
      let client;try{client=await worker();}catch{try{popup.close();}catch{}end('unavailable',prepare);return;}
      const result=await runPopupFlow({win,popup,issuer,prepare,createEntry:()=>client.call('createEntry',{prepare}),prove:args=>client.call('proof',args)});
      if(result.outcome!=='completed'){end(result.outcome,prepare);return;}
      await deliver(client,result,prepare);
    })();
  };
}
