import {CONVERSATION_OPERATIONS} from './domains/conversations.mjs';
import {CONTACT_OPERATIONS} from './domains/contacts.mjs';
import {RECEIVE_OPERATIONS} from './domains/receive.mjs';
import {INTAKE_OPERATIONS} from './domains/intake.mjs';
import {DELEGATION_OPERATIONS} from './domains/delegation.mjs';
import {SEND_OPERATIONS} from './domains/send.mjs';
import {OUTBOX_OPERATIONS} from './domains/outbox.mjs';
import {EVENT_OPERATIONS} from './domains/events.mjs';
import {MailboxAction,operations,ownerOf} from './engine.mjs';
// A harmless dispatch probe, not a protocol endpoint, receipt or delivery claim.
export class MailboxPing extends MailboxAction {
 static operation='mailbox.ping';static deps=['clock'];
 run({clock}){return {owner:ownerOf(this.actor),now:clock.now(),status:'skeleton'};}
}
export const MAILBOX_OPERATIONS=operations(MailboxPing,...CONVERSATION_OPERATIONS,...CONTACT_OPERATIONS,...RECEIVE_OPERATIONS,...INTAKE_OPERATIONS,...DELEGATION_OPERATIONS,...SEND_OPERATIONS,...OUTBOX_OPERATIONS,...EVENT_OPERATIONS,
 ...VIEW_OPERATIONS,...RULE_OPERATIONS,...TAG_OPERATIONS,...CLASSIFY_OPERATIONS, // BB-B5
 ...ARCHIVE_OPERATIONS, // BB-B6
 ...INVITE_OPERATIONS, // contacts spike phase 3
 ...RESET_OPERATIONS, // contacts spike phase 4
 ...EMAIL_BRIDGE_RESET_OPERATIONS, // email-bridge removal (2026-10-28)
);

// BB-B5 append-only domain registration.
import {VIEW_OPERATIONS} from './domains/views.mjs';
import {RULE_OPERATIONS} from './domains/rules.mjs';
import {TAG_OPERATIONS} from './domains/tags.mjs';
import {CLASSIFY_OPERATIONS} from './domains/classify.mjs';

// BB-B6 append-only domain registration.
import {ARCHIVE_OPERATIONS} from './domains/archive.mjs';

// Contacts spike phase 3 append-only domain registration (provisional, unsigned).
import {INVITE_OPERATIONS} from './domains/invites.mjs';

// Contacts spike phase 4 append-only registration (provisional, unsigned): the contact-links reset.
import {RESET_OPERATIONS} from './domains/contact-links-reset.mjs';

// Email-bridge removal (owner direction 2026-10-28; provisional, unsigned): the bridged-intake reset. The BB-B7 bridge
// domain was removed.
import {EMAIL_BRIDGE_RESET_OPERATIONS} from './domains/email-bridge-reset.mjs';
