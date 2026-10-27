// AccountController slice 2, activity items and collections (docs/architecture/app-engine.md §12): reads, updates, pages,
// presentations and postbacks of stored v1 app messages. Peer messages left the core on 2026-10-27 (DEVLOG "Messaging
// removed from core; Parlay rename; BB-CUT reset"); the `/api/messages*` names are kept for the app-message API.
// `methods` are installed on AccountController.prototype (`this` is the controller); `rpc` lists the methods
// `invoke` accepts and the placement policy it applies to each (packages/runtime/account/index.mjs).
import {messagePostbackPrepare,messagePostbackDispatch,messagePostbackAvailability} from '../message-postbacks.mjs';
import {messageWithPresentation,messagePresentation} from '../message-presentations.mjs';
import {key} from '../../core/records.mjs';
import {itemPage} from '../../activity/app-messages.mjs';
import {resetLegacyMessaging,MESSAGING_RESET_MARKER} from '../messaging-reset.mjs';
import {StorageError} from '../../storage/policy.mjs';
import {storageState} from '../storage-quota.mjs';
import {armAlarm} from '../account-deletion.mjs';
import {enqueueSearchEvent,searchRevisionKey,planBudget} from '../../search/index.mjs';

export const methods={
  /** The item-index and search effects of dropping one legacy `message/` row (../messaging-reset.mjs `dropLegacyItem`),
   * shared by the BB-CUT reset and the shelved-archive restore in `warm` (review M1). */
  legacyItemEffects(owner){return {item:async(tx,row)=>{this.itemIndex?.remove(row.id);if(row.owner===owner)await this.queueMessageSearch(tx,row,'tombstone');}};},
  /** One bounded slice of the BB-CUT reset (../messaging-reset.mjs). Deleted legacy items get the full item cleanup in
   * the same transaction. Reschedules itself until the marker exists; errors retry from the alarm. */
  async resetLegacyMessaging(owner,{alarm=false,limit=256}={}){
    if(await this.metadata.get(MESSAGING_RESET_MARKER)!==undefined)return {done:true,deleted:0};
    const result=await resetLegacyMessaging(this.metadata,{limit,owner,effects:this.legacyItemEffects(owner)});
    if(!result.done)await this.scheduleAlarm(Date.now()+(alarm?1000:60000));
    return result;
  },
  async migrateItemIndex(owner){
    if(!this.itemIndex)return;
    // Filter indexes over an existing catalog build in bounded steps; reads answer 503 until all exist.
    if(!this.itemIndex.buildFilterIndexes())await armAlarm(this.metadata,Date.now()+1000);
    // Catalog progress never depends on extraction capacity. A full search
    // queue must not roll back the owner's authoritative inbox browse index.
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
  async messagePage(owner,options={}){await this.warm(owner);if(!this.itemIndex)return {items:await this.items.list(owner,options),cursor:null};if(!await this.metadata.get('item-index-ready')||!this.itemIndex.filterIndexesReady())throw new StorageError('temporarily_unavailable','Your inbox index is being upgraded. Try again shortly.',503);return this.itemIndex.page(owner,options);},
  async collections(owner,name){await this.warm(owner);return name===undefined?this.items.collections(owner):this.items.createCollection(owner,name);},
  async content(owner,id){const record=await this.items.read(owner,id);if(record.blobRef){const blob=await this.blobs.get(record.blobRef);if(!blob)throw Object.assign(new Error('Message content is temporarily unavailable.'),{code:'temporarily_unavailable',status:503});return {...record,bytes:new Uint8Array(await blob.arrayBuffer())};}return record;},
  async message(owner,id,options){return messageWithPresentation(this,owner,id,options);},
  async messagePresentation(owner,id,input){return messagePresentation(this,owner,id,input);},
  async messagePostbackPrepare(owner,id,input,epoch){return messagePostbackPrepare(this,owner,id,input,epoch);},
  async messagePostbackDispatch(owner,id,token){return messagePostbackDispatch(this,owner,id,token);},
  async postbackAvailability(owner,id,record,originalDigest){return messagePostbackAvailability(this,owner,id,record,originalDigest);},
  async messageBytes(owner,id){const {bytes,mimeType}=await this.content(owner,id);return {bytes:Array.from(bytes),mimeType};},
  async updateMessage(owner,id,actions){return this.items.update(owner,id,actions);},
  async deleteMessage(owner,id){return this.items.delete(owner,id);},
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
