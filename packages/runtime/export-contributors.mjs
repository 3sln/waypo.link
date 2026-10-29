// Domain-owned export projections. Generation sees pages, never metadata keys.
// No generic "dump record" fallback: adding a persisted family needs an explicit
// projection or a reasoned exclusion, and the inventory test pins that choice.
import {FLAGS} from '../flags/registry.mjs';
import {fault} from '../app/faults.mjs';
import {exportPath} from './export-tar.mjs';
import {CONTACT_LINKS_RESET_PREFIXES} from './contact-links-reset.mjs';
import {retiredEmailBridgeRow} from './email-bridge-reset.mjs';
const fields=text=>text.split(' '),pick=(row,names)=>Object.fromEntries(names.filter(k=>row?.[k]!==undefined).map(k=>[k,structuredClone(row[k])]));
const COMMON=fields('v version id owner name label title description status state createdAt updatedAt modifiedAt expiresAt revision generation');
// These fields can occur inside otherwise public descriptors. User message
// bytes are separate immutable payloads and never pass through this projection.
const PRIVATE=/^(?:blobRef|secret|sharedSecret|returnCapability|bootstrap|bootstrapMaterial|passwordHash|recoveryHash|sessionHash|csrfHash|token|tokens|accessToken|refreshToken|oauthToken|s3Key|privateKey|privateJwk|endpoint|auth|p256dh|jti|jtis|unsubscribeToken|credential|credentials|sealed|ciphertext)$/i;
function publicValue(value){if(value?.kty)return pick(value,fields('kty crv x y n e alg kid use key_ops'));if(Array.isArray(value))return value.map(publicValue);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!PRIVATE.test(key.replace(/[-_]/g,''))&&!/hash|secret|token|bootstrap|password|private|vault|csrf|recovery/i.test(key)).map(([key,v])=>[key,publicValue(v)]));return value;}
const projection=(row,names)=>Array.isArray(row)?row.map(v=>projection(v,names)):row&&typeof row==='object'?publicValue(pick(row,[...COMMON,...fields(names)])):row;
const definitions=[
 // Removal history with the owner's keep choices and deletion jobs for app-attributed data (never the stored continuation position).
 ['app-removals',['app-removal/record/','storage/producer-keep/','storage/producer-deletion/'],'removal entity client_id connection mode generation started_at cleanup_by committed_at access_ends_by concluded_at outcome result reminders action resource active supersededAt includeChanged includeKept complete stopped stoppedAt totalDeleted skipped passes at'],
 // Signaling AMD-SG-I1: session handler approvals (handler, version, digest, approval time, autoConnect) live beside
 // the routing default of the same kind line.
 ['intent-choices',['intent-memory/'],'kind default excluded ignored approvals handler feature version digest autoConnect'],
 // v1 app messages (activity's app-message/ family). The legacy peer `message/` family was deleted by the BB-CUT reset
 // (DEVLOG 2026-10-27); the section keeps its name so the archive shape is unchanged.
 ['messages',['app-message/'],'collection mimeType size receivedAt readAt tags classification quarantined revision presentation'],
 ['collections',['collection/'],'active'],['tags',['tag-labels/'],'labels'],['rules',['rules/','rule-defaults/'],'actions filter conditions enabled origin automatic updatedAt'],
 ['views',['message-views/'],'filter sort'],['activity',['activity-item/'],'app item activity source content occurredAt readAt tags collection'],
 ['notifications',['notification-preferences/','push-subscription/','activity-push-policy/','activity-push-app/','activity-push-device/'],'enabled email push collections quietHours rules previewConsent consent preferences'],
 // The owner's profile preference (packages/runtime/account/profile.mjs). Per-link sharing (`contact-sharing`) and contact
 // links (`links`) left the core in contacts phase 4; the `contact-links-retired-v1` reset deletes their rows.
 ['profile',['profile'],'displayName avatar'],
 ['resources',['resource/','hosted/'],'provider builtin contracts capabilities verifiedAt key version size contentType modifiedAt'],
 ['connections',['resource/'],'provider clientId scope fragments resources methods integration connectedAt disconnectedAt'],
 // Rows of the removed email bridge (feature grant, public-intake field, their notices) are skipped until the
 // `email-bridge-retired-v1` reset deletes them.
 ['integrations',['connections/field/','connections/feature/','connections/notice/'],'fragment entries purposes selection spec state grant approved'],
 ['events',['evbus/bus/','evbus/rec/'],'bus seq schema spec manifest digest host retention retentionSeconds features type published_at publisher data content payload source occurredAt'],
 ['external-storage',['drive/object/','drive/folder/'],'provider resource resourceId bucket prefix folderId key objectId fileId version size contentType'],
 ['billing',['billing/state','billing/ever-paid/'],'plan periodStart periodEnd cancelAtPeriodEnd customerId since paidAt validUntil currency annualAmount subscriptionId pendingChange'],
 ['lifecycle',['lifecycle/state-v1','lifecycle/paid-protection-v1','lifecycle/unpaid-origin-v1','retention/'],'phase deadlines notice lastActivityAt executeAfter graceDays usage exportOffered'],
 // Signaling (docs/spec/extensions/signaling.md §12.6): owner data only: the IP policy, principal blocks and provider
 // blocks (the former rtc/block-iss/ export gap is closed: `sig/block-iss/` is claimed here, Appendix C), an
 // organization's service designation, and pairings with every member in every state. Session handler approvals and
 // `autoConnect` export with `intent-choices`. Offers are transient capabilities and are excluded.
 ['signaling',['sig/policy','sig/block/','sig/block-iss/','sig/service'],'other self revision principal issuer at designated'],
 ['signaling-pairings',['sig/pairing/'],'revision kind local peer opens accept label created_via state expires_at createdAt'],
 ['quota',['quota/','hosted-usage','app-message-usage/'],'bytes messages objects limit storageBytes usage retention']
];
export const EXPORT_CLAIMED_PREFIXES=Object.freeze(Object.fromEntries(definitions.flatMap(([name,prefixes])=>prefixes.map(prefix=>[prefix,name]))));
const excluded={
 'app-removal/notice/':'Transient: reminder attempts; owner removal history is exported separately.',
 'app-removal/open/':'Derived: open removal lookup.',
 'storage/producer-cursor-key':'Secret: key sealing remaining-data page cursors.',
 'storage/producer-gc':'Transient: marker sweep continuation.',
 'storage/producer-lineage/':'Derived: pointer to a pruned removal (connection and generation) for What\'s left and the marker sweep; decisions are exported under app-removals.',
 'app-removal/cascade/':'Transient: authority revocation cascade.',
 'intent-flow/':'Transient: intent routing receipts contain no link data.',
 'intent-meter/':'Derived: direct intent handoff anti-bounce budget.',
 'owner':'Identity subject is projected through the identity port.',
 'signing-key':'Secret: private keys leave only through the protected identity backup.',
 'identity-keys/':'Secret: private identity key material; public keys use the keys port.',
 'identity-encryption-key/':'Secret: encrypted private keys; public keys use the keys port.', 'encryption-key':'Secret: private-key pointer.', 'identity-key-retained/':'Key history is projected by the keys port.', 'identity-key-pruned/':'Derived: key pruning tombstones.',
 'contact-key/':'Secret: identity key registry rows (public keys use the keys port).',
 'vault/':'Secret: integration credentials.', 'resource-secret/':'Secret: connector credentials.',
 'activity-budget/':'Derived: abuse accounting.', 'activity-event/':'Transient: activity outbox.', 'push-session-ended/':'Transient: ended-session markers for push subscription binding.', 'activity-receipt/':'Transient: mutation receipts.',
 'activity-rev/':'Derived: activity index.', 'activity-tags/':'Derived: tag index.', 'activity-usage/':'Derived: quota counters.',
 'activity-push-bucket/':'Derived: push budgets.', 'activity-push-budget/':'Derived: push budgets.', 'activity-push-channel/':'Derived: channel readiness.',
 'activity-push-group/':'Transient: push coalescing.', 'activity-push-job/':'Transient: delivery queue.',
 'notification-email-budget/':'Derived: email budgets.',
 'message-receipt-budget/':'Derived: message ingress budgets.', 'message-postback/':'Secret: prepared form submissions.', 'message-postback-budget':'Derived: submission abuse accounting.',
 // Export inventory gaps found by the core-scope audit (messaging extraction prep, 2026-10-26). MCP authorization rows
 // (`mcp/v1/*`) live in the MCP shard stores, not in the account store, so they have no account export entry.
 'mcp/operation/':'Transient: MCP agent mutation journal (48-hour replay fence); the items themselves are exported under messages.',
 'mcp/operation-expiry/':'Derived: MCP journal expiry index.',
 'automation/session/':'Transient: browser automation session grants; they expire with the browser session and are revocable.',
 'automation/confirmation/':'Transient: one-time browser automation confirmation receipts.',
 'classifier/usage/v1':'Retired: counters of the earlier built-in classifier (replaced by ai/usage/v1, 2026-10-28); nothing writes them any more.',
 'ai/usage/v1':'Derived: AI allowance accounting (monthly estimated spend, per-app share, per-service minute counters).',
 'app-notification-budget/':'Derived: per-connection app message rate accounting.',
 'app-notification-receipt/':'Transient: app message replay receipts (48-hour retention).',
 'message-postback-prepared/':'Secret: prepared form-submission capabilities (encrypted scope).',
 'migration/':'Derived: storage migration markers (including the BB-CUT, contact-links and email-bridge reset markers).', 'export/':'Transient: exports and download authority.',
 'notification-event/':'Transient: notification queue.', 'notification-job/':'Transient: delivery queue.', 'notification-unsubscribe/':'Secret: unsubscribe capabilities.',
 'search-queue-usage/':'Derived: search usage.', 'search-vector-revision/':'Derived: search vectors.',
 'search':'Derived: search indexes, queues and maintenance cursors.', 'item-index':'Derived: SQLite item index.',
 'deletion/':'Transient: deletion workflow and cancel-only capabilities; lifecycle projection carries owner deadlines.',
 'transfer-out/':'Transient: identity transfer-out workflow (PORT-2), dispute-token hashes and custody markers; the move record is published by the destination.',
 'blob-garbage/':'Transient: physical deletion journal.', 'blob-garbage-cursor':'Transient: garbage continuation.',
 'message-view-receipts/':'Transient: mutation receipts.', 'message-views-receipts/':'Transient: mutation receipts.',
 'connections/outbox/':'Transient: severance delivery.', 'connections/cascade/':'Transient: cascade delivery.', 'connections/meta':'Derived: sequence and outbox counters.',
 'key-delegation/':'Public lineage is projected by the keys port; encrypted private authority is excluded.',
 'builtin/':'Derived: built-in resource pointer.', 'hosted-index':'Derived: hosted index.', 'storage/':'Transient: quota cleanup and reservations.',
 'rpc-journal/':'Transient: RPC replay journal.',
 'integration-events/':'Transient: integration delivery outbox.', 'brokered/':'Secret: brokered authority and severance journal.',
 'shelved':'Derived: archive placement marker.', 'cold-index-mode':'Derived: archive placement marker.', 'lastOwnerActiveAt':'Lifecycle projection supplies activity time.', 'lastResourceActiveAt':'Lifecycle projection supplies activity time.', 'account/created-at':'Derived: account-local creation time for the semantic admission age gate.', 'semantic/first-seen':'Derived: semantic admission age-gate fallback clock.',
 'lifecycle':'Lifecycle state uses the lifecycle contributor; transport/effect journals are transient.', '@alarm':'Transient: scheduler wake.',
 'maintenance/':'Transient: maintenance retry.', 'population/':'Derived: aggregate active population.',
 'billing/pending':'Transient: checkout intent.', 'billing/sync':'Derived: provider synchronization health.',
 'drive/oauth/':'Secret: OAuth callback state.', 'drive/folder-pending/':'Secret: folder creation and OAuth journal.', 'drive/pending/':'Transient: upload journal.', 'drive/retained/':'External mappings are projected by the external-storage port.', 'drive/usage/':'Derived: external quota counters.', 'drive/removed/':'Transient: removed-resource sweep markers.',
 'evbus/index/':'Derived: manifest index.', 'evbus/reader/':'Secret: reader cursor authority.', 'evbus/permit/':'Transient: history opt-in.', 'evbus/tx/':'Transient: publish journal.', 'evbus/rate/':'Derived: rate counters.', 'evbus/meter/':'Derived: quota meters.', 'evbus/wait/':'Transient: wait leases.',
 'google-drive/':'Secret: OAuth and callback state; external mapping uses a dedicated port.',
 // Signaling state that is per device, per session, transient, derived or a capability (§12.6 "Excluded"). Session
 // records live at most 24 h after their end; payloads at most 60 s (§12.4).
 'sig/ep/':'Secret: signaling endpoint registrations (hashed endpoint secrets or DPoP key bindings, Web Push keys); device-local and re-registered by apps.',
 'sig/epq/':'Transient: signaling endpoint event queues (payloads kept at most 60 s).',
 'sig/out/':'Transient: signaling initiator session records (kept at most 24 h after the session ends).','sig/in/':'Transient: signaling recipient session records (kept at most 24 h after the session ends).',
 'sig/dlv/':'Derived: signaling fan-out index.','sig/dlg/':'Derived: certified leg-key thumbprints (reuse refusal window).',
 'sig/limit/':'Derived: signaling rate-limit windows (hashed keys).','sig/aep/':'Derived: highest authority epochs seen from signaling peers (24 h).',
 'sig/outbox/':'Transient: signaling outbox (offer tokens beside invites until answer_by).','sig/outbox-seq':'Derived: signaling outbox sequence.','sig/closed':'Transient: signaling deletion marker.',
 'sig/inq/':'Transient: inbound signaling batches awaiting processing.','sig/inq-meta':'Derived: inbound signaling queue counters.',
 'sig/offer/':'Transient capability: live offers (token hashes only), deleted at expiry; never exported (§5.7, §12.6).',
 'sig/pairing-peer/':'Derived: index of cross-entity pairings by (peer principal, kind line).',
 'sig/review/':'Transient: owner-page reviews (single-use, at most 10 minutes; a digest of the reviewed change, its arming and expiry times; packages/signaling/owner-pages.mjs).',
 'sig/relay/':'Transient: relay credential leases (TURN usernames only, never credentials; at most 300 s past the leg).',
 'sig/relay-use/':'Derived: relay allowance counters (reserved bytes this month and last, one-hour issuance window).',
 // Legacy rows of the replaced RTC code (dev and test stores only), deleted by the one-time reset on the account alarm
 // (packages/runtime/account/signaling.mjs legacyRtcReset; signaling Appendix C).
 'rtc/':'Retired: rows of the replaced RTC signaling code, pending the one-time reset; never exported.',
 // Contact-link families (contacts phase 4): no code writes them any more. Rows written before the change exist only
 // until the `contact-links-retired-v1` reset (packages/runtime/contact-links-reset.mjs) deletes them; never exported.
 ...Object.fromEntries(CONTACT_LINKS_RESET_PREFIXES.filter(prefix=>prefix!=='rtc/contact/').map(prefix=>[prefix,'Retired: contact-link rows pending the contact-links-retired-v1 reset; never exported.']))
};
export const EXPORT_EXCLUDED_PREFIXES=Object.freeze(excluded);
// Singleton keys match exactly, never as a prefix (review R4): `profile` must not claim `profile-other/...`.
export const EXPORT_SINGLETON_KEYS=Object.freeze(new Set(['profile']));
const matches=(key,prefix)=>EXPORT_SINGLETON_KEYS.has(prefix)?key===prefix:key.startsWith(prefix);
export function exportInventory(prefixes){return prefixes.map(prefix=>{const claimed=Object.keys(EXPORT_CLAIMED_PREFIXES).filter(p=>matches(prefix,p)).sort((a,b)=>b.length-a.length)[0];if(claimed)return {prefix,contributor:EXPORT_CLAIMED_PREFIXES[claimed]};const excluded=Object.keys(EXPORT_EXCLUDED_PREFIXES).filter(p=>matches(prefix,p)).sort((a,b)=>b.length-a.length)[0];return {prefix,...excluded?{reason:EXPORT_EXCLUDED_PREFIXES[excluded]}:{}};});}
const stable=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(value))fault('invalid_export_id','A stable archive identifier is required.',409);return value;};
export function identityExportRow(row){
 const value=pick(row,fields('id handle aliases assignmentId createdAt status termsVersion termsAcceptedAt verifiedEmail emailVerifiedAt emailLoginEnabled audit lineage nameCertificate'));
 value.passwordPresent=!!(row.passwordPresent??row.passwordHash??row.password);
 value.passkeys=(row.passkeys??row.credentials??[]).map(v=>pick(v,fields('id label createdAt lastUsed backedUp')));
 value.sessions=(row.sessions??[]).map(v=>pick(v,fields('label source createdAt lastUsed expiresAt')));value.audit=publicValue((value.audit??[]).slice(-100));const safe=publicValue(value);safe.passwordPresent=value.passwordPresent;return safe;
}
/** Read-only ports: identity(owner), keys(owner), grants.page({owner,cursor,limit}),
 * externalStorage.page(...) (the decrypted host-held mapping, NEVER external
 * bytes). Missing required ports fail closed rather than claim a complete export.
 * Each contributor returns {rows,payloads,cursor,done}, at most limit rows and
 * 500 payload descriptors (digested in groups of 32). `ref` stays private. */
export function createExportContributors({accountStore,identity,keys,grants,externalStorage,flags,quota}={}){
 const port=(name,reader,project)=>({name,version:1,async page({owner,cursor,limit}){if(!reader)fault('export_contributor_unavailable',`The ${name} export port is unavailable.`,503);const page=await reader({owner,cursor,limit});return {...page,rows:page.rows.map(project),payloads:[]};}});
 const result=[
  port('identity',identity&&(async({owner})=>({rows:[await identity(owner)],done:true})),identityExportRow),
  port('keys',keys&&(async({owner})=>({rows:[await keys(owner)],done:true})),row=>projection(row,'publicKeys keyIds certificates backupWorkflow')),
  port('grants',grants?.page?.bind(grants),row=>projection(row,'client clientId fragments fields resources methods created expires device label kind grantType lastUsedAt grantIds'))
 ];
 for(const [name,prefixes,names]of definitions){
  if(name==='external-storage'){result.push(port(name,externalStorage?.page?.bind(externalStorage),row=>projection(row,names)));continue;}
  result.push({name,version:1,prefixes,async page({owner,cursor,limit}){
   const index=cursor?.index??0,prefix=prefixes[index],pageLimit=name==='messages'?Math.min(limit,15):limit,rows=EXPORT_SINGLETON_KEYS.has(prefix)?new Map([...await accountStore.list({prefix,startAfter:cursor?.after??'',limit:pageLimit})].filter(([key])=>key===prefix)):await accountStore.list({prefix,startAfter:cursor?.after??'',limit:pageLimit}),payloads=[],out=[];
   for(const [key,row]of rows){
    if(row?.owner!==undefined&&row.owner!==owner||name==='connections'&&row?.kind!=='app-connection'||name==='resources'&&row?.kind==='app-connection'||name==='integrations'&&retiredEmailBridgeRow(row))continue;
    const value=projection(row,names);out.push({schemaVersion:1,record:value});
    if(row?.blobRef&&name==='messages')payloads.push({entryId:stable(row.id),kind:'message',source:{message:row.id,part:0},ref:row.blobRef,path:exportPath(`data/messages/${stable(row.id)}/0.bin`),size:row.size,contentType:row.mimeType});
    if(name==='messages')for(const part of row.presentation?.history??[])if(part.blobRef)payloads.push({entryId:stable(row.id)+'_'+part.revision,kind:'message',source:{message:row.id,part:part.revision},ref:part.blobRef,path:exportPath(`data/messages/${stable(row.id)}/${part.revision}.bin`),size:part.size,contentType:part.mimeType??'application/octet-stream'});
    if(row?.blobRef&&key.startsWith('hosted/')){const resource=key.split('/')[1];payloads.push({entryId:stable(row.version),kind:'object',source:{resource,key:row.key,version:row.version},ref:row.blobRef,path:exportPath(`data/objects/${stable(resource)}/${stable(row.version)}.bin`),size:row.size,contentType:row.contentType});}
   }
   const more=rows.size===pageLimit,next=more?{index,after:[...rows.keys()].at(-1)}:index+1<prefixes.length?{index:index+1}:null;
   if(name==='quota'&&next===null){if(typeof quota!=='function')fault('export_contributor_unavailable','The quota export port is unavailable.',503);out.push({schemaVersion:1,limit:await quota(owner)});}
   return {rows:out,payloads,cursor:next,done:next===null};
  }});
 }
 result.push({name:'producer-summaries',version:1,prefixes:['hosted/','drive/object/'],async page({owner,cursor,limit}){
  const prefixes=['hosted/','drive/object/'],index=cursor?.index??0,prefix=prefixes[index],rows=await accountStore.list({prefix,startAfter:cursor?.after??'',limit}),groups=new Map();
  for(const [path,row]of rows){const p=row?.producer;if(!p||row.owner!==undefined&&row.owner!==owner)continue;const resource=path.slice(prefix.length).split('/')[0],base=JSON.stringify([resource,p.connection,p.generation]),seen=[...groups.values()].filter(g=>g.base===base);let folder=p.prefix??'';if(!seen.some(g=>g.record.prefix===folder)&&seen.length>=64)folder='[other]';const bucket=JSON.stringify([base,folder]);let group=groups.get(bucket);if(!group){group={base,record:{resource,connection:p.connection,generation:p.generation,prefix:folder,items:0,bytes:0}};groups.set(bucket,group);}group.record.items++;group.record.bytes+=Number.isSafeInteger(row.size)&&row.size>=0?row.size:0;}
  const next=rows.size===limit?{index,after:[...rows.keys()].at(-1)}:index+1<prefixes.length?{index:index+1}:null;return {rows:[...groups.values()].map(({record})=>({schemaVersion:1,record})),payloads:[],cursor:next,done:next===null};
 }});
 result.push({name:'features',version:1,async page({owner}){const port=flags.for({subject:{kind:'account',owner}});return {rows:Object.values(FLAGS).filter(f=>f.class==='a').map(f=>({name:f.name,...port.evaluate(f.name)})),done:true};}});
 result.push({name:'apps-held',version:1,async page({cursor,limit}){const rows=await accountStore.list({prefix:'resource/',startAfter:cursor??'',limit});return {rows:[...rows.values()].filter(v=>v.kind==='app-connection').map(v=>({...projection(v,'clientId provider'),guidance:'Export data held by this app through its own export controls.'})),cursor:rows.size===limit?[...rows.keys()].at(-1):null,done:rows.size<limit};}});
 return result;
}
