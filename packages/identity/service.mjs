import {ageRequirement,trustedAgeLocation} from './age-policy.mjs';
import {validateHostAlias,configuredReservedName,projectAccountBadges,defaultBadgeResolver,configuredBadgeIDs} from './badge-policy.mjs';
import {onboardingAlias,sameOnboardingIdentity} from './onboarding.mjs';
import {systemMarker,systemBadge,sameSystemIdentity} from './system-bootstrap.mjs';
import {normalizeHandle,validatePaidHandle,isReservedHandle} from './handles.mjs';
import { IdentityCrypto, secureEqual, encode, decode } from './crypto.mjs';
import { DeviceLogin } from './device-login.mjs';
import { LinkedApproval, MemoryLinkedLimits, pruneLineage, revokeLineage, revokeAllLineage } from './linked-approval.mjs';
import { interactiveIdentity } from './organizations.mjs';
import {raiseAuthorityEpoch,authorityEpoch,organizationVerification} from './authority-epoch.mjs';
import {createRecoveryPayload,RECOVERY_FILE_ID} from '../recovery/index.mjs';
import {recoveryReminder} from './recovery-reminder.mjs';
import {passwordDerived} from './password-authority.mjs';
import {accountEmails,confirmedEmails,signInEmails,noticeEntry,noticeEmail,emailEntry,emailProjection,migrateEmails,MAX_CONFIRMED_EMAILS,MAX_UNVERIFIED_EMAILS,UNVERIFIED_EMAIL_TTL_MS,ESTABLISHED_METHOD_AGE_MS} from './emails.mjs';

/**
 * DX-6 identity security state (docs/architecture/account-deletion-export.md §2.1, §3, §6, R1-H1).
 *
 * Record field `account.security = {epoch, changedAt}`:
 *   epoch     non-negative safe integer. +1 in the SAME compareAndSwap as each security-sensitive change, so a
 *             reader that sees a change also sees its bump, and a lost CAS race never bumps.
 *   changedAt non-negative safe integer (identity clock, ms) of the latest bump; never moves backwards
 *             (max(previous, now)), so a clock step cannot shorten the 72-hour window.
 *   Creation (signup, operator onboarding, system bootstrap) writes {epoch:0, changedAt:createdAt}: establishing
 *   the first credential is itself a security event. A record without the field (written before DX-6) reads as
 *   {epoch:0, changedAt:0}. A malformed field fails closed: reads throw `identity_security_unavailable`.
 *   The lifecycle tombstone discards it (not RETAINED; DX-3).
 *
 * Bumped by exactly these writes (one bump per CAS):
 *   an address verified (setupEmailConfirm, emailConfirm), a verified address removed and the email-notice waiver
 *   (emailRemove), a sign-in email turned on (configureEmailLogin verified→sign-in) or removed or turned off (the
 *   removal process, emailRemove / configureEmailLogin sign-in→verified), credential added (registerPasskey,
 *   credentialFinish) or removed (removePasskey), recovery-file recovery (recover: start and resume)
 *   and recovery-file issuance (downloadRecovery, which every setup and recovery completion requires), an active-account
 *   reissue commit (reissueRecoveryConfirm) and its cancellation (reissueRecoveryCancel*, which also raises
 *   `federationGeneration` so no OAuth grant survives the restored credential).
 * Never bumped by: sessions (create, use, close, revoke), step-up, terms acceptance, renames, passkey counter
 *   updates, email-link or email-login requests, adding or deleting an unverified address, choosing the notice
 *   address, handle claims. These are the cheap,
 *   repeatable events that would otherwise let an attacker flush the change out of a rolling window.
 *
 * Trusted read-only port (never routed; adapters pass it to deletion and export):
 *   identitySecurity(owner: UUID) → Promise<Readonly<{epoch:number, changedAt:number}> | null>
 *     null  no identity record, or status 'deleted' (consumers fail closed);
 *     throws on repository failure or malformed state (consumers fail closed).
 *   Obtain it as `identitySecurityPort(repository)` (any repository with get(id): the Node IdentityRepository or the
 *   Worker ShardedIdentityRepository) or `IdentityService#identitySecurity(owner)`.
 *   Consumers: deletion grace (30 days when now - changedAt < 72 h; deadline >= changedAt + 14 d during grace),
 *   the export ready-delay (notBefore = changedAt + 72 h) and the export download binding (job epoch === epoch).
 *
 * Recovery credential (recovery file v3, option C, owner approval 2026-10-28; identity portability P14):
 *   The file is an opaque credential {version:3, issuer, entity, recoveryToken, fileId, issuedAt} encrypted on the device
 *   (packages/recovery/index.mjs). It holds no keys, so issuing it never rotates or binds a key (P15 and the recovery kid
 *   binding are withdrawn). Envelope v1 files (payloads v1 and v2) are not recognised: a record whose credential is not
 *   v3 has no usable credential and the console asks for a new file (`reissueRequired: 'legacy-format'`).
 *   recoveryHash           domain-separated hash of the CURRENT reset credential.
 *   recoveryIssuedAt       identity clock (ms) at which it became the current credential, written in the same CAS as the
 *                          hash. P14's 7-day age rule and the annual reminder read it through `recoveryCredential(account)`.
 *                          The file payload's `issuedAt` is when the server minted the file. They are equal for the
 *                          first file (one write) and for organization files (`bindRecovery` stores the payload's
 *                          value); after a reissue the record holds the confirm time and the payload the begin time
 *                          (earlier, within RECOVERY_REISSUE_TTL_MS), because the file is encrypted on the device before
 *                          it can become current. Nothing compares them: the record decides, the check-up uses fileId.
 *   recoveryFileId         the public id of the current file (envelope header and payload); the console's local
 *                          check-up compares it. `recoveryBackupVersion` 3 marks a v3 credential.
 *   recoveryResumeHash / recoveryResumeFileId / recoveryResumeBackupVersion   the credential that resumes an
 *                          in-progress recovery.
 *   recoveryReminder       {fileId, slot, at}: the last annual reminder slot sent for that file (recovery-reminder.mjs).
 *   downloadRecovery       issues a new v3 file during setup or after a recovery (budgeted: 5 per setup token).
 *   reissueRecoveryBegin / reissueRecoveryConfirm   the active-account reissue (recovery-identity "Active-account
 *                          reissue", provisional). Begin needs a fresh passkey step-up with a passkey enrolled >= 7
 *                          days earlier (`session.stepUpCredential`), or an armed forced marker
 *                          `recoveryReissue` = {reason:'elevated-abort'|'transfer-in', at}; it passes the account gate
 *                          (identityBackup.reissue) and stages `recoveryStaged` = {hash, fileId, sessionId, preparedAt,
 *                          expiresAt, base, forced?}. The current file is never cancelled before the owner
 *                          acknowledges the new one: confirmation (the browser compared the hash of the re-uploaded
 *                          encrypted file with the bytes it downloaded, then posts the staged token and file id) runs
 *                          the account gate (identityBackup.reissueCommit: refuses deletion/moved/contested, cancels a
 *                          live transfer-out) and then makes the staged credential current in one CAS with a
 *                          `security` bump, opening the 7-day cooling-off window `recoveryPrevious` (wargame
 *                          2026-10-23 #1, kept by owner approval 2026-10-28): the new file cannot start a recovery and
 *                          the previous one can only cancel (`pendingReissue`). Begin needs a passkey step-up whenever
 *                          the account has a passkey. An abandoned or expired staging leaves the current file current.
 *   reissueRecoveryCancel / ...CancelEmail / ...CancelFile   cancel the window from a session created before the reissue
 *                          began, the emailed link, or the previous file (cancelReissue).
 *   sendRecoveryReminder   the annual reissue offer (a reminder only; it changes no credential): 30 days before the
 *                          file's anniversary, on it, then every 30 days, by email and push; acceptance, not delivery.
 *
 * Passwords (owner approval 2026-10-28, "drop passwords"; sign-in and intents spike §6.3, plan provisional): there is no
 *   password sign-up, sign-in, step-up or storage. A record written earlier may still carry `passwordHash` /
 *   `passwordSetAt`; nothing reads them, password-derived authority is refused at use time (`passwordDerived`: a
 *   password session, a session approved from one, an activation session of a record with password fields; also in
 *   linked approval and app lineage), and `retirePasswords` (password-retirement.mjs) strips or resets such records.
 *   The operator boot principal keeps its own password option until the owner answers N5 (packages/identity/admin.mjs).
 *
 * Email addresses (sign-in and intents spike §3, owner approval 2026-10-28; packages/identity/emails.mjs): up to three
 *   verified addresses, one of them the notice address, plus one unverified address awaiting its link (24 h, holds no
 *   uniqueness claim). Only a verified address becomes a sign-in email (configureEmailLogin, passkey step-up or the
 *   SI-4 email step-up). Turning a sign-in email off or removing it is the removal process (spike §6.4, provisional):
 *   RM-1 floor, RM-2 Tier A (a recent sign-in email undone with a fresh assertion from an established passkey) and
 *   RM-3 (a recent sign-in email that an email session added, undone from an established sign-in email). Tier B (an
 *   established sign-in email) needs the recovery spike's proof-only file presentation, which does not exist yet, so
 *   it is refused with `removal_unavailable` (N6). Passkeys follow the same tiers (`passkeyRemovalAuthority`, review
 *   2026-10-29 M2). An account with no passkey may add one from a fresh email session (SI-4, Q8; `passkeyAddAuthority`),
 *   recorded as `addedBy: {session:'email', emailAddress, sessionId}` so RM-3 can undo it.
 *
 * Email removal resources (constructor, both optional, both fail closed):
 *   flags            flags port {for(ctx)} or a thunk returning the current one; EMAIL_REMOVAL_ENABLED is read with
 *                    for({subject:{kind:'account', owner}}).enabled(). Missing port or unknown flag ⇒ disabled.
 *   accountChannels  {state(owner) → {ready:boolean, count:number, revision:string}, notify?(owner, event)}; see
 *                    packages/runtime/account-channels.mjs. Missing ⇒ no other notice channel.
 */
/** The current recovery credential's issuance facts for P14, or null when there is none that could start a recovery
 * now (not active, no credential, no recorded issuance time, or a legacy v1/v2 credential). `keyKid` is always null
 * (v3 files hold no keys); dormant transfer-out still reads it. Pure. */
export function recoveryCredential(account){
  if(account?.status!=='active'||typeof account.recoveryHash!=='string'||!account.recoveryHash||!nonNegative(account.recoveryIssuedAt)||!currentFormat(account))return null;
  return Object.freeze({issuedAt:account.recoveryIssuedAt,version:3,fileId:account.recoveryFileId,keyKid:null});
}
/** Whether the record's current credential belongs to a v3 file. Pure. */
const currentFormat=account=>account?.recoveryBackupVersion===3&&typeof account.recoveryFileId==='string'&&RECOVERY_FILE_ID.test(account.recoveryFileId);
/** Recovery-credential age for P14, and the reissue-authority credential age (P18, P19): 7 days. */
export const RECOVERY_CREDENTIAL_AGE_MS = 7 * 86400000;
/** How long a staged reissue waits for its confirmation (phase 2). */
export const RECOVERY_REISSUE_TTL_MS = 30 * 60000;
/** Forced-reissue reasons (recovery-identity spec "Active-account reissue"). */
export const RECOVERY_REISSUE_REASONS = Object.freeze(['elevated-abort', 'transfer-in']);
/** The reissue cooling-off window (recovery-identity spec "Active-account reissue", wargame 2026-10-23 #1, provisional):
 * after a reissue commits, the new file cannot start a recovery and the previous file can only cancel the reissue
 * until it ends. Mirrors P14. */
export const RECOVERY_REISSUE_WINDOW_MS = RECOVERY_CREDENTIAL_AGE_MS;
/** How long replaced emails stay notice channels and how far back email changes and other-session revocations count
 * against a passkey's reissue authority (review 2026-10-23 R1, provisional): 30 days. */
export const SECURITY_LOOKBACK_MS = 30 * 86400000;
/** Replaced emails and authority events are retained this much longer than the lookback, so a reissue whose begin
 * falls inside the lookback still finds them at confirmation (up to the 30-minute staging TTL later). */
const SECURITY_RETENTION_MS = SECURITY_LOOKBACK_MS + 3600000;
/** One account security notice per account and type per 10 minutes; later ones are coalesced into the next. */
export const SECURITY_NOTICE_COALESCE_MS = 600000;
/** The live cooling-off record `account.recoveryPrevious` = {hash, issuedAt, fileId, version, marker, reissuedAt,
 * preparedAt, until, newFileId, cancelHash, credential}, or null when no reissue is pending at `now`. Pure. */
export function pendingReissue(account, now){const p=account?.recoveryPrevious;return p&&typeof p==='object'&&Number.isSafeInteger(p.until)&&p.until>now&&Number.isSafeInteger(p.reissuedAt)&&Number.isSafeInteger(p.preparedAt)&&typeof p.newFileId==='string'?p:null;}
/** The step-up credential as the P17 contest window compares it: a passkey id, or null. */
export const stepUpCredentialId = session => session?.stepUpCredential?.kind==='passkey'&&typeof session.stepUpCredential.id==='string'?session.stepUpCredential.id:null;
// Password-derived authority (records from before password removal) is recognised in ./password-authority.mjs, the one
// place that reads legacy password fields; this service only refuses what it reports.
export { passwordSession, passwordFields, passwordDerived } from './password-authority.mjs';
const LOGIN_TOKEN=/^pl1\.([A-Za-z0-9_-]{1,800})\.([A-Za-z0-9_-]{43})$/;
/** The armed forced-reissue marker `account.recoveryReissue` = {reason, at}, or null. Pure. */
export function reissueMarker(account){const marker=account?.recoveryReissue;return marker&&typeof marker==='object'&&RECOVERY_REISSUE_REASONS.includes(marker.reason)&&Number.isSafeInteger(marker.at)&&marker.at>=0?marker:null;}
const stagedReissue=value=>value&&typeof value==='object'&&typeof value.hash==='string'&&typeof value.fileId==='string'&&RECOVERY_FILE_ID.test(value.fileId)&&typeof value.sessionId==='string'&&Number.isSafeInteger(value.expiresAt)&&(value.base===null||typeof value.base==='string')?value:null;
/** Account security notices sent to every channel (review 2026-10-23 R1(ii)). */
export const ACCOUNT_SECURITY_NOTICES = Object.freeze(['passkey-added','passkey-removed','email-changed','email-sign-in-enabled','email-sign-in-removed','notice-email-changed','sessions-revoked','sessions-evicted']);
export const SECURITY_EVENTS = Object.freeze(['setup-email-verified','email-linked','email-removed','email-login-enabled','email-login-disabled','passkey-registered','passkey-added','passkey-removed','recovery-file-issued','recovery-file-reissued','recovery-reissue-cancelled','account-recovery-started','recovery-setup-resumed']);
export class IdentityFault extends Error {
  constructor(code, message = 'The account request could not be completed.') { super(message); this.code = code; }
}
const fail = (code, message, status) => { const error = new IdentityFault(code, message); if (status) error.status = status; throw error; };
const nonNegative = value => Number.isSafeInteger(value) && value >= 0;
/** The record's security state; legacy records read as {epoch:0, changedAt:0}; malformed state throws. */
export function securityState(account) {
  if (account?.security === undefined) return Object.freeze({ epoch: 0, changedAt: 0 });
  const { epoch, changedAt } = account.security ?? {};
  if (!nonNegative(epoch) || !nonNegative(changedAt) || !Number.isSafeInteger(epoch + 1)) fail('identity_security_unavailable', 'Account security state needs review.', 503);
  return Object.freeze({ epoch, changedAt });
}
/** identitySecurity(owner) over any identity repository with get(id). */
/** Wargame 4 M1: queue the push-subscription end row on an account record about to be CAS-written. For code that ends
 * sessions outside IdentityService (transfer-out, admin): write it in the ending CAS; IdentityService#flushPushEnds runs
 * it (owner view, next save). `nonce` identifies this queueing so a stale run never clears a newer row. */
export function queuePushEndsOn(account,ids,{keep,keepSubscriptions,nonce}={}){
  const prior=account.pendingPushEnds&&typeof account.pendingPushEnds==='object'?account.pendingPushEnds:{ids:[]};
  const next={ids:[...new Set([...(Array.isArray(prior.ids)?prior.ids:[]),...ids])].slice(-200),nonce:typeof nonce==='string'&&nonce?nonce:crypto.randomUUID()};
  if(keep)Object.assign(next,{keep:keep.slice(0,20),keepSubscriptions:(keepSubscriptions??[]).slice(0,10)});else if(Array.isArray(prior.keep))Object.assign(next,{keep:prior.keep,keepSubscriptions:prior.keepSubscriptions??[]});
  if(next.ids.length||next.keep)account.pendingPushEnds=next;
}
export function identitySecurityPort(repository) {
  if (typeof repository?.get !== 'function') throw new TypeError('An identity repository is required.');
  return async owner => { const account = await repository.get(owner); return account && account.id === owner && account.status !== 'deleted' ? securityState(account) : null; };
}
const publicAccount = (a,badges=[],now) => ({ id: a.id, handle: a.handle, status: a.status, createdAt: a.createdAt,
  badges,termsVersion: a.termsVersion, passkeyCount: a.credentials.length,
  recoveryConfigured: Boolean(a.recoveryHash), paidHandle:a.paidHandle||null, aliases:[a.handle,...onboardingAlias(a)?[onboardingAlias(a)]:[],...a.paidHandle?[a.paidHandle]:[],...systemBadge(a)?[a.systemIdentity.handle]:[]],...systemBadge(a)?{systemBadge:systemBadge(a)}:{}, emails: emailProjection(a,now), noticeEmail: noticeEmail(a), signInEmail: signInEmails(a).length>0, lastActiveAt: a.lastActiveAt });
function emailAddress(value) {
  if (typeof value !== 'string' || value.length > 254 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+$/.test(value)) fail('invalid_email', 'Enter an ordinary email address.');
  const [local, domain] = value.split('@');
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..') || !domain.includes('.') || domain.split('.').some(part => !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(part))) fail('invalid_email');
  return `${local}@${domain.toLowerCase()}`;
}
function handle(value){try{return normalizeHandle(value);}catch{fail('invalid_handle','Enter your complete account handle.');}}

function tokenParts(value) {
  if (typeof value !== 'string' || value.length > 150 || !/^[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/.test(value)) fail('unauthorized', 'Authentication failed.');
  return value.split('.');
}
function safeLabel(value, fallback = 'Browser session') {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !value.trim() || value.length > 80 || /[\u0000-\u001f\u007f]/.test(value)) fail('invalid_label', 'Use a device or passkey name of 1–80 characters.');
  return value.trim();
}
const publicCredentials = account => account.credentials.map(({ id, label, deviceType, backedUp, createdAt }) => ({ id, label: label || 'Passkey', deviceType, backedUp, createdAt }));

/** Platform-independent account policy. Repository must implement linearizable
 * create and compareAndSwap; an in-memory repository is only a test resource. */
export class IdentityService {
  constructor({ repository, deviceRequests, linkedApprovals = deviceRequests, linkedLimits, linkedPollLimits, approvalNotices, crypto, clock = () => Date.now(), turnstile, rateLimiter, webauthn, mailer, identityBackup, paidHandleEligibility, setupBilling, systemBootstrap, onboarding, resolveIdentityBadges, pushTransport, reservedHandle, flags, accountChannels, closure, severConnections, organizationSignals, config }) {
    if (!repository || !turnstile || !rateLimiter || !webauthn || !config?.termsVersion) throw new TypeError('Identity resources and terms version are required');
    const origin = new URL(config.origin);
    if (origin.origin !== config.origin || origin.hostname !== config.rpID || (origin.protocol !== 'https:' && !(config.allowInsecureLocalhost && origin.protocol === 'http:' && origin.hostname === 'localhost'))) throw new TypeError('Exact RP origin is required');
    this.repository = repository; this.crypto = new IdentityCrypto(crypto); this.clock = clock;
    this.turnstile = turnstile; this.rateLimiter = rateLimiter; this.webauthn = webauthn;
    this.pushTransport=pushTransport;this.mailer = mailer; this.identityBackup = identityBackup; this.paidHandleEligibility=paidHandleEligibility;
    // `linkedApprovals` is the renamed `deviceRequests` repository (create/get/findByUserCode/compareAndSwap).
    // `linkedLimits` is the durable window port for budgets; `linkedPollLimits` the non-durable poll limiter.
    this.deviceRequests = this.linkedApprovals = linkedApprovals; this.linkedLimits = linkedLimits ?? new MemoryLinkedLimits(clock); this.linkedPollLimits = linkedPollLimits ?? new MemoryLinkedLimits(clock); this.approvalNotices = approvalNotices;
    this.setupBilling = setupBilling;this.systemBootstrap=systemBootstrap;this.onboarding=onboarding;this.resolveIdentityBadges=resolveIdentityBadges??defaultBadgeResolver;this.reservedHandle=reservedHandle;this.flags=flags;this.accountChannels=accountChannels;this.closure=closure;this.severConnections=severConnections;this.organizationSignals=organizationSignals;
    this.config = { rpName: '3sln.me', sessionTtlMs: 86400000, pendingTtlMs: 1800000, challengeTtlMs: 300000, ...config };
    if (!(this.config.sessionTtlMs > 0 && this.config.sessionTtlMs <= 86400000)) throw new TypeError('Sessions must expire within 24 hours');
  }
  origin(context) { if (context?.origin !== this.config.origin) fail('csrf', 'Use the account website to complete this request.'); }
  /** ORG-12b break-glass liveness (organizations design §12d.3): an interactive sign-in (passkey, email) or a
   * step-up. `lastInteractiveAt` rides the caller's own CAS (no extra write); the owner hook `organizationSignals.liveness`
   * runs fire-and-forget and returns nothing to identity. Background session refreshes never call this. */
  interactive(account,kind,context){const at=this.clock();account.lastInteractiveAt=at;if(account.status==='active'&&typeof this.organizationSignals?.liveness==='function'){const owner=account.id;this.background(context,()=>this.organizationSignals.liveness(owner,{kind,at}));}}
  async projectAccount(account){
    const aliases=[account.handle,...onboardingAlias(account)?[onboardingAlias(account)]:[],...account.paidHandle?[account.paidHandle]:[],...systemBadge(account)?[account.systemIdentity.handle]:[]],identity=Object.freeze({id:account.id,handle:account.handle,status:account.status,aliases:Object.freeze(aliases),badgeIds:Object.freeze(Array.isArray(account.badgeIds)?[...account.badgeIds]:[])});let ids,timer;
    try{ids=await Promise.race([Promise.resolve().then(()=>this.resolveIdentityBadges(identity)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Badge resolution timed out')),500);})]);}catch{ids=[];}finally{clearTimeout(timer);}
    return publicAccount(account,projectAccountBadges(account,this.config,ids),this.clock());
  }
  async guard(operation, input, context) {
    this.origin(context);
    // Wargame 2026-10-23 #3: only per-network windows run before Turnstile. Handle-keyed windows never see CAPTCHA-less
    // traffic.
    if (!await this.rateLimiter.check({ phase: 'attempt', operation, remoteIP: context.remoteIP, region:context.region })) fail('rate_limited', 'Please wait before trying again.');
    if (typeof input.turnstileToken !== 'string' || input.turnstileToken.length > 4096 || !await this.turnstile.verify({ token: input.turnstileToken, remoteIP: context.remoteIP, action: operation, hostname: new URL(this.config.origin).hostname })) fail('challenge_failed', 'Complete the security check and try again.');
  }
  audit(account, type) { account.audit = [...(account.audit || []).slice(-99), { id: this.crypto.id(), type, at: this.clock() }]; }
  /** HMAC under a key derived from `config.loginTokenKey` or `config.linkedCodeKey` (never used directly). Without one
   * (tests, single-process embeddings) a per-instance random key is used: tokens then verify only in this instance,
   * so a multi-isolate deployment without a key fails closed. */
  async mac(purpose,value){
    this.macKey ??= (async()=>{const webcrypto=this.crypto.crypto,raw=this.config.loginTokenKey??this.config.linkedCodeKey;if(raw!==undefined&&raw!==null&&(typeof raw!=='string'||raw.length<16))throw new TypeError('The identity token key must be at least 16 characters.');if((raw===undefined||raw===null)&&this.config.allowInsecureLocalhost!==true&&this.config.linkedEphemeralKey!==true)throw new TypeError('An identity token key (LINKED_CODE_KEY or KEY_ENCRYPTION_KEY) is required outside local development.');const material=typeof raw==='string'?new TextEncoder().encode(raw):webcrypto.getRandomValues(new Uint8Array(32));const root=await webcrypto.subtle.importKey('raw',material,{name:'HMAC',hash:'SHA-256'},false,['sign']);const derived=await webcrypto.subtle.sign('HMAC',root,new TextEncoder().encode('bindle-identity-token-key-v1'));return webcrypto.subtle.importKey('raw',derived,{name:'HMAC',hash:'SHA-256'},false,['sign']);})();
    const signature=await this.crypto.crypto.subtle.sign('HMAC',await this.macKey,new TextEncoder().encode(`${purpose}\0${value}`));return encode(new Uint8Array(signature));
  }
  /** Work that must not delay the response (mail provider calls): the platform's waitUntil when the adapter supplies
   * one, otherwise detached. Failures are swallowed: callers never surface provider errors. `settleBackground()` lets
   * tests wait for it. */
  background(context,work){const promise=Promise.resolve().then(work).catch(()=>{});(this.pendingWork??=new Set()).add(promise);promise.finally(()=>this.pendingWork.delete(promise));if(typeof context?.waitUntil==='function')try{context.waitUntil(promise);}catch{}return promise;}
  async settleBackground(){while(this.pendingWork?.size)await Promise.all([...this.pendingWork]);}
  /** Bumps `security` on the record about to be CAS-written; call once per security-sensitive CAS (header JSDoc). */
  securityChanged(account) { const { epoch, changedAt } = securityState(account); account.security = { epoch: epoch + 1, changedAt: Math.max(changedAt, this.clock()) }; }
  /** Trusted read-only port (DX-6); see the header JSDoc for the contract. Never routed. */
  async identitySecurity(owner) { return identitySecurityPort(this.repository)(owner); }
  async save(account, revision) {
    this.collectDueNotices(account);migrateEmails(account,this.clock());
    account.revision = revision + 1;
    if (!await this.repository.compareAndSwap(account.id, revision, account)) { this.queuedNotices?.delete(account); fail('conflict', 'The account changed; start this step again.'); }
    await this.flushNotices(account);
    if (account.pendingPushEnds) await this.syncPushEnds(account);
  }
  /** Queues an account security notice for after this record's next successful save (`save` flushes), coalescing per
   * type: at most one per SECURITY_NOTICE_COALESCE_MS, carrying the count of changes since the last one sent
   * (`account.noticeLog`, written in the same CAS). Review 2026-10-23 V1/item 6, provisional. */
  queueNotice(account,type,actor='unknown'){
    const now=this.clock(),log=account.noticeLog&&typeof account.noticeLog==='object'?account.noticeLog:{},entry=log[type];
    // Review 2026-10-23 N1: only repeats by the SAME acting session or credential within the window are coalesced; a
    // different actor is always notified at once (carrying any count it supersedes).
    if(entry&&nonNegative(entry.sentAt)&&entry.sentAt<=now&&now-entry.sentAt<SECURITY_NOTICE_COALESCE_MS&&entry.actor===actor){log[type]={sentAt:entry.sentAt,pending:(nonNegative(entry.pending)?entry.pending:0)+1,actor};account.noticeLog=log;return;}
    const count=(nonNegative(entry?.pending)?entry.pending:0)+1;log[type]={sentAt:now,pending:0,actor};account.noticeLog=log;
    (this.queuedNotices??=new WeakMap()).set(account,[...(this.queuedNotices.get(account)??[]),{type,count}]);
  }
  /** Trailing notices for coalesced events whose window has passed (review N1): queued for after the write that carries
   * the reset `noticeLog`. Called by `save` and by the owner view's last-use write, so a pending count is delivered at
   * the account's next write or owner view after the window. */
  collectDueNotices(account){
    const now=this.clock(),log=account.noticeLog;if(!log||typeof log!=='object')return;
    for(const [type,entry]of Object.entries(log))if(nonNegative(entry?.pending)&&entry.pending>0&&nonNegative(entry.sentAt)&&now-entry.sentAt>=SECURITY_NOTICE_COALESCE_MS){log[type]={sentAt:now,pending:0,actor:entry.actor};(this.queuedNotices??=new WeakMap()).set(account,[...(this.queuedNotices.get(account)??[]),{type,count:entry.pending,trailing:true}]);}
  }
  async flushNotices(account){const queued=this.queuedNotices?.get(account);if(!queued)return;this.queuedNotices.delete(account);for(const {type,count,trailing}of queued)await this.reissueNotice(account,type,trailing?{count,trailing:true}:count>1?{count}:{});}
  async pending(value, context) {
    const [id] = tokenParts(value); const account = await this.repository.get(id);
    if (!account || !interactiveIdentity(account) || !['pending', 'recovering'].includes(account.status) || account.pendingExpiresAt <= this.clock() || !secureEqual(account.pendingHash, await this.crypto.hash('pending', value))) fail('unauthorized', 'This setup session has expired.');
    if(account.setupBindingHash&&(!context?.setupBinding||!secureEqual(account.setupBindingHash,await this.crypto.hash('setup-binding',context.setupBinding))))fail('unauthorized','Continue account setup in the browser that started it.');return account;
  }
  async newPending(account,context) {
    if((this.config.requireReachability===true||account.systemIdentity||account.onboardingIdentity)&&context){if(!context.setupBinding)fail('unauthorized');account.setupBindingHash=await this.crypto.hash('setup-binding',context.setupBinding);}
    delete account.setupEmailChallenge;delete account.setupPushChallenge;delete account.setupPushVerified;delete account.pendingCredentialAt;delete account.pendingPasswordSets;delete account.recoveryDownloads;delete account.passwordHash;delete account.passwordSetAt;
    const value = `${account.id}.${this.crypto.random()}`;
    account.pendingHash = await this.crypto.hash('pending', value); account.pendingExpiresAt = this.clock() + this.config.pendingTtlMs;
    return value;
  }
  async session(account, { label, credentialId, source = 'credential', activationCredentialAt, parentSessionId, expiresAt: cap = Infinity, scope, emailAddress } = {}) {
    // ORG-1: nobody signs in as an organization (spec organizations §3); every session path ends here.
    if (!interactiveIdentity(account)) fail('unauthorized', 'Authentication failed.');
    const sessionToken = `${account.id}.${this.crypto.random()}`; const csrfToken = this.crypto.random();
    const expiresAt = Math.min(this.clock() + this.config.sessionTtlMs, cap);
    await this.pruneSessions(account, s => s.expiresAt <= this.clock(), { natural: true });
    // Eviction never ends the new session's own ancestry, prefers sessions with no derived sessions or apps, and
    // cascades like any explicit termination (architecture §7.4).
    const protectedIds=new Set();for(let id=parentSessionId;id&&!protectedIds.has(id);id=account.sessions.find(s=>s.id===id)?.parentSessionId)protectedIds.add(id);
    const busy=s=>account.sessions.some(child=>child.parentSessionId===s.id)||(account.linkedLineage??[]).some(entry=>entry.sessions.includes(s.id));
    let evicted=false;while(account.sessions.length>=10){const target=account.sessions.find(s=>!protectedIds.has(s.id)&&!busy(s))??account.sessions.find(s=>!protectedIds.has(s.id));if(!target)fail('conflict');if(target.expiresAt>this.clock())evicted=true;await this.pruneSessions(account,s=>s===target);}
    // Review 2026-10-23 V1: evicting a live session at the cap removes an owner channel, so it is an authority event with a notice.
    if(evicted){this.authorityEvent(account,'sessions-evicted');this.queueNotice(account,'sessions-evicted',`credential:${credentialId??source}`);}
    account.sessions = [...account.sessions, {
      id: this.crypto.id(), label: safeLabel(label), credentialId, source, parentSessionId, ...source==='activation'&&Number.isSafeInteger(activationCredentialAt)?{activationCredentialAt}:{},
      // DX-7 closure-export: the credential was verified just now, so the session starts stepped up.
      ...scope==='closure-export'?{scope,stepUpAt:this.clock()}:{},
      // The sign-in email an email session proved (RM-3 needs it: an established sign-in email may undo what an email session added).
      ...source==='email'&&typeof emailAddress==='string'?{emailAddress}:{},
      hash: await this.crypto.hash('session', sessionToken), csrfToken, expiresAt, createdAt: this.clock(), lastUsedAt: this.clock() }];
    account.lastActiveAt = this.clock(); this.audit(account, 'session-created');
    return { account: await this.projectAccount(account), sessionToken, csrfToken, expiresAt, sessionContext:account.sessions.at(-1).id };
  }
  async authorized(context, mutation = false, { closure = false } = {}) {
    if (mutation) this.origin(context);
    const [id] = tokenParts(context?.sessionToken); const account = await this.repository.get(id);
    const hash = await this.crypto.hash('session', context.sessionToken);
    const session = account?.sessions.find(s => secureEqual(s.hash, hash) && s.expiresAt > this.clock());
    // Password removal (spike §6.3; review 2026-10-29 L1): a session a password created or stepped up, or one approved from
    // such a session or activated by a password sign-up, is no longer an authority.
    if (!account || !session || !interactiveIdentity(account) || passwordDerived(account, session)) fail('unauthorized', 'Sign in to continue.');
    // DX-7: a closure-export session is accepted only where the caller opted in (export, status, step-up and
    // sign-out), only for a suspended account whose applied closure still offers an export window.
    if (session.scope === 'closure-export') { if (!closure || !['suspended', 'moved'].includes(account.status) || !await this.closureWindow(account)) fail('unauthorized', 'Sign in to continue.'); }
    else if (session.scope !== undefined || account.status !== 'active') fail('unauthorized', 'Sign in to continue.');
    if(context.expectedOwner&&context.expectedOwner!==account.id)throw Object.assign(new Error('Reload the account chooser before continuing.'),{code:'account_context_conflict',status:409});
    if(context.sessionContext&&context.sessionContext!==await this.sessionID(session))throw Object.assign(new Error('Reload the account chooser before continuing.'),{code:'session_context_conflict',status:409});
    if (mutation && !secureEqual(session.csrfToken, context.csrfToken)) fail('csrf', 'Reload the account page and try again.');
    if(context.requireCurrentTerms===true)this.requireCurrentTerms(account);
    return { account, session };
  }
  /** The applied closure's export window for a suspended account, or null (DX-7, terms §10). A moved identity (PORT-2,
   * identity-portability design §6.5 item 1) has the same read-only window until its record's `exportUntil`. */
  async closureWindow(account){if(account?.status==='moved'){const until=account.moved?.exportUntil;return Number.isSafeInteger(until)&&until>this.clock()?{exportUntil:until,moved:true}:null;}if(account?.status!=='suspended'||typeof this.closure?.window!=='function')return null;let window;try{window=await this.closure.window(account.id,account.assignmentId);}catch{return null;}return Number.isSafeInteger(window?.exportUntil)&&window.exportUntil>this.clock()?{exportUntil:window.exportUntil}:null;}
  /** A credential sign-in to a closed account during its export window: a restricted, time-bound session. */
  async closureSession(account,revision,options){const window=await this.closureWindow(account);if(!window)fail('unauthorized','Authentication failed.');const result=await this.session(account,{...options,scope:'closure-export',expiresAt:Math.min(this.clock()+3600000,window.exportUntil)});await this.save(account,revision);return {...result,account:{...result.account,scope:'closure-export'},scope:'closure-export',closure:window};}
  /** The restricted owner view for closure-export routes (export and deletion status only). */
  async closureOwner(context){const {account,session}=await this.authorized(context,false,{closure:true});if(session.scope!=='closure-export')fail('unauthorized','Sign in to continue.');const window=await this.closureWindow(account);return {account:{...await this.projectAccount(account),scope:'closure-export'},scope:'closure-export',closure:window,...window?.moved?{moved:{error:'identity_moved'}}:{},csrfToken:session.csrfToken,expiresAt:session.expiresAt,authTime:Number.isFinite(this.authAt(session))?this.authAt(session):null,sessionContext:await this.sessionID(session),credentials:[],devices:[],audit:[]};}
  requireCurrentTerms(account){if(account.termsVersion!==this.config.termsVersion)throw Object.assign(new IdentityFault('terms_acceptance_required','Accept the current terms before creating content or granting access.'),{status:403});}
  authAt(session){return Math.max(session.source==='activation'&&Number.isSafeInteger(session.activationCredentialAt)&&session.activationCredentialAt<=this.clock()?session.activationCredentialAt:-Infinity,session.source==='credential'&&Number.isSafeInteger(session.createdAt)&&session.createdAt<=this.clock()?session.createdAt:-Infinity,Number.isSafeInteger(session.stepUpAt)&&session.stepUpAt<=this.clock()?session.stepUpAt:-Infinity);}
  /** Removes sessions and their transitive descendants. Removing a still-live session is an explicit termination
   * in every mode: approval lineage through it ends and its app families enter the revocation outbox in this same
   * account CAS. Already-expired sessions end naturally and keep their lineage until E (deterministic whether or
   * not expiry pruning ran first). `natural` only documents the expiry-pruning caller. */
  async pruneSessions(account,remove,{natural=false}={}){
    const now=this.clock(),removed=new Set(),explicit=new Set();for(const session of account.sessions)if(remove(session)){const id=await this.sessionID(session);removed.add(id);if(session.expiresAt>now)explicit.add(id);}
    let changed=true;while(changed){changed=false;for(const session of account.sessions)if(session.parentSessionId&&removed.has(session.parentSessionId)){const id=await this.sessionID(session);if(!removed.has(id)){removed.add(id);if(session.expiresAt>now)explicit.add(id);changed=true;}}}
    account.sessions=(await Promise.all(account.sessions.map(async session=>({session,id:await this.sessionID(session)})))).filter(item=>!removed.has(item.id)).map(item=>item.session);
    pruneLineage(account,now);if(explicit.size){revokeLineage(account,explicit,now);this.queuePushEnds(account,[...explicit]);}
  }
  async recent(context) {
    const result = await this.authorized(context, true);
    if (this.authAt(result.session) + 900000 <= this.clock()) fail('reauthentication_required', 'Confirm with your passkey before changing account access.');
    return result;
  }
  async sessionID(session) { return session.id || this.crypto.hash('session-public-id', session.hash); }
  // Privileged consoles need a per-session step-up, not merely a young session.
  async privileged(context,windowMs=300000){const {account,session}=await this.authorized(context,true,{closure:context?.allowClosure===true});this.requireStepUp(session,windowMs);return {account,session,sessionId:await this.sessionID(session)};}
  requireStepUp(session,windowMs=300000){if(!Number.isSafeInteger(session.stepUpAt)||session.stepUpAt>this.clock()||session.stepUpAt+windowMs<=this.clock())fail('step_up_required','Confirm with your passkey to continue.');}
  /** SI-4 email step-up (spike §3.5): a session created by an email sign-in within the last 5 minutes, on an account
   * with no passkey. It counts only for the narrow list (adding a passkey, verifying an extra address, turning sign-in
   * on for another address); it never sets `stepUpAt`, so nothing else (LA-7, reissue, removals, deletion) sees it. */
  emailStepUp(account,session){return account.credentials.length===0&&session.source==='email'&&Number.isSafeInteger(session.createdAt)&&session.createdAt<=this.clock()&&session.createdAt+300000>this.clock()&&signInEmails(account).some(entry=>entry.address===session.emailAddress);}
  async stepUpBegin(input,context){const {account,session}=await this.authorized(context,true,{closure:true}),revision=account.revision;if(!account.credentials.length)return {passkey:false};const authenticationOptions=await this.webauthn.authenticationOptions({config:this.config});account.challenges=[...account.challenges.filter(c=>c.expiresAt>this.clock()&&c.purpose!=='step-up').slice(-4),{purpose:'step-up',value:authenticationOptions.challenge,sessionHash:session.hash,expiresAt:this.clock()+this.config.challengeTtlMs}];await this.save(account,revision);return {passkey:true,authenticationOptions};}
  async stepUp(input,context){
    const {account,session}=await this.authorized(context,true,{closure:true}),revision=account.revision;if(!await this.rateLimiter.check({operation:'step-up',remoteIP:context.remoteIP,handle:account.handle}))fail('rate_limited','Please wait before trying again.');
    let used;
    if(input.method==='passkey'){const challenge=account.challenges.find(c=>c.purpose==='step-up'&&secureEqual(c.sessionHash,session.hash)&&c.expiresAt>this.clock()),credential=account.credentials.find(c=>c.id===input.response?.id);if(!challenge||!credential)fail('unauthorized','Authentication failed.');let verified;try{verified=await this.webauthn.verifyAuthentication({response:input.response,challenge:challenge.value,credential,account,config:this.config});}catch{fail('unauthorized','Authentication failed.');}credential.counter=verified.counter;credential.backedUp=verified.backedUp;account.challenges=account.challenges.filter(c=>c!==challenge);used={kind:'passkey',id:credential.id};}
    else fail('invalid_method');
    // Which credential confirmed it (reissue authority: a credential enrolled >= 7 days earlier, P18).
    session.stepUpAt=this.clock();session.stepUpCredential=used;this.audit(account,'step-up');this.interactive(account,'step-up',context);await this.save(account,revision);return {stepUpUntil:session.stepUpAt+300000};
  }
  ageAttestation(input,context,{paid=false,bootstrap=false}={}){const location=trustedAgeLocation({country:context?.ageLocation?.country,regionCode:context?.ageLocation?.region}),requirement=ageRequirement(location),minimum=paid?requirement.paidMinimumAge:requirement.minimumAge;if(requirement.blocked&&!bootstrap)throw Object.assign(new IdentityFault('signup_region_blocked',"Sign-up isn't available in your region."),{status:403});if(input.ageConfirmed===undefined)fail('age_confirmation_required','Confirm the minimum signup age.');if(!Number.isSafeInteger(input.ageConfirmed)||input.ageConfirmed<minimum||input.ageConfirmed>150)fail('age_confirmation_insufficient','Confirm the required signup age.');return {ageConfirmedAt:this.clock(),ageMinimum:minimum,ageCountry:location.country};}
  async acceptTerms(input,context){
    // CAS retries re-authenticate each time: revocation cannot be overwritten by a stale tab.
    for(let attempt=0;attempt<32;attempt++){const {account}=await this.authorized(context,true);if(input.termsVersion!==this.config.termsVersion)fail('terms_required','Review the current account terms.');if(account.termsVersion===this.config.termsVersion)return {account:await this.projectAccount(account)};const revision=account.revision;account.termsVersion=this.config.termsVersion;account.termsAcceptedAt=this.clock();this.audit(account,'terms-accepted');account.revision=revision+1;if(await this.repository.compareAndSwap(account.id,revision,account))return {account:await this.projectAccount(account)};}
    fail('conflict','The account changed; try accepting again.');
  }
  async signup(input, context) {
    await this.guard('signup', input, context);
    // Portable repositories without an allocator keep the canonical handle, so
    // case/confusable variants cannot register twice or strand a login.
    const requestedHandle=this.repository.allocateFreeHandle?input.handle:handle(input.handle);
    if (input.termsAccepted !== true || input.termsVersion !== this.config.termsVersion) fail('terms_required', 'Agree to the current account terms.');
    // Passwords were dropped (owner approval 2026-10-28): sign-up is passkey (email sign-up arrives with the email flow, P3).
    if (input.method !== 'passkey' || input.password !== undefined) fail('invalid_method', 'Create your account with a passkey.');
    const signupPlan=input.signupPlan??'free';if(!['free','paid','plus','ultra'].includes(signupPlan))fail('invalid_plan','Choose a supported signup plan.');const age=this.ageAttestation(input,context,{paid:signupPlan!=='free'});
    if(signupPlan!=='free'&&(this.config.paidSignupEnabled!==true||!this.setupBilling))throw Object.assign(new IdentityFault('paid_signup_unavailable','Paid signup is not available.'),{status:503});
    if (!this.repository.allocateFreeHandle&&await this.repository.findByHandle(requestedHandle)) fail('handle_unavailable', 'Choose another account handle.');
    // Global/daily creation capacity is reserved only for a valid proof and
    // complete valid signup, never for anonymous CAPTCHA or malformed attempts.
    const id=this.crypto.id(),assignmentId=this.crypto.id();
    // The new account ID is the admission receipt: a retried capacity claim for
    // this signup spends at most one unit.
    if (!await this.rateLimiter.check({ phase: 'admitted', operation: 'signup', signupKind:signupPlan==='free'?'free':'paid',remoteIP: context.remoteIP, region:context.region, handle: input.handle, admissionId:id })) fail('rate_limited', 'Account creation is limited for this network or region. Please try again in a few hours.');
    const allocatedHandle=this.repository.allocateFreeHandle?await this.repository.allocateFreeHandle(input.handle,id,assignmentId):requestedHandle;
    const account = { id, assignmentId, nameAssignmentId:assignmentId, revision: 0, handle: allocatedHandle, status: 'pending',
      admission:{version:1,kind:signupPlan==='free'?'free':'paid',plan:signupPlan,...signupPlan==='free'?{}:{incarnation:this.crypto.id(),checkoutStartUntil:this.clock()+86400000,initialPaymentRequired:true}},
      createdAt: this.clock(), lastActiveAt: this.clock(), termsVersion: this.config.termsVersion,
      termsAcceptedAt: this.clock(), ...age, security: { epoch: 0, changedAt: this.clock() }, credentials: [], sessions: [], challenges: [], audit: [], recoveryHash: null };
    if(this.config.requireReachability===true){if(!context.setupBinding)fail('unauthorized','Start setup in the account browser.');account.setupBindingHash=await this.crypto.hash('setup-binding',context.setupBinding);}
    const pendingToken = await this.newPending(account,context);
    const registrationOptions = await this.webauthn.registrationOptions({ account, config: this.config });
    account.challenges.push({ purpose: 'register', value: registrationOptions.challenge, expiresAt: this.clock() + this.config.challengeTtlMs });
    this.audit(account, 'signup-pending');
    if (!await this.repository.create(account)) fail('handle_unavailable', 'Choose another account handle.');
    return { pendingToken, account: await this.projectAccount(account), registrationOptions, readyForRecovery: false,signupPlan,paymentRequired:signupPlan!=='free' };
  }
  async inspectOnboarding(input,context){this.origin(context);if(Object.keys(input).length!==1||typeof input.onboardingToken!=='string')fail('invalid_onboarding_invitation');if(!this.onboarding)fail('onboarding_unavailable');return this.onboarding.inspect(input.onboardingToken);}
  async issueOnboarding(input,context){this.origin(context);if(Object.keys(input).length!==2||typeof input.onboardingToken!=='string'||typeof input.issuanceProof!=='string')fail('invalid_onboarding_issuance');if(!this.onboarding)fail('onboarding_unavailable');return this.onboarding.issue(input.onboardingToken,input.issuanceProof);}
  async claimOnboarding(input,context){
    const age=this.ageAttestation(input,context);await this.guard('onboarding',input,context);if(!this.onboarding)fail('onboarding_unavailable','Account onboarding is not configured.');if(!context.setupBinding)fail('setup_binding_required','Prepare account onboarding in this browser before continuing.');
    if(Object.keys(input).some(name=>!['onboardingToken','name','method','termsAccepted','termsVersion','ageConfirmed','turnstileToken'].includes(name)))fail('invalid_onboarding_request');
    if(input.termsAccepted!==true||input.termsVersion!==this.config.termsVersion)fail('terms_required','Agree to the current account terms.');if(input.method!=='passkey')fail('invalid_method','Create your account with a passkey.');
    const binding=await this.crypto.hash('onboarding-setup-browser',context.setupBinding),prepared=await this.onboarding.prepare(input.onboardingToken,input.name,binding),{claims,digest,item,marker}=prepared,previous=await this.repository.get(item.owner);
    if(previous){if(previous.assignmentId!==item.assignmentId||!sameOnboardingIdentity(previous.onboardingIdentity,marker))fail('onboarding_conflict','Onboarding setup needs operator reconciliation.');await this.onboarding.finish(item,digest,binding);fail('onboarding_invitation_consumed','Setup already started for this name. Sign in with its credential, or ask the host operator for help.');}
    let canonical=prepared.reservation.canonical;if(!canonical){const allocated=await this.repository.allocateFreeHandle(undefined,item.owner,item.assignmentId),reservation=await this.onboarding.canonical(item,digest,binding,allocated);if(!reservation?.canonical)fail('onboarding_conflict','Onboarding setup needs operator reconciliation.');canonical=reservation.canonical;}
    const account={id:item.owner,assignmentId:item.assignmentId,nameAssignmentId:item.assignmentId,revision:0,handle:canonical,status:'pending',onboardingIdentity:marker,badgeIds:[...item.badgeIds],admission:{version:1,kind:'operator',plan:'free'},createdAt:this.clock(),lastActiveAt:this.clock(),termsVersion:this.config.termsVersion,termsAcceptedAt:this.clock(),...age,security:{epoch:0,changedAt:this.clock()},credentials:[],sessions:[],challenges:[],audit:[],recoveryHash:null};
    const pendingToken=await this.newPending(account,context);const registrationOptions=await this.webauthn.registrationOptions({account,config:this.config});account.challenges.push({purpose:'register',value:registrationOptions.challenge,expiresAt:this.clock()+this.config.challengeTtlMs});
    if(claims.expiresAt<=this.clock())fail('invalid_onboarding_invitation','This onboarding invitation expired before account creation.');this.audit(account,'operator-onboarding-pending');if(!await this.repository.create(account))fail('onboarding_conflict','Setup already started for this name. Sign in with its credential or ask the operator to reconcile it.');if(!await this.onboarding.finish(item,digest,binding))fail('onboarding_conflict','Onboarding setup needs operator reconciliation.');return {pendingToken,account:await this.projectAccount(account),registrationOptions,readyForRecovery:false,signupPlan:'free',paymentRequired:false};
  }
  async bootstrapSystem(input,context){
    const age=this.ageAttestation(input,context,{bootstrap:true});await this.guard('system-bootstrap',input,context);
    if(!this.systemBootstrap||!this.repository.reserveSystemIdentity)fail('system_bootstrap_unavailable','System setup is not configured.');
    if(!context.setupBinding)fail('setup_binding_required','Prepare system setup in this browser before continuing.');
    if(input.termsAccepted!==true||input.termsVersion!==this.config.termsVersion)fail('terms_required','Agree to the current account terms.');
    if(input.method!=='passkey'||input.password!==undefined)fail('invalid_method','Set up the system account with a passkey.');
    const binding=await this.crypto.hash('system-setup-browser',context.setupBinding),prepared=await this.systemBootstrap.prepare(input.bootstrapToken,binding),{claims,digest}=prepared,marker=systemMarker(claims,digest);
    const previous=await this.repository.get(claims.owner);
    if(previous){if(previous.assignmentId!==claims.assignmentId||!sameSystemIdentity(previous.systemIdentity,marker))fail('system_bootstrap_conflict','System setup needs operator reconciliation.');await this.systemBootstrap.finish(claims,digest,binding);fail('system_invitation_consumed','This invitation was already used. Sign in with the configured credential, or ask the operator to repair incomplete setup.');}
    let canonical=prepared.reservation.canonical;if(!canonical){const allocated=await this.repository.allocateFreeHandle(undefined,claims.owner,claims.assignmentId),reservation=await this.systemBootstrap.canonical(claims,digest,binding,allocated);if(!reservation?.canonical)fail('system_bootstrap_conflict','System setup needs operator reconciliation.');canonical=reservation.canonical;}
    const account={id:claims.owner,assignmentId:claims.assignmentId,nameAssignmentId:claims.assignmentId,revision:0,handle:canonical,status:'pending',systemIdentity:marker,badgeIds:configuredBadgeIDs(this.config).includes('system')?['system']:[],admission:{version:1,kind:'system',plan:'free',initialSystemActivationRequired:true},createdAt:this.clock(),lastActiveAt:this.clock(),termsVersion:this.config.termsVersion,termsAcceptedAt:this.clock(),...age,security:{epoch:0,changedAt:this.clock()},credentials:[],sessions:[],challenges:[],audit:[],recoveryHash:null};
    const pendingToken=await this.newPending(account,context);const registrationOptions=await this.webauthn.registrationOptions({account,config:this.config});account.challenges.push({purpose:'register',value:registrationOptions.challenge,expiresAt:this.clock()+this.config.challengeTtlMs});
    if(claims.expiresAt<=this.clock())fail('invalid_system_invitation','This system invitation expired before account creation.');
    this.audit(account,'system-bootstrap-pending');if(!await this.repository.create(account))fail('system_bootstrap_conflict','System setup was already started. Sign in with the configured credential or ask the operator to reconcile it.');
    if(!await this.systemBootstrap.finish(claims,digest,binding))fail('system_bootstrap_conflict','System setup needs operator reconciliation.');
    return {pendingToken,account:await this.projectAccount(account),registrationOptions,readyForRecovery:false,signupPlan:'free',paymentRequired:false};
  }
  async beginPasskeyRegistration(input, context) {
    this.origin(context); const account = await this.pending(input.pendingToken,context); const revision = account.revision;
    const registrationOptions = await this.webauthn.registrationOptions({ account, config: this.config });
    account.challenges = [{ purpose: 'register', value: registrationOptions.challenge, expiresAt: this.clock() + this.config.challengeTtlMs }];
    await this.save(account, revision); return { registrationOptions };
  }
  async registerPasskey(input, context) {
    this.origin(context); const account = await this.pending(input.pendingToken,context); const revision = account.revision;
    const challenge = account.challenges.find(c => c.purpose === 'register' && c.expiresAt > this.clock());
    if (!challenge) fail('invalid_challenge');
    let credential;
    try { credential = await this.webauthn.verifyRegistration({ response: input.response, challenge: challenge.value, config: this.config }); } catch { fail('invalid_passkey', 'Passkey verification failed.'); }
    if (!credential?.id || !credential.publicKey || account.credentials.length >= 5 || account.credentials.some(c => c.id === credential.id)) fail('invalid_passkey');
    account.pendingCredentialAt=this.clock();account.credentials.push({ ...credential, label: safeLabel(input.label, 'Passkey'), createdAt: this.clock(), addedBy: { session: account.status === 'recovering' ? 'recovery' : 'setup', at: this.clock() } }); account.challenges = []; this.audit(account, 'passkey-registered'); this.securityChanged(account);
    // R1(ii): a recovery's replacement credential is announced to every channel (it was the 'password-changed' notice before passwords were dropped).
    if (account.status === 'recovering') this.queueNotice(account, 'passkey-added', 'recovery');
    await this.save(account, revision); return { readyForRecovery: true };
  }
  /** A fresh v3 payload for `account` and the hash that binds its credential. The token is `<id>.<32 random bytes>` and
   * the file id 16 random bytes; neither derives from anything else. */
  async issueRecoveryFile(account){
    const recoveryToken=`${account.id}.${this.crypto.random()}`,fileId=this.crypto.random(16),issuedAt=this.clock();
    const payload=createRecoveryPayload({issuer:this.config.origin,entity:account.id,recoveryToken,fileId,issuedAt});
    return {payload,recoveryToken,fileId,issuedAt,hash:await this.crypto.hash('recovery',recoveryToken)};
  }
  async downloadRecovery(input, context) {
    this.origin(context); const account = await this.pending(input.pendingToken,context); const revision = account.revision;
    if (!account.credentials.length) fail('credential_required', 'Set up your passkey first.');
    // Downloads are budgeted: at most 5 per setup token and the network/per-account windows (wargame 2026-10-23).
    if(!Number.isSafeInteger(account.recoveryDownloads??0)||(account.recoveryDownloads??0)>=5)fail('rate_limited','Please wait before trying again.');
    if(!await this.rateLimiter.check({operation:'recovery-download',remoteIP:context.remoteIP,region:context.region,handle:account.id}))fail('rate_limited','Please wait before trying again.');
    account.recoveryDownloads=(account.recoveryDownloads??0)+1;
    // The identity signing key exists once setup issues a file (idempotent; no rotation, P15 withdrawn).
    if(typeof this.identityBackup?.provision==='function')await this.identityBackup.provision(account);
    const issued=await this.issueRecoveryFile(account);
    account.recoveryHash=issued.hash;account.recoveryIssuedAt=issued.issuedAt;account.recoveryFileId=issued.fileId;account.recoveryBackupVersion=3;delete account.recoveryKeyKid;delete account.recoveryReminder;
    account.nameAssignmentId ||= this.crypto.id();
    this.audit(account, 'recovery-file-issued'); this.securityChanged(account); await this.save(account, revision);
    return {fileName:`3sln-recovery-${account.id}.json`,content:JSON.stringify(issued.payload),handle:account.handle,recoveryToken:issued.recoveryToken,fileId:issued.fileId};
  }
  /** The owner's recovery-file status for the console. Hashes, kids and tokens never leave the record. */
  recoveryView(account,session){
    const now=this.clock(),credential=recoveryCredential(account),marker=reissueMarker(account),pending=pendingReissue(account,now);
    // A credential of a withdrawn format (envelope v1: payloads v1 and v2) recovers nothing any more: ask for a new file.
    const legacy=!credential&&account?.status==='active'&&typeof account.recoveryHash==='string'&&account.recoveryHash.length>0;
    return {issuedAt:credential?.issuedAt??null,version:credential?.version??null,fileId:credential?.fileId??null,
      // Transfer-out is dormant until the portability revision (recovery and transfer spike, phase 2): a v3 file never
      // authorizes a move, so no eligibility date is shown.
      transferEligibleAt:null,reissueRequired:marker?.reason??(legacy?'legacy-format':null),reissueAvailable:typeof this.identityBackup?.reissue==='function'&&typeof this.identityBackup?.reissueCommit==='function',
      // The annual offer (a reminder only): none while a reissue is pending or a new file is required anyway.
      reminder:credential&&!pending&&!marker?recoveryReminder(credential.issuedAt,now):null,
      // The cooling-off window of a committed reissue: the new file restores from `usableAt`; until then a session,
      // device or email that predates the reissue (or the previous file) can cancel it.
      pendingReissue:pending?{reissuedAt:pending.reissuedAt,usableAt:pending.until,previousFileId:pending.version===3&&typeof pending.fileId==='string'?pending.fileId:null,previousRestorable:pending.version===3&&typeof pending.hash==='string'&&pending.hash.length>0,previousFileCanCancel:pending.version===3&&typeof pending.hash==='string'&&pending.hash.length>0&&pending.fileLocked!==true,cancellable:Boolean(session)&&Number.isSafeInteger(session.createdAt)&&session.createdAt<pending.preparedAt}:null};
  }
  /** The annual reissue offer (recovery and transfer spike §4.2, owner approval 2026-10-28): a reminder only, never a
   * change to any credential. Trusted, not routed: a scheduler calls it per account. Sends at most once per reminder
   * slot of the current file (recovery-reminder.mjs) to the verified email and push, after recording the slot in one
   * CAS (so a lost race or a retry never double-sends). Nothing is sent while a reissue is pending or a forced marker
   * asks for a new file anyway. Resolves {sent, slot?, notified?}; `notified` is transport acceptance, not delivery. */
  async sendRecoveryReminder(owner){
    for(let attempt=0;attempt<4;attempt++){
      const account=await this.repository.get(owner),now=this.clock(),credential=recoveryCredential(account);
      if(!credential||!interactiveIdentity(account)||pendingReissue(account,now)||reissueMarker(account))return {sent:false};
      const due=recoveryReminder(credential.issuedAt,now),last=account.recoveryReminder;
      if(due.stage==='none'||last?.fileId===credential.fileId&&Number.isSafeInteger(last.slot)&&last.slot>=due.slot)return {sent:false,nextAt:due.nextAt};
      const revision=account.revision;account.recoveryReminder={fileId:credential.fileId,slot:due.slot,at:now};this.audit(account,'recovery-reminder-sent');account.revision=revision+1;
      if(!await this.repository.compareAndSwap(account.id,revision,account))continue;
      const notified=await this.reissueNotice(account,'recovery-reissue-reminder',{stage:due.stage,anniversaryAt:due.anniversaryAt});
      return {sent:true,slot:due.slot,stage:due.stage,nextAt:due.nextAt,notified};
    }
    fail('conflict','The account changed; try again.');
  }
  /** Remembers a verified email that is being replaced or removed (`account.previousEmails`, up to 8 within retention;
   * further changes are refused rather than dropping one), so a reissue begun shortly after an email swap still notifies, and can be cancelled from, the
   * address the owner had before (coordinator decision 2026-10-23, provisional). Call before overwriting. */
  /** Records an email change or another-session revocation (`account.authorityEvents`, last 30 days, at most 16, the
   * newest kept, for display) and raises the uncapped `lastChannelRemovalAt` the file-proof check reads (V2). */
  authorityEvent(account,kind){const now=this.clock(),kept=(Array.isArray(account.authorityEvents)?account.authorityEvents:[]).filter(entry=>nonNegative(entry?.at)&&entry.at>now-SECURITY_RETENTION_MS);kept.push({kind,at:now});account.authorityEvents=kept.slice(-16);
    // Review 2026-10-23 V2: the file-proof decision reads this uncapped monotonic maximum, never the (display) list.
    account.lastChannelRemovalAt=Math.max(nonNegative(account.lastChannelRemovalAt)?account.lastChannelRemovalAt:0,now);}
  /** Account security notice to every channel: the current email, emails replaced in the last 30 days, and push.
   * Best effort after commit; acceptance is not delivery. */
  /** Whether a reissue authorized by `credential` is file-proof (review 2026-10-23 R1(i), V1, provisional): a passkey
   * step-up whose passkey was enrolled before the previous file was issued, with no channel-removing authority event in
   * the 30 days before the begin. Then the previous file cannot cancel it (`fileLocked`); otherwise (the passkey is
   * younger than the previous file, or a channel was removed recently) the previous file can still cancel it.
   * Password removal (owner approval 2026-10-28; sign-in and intents spike §6.3, recovery and transfer spike §9.3(b),
   * provisional restatement): every reissue is passkey-authorized now, so the former password branch ("a
   * password-authorized reissue stays cancellable by the previous file") is gone. The rule reads "a reissue confirmed
   * with a passkey that is not file-proof stays cancellable by the previous file". An account with no passkey cannot
   * reissue at all (it must add a passkey and wait 7 days, `reissueAuthority`). */
  fileProofReissue(account,credential,at=this.clock()){
    if(typeof credential?.id!=='string'||typeof account.recoveryHash!=='string'||!account.recoveryHash)return false;
    const passkey=account.credentials.find(c=>c.id===credential.id);
    if(!passkey||!nonNegative(passkey.createdAt)||!nonNegative(account.recoveryIssuedAt)||passkey.createdAt>=account.recoveryIssuedAt)return false;
    // Review 2026-10-23 V1: ANY channel-removing event (email change or removal, other-session revocation, session-cap
    // eviction, passkey removal) in the lookback before `at` (the begin) disqualifies, whatever its order.
    const latest=Math.max(nonNegative(account.lastChannelRemovalAt)?account.lastChannelRemovalAt:0,...(Array.isArray(account.authorityEvents)?account.authorityEvents:[]).map(entry=>nonNegative(entry?.at)?entry.at:0));
    return !(latest>at-SECURITY_LOOKBACK_MS);
  }
  /** Remembers confirmed addresses that are being removed (`account.previousEmails`, up to 8 within retention; further
   * removals are refused rather than dropping one), so a reissue begun shortly after an email change still notifies,
   * and can be cancelled from, the addresses the owner had before (coordinator decision 2026-10-23, provisional). Call
   * with the entries about to be removed, before removing them. */
  rememberPreviousEmail(account,removed=[]){
    const now=this.clock(),kept=(Array.isArray(account.previousEmails)?account.previousEmails:[]).filter(entry=>typeof entry?.email==='string'&&nonNegative(entry.verifiedAt)&&nonNegative(entry.replacedAt)&&entry.replacedAt>now-SECURITY_RETENTION_MS);
    // V2 audit: never drop a retained channel to make room (earliest- or newest-wins could both be gamed); refuse more
    // email changes instead until one ages out.
    for(const entry of removed)if(entry&&entry.state!=='unverified'&&typeof entry.address==='string'&&nonNegative(entry.verifiedAt)&&!kept.some(item=>item.email===entry.address)){if(kept.length>=8)throw Object.assign(new IdentityFault('email_change_limited','This account changed its email too many times recently. Try again later.'),{status:429});kept.push({email:entry.address,verifiedAt:entry.verifiedAt,replacedAt:now});}
    if(kept.length)account.previousEmails=kept;else delete account.previousEmails;
  }
  /** Email recipients for security notices: every verified or sign-in address, and any removed in the last 30 days. */
  reissueRecipients(account,at=this.clock()){
    const now=at,list=[];
    for(const entry of confirmedEmails(account))if(!list.some(item=>item.email===entry.address))list.push({email:entry.address,verifiedAt:entry.verifiedAt,current:true});
    for(const entry of Array.isArray(account.previousEmails)?account.previousEmails:[])if(typeof entry?.email==='string'&&nonNegative(entry.verifiedAt)&&nonNegative(entry.replacedAt)&&entry.replacedAt>now-SECURITY_LOOKBACK_MS&&!list.some(item=>item.email===entry.email))list.push({email:entry.email,verifiedAt:entry.verifiedAt});
    return list;
  }
  /** Security notices to every channel (email, including recently replaced emails, and push); best effort, acceptance is
   * not delivery. `cancel` {token, before}: the cancel link goes only to emails verified before `before`. */
  async reissueNotice(account,type,extra={},cancel=null,at=this.clock()){
    const notified={email:false,push:false};
    // R2: after a file-proof (passkey) reissue the cancel link goes only to the current email; replaced ones get the notice.
    for(const recipient of this.reissueRecipients(account,at))try{if(typeof this.mailer?.sendSecurityAlert==='function'){await this.mailer.sendSecurityAlert({email:recipient.email,type,owner:account.id,...extra,...cancel&&recipient.verifiedAt<cancel.before&&(recipient.current||!cancel.currentOnly)?{cancelToken:cancel.token}:{}});notified.email=true;}}catch{}
    try{if(typeof this.accountChannels?.notify==='function')notified.push=(await this.accountChannels.notify(account.id,type))?.accepted>0;}catch{}
    return notified;
  }
  /** Hook for a later change (coordinator 2026-10-28): reissue will be refused while a sign-in-method removal is
   * pending. Returns a refusal {code, message, status} or null; nothing is pending yet, so it always returns null. */
  reissueRefusal(account){return null;}
  /** Who may reissue (recovery-identity spec "Active-account reissue"; restated without passwords, owner approval
   * 2026-10-28, provisional): a passkey step-up within 5 minutes with a passkey enrolled at least 7 days earlier (P18),
   * or any fresh passkey step-up while a forced path is armed (an elevated abort, PORT-4 activation). An account with no
   * passkey (one that signs in only by email) must add a passkey first (`passkey_required`); an email session never
   * reissues (SI-4). `reauthentication_required` makes the console prompt again; `credential_too_new` means no passkey
   * is old enough yet. */
  reissueAuthority(account,session){
    const now=this.clock();
    if(!account.credentials.length)fail('passkey_required','Add a passkey to replace your recovery file. It can replace the file once you have had it for 7 days.',409);
    if(!Number.isSafeInteger(session.stepUpAt)||session.stepUpAt>now||session.stepUpAt+300000<=now)fail('reauthentication_required','Confirm with your passkey to replace your recovery file.');
    const aged=at=>nonNegative(at)&&at<=now&&now-at>=RECOVERY_CREDENTIAL_AGE_MS,used=session.stepUpCredential;
    if(used?.kind!=='passkey')fail('reauthentication_required','Confirm with one of your passkeys to replace your recovery file.');
    const enrolled=account.credentials.find(c=>c.id===used.id)?.createdAt;
    // A forced marker waives the age only for a credential enrolled no later than the marker was armed, so a
    // credential added afterwards (perhaps by whoever took over the session) still waits 7 days (P18).
    const marker=reissueMarker(account);if(marker&&nonNegative(enrolled)&&enrolled<=marker.at)return {forced:marker.reason,credential:used};
    if(aged(enrolled))return {forced:null,credential:used};
    if(account.credentials.some(c=>aged(c.createdAt)))fail('reauthentication_required','Confirm with a passkey you have had for at least 7 days.');
    fail('credential_too_new','Replacing your recovery file needs a passkey you have had for at least 7 days.',409);
  }
  /** Active-account reissue, phase 1 (recovery-identity "Active-account reissue"; identity portability P14, P17).
   * Authority as `reissueAuthority`. The account single writer refuses during a deletion, a move or a contest; the new
   * v3 file is then STAGED, bound to this session for 30 minutes. No key changes (P15 withdrawn with recovery file v3).
   * The current file keeps working until phase 2 commits, so an interrupted reissue never leaves the owner without a
   * file. A new begin replaces an older staged file, which then never becomes current. */
  async reissueRecoveryBegin(input,context){
    const {account,session}=await this.authorized(context,true);const revision=account.revision;
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(name=>name!=='acknowledged'))fail('invalid_request','Unsupported recovery request.',400);
    if(input.acknowledged!==true)fail('confirmation_required','Confirm that your current recovery file will stop working.',400);
    if(typeof this.identityBackup?.reissue!=='function'||typeof this.identityBackup?.reissueCommit!=='function')fail('recovery_unavailable','Recovery files cannot be replaced right now.',503);
    // One cooling-off window at a time: a second reissue would push the trusted previous file out of the window.
    const open=pendingReissue(account,this.clock());if(open)throw Object.assign(new IdentityFault('recovery_reissue_pending','A recovery file replacement is still in its 7-day waiting period. Cancel it first, or wait until it ends.'),{status:409,usableAt:open.until});
    const refusal=this.reissueRefusal(account);if(refusal)fail(refusal.code,refusal.message,refusal.status);
    const authority=this.reissueAuthority(account,session);
    if(!await this.rateLimiter.check({operation:'recovery-reissue',remoteIP:context.remoteIP,handle:account.handle}))fail('rate_limited','Please wait before trying again.');
    const sessionId=await this.sessionID(session);
    // P17 compares the credential that confirmed the step-up, not the one the session signed in with.
    const gate=await this.identityBackup.reissue(account,{actor:{credentialId:session.credentialId??null,stepUpCredentialId:stepUpCredentialId(session),sessionId}});
    const issued=await this.issueRecoveryFile(account),now=this.clock();
    account.recoveryStaged={hash:issued.hash,fileId:issued.fileId,sessionId,preparedAt:now,expiresAt:now+RECOVERY_REISSUE_TTL_MS,base:account.recoveryHash||null,credential:authority.credential,fileLocked:this.fileProofReissue(account,authority.credential,now),...authority.forced?{forced:authority.forced}:{}};
    if(account.recoveryPrevious&&!pendingReissue(account,now))delete account.recoveryPrevious;
    this.audit(account,'recovery-reissue-prepared');await this.save(account,revision);
    // Wargame #1(c): every channel hears about the reissue when it begins, as well as when it commits.
    await this.reissueNotice(account,'recovery-reissue-started');
    return {fileName:`3sln-recovery-${account.id}.json`,content:JSON.stringify(issued.payload),recoveryToken:issued.recoveryToken,fileId:issued.fileId,expiresAt:account.recoveryStaged.expiresAt,transferPending:gate?.transferPending===true,forced:authority.forced};
  }
  /** Active-account reissue, phase 2: the owner's acknowledgement. The browser encrypted the staged file, downloaded it,
   * and compared the SHA-256 of the encrypted file the owner picked again with the bytes it offered for download (no
   * decryption); only then does it post the staged token and file id. This server cannot see that comparison; it
   * requires the staged credential and file id, so nothing but this confirmation makes the new file current. The account
   * single writer re-checks deletion, custody and contest, and CANCELS a pending or held transfer-out (spec rationale:
   * the move was authorized by the file this replaces; abort is the safe direction). Then one identity CAS makes the
   * staged credential current with `recoveryIssuedAt = now` (so P14 waits 7 days again), clears any forced marker and
   * bumps `security`. Notices go to the verified email and every push subscription after commit. */
  async reissueRecoveryConfirm(input,context){
    let {account,session}=await this.authorized(context,true);
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(name=>!['recoveryToken','fileId','downloadConfirmed'].includes(name)))fail('invalid_request','Unsupported recovery request.',400);
    if(input.downloadConfirmed!==true||typeof input.recoveryToken!=='string'||input.recoveryToken.length>150||typeof input.fileId!=='string'||!RECOVERY_FILE_ID.test(input.fileId))fail('recovery_confirmation_required','Download your new recovery file and select it again before continuing.',400);
    if(typeof this.identityBackup?.reissueCommit!=='function')fail('recovery_unavailable','Recovery files cannot be replaced right now.',503);
    const hash=await this.crypto.hash('recovery',input.recoveryToken),sessionId=await this.sessionID(session);
    const check=a=>{const staged=stagedReissue(a.recoveryStaged);if(!staged||staged.sessionId!==sessionId||!secureEqual(staged.hash,hash)||staged.fileId!==input.fileId||staged.expiresAt<=this.clock())fail('recovery_reissue_expired','Start replacing your recovery file again.',409);if((a.recoveryHash||null)!==staged.base)fail('recovery_changed','Your recovery file changed. Start again.',409);
      // The passkey that authorized phase 1 must still exist (removing it revokes its sessions).
      const used=staged.credential;if(used?.kind!=='passkey'||!a.credentials.some(c=>c.id===used.id))fail('recovery_reissue_expired','Start replacing your recovery file again.',409);return staged;};
    const first=check(account);
    const gate=await this.identityBackup.reissueCommit(account.id,{actor:{credentialId:session.credentialId??null,stepUpCredentialId:stepUpCredentialId(session),sessionId}});
    for(let attempt=0;attempt<4;attempt++){
      if(attempt)({account,session}=await this.authorized(context,true));
      const staged=check(account),revision=account.revision,now=this.clock();
      if(pendingReissue(account,now))fail('recovery_reissue_pending','A recovery file replacement is still in its 7-day waiting period.',409);
      const refusal=this.reissueRefusal(account);if(refusal)fail(refusal.code,refusal.message,refusal.status);
      // Wargame 2026-10-23 #1(b)-(d), provisional: the staged file becomes current but cannot start a recovery until the
      // window ends; the previous credential is kept, able only to cancel this reissue, and becomes current again if
      // the reissue is cancelled. The cancel link goes only to an email verified before the reissue began.
      const preparedAt=Number.isSafeInteger(staged.preparedAt)?staged.preparedAt:now,fileLocked=staged.fileLocked===true&&this.fileProofReissue(account,staged.credential,preparedAt),emailCancel=this.reissueRecipients(account,preparedAt).some(recipient=>recipient.verifiedAt<preparedAt&&(recipient.current||!fileLocked)),cancelToken=emailCancel?`${account.id}.${this.crypto.random()}`:null;
      account.recoveryPrevious={hash:account.recoveryHash||null,issuedAt:nonNegative(account.recoveryIssuedAt)?account.recoveryIssuedAt:null,fileId:currentFormat(account)?account.recoveryFileId:null,version:currentFormat(account)?3:account.recoveryHash?'legacy':null,marker:reissueMarker(account),reminder:account.recoveryReminder??null,reissuedAt:now,preparedAt:Number.isSafeInteger(staged.preparedAt)?staged.preparedAt:now,until:now+RECOVERY_REISSUE_WINDOW_MS,newFileId:staged.fileId,cancelHash:cancelToken?await this.crypto.hash('reissue-cancel',cancelToken):null,credential:staged.credential??null,fileLocked,stagedSessionId:staged.sessionId,confirmedSessionId:sessionId};
      // P14 and the annual reminder count from the commit: the file becomes current now.
      account.recoveryHash=staged.hash;account.recoveryIssuedAt=now;account.recoveryFileId=staged.fileId;account.recoveryBackupVersion=3;delete account.recoveryKeyKid;delete account.recoveryReminder;delete account.recoveryStaged;delete account.recoveryReissue;
      this.audit(account,'recovery-file-reissued');this.securityChanged(account);account.revision=revision+1;
      if(!await this.repository.compareAndSwap(account.id,revision,account))continue;
      const notified=await this.reissueNotice(account,'recovery-reissued',{usableAt:account.recoveryPrevious.until},cancelToken?{token:cancelToken,before:preparedAt,currentOnly:fileLocked}:null,preparedAt);
      return {reissued:true,issuedAt:now,usableAt:account.recoveryPrevious.until,transferCancelled:gate?.transferCancelled===true,notified,recovery:this.recoveryView(account,session),account:await this.projectAccount(account)};
    }
    fail('conflict','The account changed; start this step again.');
  }
  /** Cancels a committed reissue during its cooling-off window (wargame 2026-10-23 #1(c), provisional). `how`: 'session'
   * (a session created before the reissue began), 'email' (the cancel link sent to an email verified before it began)
   * or 'file' (the previous recovery file). One identity CAS restores the previous credential
   * (and any forced marker it replaced), raises `federationGeneration` so no grant from before or during the window
   * survives, and bumps `security` (which also re-arms the 7-day transfer look-back). Notices go to every channel. */
  async cancelReissue(id,how,matches){
    let account=await this.repository.get(id);const first=pendingReissue(account,this.clock());
    if(!account||account.status!=='active'||!first||!await matches(account,first))fail('recovery_reissue_not_pending','There is no recovery file replacement to cancel.',409);
    for(let attempt=0;attempt<4;attempt++){
      if(attempt)account=await this.repository.get(id);
      const previous=pendingReissue(account,this.clock());
      if(!account||account.status!=='active'||!previous||previous.reissuedAt!==first.reissuedAt)fail('recovery_reissue_not_pending','There is no recovery file replacement to cancel.',409);
      const revision=account.revision;
      // A legacy previous credential is restored as it was: it still recovers nothing, and the console still asks for a
      // new file.
      if(typeof previous.hash==='string'&&previous.hash){account.recoveryHash=previous.hash;if(nonNegative(previous.issuedAt))account.recoveryIssuedAt=previous.issuedAt;else delete account.recoveryIssuedAt;if(previous.version===3&&typeof previous.fileId==='string'){account.recoveryFileId=previous.fileId;account.recoveryBackupVersion=3;}else{delete account.recoveryFileId;delete account.recoveryBackupVersion;}if(previous.reminder)account.recoveryReminder=previous.reminder;else delete account.recoveryReminder;}
      else{account.recoveryHash=null;delete account.recoveryIssuedAt;delete account.recoveryFileId;delete account.recoveryBackupVersion;delete account.recoveryReminder;}
      delete account.recoveryKeyKid;
      if(previous.marker&&RECOVERY_REISSUE_REASONS.includes(previous.marker.reason))account.recoveryReissue=previous.marker;
      delete account.recoveryPrevious;delete account.recoveryStaged;
      // Sessions created at or after the begin, and the sessions that staged and confirmed the reissue (perhaps the
      // minter's, created earlier), end with it (review 2026-10-23 item 3 and follow-up).
      const ended=new Set([previous.stagedSessionId,previous.confirmedSessionId].filter(id=>typeof id==='string'));
      await this.pruneSessions(account,s=>Number.isSafeInteger(s.createdAt)&&s.createdAt>=previous.preparedAt||ended.has(s.id));
      account.pendingSever={reason:'recovery',at:this.clock()};
      account.federationGeneration=(nonNegative(account.federationGeneration)?account.federationGeneration:0)+1;
      this.audit(account,'recovery-reissue-cancelled');this.securityChanged(account);account.revision=revision+1;
      if(!await this.repository.compareAndSwap(account.id,revision,account))continue;
      const notified=await this.reissueNotice(account,'recovery-reissue-cancelled');
      await this.flushSever(account.id);
      return {cancelled:true,restored:Boolean(account.recoveryHash),notified};
    }
    fail('conflict','The account changed; try again.');
  }
  /** Wargame 4 M1: sessions ended explicitly (revoke, cap eviction, recovery) end their bound push subscriptions. The
   * row is written in the ending CAS and run by flushPushEnds after it (save, owner view), retried like pendingSever.
   * `keep` (sign out other devices) also ends every subscription not bound to a kept session or `keepSubscriptions`. */
  queuePushEnds(account,ids,{keep,keepSubscriptions}={}){
    if(typeof this.accountChannels?.endSessions!=='function')return; // no account object to clean on this host
    queuePushEndsOn(account,ids,{keep,keepSubscriptions,nonce:this.crypto.random()});
  }
  async flushPushEnds(id){
    for(let attempt=0;attempt<4;attempt++){
      const account=await this.repository.get(id);if(!account?.pendingPushEnds)return true;const run=account.pendingPushEnds;
      if(typeof this.accountChannels?.endSessions==='function')try{await this.accountChannels.endSessions(id,{sessionIds:run.ids??[],...run.keep?{keep:run.keep,keepSubscriptions:run.keepSubscriptions??[]}:{}});}catch{return false;}
      const current=await this.repository.get(id);if(!current?.pendingPushEnds)return true;if(current.pendingPushEnds.nonce!==run.nonce)continue;const revision=current.revision;delete current.pendingPushEnds;current.revision=revision+1;
      if(await this.repository.compareAndSwap(id,revision,current))return true;
    }
    return false;
  }
  /** After `save`: run the row; keep the caller's in-memory record coherent when only that clear was written. */
  async syncPushEnds(account){const revision=account.revision;if(!await this.flushPushEnds(account.id))return;const fresh=await this.repository.get(account.id);if(fresh&&!fresh.pendingPushEnds&&fresh.revision===revision+1){delete account.pendingPushEnds;account.revision=fresh.revision;}}
  /** Runs the durable connection-severing row `account.pendingSever` (written in the recovery-start or reissue-cancel CAS)
   * and clears it once the port succeeded. A failure leaves the row, so the next attempt (recovery activation, the
   * owner view, a later cancel) retries. Without a port configured the row is cleared (nothing to sever). */
  async flushSever(id){
    for(let attempt=0;attempt<4;attempt++){
      const account=await this.repository.get(id);if(!account?.pendingSever)return true;const ran=account.pendingSever.at;
      if(typeof this.severConnections==='function')try{await this.severConnections(id,{reason:account.pendingSever.reason??'recovery'});}catch{return false;}
      // Clear only the row that was run; a newer row (a later recovery or cancel) waits for its own run.
      const current=await this.repository.get(id);if(!current?.pendingSever)return true;if(current.pendingSever.at!==ran)continue;const revision=current.revision;delete current.pendingSever;current.revision=revision+1;
      if(await this.repository.compareAndSwap(id,revision,current))return true;
    }
    return false;
  }
  /** Cancel from a signed-in session that existed before the reissue began (any of the owner's earlier devices). */
  async reissueRecoveryCancel(input,context){
    const {account,session}=await this.authorized(context,true);
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(name=>name!=='confirmed')||input.confirmed!==true)fail('confirmation_required','Confirm that you want to cancel the recovery file replacement.',400);
    if(!await this.rateLimiter.check({operation:'recovery-reissue-cancel',remoteIP:context.remoteIP,region:context.region,handle:account.id}))fail('rate_limited','Please wait before trying again.');
    const hash=session.hash;
    const result=await this.cancelReissue(account.id,'session',async(current,previous)=>{const live=current.sessions.find(s=>secureEqual(s.hash,hash)&&s.expiresAt>this.clock());if(!live)fail('unauthorized','Sign in to continue.');if(!(Number.isSafeInteger(live.createdAt)&&live.createdAt<previous.preparedAt))throw Object.assign(new IdentityFault('reissue_cancel_not_allowed','Cancel from a device that was signed in before the replacement started, from the link in the email notice, or with your previous recovery file.'),{status:403});return true;});
    // The cancel ends the staging and confirming sessions (and sessions approved from them), which may include this one:
    // say so instead of projecting the account to an ended session, so the console can show the outcome and sign out
    // rather than treating the next request's 401 as an expired session.
    const after=await this.repository.get(account.id);
    if(!after?.sessions?.some(s=>secureEqual(s.hash,hash)&&s.expiresAt>this.clock()))return {...result,signedOut:true};
    return {...result,account:await this.projectAccount(after)};
  }
  /** Cancel with the link mailed to an email verified before the reissue began. Mailbox proof only cancels; it never
   * signs in. GET of the page changes nothing; this is the explicit POST. */
  async reissueRecoveryCancelEmail(input,context){
    this.origin(context);
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(name=>!['token','confirmed'].includes(name))||input.confirmed!==true)fail('confirmation_required','Confirm that you want to cancel the recovery file replacement.',400);
    if(!await this.rateLimiter.check({operation:'recovery-reissue-cancel',remoteIP:context.remoteIP,region:context.region}))fail('rate_limited','Please wait before trying again.');
    const [id]=tokenParts(input.token),hash=await this.crypto.hash('reissue-cancel',input.token);
    const result=await this.cancelReissue(id,'email',async(current,previous)=>typeof previous.cancelHash==='string'&&secureEqual(previous.cancelHash,hash));
    return {cancelled:result.cancelled,restored:result.restored};
  }
  /** Cancel with the previous recovery file: during the window that is the only thing it can do (wargame #1(d)). The
   * proof is the 256-bit token of a v3 file, so no CAPTCHA is asked (the one the owner solved for the refused recovery
   * attempt is already spent); the network windows still apply. A legacy previous credential cannot cancel. */
  async reissueRecoveryCancelFile(input,context){
    this.origin(context);
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(name=>!['recoveryToken','turnstileToken'].includes(name)))fail('invalid_request','Unsupported recovery request.',400);
    if(!await this.rateLimiter.check({phase:'attempt',operation:'recovery-reissue-cancel',remoteIP:context.remoteIP,region:context.region}))fail('rate_limited','Please wait before trying again.');
    const [id]=tokenParts(input.recoveryToken),proof=await this.crypto.hash('recovery',input.recoveryToken);
    const result=await this.cancelReissue(id,'file',async(current,previous)=>{
      if(previous.version!==3||typeof previous.hash!=='string'||!secureEqual(previous.hash,proof))return false;
      // Coordinator decision 2026-10-23 (provisional), restated without passwords (2026-10-28): a file-proof passkey
      // reissue may be retiring a leaked file, so that file cannot undo it; only earlier sessions and the pre-reissue
      // email can. One confirmed with a passkey that is not file-proof (younger than the previous file, or after a recent
      // channel change) stays cancellable by the file (`fileProofReissue`).
      if(previous.fileLocked===true)throw Object.assign(new IdentityFault('reissue_cancel_not_allowed','This replacement was confirmed with a passkey you had before your previous file, so that file cannot cancel it. Cancel it from a device that was signed in before it started, or from the link in the email notice.'),{status:403});
      return true;});
    return {cancelled:result.cancelled,restored:result.restored};
  }
  async claimHandle(input,context){
    const {account}=await this.recent(context);
    let selected;try{selected=validateHostAlias(input.handle);}catch{fail('invalid_handle','Choose a custom handle of 3–32 letters, digits, underscores or hyphens.');}
    if(configuredReservedName(this.config,selected)||this.reservedHandle&&await this.reservedHandle(selected)!==false)fail('reserved_handle','This handle is reserved for operator-issued account onboarding.');
    if(!await this.rateLimiter.check({operation:'handle-claim',remoteIP:context.remoteIP}))fail('rate_limited','Please wait before trying again.');
    if(account.paidHandle&&account.paidHandle!==selected)fail('handle_already_claimed','This identity already has a permanent custom handle.');
    if(!this.paidHandleEligibility||!await this.paidHandleEligibility(account.id))fail('paid_history_required','A verified paid subscription is required to claim a custom handle.');
    if(!this.repository.claimPaidHandle||!account.assignmentId)fail('handle_claim_unavailable','Custom handles are unavailable for this identity.');
    if(!await this.repository.claimPaidHandle(selected,account.id,account.assignmentId))fail('handle_unavailable','This handle is permanently assigned or you already claimed another handle.');
    if(!account.paidHandle){const revision=account.revision;account.paidHandle=selected;this.audit(account,'paid-handle-claimed');await this.save(account,revision);}
    return {account:await this.projectAccount(account)};
  }
  async handleCertificate(input,context){
    const {account}=await this.authorized(context,true);
    if(!this.identityBackup?.certificate)fail('recovery_unavailable','Certificate signing is unavailable.');
    const selected=input.handle===undefined?account.handle:handle(input.handle);
    if(selected!==account.handle&&selected!==onboardingAlias(account)&&selected!==account.paidHandle&&selected!==await this.repository.paidHandleForOwner?.(account.id))fail('forbidden','This handle does not belong to your identity.');
    const certificate=await this.identityBackup.certificate(account,selected,this.clock());
    return {fileName:`handle-claim-${selected}.json`,content:JSON.stringify(certificate,null,2)};
  }
  setupProjection(account){const push=typeof this.pushTransport?.send==='function'&&typeof this.pushTransport?.register==='function'&&account.setupPushVerified?.expiresAt>this.clock(),notice=noticeEntry(account);return {accountId:account.id,signupPlan:account.admission?.plan??'free',paymentRequired:account.admission?.kind==='paid'&&account.admission.initialPaymentRequired!==false,channelRequired:this.config.requireReachability===true||Boolean(account.systemIdentity),channelVerified:Boolean(notice||push),verifiedEmail:notice?.address??null,signInEmail:notice?.state==='sign-in',pushVerified:Boolean(push),emailAvailable:typeof this.mailer?.sendSetupCode==='function',pushAvailable:typeof this.pushTransport?.send==='function'&&typeof this.pushTransport?.register==='function'};}
  async setupSendAdmission(account,kind,context,target){const now=this.clock(),windowKey='setup'+kind+'WindowAt',countKey='setup'+kind+'Sends',sentKey='setup'+kind+'SentAt';const window=account[windowKey];if(window!==undefined&&(!Number.isSafeInteger(window)||window>now))fail('rate_limited');if(window===undefined||now-window>=600000){account[windowKey]=now;account[countKey]=0;}if(!Number.isInteger(account[countKey])||account[countKey]<0||account[countKey]>=3||account[sentKey]&&now-account[sentKey]<60000||!await this.rateLimiter.check({operation:'email',remoteIP:context.remoteIP,handle:target}))fail('rate_limited','Wait before requesting another verification check.');account[countKey]++;account[sentKey]=now;}
  async setupStatus(input,context){this.origin(context);return this.setupProjection(await this.pending(input.pendingToken,context));}
  async setupBillingCheckout(input,context){this.origin(context);const account=await this.pending(input.pendingToken,context);if(!['pending','recovering'].includes(account.status)||account.admission?.kind!=='paid'||account.admission.initialPaymentRequired===false||!this.setupBilling)fail('invalid_paid_setup');await this.requireSetupChannel(account);if(!await this.rateLimiter.check({operation:'paid-setup',remoteIP:context.remoteIP,handle:account.id}))fail('rate_limited');const result=await this.setupBilling.checkout(account.id,account.admission,{requestId:input.requestId,currency:input.currency,priceDigest:input.priceDigest});await this.pending(input.pendingToken,context);return result;}
  async setupBillingStatus(input,context){this.origin(context);const account=await this.pending(input.pendingToken,context);if(!['pending','recovering'].includes(account.status)||account.admission?.kind!=='paid'||account.admission.initialPaymentRequired===false||!this.setupBilling)fail('invalid_paid_setup');if(!await this.rateLimiter.check({operation:'paid-setup',remoteIP:context.remoteIP,handle:account.id}))fail('rate_limited');const result=await this.setupBilling.status(account.id,account.admission);await this.pending(input.pendingToken,context);return result;}
  async setupEmailStart(input,context){this.origin(context);if(input.locale!==undefined&&!['en','es'].includes(input.locale))fail('invalid_locale','Choose English or Spanish.');const account=await this.pending(input.pendingToken,context),revision=account.revision;if(typeof this.mailer?.sendSetupCode!=='function')fail('email_unavailable','Email delivery is not configured.');const email=emailAddress(input.email),now=this.clock();if(account.systemIdentity?.requiredEmail&&account.admission?.initialSystemActivationRequired!==false&&email!==emailAddress(account.systemIdentity.requiredEmail))fail('contact_required','Use the contact address assigned by the system invitation.');await this.setupSendAdmission(account,'Email',context,email);let number;do{number=globalThis.crypto.getRandomValues(new Uint32Array(1))[0];}while(number>=4200000000);const code=String(number%100000000).padStart(8,'0');account.setupEmailChallenge={email,hash:await this.crypto.hash('setup-email',account.id+'|'+account.pendingHash+'|'+email+'|'+code),pendingHash:account.pendingHash,expiresAt:now+600000,attempts:0};await this.save(account,revision);await this.mailer.sendSetupCode({email,code,issuer:this.config.origin,locale:input.locale??'en'});return {sent:true,...this.setupProjection(account)};}
  /** The setup code verifies the address (`verified`, the notice address). Sign-in is an explicit, never preselected
   * choice on the same screen (`signIn: true`, spike §3.3 and Q3, owner-approved 2026-10-28): the address is verified at
   * that instant, so the "only a verified address becomes a sign-in email" rule holds. During sign-up a new setup
   * address replaces the previous setup address; during recovery setup it is added beside the account's addresses. */
  async setupEmailConfirm(input,context){this.origin(context);if(input.signIn!==undefined&&typeof input.signIn!=='boolean')fail('invalid_request','Choose whether this email can sign in.');const account=await this.pending(input.pendingToken,context),revision=account.revision,challenge=account.setupEmailChallenge;if(!challenge||challenge.pendingHash!==account.pendingHash||challenge.expiresAt<=this.clock()||challenge.attempts>=5||typeof input.code!=='string'||!/^\d{8}$/.test(input.code))fail('invalid_challenge','Request a fresh email code.');challenge.attempts++;if(!secureEqual(challenge.hash,await this.crypto.hash('setup-email',account.id+'|'+account.pendingHash+'|'+challenge.email+'|'+input.code))){await this.save(account,revision);fail('invalid_challenge','That email code is incorrect.');}const existing=await this.repository.findByEmail(challenge.email);if(existing&&existing.id!==account.id)fail('email_already_linked','This verified email belongs to another account. Sign in to that account.');
    const now=this.clock();migrateEmails(account,now);let entries=account.emails??[];const same=entries.find(entry=>entry.address===challenge.email&&entry.state!=='unverified');
    if(!same&&account.status==='pending')entries=entries.filter(entry=>entry.source!=='setup-code');
    entries=entries.filter(entry=>entry.state!=='unverified'||entry.address!==challenge.email);
    if(!same&&entries.filter(entry=>entry.state!=='unverified').length>=MAX_CONFIRMED_EMAILS)fail('email_limit','This account already has three verified email addresses.',409);
    const signIn=input.signIn===true,entry=same??{address:challenge.email,state:'verified',source:'setup-code',addedBy:{session:account.status==='recovering'?'recovery':'setup',at:now}};
    if(entry!==same){this.securityChanged(account);delete account.noticeWaiver;entries.push(entry);}
    entry.verifiedAt=now;if(signIn&&entry.state!=='sign-in'){entry.state='sign-in';entry.signInSince=now;entry.addedBy={session:account.status==='recovering'?'recovery':'setup',at:now};if(entry===same)this.securityChanged(account);}
    for(const item of entries)item.notices=item===entry;account.emails=entries;delete account.setupEmailChallenge;this.audit(account,'setup-email-verified');await this.save(account,revision);return this.setupProjection(account);}
  async setupPushStart(input,context){this.origin(context);if(input.locale!==undefined&&!['en','es'].includes(input.locale))fail('invalid_locale','Choose English or Spanish.');const account=await this.pending(input.pendingToken,context),revision=account.revision;if(typeof this.pushTransport?.send!=='function')fail('push_unavailable','Push delivery is not configured.');const subscription=input.subscription;if(!subscription||typeof subscription.endpoint!=='string'||subscription.endpoint.length>4096||!subscription.keys||typeof subscription.keys.p256dh!=='string'||typeof subscription.keys.auth!=='string'||JSON.stringify(subscription).length>8192)fail('invalid_subscription','Use a browser-created push subscription.');await this.setupSendAdmission(account,'Push',context,account.handle);const proof=account.id+'.'+this.crypto.random();account.setupPushChallenge={subscription:structuredClone(subscription),hash:await this.crypto.hash('setup-push',proof),pendingHash:account.pendingHash,expiresAt:this.clock()+300000};delete account.setupPushVerified;await this.save(account,revision);await this.pushTransport.send(subscription,{type:'bindle-setup-challenge',proof,owner:account.id,locale:input.locale??'en'});return {sent:true,...this.setupProjection(account)};}
  async setupPushConfirm(input,context){this.origin(context);const account=await this.pending(input.pendingToken,context),revision=account.revision,challenge=account.setupPushChallenge;if(typeof this.pushTransport?.send!=='function'||!challenge||challenge.pendingHash!==account.pendingHash||challenge.expiresAt<=this.clock()||typeof input.proof!=='string'||!secureEqual(challenge.hash,await this.crypto.hash('setup-push',input.proof)))fail('invalid_challenge','Enable notifications and request a fresh push check.');account.setupPushVerified={subscription:challenge.subscription,verifiedAt:this.clock(),expiresAt:account.pendingExpiresAt};delete account.setupPushChallenge;this.audit(account,'setup-push-verified');await this.save(account,revision);return this.setupProjection(account);}
  async requireSetupChannel(account){if(this.config.requireReachability!==true&&!account.systemIdentity)return;if(account.systemIdentity?.requiredEmail&&account.admission?.initialSystemActivationRequired!==false&&!confirmedEmails(account).some(entry=>entry.address===emailAddress(account.systemIdentity.requiredEmail)))fail('contact_required','Verify the contact address assigned by the system invitation.');for(const entry of confirmedEmails(account)){const owner=await this.repository.findByEmail(entry.address);if(owner?.id===account.id)return;}if(typeof this.pushTransport?.send==='function'&&account.setupPushVerified?.expiresAt>this.clock()){if(typeof this.pushTransport.register!=='function')fail('push_unavailable','Push registration is not configured.');await this.pushTransport.register({owner:account.id,subscription:account.setupPushVerified.subscription});if(account.pendingExpiresAt<=this.clock()||account.setupPushVerified.expiresAt<=this.clock())fail('unauthorized','This setup proof expired. Start another check.');return;}fail('contact_required','Verify an email address or enable and verify push notifications before activating your account.');}
  async confirmRecovery(input, context) {
    this.origin(context); const account = await this.pending(input.pendingToken,context); const revision = account.revision,activationDeadline=account.pendingExpiresAt;
    if (input.downloadConfirmed !== true || !account.recoveryHash || typeof input.recoveryToken !== 'string' || !secureEqual(account.recoveryHash, await this.crypto.hash('recovery', input.recoveryToken))) fail('recovery_confirmation_required', 'Download and confirm your recovery file before continuing.');
    if (!account.credentials.length) fail('credential_required');
    await this.requireSetupChannel(account);
    if(account.admission?.kind==='paid'&&account.admission.initialPaymentRequired!==false){if(!this.setupBilling)fail('payment_required','Verify your paid subscription before activating this account.');const payment=await this.setupBilling.status(account.id,account.admission);if(payment?.paymentVerified!==true||payment.signupPlan!==account.admission.plan||payment.validUntil<=this.clock())fail('payment_required','Payment is still being verified. Recheck before activating your account.');account.admission.initialPaymentRequired=false;}
    if(account.systemIdentity)account.admission={...account.admission,initialSystemActivationRequired:false};
    const source=account.status==='recovering'?'recovery':'activation',activationCredentialAt=account.pendingCredentialAt;if(source==='recovery')raiseAuthorityEpoch(account,{reason:'recovery'});delete account.pendingCredentialAt;
    account.status = 'active'; account.pendingHash = null; account.pendingExpiresAt = null; account.challenges = [];delete account.setupBindingHash;delete account.setupEmailChallenge;delete account.setupPushChallenge;delete account.setupEmailSends;delete account.setupEmailSentAt;delete account.setupPushSends;delete account.setupPushSentAt;delete account.setupEmailWindowAt;delete account.setupPushWindowAt;
    delete account.recoveryResumeHash; delete account.recoveryResumeBackupVersion; delete account.recoveryResumeKeyKid; delete account.recoveryResumeFileId;
    this.audit(account, 'account-activated'); const result = await this.session(account,{source,activationCredentialAt});if(activationDeadline<=this.clock())fail('unauthorized','This setup session expired.');
    await this.save(account, revision); if (account.pendingSever) await this.flushSever(account.id);
    // SI-8 (c): the console discards a held sign-in continuation after a recovery and resumes it after a sign-up.
    return { ...result, recovered: source === 'recovery' };
  }
  async resumeSetupCredential(account,context,revision=account.revision){const pendingToken=await this.newPending(account,context);account.pendingCredentialAt=this.clock();account.challenges=[];this.audit(account,'setup-credential-resumed');await this.save(account,revision);return {pendingToken,account:await this.projectAccount(account),readyForRecovery:account.credentials.length>0,credentialRequired:false,resumed:true,signupPlan:account.admission?.plan??'free',paymentRequired:account.admission?.kind==='paid'&&account.admission.initialPaymentRequired!==false,setup:this.setupProjection(account)};}

  /** Passkey sign-in, phase 1 (wargame 2026-10-23 #3, #9 and challenge eviction). The challenge is not stored: the
   * token is `pl1.<payload>.<mac>`, a keyed MAC over {handle, challenge, nonce, expiry}. Begin therefore reads no
   * account and writes nothing, so it cannot reveal whether or in what state a handle exists, cannot evict another
   * caller's challenge and never bumps the account revision. It passes only the per-network windows and Turnstile;
   * the per-handle window is not charged. Finish verifies the MAC, then the assertion, and records the nonce as used
   * in the session's own write (single use). */
  async beginPasskeyLogin(input, context) {
    this.origin(context);input={...input,handle:handle(input.handle)};await this.guard('login', input, context);
    const authenticationOptions = await this.webauthn.authenticationOptions({ config: this.config });
    if(typeof authenticationOptions?.challenge!=='string'||authenticationOptions.challenge.length>256)fail('unavailable','Passkey sign-in is unavailable.',503);
    const payload=encode(new TextEncoder().encode(JSON.stringify({v:1,h:input.handle,c:authenticationOptions.challenge,n:this.crypto.random(16),e:this.clock()+this.config.challengeTtlMs})));
    return { authenticationOptions, challengeToken: `pl1.${payload}.${await this.mac('passkey-login',payload)}` };
  }
  /** The verified claim of a passkey sign-in token, or `unauthorized`. */
  async loginClaim(token){
    const match=typeof token==='string'?LOGIN_TOKEN.exec(token):null;if(!match||!secureEqual(match[2],await this.mac('passkey-login',match[1])))fail('unauthorized','Authentication failed.');
    let claim;try{claim=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decode(match[1])));}catch{fail('unauthorized','Authentication failed.');}
    if(claim?.v!==1||typeof claim.h!=='string'||typeof claim.c!=='string'||typeof claim.n!=='string'||!Number.isSafeInteger(claim.e)||claim.e<=this.clock())fail('unauthorized','Authentication failed.');
    return claim;
  }
  async finishPasskeyLogin(input, context) {
    this.origin(context);
    if (!await this.rateLimiter.check({ operation: 'assertion', remoteIP: context.remoteIP })) fail('rate_limited');
    const claim = await this.loginClaim(input.challengeToken); const account = await this.repository.findByHandle(claim.h);
    const nonce = await this.crypto.hash('passkey-login-nonce', claim.n), now = this.clock();
    const replayed = (account?.loginNonces ?? []).some(entry => entry?.expiresAt > now && secureEqual(entry.hash, nonce));
    const credential = account?.credentials.find(c => c.id === input.response?.id);
    const closed = ['suspended','moved'].includes(account?.status) && Boolean(await this.closureWindow(account));
    if (!account || !(closed||['active',...(this.config.requireReachability===true||account?.systemIdentity||account?.onboardingIdentity)?['pending','recovering']:[]].includes(account.status)) || replayed || !credential) fail('unauthorized', 'Authentication failed.');
    const revision = account.revision; let verified;
    try { verified = await this.webauthn.verifyAuthentication({ response: input.response, challenge: claim.c, credential, account, config: this.config }); } catch { fail('unauthorized', 'Authentication failed.'); }
    credential.counter = verified.counter; credential.backedUp = verified.backedUp;
    // Only verified assertions add an entry, so this list cannot be filled without the passkey.
    // V2 audit: never evict a live nonce (an evicted one could be replayed); at 32 live nonces sign-in waits.
    const liveNonces = (account.loginNonces ?? []).filter(entry => entry?.expiresAt > now); if (liveNonces.length >= 32) fail('rate_limited', 'Please wait before trying again.');
    account.loginNonces = [...liveNonces, { hash: nonce, expiresAt: claim.e }];
    account.challenges = account.challenges.filter(c => c.purpose !== 'login');
    if(closed)return this.closureSession(account,revision,{ label: input.label, credentialId: credential.id });
    if(account.status!=='active')return this.resumeSetupCredential(account,context,revision);
    this.interactive(account,'sign-in',context); const result = await this.session(account, { label: input.label, credentialId: credential.id }); await this.save(account, revision); return result;
  }
  async recover(input, context) {
    await this.guard('recovery', input, context); const [id] = tokenParts(input.recoveryToken);
    const account = await this.repository.get(id);
    const proofHash = await this.crypto.hash('recovery', input.recoveryToken);
    const resumed = account?.status === 'recovering' && secureEqual(account.recoveryResumeHash, proofHash);
    // Wargame 2026-10-23 #1(b), (d): during a reissue's cooling-off window neither file starts a recovery. The new file
    // waits until the window ends; the previous one can only cancel the reissue. Both answers need the file's 256-bit
    // credential, so they reveal the window only to a holder of a genuine v3 file.
    const pending = account?.status === 'active' ? pendingReissue(account, this.clock()) : null;
    if (pending && !resumed) {
      const previous = pending.version === 3 && typeof pending.hash === 'string' && secureEqual(pending.hash, proofHash), current = currentFormat(account) && secureEqual(account.recoveryHash, proofHash);
      if (previous || current) {
        if (previous && pending.fileLocked === true) throw Object.assign(new IdentityFault('recovery_reissue_locked', 'This recovery file was replaced recently with a passkey confirmation. It cannot recover the account or cancel the replacement. Cancel it from a device that was signed in before it started, or from the link in the email notice.'), { status: 409, usableAt: pending.until, cancellable: false });
        if (previous) throw Object.assign(new IdentityFault('recovery_reissue_pending', 'This recovery file was replaced recently. During the 7-day waiting period you can use it only to cancel that replacement; once cancelled it works again.'), { status: 409, usableAt: pending.until, cancellable: true });
        throw Object.assign(new IdentityFault('recovery_not_ready', 'This recovery file is new. It can start a recovery once its 7-day waiting period ends.'), { status: 409, usableAt: pending.until });
      }
    }
    // Organization recovery (break-glass, design §5.11) is phase B (ORG-12): until then an organization file recovers nothing.
    // Only a v3 credential recovers or resumes (v1/v2 files are no longer recognised, owner approval 2026-10-28).
    if (!account || !interactiveIdentity(account) || (resumed ? account.recoveryResumeBackupVersion !== 3 : (!['active','pending'].includes(account.status) || !currentFormat(account) || !secureEqual(account.recoveryHash, proofHash)))) fail('unauthorized', 'Recovery failed.');
    const revision = account.revision;
    if (!resumed) {
      account.recoveryResumeHash = account.recoveryHash;
      account.recoveryResumeBackupVersion=3;account.recoveryResumeFileId=account.recoveryFileId;
      delete account.recoveryKeyKid;delete account.recoveryResumeKeyKid;delete account.recoveryFileId;delete account.recoveryBackupVersion;delete account.recoveryReminder;
      this.queuePushEnds(account, await Promise.all(account.sessions.filter(s => s.expiresAt > this.clock()).map(s => this.sessionID(s))));
      account.status = 'recovering'; account.recoveryHash = null; account.credentials = []; delete account.passwordHash; delete account.passwordSetAt; account.sessions = []; revokeAllLineage(account, this.clock()); account.emailChallenges = [];
      // Spike §3.7 (owner-approved 2026-10-28): a recovery sets every sign-in email to verified and drops an unverified
      // address; recovery setup can turn sign-in back on with a fresh mailbox proof (the setup code).
      migrateEmails(account, this.clock()); if (Array.isArray(account.emails)) account.emails = account.emails.filter(entry => entry.state !== 'unverified').map(entry => { if (entry.state !== 'sign-in') return entry; const { signInSince, ...rest } = entry; return { ...rest, state: 'verified' }; });
      // The replacement file of the recovery supersedes any staged reissue and any forced-reissue marker.
      delete account.recoveryStaged; delete account.recoveryReissue; delete account.recoveryPrevious;
      account.pendingSever = { reason: 'recovery', at: this.clock() };
    }
    // Resumption only rotates the limited setup authority; completed replacement
    // credentials and the replacement recovery file remain intact.
    account.challenges = [];
    const pendingToken = await this.newPending(account,context); this.audit(account, resumed ? 'recovery-setup-resumed' : 'account-recovery-started'); this.securityChanged(account);
    await this.save(account, revision);
    // OAuth app authorizations do not survive a recovery (recovery-identity spec): connections end too. The durable
    // `pendingSever` row written in the same CAS makes a transient failure retry (flushSever).
    if (!resumed) await this.flushSever(account.id);
    const credentialRequired = !account.credentials.length;
    return { pendingToken, account: await this.projectAccount(account), credentialRequired, readyForRecovery: !credentialRequired, resumed };
  }
  async owner(input, context) {
    const { account, session } = await this.authorized(context);
    if(account.pendingPushEnds)await this.flushPushEnds(account.id);
    if((account.pendingSever&&await this.flushSever(account.id))||account.pendingPushEnds){const fresh=await this.repository.get(account.id);if(fresh){for(const key of Object.keys(account))if(!(key in fresh))delete account[key];Object.assign(account,fresh);}}
    if(!account.paidHandle&&this.repository.paidHandleForOwner)account.paidHandle=await this.repository.paidHandleForOwner(account.id)||undefined;
    // Throttle last-use persistence; telemetry must not cause a read to fail
    // if another authenticated mutation won the account revision race.
    if ((session.lastUsedAt || session.createdAt) + 60000 <= this.clock()) {
      const revision = account.revision; session.lastUsedAt = this.clock(); this.collectDueNotices(account);
      account.revision = revision + 1;
      if (await this.repository.compareAndSwap(account.id, revision, account)) await this.flushNotices(account); else this.queuedNotices?.delete(account);
    }
    // `securityEpoch` feeds the ORG-0 actor (packages/orgs/authority.mjs); the HTTP router strips it from /api/session.
    return { account: await this.projectAccount(account), csrfToken: session.csrfToken, expiresAt: session.expiresAt,authTime:Number.isFinite(this.authAt(session))?this.authAt(session):null,securityEpoch:securityState(account).epoch,authorityEpoch:authorityEpoch(account),organizationVerification:organizationVerification(account,session),sessionContext:await this.sessionID(session),signOutImpact:await this.signOutImpact(account,session),
      credentials: publicCredentials(account),
      devices: await Promise.all(account.sessions.filter(s => s.expiresAt > this.clock()).map(async s => ({
        id: await this.sessionID(s), label: s.label || 'Browser session', createdAt: s.createdAt, ...s.parentSessionId?{approvedFrom:s.parentSessionId}:{},
        lastUsedAt: s === session ? this.clock() : s.lastUsedAt || s.createdAt, expiresAt: s.expiresAt, current: s === session }))),
      audit: account.audit.slice(-20), recovery: this.recoveryView(account,session) };
  }
  /** Recent authentication for adding a passkey: a passkey sign-in or step-up within 15 minutes (`recent`), or the SI-4
   * email step-up (spike §3.5, Q8, owner-approved: an email session may add a passkey, never remove one) on an account
   * that has no passkey. Returns the authorized pair and `via`, the kind recorded as the new passkey's `addedBy.session`
   * (RM-3 lets an established sign-in email undo a passkey that an email session added). Sessions from the cross-device
   * code path (`email-cross-device`, N2) do not exist yet; when they do, the passkey they add is provisional for 24 h,
   * so `emailStepUp` refuses them until that is built. */
  async passkeyAddAuthority(context) {
    const result = await this.authorized(context, true);
    if (this.authAt(result.session) + 900000 > this.clock()) return { ...result, via: this.sessionKind(result.session) };
    if (this.emailStepUp(result.account, result.session)) return { ...result, via: 'email' };
    fail('reauthentication_required', result.account.credentials.length ? 'Confirm with your passkey before changing account access.' : 'Sign in again with your sign-in email to add a passkey.');
  }
  async credentialBegin(input, context) {
    const { account, session, via } = await this.passkeyAddAuthority(context); const revision = account.revision;
    if (account.credentials.length >= 5) fail('credential_limit', 'You can register up to five passkeys.');
    if (!await this.rateLimiter.check({ operation: 'credential-begin', remoteIP: context.remoteIP, region: context.region, handle: account.id })) fail('rate_limited', 'Please wait before trying again.');
    const registrationOptions = await this.webauthn.registrationOptions({ account, config: this.config });
    const challengeId = this.crypto.id();
    account.challenges = [...account.challenges.filter(c => c.expiresAt > this.clock() && c.purpose !== 'credential').slice(-4), {
      id: challengeId, purpose: 'credential', value: registrationOptions.challenge, sessionHash: session.hash, via,
      label: safeLabel(input.label, 'Passkey'), expiresAt: this.clock() + this.config.challengeTtlMs }];
    await this.save(account, revision); return { registrationOptions, challengeId };
  }
  async credentialFinish(input, context) {
    const { account, session } = await this.authorized(context, true); const revision = account.revision, now = this.clock();
    const challenge = account.challenges.find(c => c.purpose === 'credential' && c.id === input.challengeId && c.expiresAt > now && secureEqual(c.sessionHash, session.hash));
    // A challenge begun under the SI-4 email step-up finishes within its own 5-minute lifetime while the account still has
    // no passkey and the session's sign-in email is still one; anything else needs the ordinary recent authentication.
    const byEmail = challenge?.via === 'email' && account.credentials.length === 0 && session.source === 'email' && signInEmails(account).some(entry => entry.address === session.emailAddress);
    if (!byEmail && this.authAt(session) + 900000 <= now) fail('reauthentication_required', 'Confirm with your passkey before changing account access.');
    if (!challenge) fail('invalid_challenge');
    let credential;
    try { credential = await this.webauthn.verifyRegistration({ response: input.response, challenge: challenge.value, config: this.config }); } catch { fail('invalid_passkey', 'Passkey verification failed.'); }
    if (!credential?.id || !credential.publicKey || account.credentials.length >= 5 || account.credentials.some(c => c.id === credential.id)) fail('invalid_passkey');
    // `addedBy` (spike §3.2, §6.4): the kind of session that added it; an email-added passkey also names the sign-in
    // email and session that added it, so RM-3 can undo it and the owner can see where it came from.
    account.credentials.push({ ...credential, label: challenge.label, createdAt: now, addedBy: byEmail ? { session: 'email', at: now, emailAddress: session.emailAddress, sessionId: await this.sessionID(session) } : { session: this.sessionKind(session), at: now } });
    account.challenges = account.challenges.filter(c => c !== challenge); this.audit(account, byEmail ? 'passkey-added-by-email' : 'passkey-added'); this.securityChanged(account);
    this.queueNotice(account, 'passkey-added', await this.sessionID(session)); await this.save(account, revision); return { credentials: publicCredentials(account) };
  }
  async renamePasskey(input, context) {
    const { account } = await this.recent(context); const revision = account.revision;
    const credential = account.credentials.find(c => c.id === input.credentialId);
    if (!credential) fail('not_found', 'Passkey not found.');
    credential.label = safeLabel(input.label, 'Passkey'); this.audit(account, 'passkey-renamed');
    await this.save(account, revision); return { credentials: publicCredentials(account) };
  }
  /** The removal process for a passkey (sign-in and intents spike §6.4, provisional; review 2026-10-29 M2), in the same
   * tiers as sign-in emails (`signInRemovalAuthority`):
   *   RM-1  the recovery file plus another working method (a passkey or a sign-in email) must remain;
   *   RM-4  an established passkey (7 days or older, or of unknown age) needs file proof and a delay (Tier B), which do
   *         not exist yet: refused with `removal_unavailable`;
   *   RM-2  a recent passkey is undone at once with a passkey step-up within 5 minutes from an established passkey other
   *         than the one being removed (Tier A);
   *   RM-3  a recent passkey that an email session added is undone at once from an email-sign-in session under 10
   *         minutes old on an established sign-in email.
   * The proving method is always one that remains (a different passkey, or a sign-in email), so the remaining method
   * is proven in the same flow. `step_up_required` asks the console to prompt when an established passkey could prove
   * it; `removal_proof_required` means none of the accepted proofs is available. Returns 'passkey' or 'email'. */
  passkeyRemovalAuthority(account, session, target) {
    const now = this.clock(), established = at => nonNegative(at) && at <= now && now - at >= ESTABLISHED_METHOD_AGE_MS;
    if (!account.recoveryHash || account.credentials.filter(c => c.id !== target.id).length + signInEmails(account).length < 1) fail('credential_required', 'Keep another passkey or a sign-in email, and your recovery file, before removing this passkey.');
    // A passkey of unknown or future age counts as established (fails closed).
    if (!(nonNegative(target.createdAt) && target.createdAt <= now && now - target.createdAt < ESTABLISHED_METHOD_AGE_MS)) fail('removal_unavailable', 'Removing a passkey you have had for 7 days or more needs your recovery file and a waiting period. This is not available yet.', 409);
    const others = account.credentials.filter(c => c.id !== target.id && established(c.createdAt));
    const stepped = session.stepUpCredential?.kind === 'passkey' && Number.isSafeInteger(session.stepUpAt) && session.stepUpAt <= now && session.stepUpAt + 300000 > now ? others.find(c => c.id === session.stepUpCredential.id) : null;
    if (stepped) return 'passkey';
    if (['email', 'email-cross-device'].includes(target.addedBy?.session) && session.source === 'email' && Number.isSafeInteger(session.createdAt) && session.createdAt <= now && session.createdAt + 600000 > now && signInEmails(account).some(item => item.address === session.emailAddress && established(item.signInSince))) return 'email';
    if (others.length) fail('step_up_required', 'Confirm with a passkey you have had for at least 7 days to remove this recent passkey.');
    fail('removal_proof_required', 'Removing a recent passkey needs a passkey you have had for at least 7 days.', 403);
  }
  async removePasskey(input, context) {
    const { account, session } = await this.authorized(context, true); const revision = account.revision;
    const target = account.credentials.find(c => c.id === input.credentialId);
    if (!target) fail('not_found', 'Passkey not found.');
    const authority = this.passkeyRemovalAuthority(account, session, target);
    account.credentials = account.credentials.filter(c => c.id !== input.credentialId);
    await this.pruneSessions(account,s=>s.credentialId===input.credentialId);
    account.challenges = account.challenges.filter(c => c.purpose !== 'credential'); this.audit(account, authority === 'email' ? 'passkey-removed-by-email' : 'passkey-removed'); this.securityChanged(account);
    this.authorityEvent(account, 'passkey-removed'); this.queueNotice(account, 'passkey-removed', await this.sessionID(session));
    await this.save(account, revision); return { removed: true, currentSessionRevoked: !account.sessions.includes(session), credentials: publicCredentials(account) };
  }
  async renameSession(input, context) {
    const {account}=await this.authorized(context,true);const revision=account.revision;
    if(typeof input.label!=='string'||!input.label.trim()||input.label.length>80||/[\u0000-\u001f\u007f]/.test(input.label))fail('invalid_device_label','Choose a device name of up to 80 characters.');
    const target=(await Promise.all(account.sessions.map(async s=>({session:s,id:await this.sessionID(s)})))).find(s=>s.id===input.sessionId&&s.session.expiresAt>this.clock())?.session;
    if(!target)fail('not_found','Device session not found.');target.label=input.label.trim();this.audit(account,'device-session-renamed');await this.save(account,revision);return {renamed:true,sessionId:input.sessionId,label:target.label};
  }
  async revokeSession(input, context) {
    const { account, session } = await this.recent(context); const revision = account.revision;
    const target = (await Promise.all(account.sessions.map(async s => ({ session: s, id: await this.sessionID(s) })))).find(s => s.id === input.sessionId)?.session;
    if (!target) fail('not_found', 'Device session not found.');
    const other = target !== session; await this.pruneSessions(account,s=>s===target); this.audit(account, 'device-session-revoked'); if (other) { this.authorityEvent(account, 'sessions-revoked'); this.queueNotice(account, 'sessions-revoked', await this.sessionID(session)); }
    await this.save(account, revision); return { revoked: true, currentSessionRevoked: !account.sessions.includes(session) };
  }
  async revokeOtherSessions(input, context) {
    const { account, session } = await this.recent(context); const revision = account.revision;
    const keep=new Set([await this.sessionID(session)]);let parent=session.parentSessionId;while(parent&&!keep.has(parent)){keep.add(parent);parent=account.sessions.find(s=>s.id===parent)?.parentSessionId;}const before=account.sessions.filter(s=>s.expiresAt>this.clock()).length;const ids=new Map(await Promise.all(account.sessions.map(async s=>[s,await this.sessionID(s)])));await this.pruneSessions(account,s=>!keep.has(ids.get(s)));this.queuePushEnds(account,[],{keep:[...keep],keepSubscriptions:typeof input?.pushSubscription==='string'&&/^[A-Za-z0-9_-]{43}$/.test(input.pushSubscription)?[input.pushSubscription]:[]});const count=before-account.sessions.filter(s=>s.expiresAt>this.clock()).length; this.audit(account, 'other-device-sessions-revoked'); if (count > 0) { this.authorityEvent(account, 'sessions-revoked'); this.queueNotice(account, 'sessions-revoked', await this.sessionID(session)); }
    await this.save(account, revision); return { revoked: count };
  }
  /** What ordinary sign-out of `session` also ends, for the sign-out warning (architecture §7.4). */
  async signOutImpact(account,session){const now=this.clock(),chain=new Set([await this.sessionID(session)]);let changed=true;while(changed){changed=false;for(const s of account.sessions)if(s.parentSessionId&&chain.has(s.parentSessionId)&&s.expiresAt>now&&!chain.has(s.id)){chain.add(s.id);changed=true;}}return {sessions:chain.size-1,apps:(account.linkedLineage??[]).filter(entry=>entry.expiresAt>now&&entry.sessions.some(id=>chain.has(id))).length};}
  linkedFlow() { return this.linkedApproval ||= new LinkedApproval(this, IdentityFault); }
  deviceFlow() { return this.deviceLogin ||= new DeviceLogin(this, IdentityFault); }
  // Linked approval (packages/identity/linked-approval.mjs; contract in linked-approval.md §10.1). Gated by
  // config.deviceAuthorizationEnabled. The system operations below are for the federation engine and are never routed.
  async linkedStart(input, context) { return this.linkedFlow().start(input, context); }
  async linkedResolve(input, context) { return this.linkedFlow().resolve(input, context); }
  async linkedApprove(input, context) { this.requireCurrentTerms((await this.authorized(context,true)).account);return this.linkedFlow().approve(input, context); }
  async linkedDeny(input, context) { return this.linkedFlow().deny(input, context); }
  async linkedPoll(input, context) { return this.linkedFlow().poll(input, context); }
  async linkedAccept(input, context) { return this.linkedFlow().accept(input, context); }
  async linkedCancel(input, context) { this.linkedFlow().enabled(); return this.linkedFlow().cancel(input, context); }
  async linkedStartApp(input, context) { return this.linkedFlow().startApp(input, context); }
  async linkedRedeem(input, context) { return this.linkedFlow().redeem(input, context); }
  async linkedCancelApp(input) { return this.linkedFlow().cancelApp(input); }
  async linkedLineageLive(input) { return this.linkedFlow().lineageLive(input); }
  async linkedLineageRevoke(input) { return this.linkedFlow().lineageRevoke(input); }
  async linkedOutbox(input) { return this.linkedFlow().outbox(input); }
  async linkedOutboxAck(input) { return this.linkedFlow().outboxAck(input); }
  async createDeviceLogin(input, context) { return this.deviceFlow().create(input, context); }
  async deviceRequest(input, context) { return this.deviceFlow().inspect(input, context); }
  async approveDeviceLogin(input, context) { this.requireCurrentTerms((await this.authorized(context,true)).account);return this.deviceFlow().approve(input, context); }
  async denyDeviceLogin(input, context) { return this.deviceFlow().deny(input, context); }
  async pollDeviceLogin(input, context) { return this.deviceFlow().poll(input, context); }
  async cancelDeviceLogin(input, context) { return this.deviceFlow().cancel(input, context); }
  /** The kind of authority `session` holds right now, for `addedBy` (spike §3.2, §6.4): 'passkey' when a passkey
   * signed it in or stepped it up, 'email' for an email-sign-in session, otherwise the session's own source. */
  sessionKind(session){return session.stepUpCredential?.kind==='passkey'||typeof session.credentialId==='string'?'passkey':session.source==='email'?'email':session.source==='activation'?'setup':session.source??'unknown';}
  /** Recent authentication for adding or verifying an address: a passkey sign-in or step-up within 15 minutes, or (SI-4)
   * an email-sign-in session within 15 minutes on an account that has no passkey. */
  recentForEmail(account,session){const now=this.clock();if(this.authAt(session)+900000>now)return;if(account.credentials.length===0&&session.source==='email'&&Number.isSafeInteger(session.createdAt)&&session.createdAt+900000>now)return;fail('reauthentication_required','Confirm with your passkey before changing your email addresses.');}
  /** Adds an address as `unverified` (or re-sends the link for the unverified one) and mails a session-bound link.
   * Uniform answer (no enumeration): an address another account already verified gets the same response and an entry
   * that can never verify; no mail goes to it. The mail is sent in the background so latency does not depend on it. An
   * unverified entry holds no uniqueness claim and expires after 24 hours. At most one unverified entry: a new address
   * replaces it. */
  async emailStart(input, context) {
    if (!this.mailer) fail('email_unavailable', 'Email delivery is not configured.');
    const { account, session } = await this.authorized(context, true); const revision = account.revision, now = this.clock();
    this.recentForEmail(account, session);
    const email = emailAddress(input.email);
    const confirmed = confirmedEmails(account);
    if (confirmed.some(entry => entry.address === email)) fail('email_already_added', 'This address is already on your account.', 409);
    if (confirmed.length >= MAX_CONFIRMED_EMAILS) fail('email_limit', 'You can keep up to three verified email addresses. Remove one first.', 409);
    if (!await this.rateLimiter.check({ operation: 'email', remoteIP: context.remoteIP, handle: account.handle })) fail('rate_limited');
    migrateEmails(account, now);
    const token = `${account.id}.${this.crypto.random()}`, expiresAt = now + UNVERIFIED_EMAIL_TTL_MS;
    account.emails = [...(account.emails ?? []).filter(entry => entry.state !== 'unverified'), { address: email, state: 'unverified', expiresAt, notices: false, source: 'linked', addedBy: { session: this.sessionKind(session), at: now } }].slice(0, MAX_CONFIRMED_EMAILS + MAX_UNVERIFIED_EMAILS);
    account.emailChallenges = [...(account.emailChallenges ?? []).filter(c => c.purpose !== 'link' && c.expiresAt > now), { purpose: 'link', email, hash: await this.crypto.hash('email', token), sessionHash: session.hash, expiresAt }];
    this.audit(account, 'email-link-requested'); await this.save(account, revision);
    // Tokens only leave through the mail transport, never through API results.
    const claimed = typeof this.repository.findByEmail === 'function' ? await this.repository.findByEmail(email) : null;
    if (!claimed || claimed.id === account.id) this.background(context, () => this.mailer.sendVerification({ email, token, purpose: 'link', issuer: this.config.origin }));
    return { sent: true, account: await this.projectAccount(account) };
  }
  /** Verifies the unverified address with its session-bound link: `unverified → verified`. The first confirmed address
   * becomes the notice address. Fails generically when the link is stale, belongs to another session, or another account
   * verified the address first (the repository's email index refuses a concurrent claim in the same CAS). */
  async emailConfirm(input, context) {
    const { account, session } = await this.authorized(context, true); const revision = account.revision, now = this.clock();
    if (input.confirmed !== true || typeof input.token !== 'string') fail('confirmation_required');
    const hash = await this.crypto.hash('email', input.token);
    const challenge = account.emailChallenges?.find(c => c.purpose === 'link' && secureEqual(c.hash, hash) && secureEqual(c.sessionHash, session.hash) && c.expiresAt > now);
    const entry = challenge ? emailEntry(account, challenge.email, now) : null;
    const invalid = () => fail('invalid_challenge', 'This email confirmation is expired, was replaced, or belongs to another browser session.');
    if (!challenge || entry?.state !== 'unverified') invalid();
    const claimed = typeof this.repository.findByEmail === 'function' ? await this.repository.findByEmail(entry.address) : null;
    if (claimed && claimed.id !== account.id) invalid();
    if (confirmedEmails(account).length >= MAX_CONFIRMED_EMAILS) fail('email_limit', 'You can keep up to three verified email addresses. Remove one first.', 409);
    migrateEmails(account, now);
    const hasNotice = account.emails.some(item => item.state !== 'unverified');
    account.emails = account.emails.map(item => item.address === entry.address && item.state === 'unverified' ? (({ expiresAt, ...rest }) => ({ ...rest, state: 'verified', verifiedAt: now, notices: !hasNotice }))(item) : item);
    account.emailChallenges = (account.emailChallenges ?? []).filter(c => c !== challenge);
    this.securityChanged(account); delete account.noticeWaiver;
    this.audit(account, 'email-linked');
    try { await this.save(account, revision); } catch (error) { if (error?.code === 'conflict') { const fresh = await this.repository.findByEmail?.(entry.address); if (fresh && fresh.id !== account.id) invalid(); } throw error; }
    return { linked: true, account: await this.projectAccount(account) };
  }
  /** Email sign-in, phase 1. The answer is `{sent:true}` for every address (wargame 2026-10-23 #7, #8): after Turnstile a
   * pseudonymized mailbox window and a global window are charged whether or not an account exists; both branches do
   * the same token work; the challenge write and the provider call run in the background on a hit, so latency does not
   * depend on the address, and provider errors never reach the caller. Only a sign-in email of an active account gets a
   * link; the challenge binds (address, signInSince), so turning sign-in off and on again invalidates it. */
  async emailLoginStart(input, context) {
    if (!this.mailer || typeof this.repository.findByEmail !== 'function') fail('email_unavailable', 'Email delivery is not configured.');
    await this.guard('email', input, context); const email = emailAddress(input.email);
    if (!await this.rateLimiter.check({ phase: 'mailbox', operation: 'email-login', remoteIP: context.remoteIP, region: context.region, handle: `mailbox\0${email}` })) fail('rate_limited', 'Please wait before trying again.');
    const account = await this.repository.findByEmail(email);
    const eligible = candidate => candidate?.status === 'active' && signInEmails(candidate).find(entry => entry.address === email);
    const token = `${account?.id ?? this.crypto.id()}.${this.crypto.random()}`, hash = await this.crypto.hash('email', token), expiresAt = this.clock() + 600000;
    if (eligible(account)) this.background(context, async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const current = attempt ? await this.repository.get(account.id) : account, entry = eligible(current); if (!entry) return;
        const revision = current.revision;
        current.emailChallenges = [...(current.emailChallenges || []).filter(c => c.expiresAt > this.clock()).slice(-3), { purpose: 'login', email, signInSince: entry.signInSince, hash, expiresAt }];
        current.revision = revision + 1;
        if (await this.repository.compareAndSwap(current.id, revision, current)) { await this.mailer.sendVerification({ email, token, purpose: 'login', issuer: this.config.origin }); return; }
      }
    });
    return { sent: true };
  }
  async emailLoginConfirm(input, context) {
    this.origin(context); const [id] = tokenParts(input.token); const account = await this.repository.get(id);
    if (input.confirmed !== true) fail('confirmation_required');
    const hash = await this.crypto.hash('email', input.token);
    const challenge = account?.emailChallenges?.find(c => c.purpose === 'login' && secureEqual(c.hash, hash) && c.expiresAt > this.clock());
    const entry = challenge ? signInEmails(account).find(item => item.address === challenge.email) : null;
    if (!account || account.status !== 'active' || !challenge || !entry || challenge.signInSince !== entry.signInSince) fail('unauthorized', 'Email login failed.');
    const revision = account.revision; account.emailChallenges = account.emailChallenges.filter(c => c !== challenge);
    this.interactive(account,'sign-in',context); const result = await this.session(account,{source:'email',emailAddress:entry.address}); await this.save(account, revision); return result;
  }
  /** The address an owner request names: `address` (or the legacy `expectedEmail`), else the notice address. */
  requestedEmail(account,input,now){const named=input?.address??input?.expectedEmail;const address=named===undefined?noticeEmail(account):typeof named==='string'?named:null;const entry=address?emailEntry(account,address,now):null;if(!entry)fail('email_not_linked','This address is not on your account.',409);return entry;}
  /** The removal process for a sign-in email (sign-in and intents spike §6.4, provisional; owner direction 2026-10-28).
   * Implemented: RM-1 (never leave no working method), RM-2 Tier A (a recent sign-in email, under 7 days since sign-in
   * was turned on, undone with a passkey step-up within 5 minutes from a passkey enrolled 7 days or more earlier) and
   * RM-3 (a recent sign-in email whose sign-in an email session turned on, undone from an email-sign-in session under 10
   * minutes old on another established sign-in email). Tier B (an established sign-in email) needs the recovery spike's
   * proof-only file presentation, which does not exist yet: refused with `removal_unavailable` (N6). Returns the
   * authority used ('passkey' or 'email'). */
  signInRemovalAuthority(account,session,entry){
    const now=this.clock(),established=at=>nonNegative(at)&&at<=now&&now-at>=ESTABLISHED_METHOD_AGE_MS;
    if(account.credentials.length+signInEmails(account).filter(item=>item.address!==entry.address).length<1)fail('last_sign_in_method','Add a passkey or turn on another sign-in email first. Your account must keep a way to sign in.',409);
    if(established(entry.signInSince))fail('removal_unavailable','Turning off an established sign-in email needs your recovery file and a waiting period. This is not available yet.',409);
    const passkey=session.stepUpCredential?.kind==='passkey'&&Number.isSafeInteger(session.stepUpAt)&&session.stepUpAt<=now&&session.stepUpAt+300000>now?account.credentials.find(c=>c.id===session.stepUpCredential.id):null;
    if(passkey&&established(passkey.createdAt))return 'passkey';
    if(entry.addedBy?.session==='email'&&session.source==='email'&&Number.isSafeInteger(session.createdAt)&&session.createdAt<=now&&session.createdAt+600000>now&&session.emailAddress!==entry.address&&signInEmails(account).some(item=>item.address===session.emailAddress&&established(item.signInSince)))return 'email';
    fail('removal_proof_required','Confirm with a passkey you have had for at least 7 days to undo this recent change.',403);
  }
  /** RM-9 effects of removing a sign-in method that was `entry`, in the caller's CAS: email-login challenges for it end,
   * sessions that signed in with it end, the security epoch rises (caller), and a notice goes to every channel. */
  async endSignInEmail(account,session,entry){
    account.emailChallenges=(account.emailChallenges??[]).filter(c=>!(c.purpose==='login'&&c.email===entry.address));
    await this.pruneSessions(account,s=>s.source==='email'&&s.emailAddress===entry.address);
    this.authorityEvent(account,'email-changed');this.queueNotice(account,'email-sign-in-removed',await this.sessionID(session));
  }
  /** Turns sign-in on for a verified address (`verified → sign-in`, SI-3) or off (`sign-in → verified`, the removal
   * process). Turning on needs a passkey step-up within 5 minutes, or for an account with no passkey the SI-4 email
   * step-up (an email-sign-in session under 5 minutes old from an existing sign-in email). Every change raises the
   * security epoch and notifies every channel. `address` defaults to the notice address. */
  async configureEmailLogin(input, context) {
    const { account, session } = await this.authorized(context, true); const revision = account.revision, now = this.clock();
    if (!input || typeof input !== 'object' || typeof input.enabled !== 'boolean' || input.address !== undefined && typeof input.address !== 'string') fail('invalid_request', 'Choose whether this email can sign in to this account.');
    if (input.enabled && !confirmedEmails(account).length) fail('verified_email_required', 'Verify an email address before turning on email sign-in.');
    const entry = this.requestedEmail(account, input, now);
    if (entry.state === 'unverified') fail('verified_email_required', 'Verify this address before using it to sign in.', 409);
    if (input.enabled === (entry.state === 'sign-in')) return { emailLoginEnabled: input.enabled, account: await this.projectAccount(account) };
    migrateEmails(account, now);
    const target = account.emails.find(item => item.address === entry.address && item.state !== 'unverified');
    if (input.enabled) {
      const passkey = session.stepUpCredential?.kind === 'passkey' && Number.isSafeInteger(session.stepUpAt) && session.stepUpAt <= now && session.stepUpAt + 300000 > now && account.credentials.some(c => c.id === session.stepUpCredential.id);
      if (!passkey && !this.emailStepUp(account, session)) fail('step_up_required', account.credentials.length ? 'Confirm with your passkey to turn on email sign-in.' : 'Sign in again with one of your sign-in emails to turn on another one.');
      target.state = 'sign-in'; target.signInSince = now; target.addedBy = { session: passkey ? 'passkey' : 'email', at: now };
      this.queueNotice(account, 'email-sign-in-enabled', await this.sessionID(session));
    } else {
      this.signInRemovalAuthority(account, session, target);
      target.state = 'verified'; delete target.signInSince;
      await this.endSignInEmail(account, session, target);
    }
    this.securityChanged(account);
    this.audit(account, input.enabled ? 'email-login-enabled' : 'email-login-disabled');
    await this.save(account, revision); return { emailLoginEnabled: input.enabled, currentSessionRevoked: !account.sessions.includes(session), account: await this.projectAccount(account) };
  }
  /** Chooses the notice address among the verified and sign-in addresses (Q4: one notice address). A change notifies
   * every channel, which includes the previous and the new notice address (review 2026-10-29 M3). Not a security-epoch
   * event (header JSDoc). Needs a passkey sign-in or step-up within 15 minutes: SI-4 does not list it for email
   * sessions, so an email-only account adds a passkey first. */
  async emailNotices(input, context) {
    const { account, session } = await this.recent(context); const revision = account.revision, now = this.clock();
    if (!input || typeof input !== 'object' || Object.keys(input).some(name => name !== 'address') || typeof input.address !== 'string') fail('invalid_request', 'Choose a verified address.');
    const entry = this.requestedEmail(account, input, now);
    if (entry.state === 'unverified') fail('verified_email_required', 'Verify this address before using it for notices.', 409);
    const previous = noticeEntry(account)?.address ?? null;
    migrateEmails(account, now); for (const item of account.emails) item.notices = item.state !== 'unverified' && item.address === entry.address;
    if (previous !== entry.address) this.queueNotice(account, 'notice-email-changed', await this.sessionID(session));
    this.audit(account, 'email-notices-changed'); await this.save(account, revision); return { account: await this.projectAccount(account) };
  }
  /** EMAIL_REMOVAL_ENABLED for this owner through the flags port; any failure (no port, unknown flag) is "off". */
  emailRemovalEnabled(owner) { try { const port = typeof this.flags === 'function' ? this.flags() : this.flags; return port?.for({ subject: { kind: 'account', owner } }).enabled('EMAIL_REMOVAL_ENABLED') === true; } catch { return false; } }
  /** Other notice channels than email (verified, available push), via the account-channels port. */
  async noticeChannels(owner) {
    if (!this.accountChannels) return { ready: false, count: 0 };
    let state; try { state = await this.accountChannels.state(owner); } catch { state = null; }
    if (typeof state?.ready !== 'boolean' || !nonNegative(state.count) || state.ready && state.count < 1) fail('notice_channels_unavailable', 'Your notification devices could not be checked. Try again shortly.', 503);
    return { ready: state.ready, count: state.count };
  }
  /** Wire identity.email-remove (account-deletion-export.md §3), per address (`address`, or the legacy `expectedEmail`;
   * default the notice address). An unverified address is simply dropped. A verified address keeps the DX-6 rules:
   * EMAIL_REMOVAL_ENABLED, step-up (5 min) and CSRF; one CAS removes it, releases its index claim (repository CAS),
   * moves the notice address to another confirmed address, records the notice waiver when no other channel remains,
   * and bumps `security`. A sign-in email additionally goes through the removal process (`signInRemovalAuthority`).
   * Never removes credentials or recovery. */
  async emailRemove(input, context) {
    const { account, session } = await this.authorized(context, true); const revision = account.revision, now = this.clock();
    if (!input || typeof input !== 'object' || Object.keys(input).some(name => !['confirmed', 'waiveNotice', 'expectedEmail', 'address'].includes(name)) || input.waiveNotice !== undefined && typeof input.waiveNotice !== 'boolean') fail('invalid_request', 'Unsupported email removal request.', 400);
    if (input.confirmed !== true) fail('confirmation_required', 'Confirm that you want to remove your email.', 400);
    if (input.address !== undefined && input.expectedEmail !== undefined && input.address !== input.expectedEmail) fail('email_changed', 'Your email changed. Reload and try again.', 409);
    const named = input.address ?? input.expectedEmail;
    if (named === undefined && !confirmedEmails(account).length) { if (!this.emailRemovalEnabled(account.id)) fail('email_removal_unavailable', 'Email removal is not available.', 404); fail('email_not_linked', 'This account has no verified email.', 409); }
    let entry; try { entry = this.requestedEmail(account, input, now); } catch (error) { if (input.expectedEmail !== undefined && error?.code === 'email_not_linked' && this.emailRemovalEnabled(account.id)) fail('email_changed', 'Your email changed. Reload and try again.', 409); throw error; }
    if (entry.state === 'unverified') {
      migrateEmails(account, now); account.emails = account.emails.filter(item => !(item.address === entry.address && item.state === 'unverified'));
      account.emailChallenges = (account.emailChallenges ?? []).filter(c => !(c.purpose === 'link' && c.email === entry.address));
      this.audit(account, 'email-unverified-removed'); await this.save(account, revision);
      return { removed: true, noticeWaived: false, notified: { email: false, push: false }, account: await this.projectAccount(account) };
    }
    if (!this.emailRemovalEnabled(account.id)) fail('email_removal_unavailable', 'Email removal is not available.', 404);
    this.requireStepUp(session, 300000);
    if (entry.state === 'sign-in') this.signInRemovalAuthority(account, session, entry);
    const others = confirmedEmails(account).filter(item => item.address !== entry.address);
    const channels = others.length ? { ready: true, count: others.length } : await this.noticeChannels(account.id), waived = !channels.ready;
    if (waived && input.waiveNotice !== true) fail('last_notice_channel', 'Email is your only notice channel. Enable notifications on a device first, or confirm that you accept in-app notices only.', 409);
    // The waiver is consent under the current terms; it is recorded only when no other channel exists.
    if (waived) { this.requireCurrentTerms(account); account.noticeWaiver = { at: now, termsVersion: this.config.termsVersion }; }
    this.rememberPreviousEmail(account, [entry]); this.authorityEvent(account, 'email-changed');
    migrateEmails(account, now); const wasNotice = account.emails.find(item => item.address === entry.address)?.notices === true;
    account.emails = account.emails.filter(item => item.address !== entry.address);
    if (wasNotice) { const next = account.emails.find(item => item.state !== 'unverified'); for (const item of account.emails) item.notices = item === next; }
    account.emailChallenges = (account.emailChallenges ?? []).filter(c => c.email !== entry.address);
    if (entry.state === 'sign-in') await this.endSignInEmail(account, session, entry);
    this.audit(account, 'email-removed'); this.securityChanged(account);
    await this.save(account, revision);
    // Notices are best effort after commit; acceptance is not delivery.
    const notified = { email: false, push: false };
    try { if (typeof this.mailer?.sendSecurityAlert === 'function') { await this.mailer.sendSecurityAlert({ email: entry.address, type: 'email-removed', owner: account.id }); notified.email = true; } } catch {}
    try { if (typeof this.accountChannels?.notify === 'function' && (channels.ready || others.length)) notified.push = (await this.accountChannels.notify(account.id, 'email-removed'))?.accepted > 0; } catch {}
    return { removed: true, noticeWaived: waived, notified, currentSessionRevoked: !account.sessions.includes(session), account: await this.projectAccount(account) };
  }
  async logoutSaved(input,context){
    this.origin(context);const {account,session}=await this.authorized(context,false,{closure:true});const revision=account.revision;await this.pruneSessions(account,s=>s===session);this.audit(account,'session-closed');await this.save(account,revision);return {loggedOut:true};
  }
  async logout(input, context) {
    const { account, session } = await this.authorized(context, true, { closure: true }); const revision = account.revision;
    await this.pruneSessions(account,s=>s===session); this.audit(account, 'session-closed');
    await this.save(account, revision); return { loggedOut: true };
  }
}
