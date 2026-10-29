import {createArchiveProvider} from '../../../packages/messaging-engine/domains/archive.mjs';
import {requireRestored} from '../../../packages/messaging-engine/store/restore.mjs';
import {createBridgeProvider} from '../../../packages/messaging-engine/domains/bridge.mjs';
import {createMailboxEngine,operate} from '../../../packages/messaging-engine/engine.mjs';
import {MAILBOX_OPERATIONS} from '../../../packages/messaging-engine/operations.mjs';
import {ContactsDomain,ReceiveDomain} from '../../../packages/messaging-engine/store/mailbox.mjs';
import {createOutboxProvider} from '../../../packages/messaging-engine/domains/outbox.mjs';
import {SHELL_OPERATIONS,authorizeSend} from './operations.mjs';
import {REMOVAL_OPERATIONS} from './removal.mjs';
import {INTEGRATION_OPERATIONS} from './integration.mjs';
import {organizationProviders} from '../../../packages/messaging-engine/domains/views.mjs';
import {ConversationsDomain,withConversations} from '../../../packages/messaging-engine/domains/conversations.mjs';
import {fault} from '../../../packages/messaging-engine/faults.mjs';
import {CONTACT_LINKS_RESET_MARKER} from '../../../packages/messaging-engine/domains/contact-links-reset.mjs';
import {CLASSIFY_PENDING} from '../../../packages/messaging-engine/store/item-index.mjs';
const RESET_SLICES=64;
export const enabled=value=>value===true||value==='true';
export function createMailbox({store,ports={},PARLAY_ENABLED=false,clock={now:()=>Date.now()},random={uuid:()=>crypto.randomUUID(),bytes:n=>crypto.getRandomValues(new Uint8Array(n))},audit={record:()=>{}},outboxOptions={}}){
 const on=enabled(PARLAY_ENABLED),registry={...MAILBOX_OPERATIONS,...SHELL_OPERATIONS,...INTEGRATION_OPERATIONS,...REMOVAL_OPERATIONS},conversationAuthority=withConversations(authorizeSend);
 const engine=createMailboxEngine({providers:{clock,random,audit,mailboxStore:store,mailboxCleanup:ports.mailboxCleanup??{},...organizationProviders({PARLAY_ENABLED:on,classifier:ports.classifier??null}),archive:createArchiveProvider({PARLAY_ENABLED:on,ownerKeys:ports.ownerKeys??null}),conversations:ConversationsDomain,contacts:ContactsDomain,receive:ReceiveDomain,bridge:createBridgeProvider({PARLAY_ENABLED:on}),directory:ports.directory??{resolveKey:async()=>null,status:async()=>{fault('author_unverifiable','Directory unavailable.',503);}},providerBridge:ports.providerBridge??null,delegateKeys:ports.delegateKeys??null,userStorage:ports.userStorage??null,egress:ports.egress??{fetch:async()=>{throw new Error('Delivery transport unavailable');}},outbox:createOutboxProvider({...outboxOptions,renewDelegation:async()=>{await ports.delegateKeys?.renew();return (await ports.delegateKeys?.current())?.delegation;},PARLAY_ENABLED:on,authorize:async(tx,task,owner)=>(await tx.get('shell:authorization'))?.active===true&&conversationAuthority(tx,task,owner)})}});
 const run=async(owner,name,params={})=>{if(!on)fault('not_found','Messaging is disabled.',404);if(!Object.hasOwn(registry,name))fault('not_found','Operation unavailable.',404);if(['receive.deliver','receive.redeem','receive.first-contact','conversations.receive','conversations.respond','shell.public-intake'].includes(name))await requireRestored(store);return operate(engine,new registry[name]({...params,actor:{kind:['receive.deliver','receive.redeem','receive.first-contact','shell.public-intake','conversations.receive','conversations.respond'].includes(name)?'ingress':name==='invites.mint-bound'?'system':'owner',owner}}));};
 // Contacts spike phase 4: the `parlay-contact-links-retired-v1` reset (domains/contact-links-reset.mjs) runs on mailbox open,
 // before the requested operation, in bounded slices (at most RESET_SLICES per open), and from the alarm until its
 // marker exists. Once the marker exists this costs one read.
 const reset=async owner=>{if(await store.get(CONTACT_LINKS_RESET_MARKER)!==undefined)return true;for(let i=0;i<RESET_SLICES;i++)if((await run(owner,'mailbox.reset-contact-links')).done)return true;return false;};
 // Auto-classification (owner direction 2026-10-28; review M2): the deadline sweep fails items pending too long (final
 // rule run, held notification released), then each unclaimed pending item is classified once through this mailbox's
 // classifier port (classify.item claims it first, so a host call racing this one never charges twice). A failure of one
 // item never blocks the alarm.
 const classifyDue=async owner=>{if(!(await store.list({prefix:CLASSIFY_PENDING,limit:1})).size)return;const {due}=await run(owner,'classify.sweep');for(const id of due)try{await run(owner,'classify.item',{id});}catch{}};
 return {engine,run,reset,async open(owner){await run(owner,'shell.bind');await reset(owner);return this;},async provision(owner,{receive,authorization}={}){await this.open(owner);if(ports.userStorage&&ports.ownerKeys){await store.put('shell:archive-enabled',true);if(!await store.get('shell:archive-started'))await store.put('shell:archive-started',clock.now());}if(receive)await run(owner,'receive.configure',{input:receive});if(authorization)await run(owner,'shell.authorization',{input:authorization});},async alarm(){if(!on)return;const owner=await store.get('owner');if(!owner)return;await run(owner,'shell.purge-expired');if(!await store.get('owner'))return;await reset(owner);if(await store.get('config')&&(await store.get('shell:authorization'))?.active)await run(owner,'conversations.drain');const result=await run(owner,'outbox.drain');await classifyDue(owner);if(await store.get('config')&&((await store.list({prefix:'inv/pending/',limit:1})).size||(await store.list({prefix:'inv/link/',limit:1})).size))await run(owner,'invites.sweep');if(ports.userStorage&&ports.ownerKeys&&await store.get('config')&&(await store.get('shell:authorization'))?.active){const status=await run(owner,'archive.status');if(!status.importing&&!status.fenced&&status.due){await store.put('shell:archive-retry',clock.now()+60000);await run(owner,'archive.checkpoint');await store.delete('shell:archive-retry');}await run(owner,'archive.reclaim');}const renewal=await store.get('shell:renewal');if(renewal?.at<=clock.now())await run(owner,'shell.delegation-renew');return result;},dispose:()=>engine.dispose()};
}
