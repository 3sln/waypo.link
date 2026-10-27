// ORG-10f provisional upgrade adapter. Existing events pin a participation, not individual edges. Until a reviewed
// per-edge migration protocol exists, a newer additive document is offered as a NEW instance requiring the ordinary
// full matrix acceptance. The previous instance and its grants remain intact; ending it is an explicit admin action.
import {AppAction} from '../app/engine.mjs';
import {AppFault} from '../app/faults.mjs';
import {relationAdditive} from './relation-documents.mjs';
import {validPrincipal} from './memberships.mjs';
import {K} from './relation-keys.mjs';

const fail=(code='relation_upgrade_invalid',message='Choose a newer additive relation version.',status=409)=>{throw new AppFault(code,message,status);};
// Both durable documents are validated normalized projections (the validator drops empty crit and adds indices).
const growthBody=doc=>({...doc,crit:[],access:doc.access.map(({index,...entry})=>entry)});
export const relationUpgradeMethods={
 async upgrade(actor,input){
  // Recheck fresh admin authority before resolving documents or creating the replacement. No caller supplied
  // disclosure override: actor disclosure is part of the document both organizations review and accept.
  const prior=await this.widen(actor,input,['instance','counterpart','version','values','receive','disclosure'],async(r,v,now,m,tx)=>{
   if(v.receive!==undefined&&typeof v.receive!=='boolean')fail('invalid_request','Unsupported relation request.',400);
   if(v.disclosure!==undefined)fail('invalid_request','Review actor disclosure in the relation document.',400);
   if(typeof v.instance!=='string'||!validPrincipal(v.counterpart))fail();
   this.requireLocal(actor.owner,v.counterpart);
   const part=await tx.get(K.instance(v.instance)),cp=part?await tx.get(K.cp(v.instance,v.counterpart)):null;
   if(part?.state!=='live'||cp?.state!=='live')fail('not_found','Not found.',404);
   return {part,cp,doc:await this.docFor(tx,part.relation)};
  });
  const next=await this.resolveDoc(input.version);
  if(next.pin.artefact!==prior.part.relation.artefact||next.pin.version<=prior.part.relation.version||!relationAdditive(growthBody(prior.doc),growthBody(next.doc)))fail();
  const created=await this.create(actor,{relation:next.pin,slots:prior.part.slots});
  try{
   const invitation=await this.invite(actor,{instance:created.instance,as:prior.cp.as,slot:prior.cp.slot,invitee:input.counterpart,...input.values!==undefined?{values:input.values}:{},receive:input.receive===true});
   return {replacement:true,previous:prior.part.instance,...invitation};
  }catch(error){
   // A failed offer cannot leave an empty live replacement consuming the instance allowance. The previous edge is
   // never touched, even if the cleanup cannot run because account authority changed concurrently.
   try{await this.leave(actor,{instance:created.instance});}catch{/* operator may retire the empty replacement */}
   throw error;
  }
 },
};
export class UpgradeRelation extends AppAction{static operation='relations.upgrade';static deps=['relations'];static entities=['organization'];static changes='relations-changed';run({relations}){return relations.upgrade(this.actor,this.input);}}
export const RELATION_UPGRADE_OPERATIONS=Object.freeze([UpgradeRelation]);
