import {Action} from '../shared/stack.mjs';
import {snapshot,publish,expireOwner} from './owner-flow.mjs';
import {accountContextError} from './account-context.mjs';
import {cancelStepUp} from './step-up.mjs';
export const termsPending=state=>!!state.session?.account&&typeof state.config?.termsVersion==='string'&&state.session.account.termsVersion!==state.config.termsVersion;
// Acceptance never resumes an older security-sensitive mutation. A covered
// confirmation is cancelled after success and its old generation is invalidated.
export class AcceptTerms extends Action {
 static deps={state:{write:true},api:{},browser:{}};
 async execute(resources,ctx){const state=snapshot(resources);if(!termsPending(state)||state.offline||!resources.state.reserve())return;const owner=state.session.account.id,session=state.session.sessionContext,generation=state.beamGeneration??0,version=state.config.termsVersion,current=()=>snapshot(resources).session?.account?.id===owner&&snapshot(resources).session?.sessionContext===session&&(snapshot(resources).beamGeneration??0)===generation&&!snapshot(resources).offline,r={...resources,current};publish(r,ctx,{});
  try{const result=await r.api.request('/api/auth/terms/accept',{termsVersion:version});if(!current())return;if(result.account?.id!==owner||result.account.termsVersion!==version)throw Error(state.locale==='es'?'No se pudo verificar la aceptación. Inténtalo de nuevo.':'Acceptance could not be verified. Please try again.');const live=snapshot(r),covered=!!live.stepUp;if(covered)cancelStepUp(r.browser);publish(r,ctx,{session:{...live.session,account:result.account},...live.data?{data:{...live.data,account:result.account}}:{},modal:null,stepUp:null,error:'',busy:false,...covered?{beamGeneration:generation+1}:{}});r.browser.focusAccountContent?.();}
  catch(error){if(!current())return;if(error.status===401||accountContextError(error)){expireOwner(r,ctx);return;}if(error.code==='terms_required'){try{const config=await r.api.get('/api/config');if(!current())return;if(typeof config?.termsVersion!=='string'||!config.termsVersion)throw Error('Invalid policy version');publish(r,ctx,{config,error:state.locale==='es'?'Revisa los términos actuales de la cuenta.':'Review the current account terms.'});}catch{if(current())publish(r,ctx,{error:state.locale==='es'?'No se pudieron cargar las políticas actualizadas. Recarga la página e inténtalo de nuevo.':'The updated policies could not be loaded. Reload and try again.'});}return;}const text=state.locale==='es'?({terms_required:'Revisa los términos actuales de la cuenta.',terms_acceptance_required:'Acepta los términos actuales antes de crear contenido o conceder acceso.',conflict:'La cuenta ha cambiado; intenta aceptar de nuevo.'})[error.code]??error.message:error.message;publish(r,ctx,{error:text});}
  finally{if(current())publish(r,ctx,{busy:false});}
 }
}
