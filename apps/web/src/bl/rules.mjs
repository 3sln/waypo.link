import {systemTag,reservedTag} from '../../../../packages/core/tags.mjs';
import {OwnerFlow,snapshot,publish} from './owner-flow.mjs';
import {accountContextError} from './account-context.mjs';
// Rule and tag-label maintenance for the Rules view.
const tagId=id=>typeof id==='string'&&id.length>0&&id.length<=64&&!/[\u0000-\u001f\u007f]/.test(id)&&(systemTag(id)?.kind==='final'||!reservedTag(id));
async function reload(r,ctx){const data=await r.api.get('/api/account');publish(r,ctx,{data});}
// After a successful mutation the outcome is published first; a failed refresh only marks the view stale.
async function refreshAfter(r,ctx,patch){publish(r,ctx,{...patch,error:''});try{await reload(r,ctx);}catch(error){if(error.status===401||accountContextError(error))throw error;publish(r,ctx,{error:'Your change was saved, but the latest information could not be loaded. Reload to see it.'});}}
export class RestoreDefaultRule extends OwnerFlow{async perform(r,ctx,d){await r.api.request(`/api/rules/${encodeURIComponent(d.id)}/restore`,{});await refreshAfter(r,ctx,{notice:'Default rule restored.'});}}
export class SaveTagLabel extends OwnerFlow{async perform(r,ctx,d){const v=d.values,label=String(v.label??'').trim(),id=String(v.id??'').trim(),registry=snapshot(r).data?.tagLabels;if(!label||label.length>64)throw Error('Use a label of up to 64 characters.');if(id&&!tagId(id))throw Error('Use tag names of up to 64 characters. Names starting with “sys:” are reserved.');await r.api.request('/api/tags/labels',{...id?{id}:{},label,...Number.isSafeInteger(registry?.revision)?{expectedRevision:registry.revision}:{}},'PUT');await refreshAfter(r,ctx,{modal:null,notice:'Tag label saved. Messages keep their tags.'});}}
