// AccountController slice 2, Messages and collections (docs/architecture/app-engine.md §12): message reads, updates, pages, presentations and postbacks.
// `methods` are installed on AccountController.prototype (`this` is the controller); `rpc` lists the methods
// `invoke` accepts and the placement policy it applies to each (packages/runtime/account/index.mjs).
import {messagePostbackPrepare,messagePostbackDispatch,messagePostbackAvailability} from '../message-postbacks.mjs';
import {messageWithPresentation,messagePresentation} from '../message-presentations.mjs';
import {key} from '../../core/records.mjs';
import {itemPage,migrateAppMessages,APP_MESSAGES_MARKER,APP_MESSAGES_CURSOR,APP_MESSAGES_RECONCILED} from '../../activity/app-messages.mjs';
const RECONCILE_INTERVAL=86400000;
import {appNotificationPublicKeys} from '../app-notifications.mjs';
import {StorageError} from '../../storage/policy.mjs';
import {storageState} from '../storage-quota.mjs';
import {armAlarm} from '../account-deletion.mjs';
import {enqueueSearchEvent,searchRevisionKey,planBudget} from '../../search/index.mjs';

export const methods={
  /** One bounded `app-messages-v1` slice (packages/activity/app-messages.mjs). The warm path stops at the marker; the
   * alarm path keeps reconciling after it, starting a new post-marker pass at most once a day (review F6), and
   * reschedules itself only while the marker is missing. Nothing runs while the account is shelved (its rows are in
   * the archive; the restore clears the marker, review F2) or while an export is active (DX-2 pinning; a row moving
   * between the `messages` contributor's two phases would repeat an archive path, review F4).
   * Errors never escape: a failed slice is retried by the alarm. */
  async migrateAppMessageFamily(owner,{alarm=false,limit=64,now=Date.now()}={}){
    try{
      const marked=await this.metadata.get(APP_MESSAGES_MARKER)!==undefined;
      if(!alarm&&marked)return {done:true,moved:0,unverified:0};
      if(alarm&&marked&&await this.metadata.get(APP_MESSAGES_CURSOR)===undefined){const last=await this.metadata.get(APP_MESSAGES_RECONCILED);if(Number.isSafeInteger(last)&&now-last<RECONCILE_INTERVAL)return {done:true,moved:0,unverified:0,reason:'reconciled'};}
      let keys=null;try{keys=appNotificationPublicKeys(this.config);}catch{keys=null;}
      const result=await migrateAppMessages(this.metadata,{owner,issuer:this.config.APP_ORIGIN,keys,limit,holds:['shelved','export/active']});
      if(result.done&&marked)await this.metadata.put(APP_MESSAGES_RECONCILED,now);
      // Shelved: the restore re-arms the pass. Export: retried once the export ends (its own alarms keep running).
      if(!result.done&&result.reason!=='keys-unavailable'&&result.hold!=='shelved'&&await this.metadata.get(APP_MESSAGES_MARKER)===undefined)await this.scheduleAlarm(Date.now()+(alarm&&!result.hold?1000:60000));
      return result;
    }catch(error){try{await this.scheduleAlarm(Date.now()+60000);}catch{}return {done:false,moved:0,unverified:0,reason:error?.code??'unavailable'};}
  },
  async migrateItemIndex(owner){
    if(!this.itemIndex)return;
    // Filter indexes over an existing catalog build in bounded steps; reads answer 503 until all exist.
    if(!this.itemIndex.buildFilterIndexes())await armAlarm(this.metadata,Date.now()+1000);
    // Catalog progress never depends on extraction capacity. A full search
    // queue must not roll back the owner's authoritative inbox browse index.
    // Both item families are indexed: legacy messages, then activity's app messages (one cursor, itemPage).
    if(!await this.metadata.get('item-index-ready')){
      const page=await itemPage(options=>this.metadata.list(options),owner,{cursor:await this.metadata.get('item-index-migration'),limit:200}),rows=page.rows;
      await this.metadata.transaction(async tx=>{
        for(const [,message]of rows)this.itemIndex.upsert(message);
        if(page.done){await tx.put('item-index-ready',true);await tx.delete('item-index-migration');}
        else{await tx.put('item-index-migration',page.cursor);await tx.setAlarm(Date.now()+60000);}
      });
    }
    if(await this.metadata.get('item-index-ready'))await this.metadata.transaction(async tx=>{if(!this.itemIndex.migrateIncoming())await tx.setAlarm(Date.now()+60000);});
    if(await this.metadata.get('search-backfill-ready'))return;
    // Source revision initialization and work publication remain atomic. Leave
    // room for new deliveries while legacy work proceeds in bounded pages.
    await this.metadata.transaction(async tx=>{
      const entitlement=await storageState(tx,owner,Date.now(),this.config),maxQueue=planBudget(entitlement.plan==='free'?'free':'paid').limits.queue;
      const usage=await tx.get(key('search-queue-usage',owner))||{count:0};
      const reserve=Math.min(100,Math.floor(maxQueue/10)),capacity=Math.max(0,maxQueue-reserve-usage.count);
      if(!capacity){await tx.put('search-backfill-blocked',{reason:'queue_capacity'});await tx.setAlarm(Date.now()+60000);return;}
      const limit=Math.min(200,capacity),page=await itemPage(options=>tx.list(options),owner,{cursor:await tx.get('search-backfill-cursor'),limit}),rows=page.rows;
      for(const [path,message]of rows){
        if(message.owner!==owner||typeof message.id!=='string'||typeof message.mimeType!=='string')continue;
        const id=`message:${message.id}`;
        if(!await tx.get(searchRevisionKey(owner,id))){
          const revision=message.revision||1;
          await enqueueSearchEvent(tx,{owner,id,source:{kind:'message',id:message.id},operation:'upsert',revision},{maxQueue});
          message.revision=revision;await tx.put(path,message);this.itemIndex.upsert(message);
        }
      }
      await tx.delete('search-backfill-blocked');
      if(page.done){await tx.put('search-backfill-ready',true);await tx.delete('search-backfill-cursor');}
      else await tx.put('search-backfill-cursor',page.cursor);
      if(rows.size||!await tx.get('search-backfill-ready'))await tx.setAlarm(Date.now()+60000);
    });
  },
  async messagePage(owner,options={}){await this.warm(owner);if(!this.itemIndex)return {items:await this.messages.list(owner,options),cursor:null};if(!await this.metadata.get('item-index-ready')||!this.itemIndex.filterIndexesReady())throw new StorageError('temporarily_unavailable','Your inbox index is being upgraded. Try again shortly.',503);return this.itemIndex.page(owner,options);},
  async collections(owner,name){await this.warm(owner);return name===undefined?this.messages.collections(owner):this.messages.createCollection(owner,name);},
  async content(owner,id){const record=await this.messages.read(owner,id);if(record.blobRef){const blob=await this.blobs.get(record.blobRef);if(!blob)throw Object.assign(new Error('Message content is temporarily unavailable.'),{code:'temporarily_unavailable',status:503});return {...record,bytes:new Uint8Array(await blob.arrayBuffer())};}return record;},
  async message(owner,id,options){return messageWithPresentation(this,owner,id,options);},
  async messagePresentation(owner,id,input){return messagePresentation(this,owner,id,input);},
  async messagePostbackPrepare(owner,id,input,epoch){return messagePostbackPrepare(this,owner,id,input,epoch);},
  async messagePostbackDispatch(owner,id,token){return messagePostbackDispatch(this,owner,id,token);},
  async postbackAvailability(owner,id,record,originalDigest){return messagePostbackAvailability(this,owner,id,record,originalDigest);},
  async messageBytes(owner,id){const {bytes,mimeType}=await this.content(owner,id);return {bytes:Array.from(bytes),mimeType};},
  async updateMessage(owner,id,actions){return this.messages.update(owner,id,actions);},
  async deleteMessage(owner,id){return this.messages.delete(owner,id);},
};

export const rpc={
 collections:{},
 message:{warm:true},
 messagePresentation:{warm:true},
 messagePostbackPrepare:{warm:true},
 messagePostbackDispatch:{},
 messageBytes:{warm:true},
 updateMessage:{warm:true},
 deleteMessage:{warm:true},
 messagePage:{},
};
