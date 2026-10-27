// A resumable materialized Kahn order. Late parents can reorder an arbitrary suffix, so a dirty
// generation is rebuilt under a fixed store-work budget and never served as a partial snapshot.
const root=c=>`conv/timeline/${c}/`,key=(c,s)=>root(c)+s,event=(c,id)=>`conv/event/${c}/${id}`;
const display=e=>({eventId:e.eventId,type:e.type,author:e.author,createdAt:e.createdAt,own:e.own,bodyRef:e.bodyRef,resendOf:e.resendOf});
export async function dirtyTimeline(tx,c,e){const stateKey=`conv/timeline-state/${c}`,prior=await tx.get(stateKey);
 // Depending on the last exact topological event forces a new message behind the entire existing order.
 // A formerly missing parent cannot use this path: its arrival may reorder older descendants.
 if(prior?.phase==='ready'&&e?.type==='message'&&!e.quarantined&&e.parents?.includes(prior.last)&&!await tx.get(key(c,'missing/'+e.eventId))){await tx.put(key(c,'page/'+String(prior.total++).padStart(16,'0')),display(e));prior.last=e.eventId;prior.rank++;prior.generation=(prior.generation??0)+1;await tx.put(stateKey,prior);return;}
 await tx.put(stateKey,{phase:'clear',generation:(prior?.generation??0)+1});}

export async function prepareTimeline(tx,c,budget=512){
 const stateKey=`conv/timeline-state/${c}`,s=await tx.get(stateKey)??{phase:'clear'};let left=budget;
 while(left>0&&s.phase!=='ready'){
  if(s.phase==='clear'){
   const rows=await tx.list({prefix:root(c),limit:Math.min(left,64)});left-=Math.max(1,rows.size);for(const k of rows.keys())await tx.delete(k);
   if(!rows.size){Object.assign(s,{phase:'scan',after:null,total:0,quarantined:0,rank:0});}
  }else if(s.phase==='scan'){
   const cap=Math.min(16,left),rows=await tx.list({prefix:`conv/event/${c}/`,startAfter:s.after??undefined,limit:cap});left-=Math.max(1,rows.size);
   for(const [k,e] of rows){s.after=k;if(e.quarantined)s.quarantined++;if(!['genesis','message','edit','retract'].includes(e.type))continue;
    const parents=[];for(const id of new Set(e.parents??[])){left--;if(id===e.eventId)continue;const p=await tx.get(event(c,id));if(p&&['genesis','message','edit','retract'].includes(p.type))parents.push(id);else if(!p)await tx.put(key(c,'missing/'+id),true);}
    await tx.put(key(c,'node/'+e.eventId),{id:e.eventId,type:e.type,parents,target:e.target,quarantined:e.quarantined,applied:e.mutationApplied,view:display(e)});if(e.type==='genesis')s.genesis=e.eventId;
   }
   if(rows.size<cap) {s.phase='edges';s.after=null;}
  }else if(s.phase==='edges'){
   const cap=Math.min(16,left),rows=await tx.list({prefix:key(c,'node/'),startAfter:s.after??undefined,limit:cap});left-=Math.max(1,rows.size);
   for(const [k,n] of rows){s.after=k;const parents=n.parents.length?n.parents:(s.genesis&&n.id!==s.genesis?[s.genesis]:[]);await tx.put(k,{...n,remaining:parents.length});if(!parents.length)await tx.put(key(c,'ready/'+n.id),n.id);for(const p of parents)await tx.put(key(c,`child/${p}/${n.id}`),n.id);}
   if(rows.size<cap){s.phase='order';s.after=null;}
  }else if(s.phase==='order'){
   // A node with many children is drained across calls before choosing the next ready event.
   if(s.active){const cap=Math.min(32,left),rows=await tx.list({prefix:key(c,'child/'+s.active+'/'),startAfter:s.after??undefined,limit:cap});left-=Math.max(1,rows.size);for(const [k,id] of rows){s.after=k;const nk=key(c,'node/'+id),n=await tx.get(nk);n.remaining--;await tx.put(nk,n);if(!n.remaining)await tx.put(key(c,'ready/'+id),id);}if(rows.size<cap){s.active=null;s.after=null;}continue;}
   const ready=await tx.list({prefix:key(c,'ready/'),limit:1});left--;if(!ready.size){s.phase='ready';break;}
   const [rk,id]=[...ready][0],n=await tx.get(key(c,'node/'+id));await tx.delete(rk);await tx.put(key(c,'rank/'+id),s.rank++);s.last=id;
   if(['message','genesis'].includes(n.type)&&!n.quarantined)await tx.put(key(c,'page/'+String(s.total++).padStart(16,'0')),n.view);
   if(['edit','retract'].includes(n.type)&&!n.quarantined&&n.target){const applied=n.applied??((await tx.get(event(c,n.target)))?.[n.type==='edit'?'revisions':'retractions']??[]).includes(id);if(applied){const fk=key(c,'fold/'+n.target),f=await tx.get(fk)??{revisions:[],deleted:false};if(n.type==='edit'){f.count=(f.count??0)+1;f.revisions=[...f.revisions,n.view].slice(-20);}else f.deleted=true;await tx.put(fk,f);}}
   s.active=id;s.after=null;
  }
 }
 await tx.put(stateKey,s);return s;
}
export const timelineKey=key;
