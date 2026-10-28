// Contacts: principal blocks. Contact links (owner-issued parents, contacts added from another person's link and their
// indexes) were removed in contacts spike phase 4 (docs/architecture/contacts-and-links-rethink.md §8 CR-C9, §9); the
// people a user can message, and who can message them, are the members of first-class lists (invites.mjs: lists.list,
// lists.members, lists.add, lists.remove). A block overrides every list (§4.4) and is the one per-person setting here.
import {MailboxAction,MailboxQuery} from '../engine.mjs';
import {fault} from '../faults.mjs';
import {KEYS,actorOwner} from '../store/mailbox.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const invalid=message=>fault('invalid_input',message,400);
const principalInput=p=>{if(!p||typeof p!=='object'||typeof p.issuer!=='string'||!/^https:\/\/[^/?#]+$/.test(p.issuer)||!UUID.test(p.subject))invalid('Choose a valid principal.');return {issuer:p.issuer,subject:p.subject};};

// Blocking a principal refuses its first contact (§6.7, the uniform not_authorized), its redemptions (silently) and its
// conversation traffic; list memberships are kept, so unblocking restores the earlier relationship.
export class ContactsBlock extends MailboxAction {
 static operation='contacts.block';static deps=['contacts','clock'];static changes='contacts-changed';
 async run({contacts,clock}){
  actorOwner(this.actor);const principal=principalInput(this.input?.principal),blocked=this.input?.blocked!==false;
  await contacts.store.transaction(async tx=>{if(blocked)await tx.put(KEYS.block(principal),{principal,at:clock.now()});else await tx.delete(KEYS.block(principal));});
  return {principal,blocked};
 }
}
// The owner's blocked principals, newest first (lists.list and lists.members cover everyone else).
export class ContactsBlocks extends MailboxQuery {
 static operation='contacts.blocks';static deps=['contacts'];static refreshOn=['contacts-changed'];
 async fetch({contacts}){actorOwner(this.actor);return {blocks:[...(await contacts.store.list({prefix:'block/'})).values()].map(b=>({principal:{issuer:b.principal.issuer,subject:b.principal.subject},at:b.at})).sort((a,b)=>b.at-a.at)};}
}
export const CONTACT_OPERATIONS=[ContactsBlock,ContactsBlocks];
