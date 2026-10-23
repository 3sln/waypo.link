// AU-S7: owner/session fenced engine orchestration; views dispatch intent only.
import {OwnerFlow,snapshot,publish} from './owner-flow.mjs';
import {connectionsModel} from './connections.mjs';
import {connectionManifest} from './connections-port.mjs';
const ROOT='/api/apps/removal';
export const removalPending=r=>['pending','in-progress'].includes(r?.state);
export class AppRemovalIntent extends OwnerFlow{
 async perform(r,ctx,d){const initial=snapshot(r),session=initial.session.sessionContext,current=()=>r.current()&&snapshot(r).session?.sessionContext===session,m=connectionsModel(initial);if(!m)return;
 const put=p=>{if(current())publish(r,ctx,{connectionsConsole:{...connectionsModel(snapshot(r)),...p}});},call=async(path,input)=>{const result=input===undefined?await r.api.get(path):await r.api.request(path,input);if(!current())throw Error('Account changed.');return result;},focus=()=>r.browser.focusConnections?.('connections-removal');
 const show=result=>{const now=connectionsModel(snapshot(r)),closed=['forced','completed'].includes(result?.state),revoked=c=>closed&&c.id===result.connection&&c.clientId===result.client_id&&c.generation<=result.generation;put({removalResult:result,removalReview:null,...result?{removals:(now.removals??[]).map(row=>row.removal===result.removal?result:row)}:{},...closed?{connections:now.connections.map(c=>revoked(c)?{...c,state:'disconnected',status:'disconnected'}:c),slots:now.slots.map(slot=>({...slot,occupants:slot.occupants.filter(o=>!now.connections.some(c=>c.id===o.connection&&revoked(c)))}))}:{}});};
 try{
  if(d.action==='removal-load'){const result=await call(ROOT);put({removals:result.removals,cleanRemovalEnabled:result.clean_enabled===true,cleanRemovalConnections:result.clean_connections,removalError:null});if(current())r.browser.clearRemovalRoute?.();return;}
  if(d.action==='removal-return'){const p=new URLSearchParams(d.query);if([...p.keys()].some(k=>!['removal','outcome','result'].includes(k)))throw Error('Invalid return.');const result=await call(ROOT+'/return?'+p);show(result.removal);if(result.removal&&current())r.browser.clearRemovalRoute?.({returned:true});if(!result.removal)put({removalError:initial.locale==='es'?'Este regreso ya no está disponible. Actualiza para revisar el estado.':'This return is unavailable. Refresh to review the current state.'});focus();return;}
  if(d.action==='removal-close'){put({removalReview:null,removalResult:null,removalError:null});r.browser.focusConnections?.('connections-title');return;}
  const c=m.connections.find(c=>c.id===d.id),row=m.removals?.find(row=>row.removal===d.removal);
  if(d.action==='removal-result'){if(!row)throw Error('Reload this removal.');show(row);focus();return;}
  if(d.action==='removal-review'){if(!c||c.state==='disconnected')throw Error('Reload this connection.');put({removalReview:{connection:c.id,generation:c.generation,name:c.name,clean:(m.cleanRemovalConnections?m.cleanRemovalConnections[c.id]===true:m.cleanRemovalEnabled===true)&&['active','configuring','degraded','suspended'].includes(c.state)&&Boolean(connectionManifest(c).removal)&&!(c.state==='suspended'&&(c.suspensionReason!=='owner'||c.securitySuspended)),resumes:c.state==='suspended'},removalResult:null,removalError:null});focus();return;}
  if(d.values?.confirm!==true)throw Error('Review and confirm this change.');
  const review=m.removalReview,connection=review&&m.connections.find(c=>c.id===review.connection);let result;
  if(['removal-start','removal-force'].includes(d.action)){
   if(row&&removalPending(row)&&d.action==='removal-force')result=await call(ROOT+'/force',{removal:row.removal});
   else{if(!connection||connection.generation!==review.generation||d.action==='removal-start'&&!review.clean)throw Error('Reload this connection.');result=await call(ROOT+(d.action==='removal-start'?'/start':'/force'),{connection:connection.id,expectedGeneration:connection.generation});}
  }else if(d.action==='removal-confirm'){const returned=m.removalResult;if(!returned?.confirmation_required)throw Error('Reload this return.');result=await call(ROOT+'/confirm',{removal:returned.removal,outcome:returned.reported_outcome,...returned.reported_result?{result:returned.reported_result}:{}});}
  else if(['removal-cancel','removal-reissue'].includes(d.action)){if(!removalPending(row))throw Error('Reload this removal.');result=await call(ROOT+(d.action==='removal-cancel'?'/cancel':'/reissue'),{removal:row.removal});}
  else throw Error('Invalid removal action.');
  show(result.removal);put({removalError:null});
  if(result.navigation_uri){const url=new URL(result.navigation_uri),client=new URL(result.removal.client_id);if(url.protocol!=='https:'||url.origin!==client.origin||url.username||url.password||url.hash)throw Error('Invalid cleanup navigation.');if(current())r.browser.navigate(url.href);return;}
  const rows=await call(ROOT);put({removals:rows.removals});focus();
 }catch(error){put({removalError:error.message});}
 }
}
