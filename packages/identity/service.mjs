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
 *   verified email added or changed (setupEmailConfirm, emailConfirm, only when the address differs),
 *   verified email removed and the email-notice waiver (emailRemove), email sign-in enabled (configureEmailLogin
 *   false→true), credential added (registerPasskey, credentialFinish) or removed (removePasskey), password set
 *   (setPendingPassword; there is no other password-change path), recovery-file recovery (recover: start and resume)
 *   and recovery-file rotation (downloadRecovery, which every setup and recovery completion requires), an active-account
 *   reissue commit (reissueRecoveryConfirm) and its cancellation (reissueRecoveryCancel*, which also raises
 *   `federationGeneration` so no OAuth grant survives the restored credential).
 * Never bumped by: sessions (create, use, close, revoke), step-up, terms acceptance, renames, passkey counter
 *   updates, email-link or email-login requests, disabling email sign-in, handle claims. These are the cheap,
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
 * Recovery credential and key binding (identity portability P14, P15; PORT-10):
 *   recoveryIssuedAt       identity clock (ms) at which the CURRENT reset credential (`recoveryHash`) was issued,
 *                          written in the same CAS as the hash. P14's 7-day age rule reads it through
 *                          `recoveryCredential(account)`; a record without it has no provable age (fails closed).
 *   recoveryKeyKid         the signing kid the current v2 file carries; `recoveryResumeKeyKid` the kid of the file
 *                          whose credential resumes an in-progress recovery. Both are bound in the same CAS as the
 *                          credential they describe and removed with it.
 *   downloadRecovery       rotates the signing key with keys.mjs continuity before issuing whenever an earlier file
 *                          may hold the current key (a re-download during setup, the replacement file after a
 *                          recovery, a future active-account reissue), so a superseded file holds a retired key that
 *                          signs nothing honoured. The first file of a new identity adopts the existing signer. A full
 *                          history of referenced keys issues without rotating; the audit records which happened.
 *   reissueRecoveryBegin / reissueRecoveryConfirm   the active-account reissue (recovery-identity spec "Active-account
 *                          reissue", provisional). Begin needs a fresh step-up with a credential enrolled >= 7 days
 *                          earlier (`session.stepUpCredential`, `passwordSetAt`), or an armed forced marker
 *                          `recoveryReissue` = {reason:'elevated-abort'|'transfer-in', at, kid?}; it rotates through the
 *                          account single writer (identityBackup.reissue) and stages `recoveryStaged` = {hash, kid,
 *                          encryptionKid, sessionId, preparedAt, expiresAt, base, forced?}. Confirm runs the account
 *                          gate (identityBackup.reissueCommit: refuses deletion/moved/contested and a staged file whose
 *                          keys no longer restore, cancels a live transfer-out)
 *                          and then makes the staged credential current in one CAS with a `security` bump, opening the
 *                          7-day cooling-off window `recoveryPrevious` (wargame 2026-10-23 #1, provisional): the new file
 *                          cannot start a recovery and the previous one can only cancel (`pendingReissue`). Begin needs a
 *                          passkey step-up whenever the account has a passkey.
 *   reissueRecoveryCancel / ...CancelEmail / ...CancelFile   cancel the window from a session created before the reissue
 *                          began, the emailed link, or the previous file (cancelReissue).
 *
 * Email removal resources (constructor, both optional, both fail closed):
 *   flags            flags port {for(ctx)} or a thunk returning the current one; EMAIL_REMOVAL_ENABLED is read with
 *                    for({subject:{kind:'account', owner}}).enabled(). Missing port or unknown flag ⇒ disabled.
 *   accountChannels  {state(owner) → {ready:boolean, count:number, revision:string}, notify?(owner, event)}; see
 *                    packages/runtime/account-channels.mjs. Missing ⇒ no other notice channel.
 */
/** The current recovery credential's issuance facts for P14, or null when there is none that could start a recovery
 * now (not active, no credential, or a legacy record without a recorded issuance time). Pure. */
export function recoveryCredential(account){
  if(account?.status!=='active'||typeof account.recoveryHash!=='string'||!account.recoveryHash||!nonNegative(account.recoveryIssuedAt))return null;
  return Object.freeze({issuedAt:account.recoveryIssuedAt,version:account.recoveryBackupVersion===2?2:1,keyKid:typeof account.recoveryKeyKid==='string'?account.recoveryKeyKid:null});
}
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
/** The live cooling-off record `account.recoveryPrevious` = {hash, issuedAt, kid, version, marker, reissuedAt,
 * preparedAt, until, newKid, cancelHash, credential}, or null when no reissue is pending at `now`. Pure. */
export function pendingReissue(account, now){const p=account?.recoveryPrevious;return p&&typeof p==='object'&&Number.isSafeInteger(p.until)&&p.until>now&&Number.isSafeInteger(p.reissuedAt)&&Number.isSafeInteger(p.preparedAt)&&typeof p.newKid==='string'?p:null;}
/** The step-up credential as the P17 contest window compares it: a passkey id, 'password', or null. */
export const stepUpCredentialId = session => session?.stepUpCredential?.kind==='passkey'&&typeof session.stepUpCredential.id==='string'?session.stepUpCredential.id:session?.stepUpCredential?.kind==='password'?'password':null;
const LOGIN_TOKEN=/^pl1\.([A-Za-z0-9_-]{1,800})\.([A-Za-z0-9_-]{43})$/;
/** The armed forced-reissue marker `account.recoveryReissue` = {reason, at, kid?}, or null. Pure. */
export function reissueMarker(account){const marker=account?.recoveryReissue;return marker&&typeof marker==='object'&&RECOVERY_REISSUE_REASONS.includes(marker.reason)&&Number.isSafeInteger(marker.at)&&marker.at>=0?marker:null;}
const stagedReissue=value=>value&&typeof value==='object'&&typeof value.hash==='string'&&typeof value.kid==='string'&&typeof value.encryptionKid==='string'&&typeof value.sessionId==='string'&&Number.isSafeInteger(value.expiresAt)&&(value.base===null||typeof value.base==='string')?value:null;
/** Account security notices sent to every channel (review 2026-10-23 R1(ii)). */
export const ACCOUNT_SECURITY_NOTICES = Object.freeze(['passkey-added','passkey-removed','email-changed','sessions-revoked','sessions-evicted','password-changed']);
export const SECURITY_EVENTS = Object.freeze(['setup-email-verified','email-linked','email-removed','email-login-enabled','passkey-registered','passkey-added','passkey-removed','password-configured','recovery-file-issued','recovery-file-reissued','recovery-reissue-cancelled','account-recovery-started','recovery-setup-resumed']);
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
export function identitySecurityPort(repository) {
  if (typeof repository?.get !== 'function') throw new TypeError('An identity repository is required.');
  return async owner => { const account = await repository.get(owner); return account && account.id === owner && account.status !== 'deleted' ? securityState(account) : null; };
}
const publicAccount = (a,badges=[]) => ({ id: a.id, handle: a.handle, status: a.status, createdAt: a.createdAt,
  badges,termsVersion: a.termsVersion, hasPassword: Boolean(a.passwordHash), passkeyCount: a.credentials.length,
  recoveryConfigured: Boolean(a.recoveryHash), paidHandle:a.paidHandle||null, aliases:[a.handle,...onboardingAlias(a)?[onboardingAlias(a)]:[],...a.paidHandle?[a.paidHandle]:[],...systemBadge(a)?[a.systemIdentity.handle]:[]],...systemBadge(a)?{systemBadge:systemBadge(a)}:{}, verifiedEmail: a.verifiedEmail || null, emailLoginEnabled: a.emailLoginEnabled === true, lastActiveAt: a.lastActiveAt });
function emailAddress(value) {
  if (typeof value !== 'string' || value.length > 254 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+$/.test(value)) fail('invalid_email', 'Enter an ordinary email address.');
  const [local, domain] = value.split('@');
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..') || !domain.includes('.') || domain.split('.').some(part => !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(part))) fail('invalid_email');
  return `${local}@${domain.toLowerCase()}`;
}
function handle(value){try{return normalizeHandle(value);}catch{fail('invalid_handle','Enter your complete account handle.');}}

function password(value) {
  if (typeof value !== 'string' || [...value].length < 15 || [...value].length > 128 || new TextEncoder().encode(value).length > 512) fail('invalid_password', 'Use a password of 15–128 characters.');
  return value;
}
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
  constructor({ repository, deviceRequests, linkedApprovals = deviceRequests, linkedLimits, linkedPollLimits, approvalNotices, crypto, clock = () => Date.now(), turnstile, rateLimiter, webauthn, passwordHasher, mailer, identityBackup, paidHandleEligibility, setupBilling, systemBootstrap, onboarding, resolveIdentityBadges, pushTransport, reservedHandle, flags, accountChannels, closure, severConnections, organizationSignals, config }) {
    if (!repository || !turnstile || !rateLimiter || !webauthn || !passwordHasher || !config?.termsVersion) throw new TypeError('Identity resources and terms version are required');
    const origin = new URL(config.origin);
    if (origin.origin !== config.origin || origin.hostname !== config.rpID || (origin.protocol !== 'https:' && !(config.allowInsecureLocalhost && origin.protocol === 'http:' && origin.hostname === 'localhost'))) throw new TypeError('Exact RP origin is required');
    this.repository = repository; this.crypto = new IdentityCrypto(crypto); this.clock = clock;
    this.turnstile = turnstile; this.rateLimiter = rateLimiter; this.webauthn = webauthn; this.passwordHasher = passwordHasher;
    this.pushTransport=pushTransport;this.mailer = mailer; this.identityBackup = identityBackup; this.paidHandleEligibility=paidHandleEligibility;
    // `linkedApprovals` is the renamed `deviceRequests` repository (create/get/findByUserCode/compareAndSwap).
    // `linkedLimits` is the durable window port for budgets; `linkedPollLimits` the non-durable poll limiter.
    this.deviceRequests = this.linkedApprovals = linkedApprovals; this.linkedLimits = linkedLimits ?? new MemoryLinkedLimits(clock); this.linkedPollLimits = linkedPollLimits ?? new MemoryLinkedLimits(clock); this.approvalNotices = approvalNotices;
    this.setupBilling = setupBilling;this.systemBootstrap=systemBootstrap;this.onboarding=onboarding;this.resolveIdentityBadges=resolveIdentityBadges??defaultBadgeResolver;this.reservedHandle=reservedHandle;this.flags=flags;this.accountChannels=accountChannels;this.closure=closure;this.severConnections=severConnections;this.organizationSignals=organizationSignals;
    this.config = { rpName: '3sln.me', sessionTtlMs: 86400000, pendingTtlMs: 1800000, challengeTtlMs: 300000, ...config };
    if (!(this.config.sessionTtlMs > 0 && this.config.sessionTtlMs <= 86400000)) throw new TypeError('Sessions must expire within 24 hours');
  }
  origin(context) { if (context?.origin !== this.config.origin) fail('csrf', 'Use the account website to complete this request.'); }
  /** ORG-12b break-glass liveness (organizations design §12d.3): an interactive sign-in (password, passkey, email) or a
   * step-up. `lastInteractiveAt` rides the caller's own CAS (no extra write); the owner hook `organizationSignals.liveness`
   * runs fire-and-forget and returns nothing to identity. Background session refreshes never call this. */
  interactive(account,kind,context){const at=this.clock();account.lastInteractiveAt=at;if(account.status==='active'&&typeof this.organizationSignals?.liveness==='function'){const owner=account.id;this.background(context,()=>this.organizationSignals.liveness(owner,{kind,at}));}}
  async projectAccount(account){
    const aliases=[account.handle,...onboardingAlias(account)?[onboardingAlias(account)]:[],...account.paidHandle?[account.paidHandle]:[],...systemBadge(account)?[account.systemIdentity.handle]:[]],identity=Object.freeze({id:account.id,handle:account.handle,status:account.status,aliases:Object.freeze(aliases),badgeIds:Object.freeze(Array.isArray(account.badgeIds)?[...account.badgeIds]:[])});let ids,timer;
    try{ids=await Promise.race([Promise.resolve().then(()=>this.resolveIdentityBadges(identity)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Badge resolution timed out')),500);})]);}catch{ids=[];}finally{clearTimeout(timer);}
    return publicAccount(account,projectAccountBadges(account,this.config,ids));
  }
  async guard(operation, input, context) {
    this.origin(context);
    // Wargame 2026-10-23 #3: only per-network windows run before Turnstile. Handle-keyed windows never see CAPTCHA-less
    // traffic; sign-in consults them after this check (loginPassword) and charges only completed, failed checks.
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
    this.collectDueNotices(account);
    account.revision = revision + 1;
    if (!await this.repository.compareAndSwap(account.id, revision, account)) { this.queuedNotices?.delete(account); fail('conflict', 'The account changed; start this step again.'); }
    await this.flushNotices(account);
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
    delete account.setupEmailChallenge;delete account.setupPushChallenge;delete account.setupPushVerified;delete account.pendingCredentialAt;delete account.pendingPasswordSets;delete account.recoveryDownloads;
    const value = `${account.id}.${this.crypto.random()}`;
    account.pendingHash = await this.crypto.hash('pending', value); account.pendingExpiresAt = this.clock() + this.config.pendingTtlMs;
    return value;
  }
  async session(account, { label, credentialId, source = 'credential', activationCredentialAt, parentSessionId, expiresAt: cap = Infinity, scope } = {}) {
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
      hash: await this.crypto.hash('session', sessionToken), csrfToken, expiresAt, createdAt: this.clock(), lastUsedAt: this.clock() }];
    account.lastActiveAt = this.clock(); this.audit(account, 'session-created');
    return { account: await this.projectAccount(account), sessionToken, csrfToken, expiresAt, sessionContext:account.sessions.at(-1).id };
  }
  async authorized(context, mutation = false, { closure = false } = {}) {
    if (mutation) this.origin(context);
    const [id] = tokenParts(context?.sessionToken); const account = await this.repository.get(id);
    const hash = await this.crypto.hash('session', context.sessionToken);
    const session = account?.sessions.find(s => secureEqual(s.hash, hash) && s.expiresAt > this.clock());
    if (!account || !session || !interactiveIdentity(account)) fail('unauthorized', 'Sign in to continue.');
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
    pruneLineage(account,now);if(explicit.size)revokeLineage(account,explicit,now);
  }
  async recent(context) {
    const result = await this.authorized(context, true);
    if (this.authAt(result.session) + 900000 <= this.clock()) fail('reauthentication_required', 'Confirm your password or passkey before changing account access.');
    return result;
  }
  async sessionID(session) { return session.id || this.crypto.hash('session-public-id', session.hash); }
  // Privileged consoles need a per-session step-up, not merely a young session.
  async privileged(context,windowMs=300000){const {account,session}=await this.authorized(context,true,{closure:context?.allowClosure===true});this.requireStepUp(session,windowMs);return {account,session,sessionId:await this.sessionID(session)};}
  requireStepUp(session,windowMs=300000){if(!Number.isSafeInteger(session.stepUpAt)||session.stepUpAt>this.clock()||session.stepUpAt+windowMs<=this.clock())fail('step_up_required','Confirm your password or passkey to continue.');}
  async stepUpBegin(input,context){const {account,session}=await this.authorized(context,true,{closure:true}),revision=account.revision;if(!account.credentials.length)return {password:Boolean(account.passwordHash),passkey:false};const authenticationOptions=await this.webauthn.authenticationOptions({config:this.config});account.challenges=[...account.challenges.filter(c=>c.expiresAt>this.clock()&&c.purpose!=='step-up').slice(-4),{purpose:'step-up',value:authenticationOptions.challenge,sessionHash:session.hash,expiresAt:this.clock()+this.config.challengeTtlMs}];await this.save(account,revision);return {password:Boolean(account.passwordHash),passkey:true,authenticationOptions};}
  async stepUp(input,context){
    const {account,session}=await this.authorized(context,true,{closure:true}),revision=account.revision;if(!await this.rateLimiter.check({operation:'step-up',remoteIP:context.remoteIP,handle:account.handle}))fail('rate_limited','Please wait before trying again.');
    let used;
    if(input.method==='password'){password(input.password);if(!account.passwordHash||!await this.passwordHasher.verify(input.password,account.passwordHash))fail('unauthorized','Authentication failed.');used={kind:'password'};}
    else if(input.method==='passkey'){const challenge=account.challenges.find(c=>c.purpose==='step-up'&&secureEqual(c.sessionHash,session.hash)&&c.expiresAt>this.clock()),credential=account.credentials.find(c=>c.id===input.response?.id);if(!challenge||!credential)fail('unauthorized','Authentication failed.');let verified;try{verified=await this.webauthn.verifyAuthentication({response:input.response,challenge:challenge.value,credential,account,config:this.config});}catch{fail('unauthorized','Authentication failed.');}credential.counter=verified.counter;credential.backedUp=verified.backedUp;account.challenges=account.challenges.filter(c=>c!==challenge);used={kind:'passkey',id:credential.id};}
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
    if (!['passkey', 'password'].includes(input.method)) fail('invalid_method');
    const selectedPassword = input.method === 'password' ? password(input.password) : null;
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
      termsAcceptedAt: this.clock(), ...age, security: { epoch: 0, changedAt: this.clock() }, credentials: [], sessions: [], challenges: [], audit: [], recoveryHash: null, emailLoginEnabled: false,
      passwordHash: selectedPassword ? await this.passwordHasher.hash(selectedPassword) : null, ...selectedPassword ? { passwordSetAt: this.clock() } : {} };
    if(this.config.requireReachability===true){if(!context.setupBinding)fail('unauthorized','Start setup in the account browser.');account.setupBindingHash=await this.crypto.hash('setup-binding',context.setupBinding);}
    const pendingToken = await this.newPending(account,context);if(selectedPassword)await this.verifyPendingPassword(account,selectedPassword);
    let registrationOptions;
    if (input.method === 'passkey') {
      registrationOptions = await this.webauthn.registrationOptions({ account, config: this.config });
      account.challenges.push({ purpose: 'register', value: registrationOptions.challenge, expiresAt: this.clock() + this.config.challengeTtlMs });
    }
    this.audit(account, 'signup-pending');
    if (!await this.repository.create(account)) fail('handle_unavailable', 'Choose another account handle.');
    return { pendingToken, account: await this.projectAccount(account), registrationOptions, readyForRecovery: input.method === 'password',signupPlan,paymentRequired:signupPlan!=='free' };
  }
  async inspectOnboarding(input,context){this.origin(context);if(Object.keys(input).length!==1||typeof input.onboardingToken!=='string')fail('invalid_onboarding_invitation');if(!this.onboarding)fail('onboarding_unavailable');return this.onboarding.inspect(input.onboardingToken);}
  async issueOnboarding(input,context){this.origin(context);if(Object.keys(input).length!==2||typeof input.onboardingToken!=='string'||typeof input.issuanceProof!=='string')fail('invalid_onboarding_issuance');if(!this.onboarding)fail('onboarding_unavailable');return this.onboarding.issue(input.onboardingToken,input.issuanceProof);}
  async claimOnboarding(input,context){
    const age=this.ageAttestation(input,context);await this.guard('onboarding',input,context);if(!this.onboarding)fail('onboarding_unavailable','Account onboarding is not configured.');if(!context.setupBinding)fail('setup_binding_required','Prepare account onboarding in this browser before continuing.');
    if(Object.keys(input).some(name=>!['onboardingToken','name','method','password','termsAccepted','termsVersion','ageConfirmed','turnstileToken'].includes(name)))fail('invalid_onboarding_request');
    if(input.termsAccepted!==true||input.termsVersion!==this.config.termsVersion)fail('terms_required','Agree to the current account terms.');if(!['passkey','password'].includes(input.method))fail('invalid_method');const selectedPassword=input.method==='password'?password(input.password):null;
    const binding=await this.crypto.hash('onboarding-setup-browser',context.setupBinding),prepared=await this.onboarding.prepare(input.onboardingToken,input.name,binding),{claims,digest,item,marker}=prepared,previous=await this.repository.get(item.owner);
    if(previous){if(previous.assignmentId!==item.assignmentId||!sameOnboardingIdentity(previous.onboardingIdentity,marker))fail('onboarding_conflict','Onboarding setup needs operator reconciliation.');await this.onboarding.finish(item,digest,binding);fail('onboarding_invitation_consumed','Setup already started for this name. Sign in with its credential, or ask the host operator for help.');}
    let canonical=prepared.reservation.canonical;if(!canonical){const allocated=await this.repository.allocateFreeHandle(undefined,item.owner,item.assignmentId),reservation=await this.onboarding.canonical(item,digest,binding,allocated);if(!reservation?.canonical)fail('onboarding_conflict','Onboarding setup needs operator reconciliation.');canonical=reservation.canonical;}
    const account={id:item.owner,assignmentId:item.assignmentId,nameAssignmentId:item.assignmentId,revision:0,handle:canonical,status:'pending',onboardingIdentity:marker,badgeIds:[...item.badgeIds],admission:{version:1,kind:'operator',plan:'free'},createdAt:this.clock(),lastActiveAt:this.clock(),termsVersion:this.config.termsVersion,termsAcceptedAt:this.clock(),...age,security:{epoch:0,changedAt:this.clock()},credentials:[],sessions:[],challenges:[],audit:[],recoveryHash:null,emailLoginEnabled:false,passwordHash:selectedPassword?await this.passwordHasher.hash(selectedPassword):null};
    const pendingToken=await this.newPending(account,context);if(selectedPassword)await this.verifyPendingPassword(account,selectedPassword);let registrationOptions;if(input.method==='passkey'){registrationOptions=await this.webauthn.registrationOptions({account,config:this.config});account.challenges.push({purpose:'register',value:registrationOptions.challenge,expiresAt:this.clock()+this.config.challengeTtlMs});}
    if(claims.expiresAt<=this.clock())fail('invalid_onboarding_invitation','This onboarding invitation expired before account creation.');this.audit(account,'operator-onboarding-pending');if(!await this.repository.create(account))fail('onboarding_conflict','Setup already started for this name. Sign in with its credential or ask the operator to reconcile it.');if(!await this.onboarding.finish(item,digest,binding))fail('onboarding_conflict','Onboarding setup needs operator reconciliation.');return {pendingToken,account:await this.projectAccount(account),registrationOptions,readyForRecovery:input.method==='password',signupPlan:'free',paymentRequired:false};
  }
  async bootstrapSystem(input,context){
    const age=this.ageAttestation(input,context,{bootstrap:true});await this.guard('system-bootstrap',input,context);
    if(!this.systemBootstrap||!this.repository.reserveSystemIdentity)fail('system_bootstrap_unavailable','System setup is not configured.');
    if(!context.setupBinding)fail('setup_binding_required','Prepare system setup in this browser before continuing.');
    if(input.termsAccepted!==true||input.termsVersion!==this.config.termsVersion)fail('terms_required','Agree to the current account terms.');
    if(!['passkey','password'].includes(input.method))fail('invalid_method');const selectedPassword=input.method==='password'?password(input.password):null;
    const binding=await this.crypto.hash('system-setup-browser',context.setupBinding),prepared=await this.systemBootstrap.prepare(input.bootstrapToken,binding),{claims,digest}=prepared,marker=systemMarker(claims,digest);
    const previous=await this.repository.get(claims.owner);
    if(previous){if(previous.assignmentId!==claims.assignmentId||!sameSystemIdentity(previous.systemIdentity,marker))fail('system_bootstrap_conflict','System setup needs operator reconciliation.');await this.systemBootstrap.finish(claims,digest,binding);fail('system_invitation_consumed','This invitation was already used. Sign in with the configured credential, or ask the operator to repair incomplete setup.');}
    let canonical=prepared.reservation.canonical;if(!canonical){const allocated=await this.repository.allocateFreeHandle(undefined,claims.owner,claims.assignmentId),reservation=await this.systemBootstrap.canonical(claims,digest,binding,allocated);if(!reservation?.canonical)fail('system_bootstrap_conflict','System setup needs operator reconciliation.');canonical=reservation.canonical;}
    const account={id:claims.owner,assignmentId:claims.assignmentId,nameAssignmentId:claims.assignmentId,revision:0,handle:canonical,status:'pending',systemIdentity:marker,badgeIds:configuredBadgeIDs(this.config).includes('system')?['system']:[],admission:{version:1,kind:'system',plan:'free',initialSystemActivationRequired:true},createdAt:this.clock(),lastActiveAt:this.clock(),termsVersion:this.config.termsVersion,termsAcceptedAt:this.clock(),...age,security:{epoch:0,changedAt:this.clock()},credentials:[],sessions:[],challenges:[],audit:[],recoveryHash:null,emailLoginEnabled:false,passwordHash:selectedPassword?await this.passwordHasher.hash(selectedPassword):null};
    const pendingToken=await this.newPending(account,context);if(selectedPassword)await this.verifyPendingPassword(account,selectedPassword);let registrationOptions;if(input.method==='passkey'){registrationOptions=await this.webauthn.registrationOptions({account,config:this.config});account.challenges.push({purpose:'register',value:registrationOptions.challenge,expiresAt:this.clock()+this.config.challengeTtlMs});}
    if(claims.expiresAt<=this.clock())fail('invalid_system_invitation','This system invitation expired before account creation.');
    this.audit(account,'system-bootstrap-pending');if(!await this.repository.create(account))fail('system_bootstrap_conflict','System setup was already started. Sign in with the configured credential or ask the operator to reconcile it.');
    if(!await this.systemBootstrap.finish(claims,digest,binding))fail('system_bootstrap_conflict','System setup needs operator reconciliation.');
    return {pendingToken,account:await this.projectAccount(account),registrationOptions,readyForRecovery:input.method==='password',signupPlan:'free',paymentRequired:false};
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
    account.pendingCredentialAt=this.clock();account.credentials.push({ ...credential, label: safeLabel(input.label, 'Passkey'), createdAt: this.clock() }); account.challenges = []; this.audit(account, 'passkey-registered'); this.securityChanged(account);
    await this.save(account, revision); return { readyForRecovery: true };
  }
  // The hash was computed from this very value a moment earlier; re-verifying it bought only KDF work (wargame #11).
  async verifyPendingPassword(account){account.pendingCredentialAt=this.clock();}
  async setPendingPassword(input, context) {
    this.origin(context); const account = await this.pending(input.pendingToken,context); const revision = account.revision; password(input.password);
    // Wargame 2026-10-23 #11: a pending token buys at most 5 password sets, each behind the network and per-account
    // windows, all checked before the KDF runs.
    if(!Number.isSafeInteger(account.pendingPasswordSets??0)||(account.pendingPasswordSets??0)>=5)fail('rate_limited','Please wait before trying again.');
    if(!await this.rateLimiter.check({operation:'pending-password',remoteIP:context.remoteIP,region:context.region,handle:account.id}))fail('rate_limited','Please wait before trying again.');
    account.pendingPasswordSets=(account.pendingPasswordSets??0)+1;
    account.passwordHash = await this.passwordHasher.hash(input.password);account.passwordSetAt=this.clock();await this.verifyPendingPassword(account);
    this.audit(account, 'password-configured'); this.securityChanged(account); if (account.status === 'recovering') this.queueNotice(account, 'password-changed', 'recovery'); await this.save(account, revision);
    return { readyForRecovery: true };
  }
  async downloadRecovery(input, context) {
    this.origin(context); const account = await this.pending(input.pendingToken,context); const revision = account.revision;
    if (!account.passwordHash && !account.credentials.length) fail('credential_required', 'Set up your passkey or password first.');
    // Each issuance after the first rotates the signing key (P15), so downloads are budgeted: at most 5 per setup token
    // and the network/per-account windows (wargame 2026-10-23: unbounded rotation churn).
    if(!Number.isSafeInteger(account.recoveryDownloads??0)||(account.recoveryDownloads??0)>=5)fail('rate_limited','Please wait before trying again.');
    if(!await this.rateLimiter.check({operation:'recovery-download',remoteIP:context.remoteIP,region:context.region,handle:account.id}))fail('rate_limited','Please wait before trying again.');
    account.recoveryDownloads=(account.recoveryDownloads??0)+1;
    const recoveryToken = `${account.id}.${this.crypto.random()}`;
    // P15: any earlier file may hold the current signing key, so this issuance rotates first. `bound` are the kids the
    // record still binds to a credential; a legacy record with an earlier file but no bound kid always rotates.
    const bound=[account.recoveryKeyKid,account.recoveryResumeKeyKid].filter(kid=>typeof kid==='string'&&kid),earlier=Boolean(account.recoveryHash||account.recoveryResumeHash||nonNegative(account.recoveryIssuedAt));
    account.recoveryHash = await this.crypto.hash('recovery', recoveryToken); account.recoveryIssuedAt = this.clock();
    let backup;
    if(this.identityBackup){
      account.nameAssignmentId ||= this.crypto.id();
      const issued=await this.identityBackup.issue(account,recoveryToken,{rotation:earlier?bound.length?{rotateIf:[...new Set(bound)]}:{always:true}:null,keep:[...new Set(bound)]});
      // A port that predates PORT-10 resolves the bare file and cannot rotate.
      const rotation=issued?.backup?issued.rotation:null;backup=issued?.backup??issued;
      account.recoveryBackupVersion=2;account.recoveryKeyKid=backup.keychain.signing.kid;
      if(rotation?.rotated)this.audit(account,'recovery-key-rotated');else if(rotation?.skipped)this.audit(account,'recovery-key-rotation-skipped');else if(earlier&&!rotation?.requested)this.audit(account,'recovery-key-rotation-unavailable');
    }
    this.audit(account, 'recovery-file-issued'); this.securityChanged(account); await this.save(account, revision);
    if(backup)return {fileName:`3sln-recovery-${account.id}.json`,content:JSON.stringify(backup),handle:account.handle,recoveryToken};
    return { fileName: `3sln-recovery-${account.handle}.json`, content: JSON.stringify({ version: 1,
      issuer: this.config.origin, handle: account.handle, recoveryToken,
      warning: 'Keep this file private and backed up. It is the only way to recover this account without a verified email or phone. It starts one recovery transaction and can resume that transaction until replacement setup is confirmed.' }, null, 2), recoveryToken };
  }
  /** The owner's recovery-file status for the console. Hashes, kids and tokens never leave the record. */
  recoveryView(account,session){
    const credential=recoveryCredential(account),marker=reissueMarker(account),pending=pendingReissue(account,this.clock());
    return {issuedAt:credential?.issuedAt??null,version:credential?.version??null,transferEligibleAt:credential?.version===2?credential.issuedAt+RECOVERY_CREDENTIAL_AGE_MS:null,reissueRequired:marker?.reason??null,reissueAvailable:typeof this.identityBackup?.reissue==='function'&&typeof this.identityBackup?.reissueCommit==='function',
      // The cooling-off window of a committed reissue: the new file restores from `usableAt`; until then a session,
      // device or email that predates the reissue (or the previous file) can cancel it.
      pendingReissue:pending?{reissuedAt:pending.reissuedAt,usableAt:pending.until,previousRestorable:typeof pending.hash==='string'&&pending.hash.length>0,previousFileCanCancel:typeof pending.hash==='string'&&pending.hash.length>0&&pending.fileLocked!==true,cancellable:Boolean(session)&&Number.isSafeInteger(session.createdAt)&&session.createdAt<pending.preparedAt}:null};
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
   * the 30 days before the begin. Otherwise the password branch applies and the previous file can cancel. */
  fileProofReissue(account,credential,at=this.clock()){
    if(credential?.kind!=='passkey'||typeof account.recoveryHash!=='string'||!account.recoveryHash)return false;
    const passkey=account.credentials.find(c=>c.id===credential.id);
    if(!passkey||!nonNegative(passkey.createdAt)||!nonNegative(account.recoveryIssuedAt)||passkey.createdAt>=account.recoveryIssuedAt)return false;
    // Review 2026-10-23 V1: ANY channel-removing event (email change or removal, other-session revocation, session-cap
    // eviction, passkey removal) in the lookback before `at` (the begin) disqualifies, whatever its order.
    const latest=Math.max(nonNegative(account.lastChannelRemovalAt)?account.lastChannelRemovalAt:0,...(Array.isArray(account.authorityEvents)?account.authorityEvents:[]).map(entry=>nonNegative(entry?.at)?entry.at:0));
    return !(latest>at-SECURITY_LOOKBACK_MS);
  }
  rememberPreviousEmail(account){
    const now=this.clock(),kept=(Array.isArray(account.previousEmails)?account.previousEmails:[]).filter(entry=>typeof entry?.email==='string'&&nonNegative(entry.verifiedAt)&&nonNegative(entry.replacedAt)&&entry.replacedAt>now-SECURITY_RETENTION_MS);
    // V2 audit: never drop a retained channel to make room (earliest- or newest-wins could both be gamed); refuse more
    // email changes instead until one ages out.
    if(typeof account.verifiedEmail==='string'&&nonNegative(account.emailVerifiedAt)&&!kept.some(entry=>entry.email===account.verifiedEmail)){if(kept.length>=8)throw Object.assign(new IdentityFault('email_change_limited','This account changed its email too many times recently. Try again later.'),{status:429});kept.push({email:account.verifiedEmail,verifiedAt:account.emailVerifiedAt,replacedAt:now});}
    if(kept.length)account.previousEmails=kept;else delete account.previousEmails;
  }
  /** Email recipients for reissue notices: the current verified email and any replaced in the last 7 days. */
  reissueRecipients(account,at=this.clock()){
    const now=at,list=[];
    if(typeof account.verifiedEmail==='string'&&nonNegative(account.emailVerifiedAt))list.push({email:account.verifiedEmail,verifiedAt:account.emailVerifiedAt,current:true});
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
  /** Who may reissue (recovery-identity spec "Active-account reissue"): a step-up within 5 minutes, made with a passkey
   * or password enrolled at least 7 days earlier (P18), or any fresh step-up while a forced path is armed (an elevated
   * abort, PORT-4 activation). `reauthentication_required` makes the console prompt again; `credential_too_new` means
   * no credential is old enough yet. */
  reissueAuthority(account,session){
    const now=this.clock();
    if(!Number.isSafeInteger(session.stepUpAt)||session.stepUpAt>now||session.stepUpAt+300000<=now)fail('reauthentication_required','Confirm your password or passkey to replace your recovery file.');
    const aged=at=>nonNegative(at)&&at<=now&&now-at>=RECOVERY_CREDENTIAL_AGE_MS,used=session.stepUpCredential;
    // Wargame 2026-10-23 #1(a): an account with a passkey reissues only after a passkey step-up. A password alone (the
    // credential most often stolen) never replaces the recovery file of an account that has a passkey.
    if(account.credentials.length&&used?.kind!=='passkey')fail('reauthentication_required','Confirm with one of your passkeys to replace your recovery file.');
    const enrolled=used?.kind==='passkey'?account.credentials.find(c=>c.id===used.id)?.createdAt:used?.kind==='password'&&account.passwordHash?account.passwordSetAt:undefined;
    // A forced marker waives the age only for a credential enrolled no later than the marker was armed, so a
    // credential added afterwards (perhaps by whoever took over the session) still waits 7 days (P18).
    const marker=reissueMarker(account);if(marker&&nonNegative(enrolled)&&enrolled<=marker.at)return {forced:marker.reason,credential:used};
    if(aged(enrolled))return {forced:null,credential:used};
    if(account.credentials.length?account.credentials.some(c=>aged(c.createdAt)):account.passwordHash&&aged(account.passwordSetAt))fail('reauthentication_required',account.credentials.length?'Confirm with a passkey you have had for at least 7 days.':'Confirm with a password you have had for at least 7 days.');
    fail('credential_too_new','Replacing your recovery file needs a passkey or password you have had for at least 7 days.',409);
  }
  /** Active-account reissue, phase 1 (recovery-identity spec "Active-account reissue"; identity portability P14, P15,
   * P17). Authority as `reissueAuthority`. The account single writer refuses during a deletion, a move or a contest and
   * rotates the signing key with continuity first (P15); the new file is then STAGED, bound to this session for 30
   * minutes. The current file keeps working until phase 2 commits, so an interrupted reissue never leaves the owner
   * without a file. A new begin replaces an older staged file, which then never becomes current. */
  async reissueRecoveryBegin(input,context){
    const {account,session}=await this.authorized(context,true);const revision=account.revision;
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(name=>name!=='acknowledged'))fail('invalid_request','Unsupported recovery request.',400);
    if(input.acknowledged!==true)fail('confirmation_required','Confirm that your current recovery file will stop working.',400);
    if(typeof this.identityBackup?.reissue!=='function'||typeof this.identityBackup?.reissueCommit!=='function')fail('recovery_unavailable','Recovery files cannot be replaced right now.',503);
    // One cooling-off window at a time: a second reissue would push the trusted previous file out of the window.
    const open=pendingReissue(account,this.clock());if(open)throw Object.assign(new IdentityFault('recovery_reissue_pending','A recovery file replacement is still in its 7-day waiting period. Cancel it first, or wait until it ends.'),{status:409,usableAt:open.until});
    const authority=this.reissueAuthority(account,session);
    if(!await this.rateLimiter.check({operation:'recovery-reissue',remoteIP:context.remoteIP,handle:account.handle}))fail('rate_limited','Please wait before trying again.');
    const sessionId=await this.sessionID(session),marker=reissueMarker(account),staged=stagedReissue(account.recoveryStaged);
    // P15: every kid an issued file may hold (the current file, an abandoned staged file, an invalidated file) is
    // rotated away. A transfer-in arrival's key was already rotated at activation, so its first file adopts it.
    const bound=[...new Set([account.recoveryKeyKid,staged?.kid,marker?.kid].filter(kid=>typeof kid==='string'&&kid))];
    const rotation=bound.length?{rotateIf:bound}:marker?.reason==='transfer-in'?null:{always:true};
    const keep=account.recoveryHash&&typeof account.recoveryKeyKid==='string'?[account.recoveryKeyKid]:[];
    const recoveryToken=`${account.id}.${this.crypto.random()}`;
    // P17 compares the credential that confirmed the step-up, not the one the session signed in with.
    const issued=await this.identityBackup.reissue(account,recoveryToken,{rotation,keep,actor:{credentialId:session.credentialId??null,stepUpCredentialId:stepUpCredentialId(session),sessionId}});
    const backup=issued?.backup,outcome=issued?.rotation;if(!backup?.keychain?.signing?.kid)fail('recovery_unavailable','Recovery files cannot be replaced right now.',503);
    // Review 2026-10-23 item 3 (provisional): a reissue that had to rotate but could not (keys.mjs `key_history_full`, e.g. a
    // moved identity whose published document has no headroom) never stages a file holding the same signing key.
    if(rotation&&outcome?.skipped)fail('rotation_unavailable','Your identity key cannot be replaced right now, so a new recovery file would not protect you. Your current file keeps working.',409);
    const now=this.clock();
    account.recoveryStaged={hash:await this.crypto.hash('recovery',recoveryToken),kid:backup.keychain.signing.kid,encryptionKid:backup.keychain.encryption.kid,sessionId,preparedAt:now,expiresAt:now+RECOVERY_REISSUE_TTL_MS,base:account.recoveryHash||null,credential:authority.credential,fileLocked:this.fileProofReissue(account,authority.credential,now),...authority.forced?{forced:authority.forced}:{}};
    if(outcome?.rotated)this.audit(account,'recovery-key-rotated');else if(outcome?.skipped)this.audit(account,'recovery-key-rotation-skipped');
    if(account.recoveryPrevious&&!pendingReissue(account,now))delete account.recoveryPrevious;
    this.audit(account,'recovery-reissue-prepared');await this.save(account,revision);
    // Wargame #1(c): every channel hears about the reissue when it begins, as well as when it commits.
    await this.reissueNotice(account,'recovery-reissue-started');
    return {fileName:`3sln-recovery-${account.id}.json`,content:JSON.stringify(backup),recoveryToken,expiresAt:account.recoveryStaged.expiresAt,transferPending:issued.transferPending===true,forced:authority.forced};
  }
  /** Active-account reissue, phase 2: after the browser encrypted, saved and test-unlocked the staged file. The account
   * single writer re-checks deletion, custody and contest, and CANCELS a pending or held transfer-out (spec rationale:
   * the move was authorized by the file this replaces; abort is the safe direction). Then one identity CAS makes the
   * staged credential current with `recoveryIssuedAt = now` (so P14 waits 7 days again), clears any forced marker and
   * bumps `security`. Notices go to the verified email and every push subscription after commit. */
  async reissueRecoveryConfirm(input,context){
    let {account,session}=await this.authorized(context,true);
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(name=>!['recoveryToken','downloadConfirmed'].includes(name)))fail('invalid_request','Unsupported recovery request.',400);
    if(input.downloadConfirmed!==true||typeof input.recoveryToken!=='string'||input.recoveryToken.length>150)fail('recovery_confirmation_required','Download and test your new recovery file before continuing.',400);
    if(typeof this.identityBackup?.reissueCommit!=='function')fail('recovery_unavailable','Recovery files cannot be replaced right now.',503);
    const hash=await this.crypto.hash('recovery',input.recoveryToken),sessionId=await this.sessionID(session);
    const check=a=>{const staged=stagedReissue(a.recoveryStaged);if(!staged||staged.sessionId!==sessionId||!secureEqual(staged.hash,hash)||staged.expiresAt<=this.clock())fail('recovery_reissue_expired','Start replacing your recovery file again.',409);if((a.recoveryHash||null)!==staged.base)fail('recovery_changed','Your recovery file changed. Start again.',409);
      // The credential that authorized phase 1 must still exist (removing it revokes its sessions, but a password can be reset by recovery only).
      const used=staged.credential;if(used?.kind==='passkey'?!a.credentials.some(c=>c.id===used.id):used?.kind==='password'?!a.passwordHash:true)fail('recovery_reissue_expired','Start replacing your recovery file again.',409);return staged;};
    const first=check(account);
    const gate=await this.identityBackup.reissueCommit(account.id,{actor:{credentialId:session.credentialId??null,stepUpCredentialId:stepUpCredentialId(session),sessionId},kids:{signing:first.kid,encryption:first.encryptionKid}});
    for(let attempt=0;attempt<4;attempt++){
      if(attempt)({account,session}=await this.authorized(context,true));
      const staged=check(account),revision=account.revision,now=this.clock();
      if(pendingReissue(account,now))fail('recovery_reissue_pending','A recovery file replacement is still in its 7-day waiting period.',409);
      // Wargame 2026-10-23 #1(b)-(d), provisional: the staged file becomes current but cannot start a recovery until the
      // window ends; the previous credential is kept, able only to cancel this reissue, and becomes current again if
      // the reissue is cancelled. The cancel link goes only to an email verified before the reissue began.
      const preparedAt=Number.isSafeInteger(staged.preparedAt)?staged.preparedAt:now,fileLocked=staged.fileLocked===true&&this.fileProofReissue(account,staged.credential,preparedAt),emailCancel=this.reissueRecipients(account,preparedAt).some(recipient=>recipient.verifiedAt<preparedAt&&(recipient.current||!fileLocked)),cancelToken=emailCancel?`${account.id}.${this.crypto.random()}`:null;
      account.recoveryPrevious={hash:account.recoveryHash||null,issuedAt:nonNegative(account.recoveryIssuedAt)?account.recoveryIssuedAt:null,kid:typeof account.recoveryKeyKid==='string'?account.recoveryKeyKid:null,version:account.recoveryBackupVersion===2?2:account.recoveryHash?1:null,marker:reissueMarker(account),reissuedAt:now,preparedAt:Number.isSafeInteger(staged.preparedAt)?staged.preparedAt:now,until:now+RECOVERY_REISSUE_WINDOW_MS,newKid:staged.kid,cancelHash:cancelToken?await this.crypto.hash('reissue-cancel',cancelToken):null,credential:staged.credential??null,fileLocked,stagedSessionId:staged.sessionId,confirmedSessionId:sessionId};
      account.recoveryHash=staged.hash;account.recoveryIssuedAt=now;account.recoveryKeyKid=staged.kid;account.recoveryBackupVersion=2;delete account.recoveryStaged;delete account.recoveryReissue;
      this.audit(account,'recovery-file-reissued');this.securityChanged(account);account.revision=revision+1;
      if(!await this.repository.compareAndSwap(account.id,revision,account))continue;
      const notified=await this.reissueNotice(account,'recovery-reissued',{usableAt:account.recoveryPrevious.until},cancelToken?{token:cancelToken,before:preparedAt,currentOnly:fileLocked}:null,preparedAt);
      return {reissued:true,issuedAt:now,usableAt:account.recoveryPrevious.until,transferCancelled:gate?.transferCancelled===true,notified,recovery:this.recoveryView(account,session),account:await this.projectAccount(account)};
    }
    fail('conflict','The account changed; start this step again.');
  }
  /** Cancels a committed reissue during its cooling-off window (wargame 2026-10-23 #1(c), provisional). `how`: 'session'
   * (a session created before the reissue began), 'email' (the cancel link sent to an email verified before it began)
   * or 'file' (the previous recovery file). The account single writer first rotates the signing key away from the
   * voided file and keeps the restored file's key bound (P15), then one identity CAS restores the previous credential
   * (and any forced marker it replaced), raises `federationGeneration` so no grant from before or during the window
   * survives, and bumps `security` (which also re-arms the 7-day transfer look-back). Notices go to every channel. */
  async cancelReissue(id,how,matches){
    let account=await this.repository.get(id);const first=pendingReissue(account,this.clock());
    if(!account||account.status!=='active'||!first||!await matches(account,first))fail('recovery_reissue_not_pending','There is no recovery file replacement to cancel.',409);
    let rotation=null;
    if(typeof this.identityBackup?.reissueCancel==='function')rotation=(await this.identityBackup.reissueCancel(account.id,{voided:first.newKid,restored:typeof first.kid==='string'?first.kid:null}))?.rotation??null;
    for(let attempt=0;attempt<4;attempt++){
      if(attempt)account=await this.repository.get(id);
      const previous=pendingReissue(account,this.clock());
      if(!account||account.status!=='active'||!previous||previous.reissuedAt!==first.reissuedAt)fail('recovery_reissue_not_pending','There is no recovery file replacement to cancel.',409);
      const revision=account.revision;
      if(typeof previous.hash==='string'&&previous.hash){account.recoveryHash=previous.hash;if(nonNegative(previous.issuedAt))account.recoveryIssuedAt=previous.issuedAt;else delete account.recoveryIssuedAt;if(typeof previous.kid==='string')account.recoveryKeyKid=previous.kid;else delete account.recoveryKeyKid;if(previous.version===2)account.recoveryBackupVersion=2;else delete account.recoveryBackupVersion;}
      else{account.recoveryHash=null;delete account.recoveryIssuedAt;delete account.recoveryKeyKid;}
      if(previous.marker&&RECOVERY_REISSUE_REASONS.includes(previous.marker.reason))account.recoveryReissue=previous.marker;
      delete account.recoveryPrevious;delete account.recoveryStaged;
      // Sessions created at or after the begin, and the sessions that staged and confirmed the reissue (perhaps the
      // minter's, created earlier), end with it (review 2026-10-23 item 3 and follow-up).
      const ended=new Set([previous.stagedSessionId,previous.confirmedSessionId].filter(id=>typeof id==='string'));
      await this.pruneSessions(account,s=>Number.isSafeInteger(s.createdAt)&&s.createdAt>=previous.preparedAt||ended.has(s.id));
      account.pendingSever={reason:'recovery',at:this.clock()};
      account.federationGeneration=(nonNegative(account.federationGeneration)?account.federationGeneration:0)+1;
      if(rotation?.rotated)this.audit(account,'recovery-key-rotated');else if(rotation?.skipped)this.audit(account,'recovery-key-rotation-skipped');
      this.audit(account,'recovery-reissue-cancelled');this.securityChanged(account);account.revision=revision+1;
      if(!await this.repository.compareAndSwap(account.id,revision,account))continue;
      const notified=await this.reissueNotice(account,'recovery-reissue-cancelled');
      await this.flushSever(account.id);
      return {cancelled:true,restored:Boolean(account.recoveryHash),notified};
    }
    fail('conflict','The account changed; try again.');
  }
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
    return {...result,account:await this.projectAccount(await this.repository.get(account.id))};
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
   * proof is a 256-bit token plus the provider-signed file, so no CAPTCHA is asked (the one the owner solved for the
   * refused recovery attempt is already spent); the network windows still apply. */
  async reissueRecoveryCancelFile(input,context){
    this.origin(context);
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(name=>!['recoveryToken','identityBackup','turnstileToken'].includes(name)))fail('invalid_request','Unsupported recovery request.',400);
    if(!await this.rateLimiter.check({phase:'attempt',operation:'recovery-reissue-cancel',remoteIP:context.remoteIP,region:context.region}))fail('rate_limited','Please wait before trying again.');
    const [id]=tokenParts(input.recoveryToken),proof=await this.crypto.hash('recovery',input.recoveryToken);
    const result=await this.cancelReissue(id,'file',async(current,previous)=>{
      if(typeof previous.hash!=='string'||!secureEqual(previous.hash,proof))return false;
      if(previous.version===2){if(!this.identityBackup||!input.identityBackup)return false;try{await this.identityBackup.verify(input.identityBackup,current,input.recoveryToken,typeof previous.kid==='string'?{expectedKid:previous.kid}:{});}catch{return false;}}
      // Coordinator decision 2026-10-23 (provisional): a passkey-authorized reissue may be retiring a leaked file, so that
      // file cannot undo it; only earlier sessions and the pre-reissue email can. A password-authorized one (no passkey
      // on the account) stays cancellable by the file, or a password thief could lock a password-only owner out.
      if(previous.fileLocked===true)throw Object.assign(new IdentityFault('reissue_cancel_not_allowed','This replacement was confirmed with a passkey, so your previous recovery file cannot cancel it. Cancel it from a device that was signed in before it started, or from the link in the email notice.'),{status:403});
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
  setupProjection(account){const push=typeof this.pushTransport?.send==='function'&&typeof this.pushTransport?.register==='function'&&account.setupPushVerified?.expiresAt>this.clock();return {accountId:account.id,signupPlan:account.admission?.plan??'free',paymentRequired:account.admission?.kind==='paid'&&account.admission.initialPaymentRequired!==false,channelRequired:this.config.requireReachability===true||Boolean(account.systemIdentity),channelVerified:Boolean(account.verifiedEmail&&Number.isFinite(account.emailVerifiedAt)||push),verifiedEmail:account.verifiedEmail??null,pushVerified:Boolean(push),emailAvailable:typeof this.mailer?.sendSetupCode==='function',pushAvailable:typeof this.pushTransport?.send==='function'&&typeof this.pushTransport?.register==='function'};}
  async setupSendAdmission(account,kind,context,target){const now=this.clock(),windowKey='setup'+kind+'WindowAt',countKey='setup'+kind+'Sends',sentKey='setup'+kind+'SentAt';const window=account[windowKey];if(window!==undefined&&(!Number.isSafeInteger(window)||window>now))fail('rate_limited');if(window===undefined||now-window>=600000){account[windowKey]=now;account[countKey]=0;}if(!Number.isInteger(account[countKey])||account[countKey]<0||account[countKey]>=3||account[sentKey]&&now-account[sentKey]<60000||!await this.rateLimiter.check({operation:'email',remoteIP:context.remoteIP,handle:target}))fail('rate_limited','Wait before requesting another verification check.');account[countKey]++;account[sentKey]=now;}
  async setupStatus(input,context){this.origin(context);return this.setupProjection(await this.pending(input.pendingToken,context));}
  async setupBillingCheckout(input,context){this.origin(context);const account=await this.pending(input.pendingToken,context);if(!['pending','recovering'].includes(account.status)||account.admission?.kind!=='paid'||account.admission.initialPaymentRequired===false||!this.setupBilling)fail('invalid_paid_setup');await this.requireSetupChannel(account);if(!await this.rateLimiter.check({operation:'paid-setup',remoteIP:context.remoteIP,handle:account.id}))fail('rate_limited');const result=await this.setupBilling.checkout(account.id,account.admission,{requestId:input.requestId,currency:input.currency,priceDigest:input.priceDigest});await this.pending(input.pendingToken,context);return result;}
  async setupBillingStatus(input,context){this.origin(context);const account=await this.pending(input.pendingToken,context);if(!['pending','recovering'].includes(account.status)||account.admission?.kind!=='paid'||account.admission.initialPaymentRequired===false||!this.setupBilling)fail('invalid_paid_setup');if(!await this.rateLimiter.check({operation:'paid-setup',remoteIP:context.remoteIP,handle:account.id}))fail('rate_limited');const result=await this.setupBilling.status(account.id,account.admission);await this.pending(input.pendingToken,context);return result;}
  async setupEmailStart(input,context){this.origin(context);if(input.locale!==undefined&&!['en','es'].includes(input.locale))fail('invalid_locale','Choose English or Spanish.');const account=await this.pending(input.pendingToken,context),revision=account.revision;if(typeof this.mailer?.sendSetupCode!=='function')fail('email_unavailable','Email delivery is not configured.');const email=emailAddress(input.email),now=this.clock();if(account.systemIdentity?.requiredEmail&&account.admission?.initialSystemActivationRequired!==false&&email!==emailAddress(account.systemIdentity.requiredEmail))fail('contact_required','Use the contact address assigned by the system invitation.');await this.setupSendAdmission(account,'Email',context,email);let number;do{number=globalThis.crypto.getRandomValues(new Uint32Array(1))[0];}while(number>=4200000000);const code=String(number%100000000).padStart(8,'0');account.setupEmailChallenge={email,hash:await this.crypto.hash('setup-email',account.id+'|'+account.pendingHash+'|'+email+'|'+code),pendingHash:account.pendingHash,expiresAt:now+600000,attempts:0};await this.save(account,revision);await this.mailer.sendSetupCode({email,code,issuer:this.config.origin,locale:input.locale??'en'});return {sent:true,...this.setupProjection(account)};}
  async setupEmailConfirm(input,context){this.origin(context);const account=await this.pending(input.pendingToken,context),revision=account.revision,challenge=account.setupEmailChallenge;if(!challenge||challenge.pendingHash!==account.pendingHash||challenge.expiresAt<=this.clock()||challenge.attempts>=5||typeof input.code!=='string'||!/^\d{8}$/.test(input.code))fail('invalid_challenge','Request a fresh email code.');challenge.attempts++;if(!secureEqual(challenge.hash,await this.crypto.hash('setup-email',account.id+'|'+account.pendingHash+'|'+challenge.email+'|'+input.code))){await this.save(account,revision);fail('invalid_challenge','That email code is incorrect.');}const existing=await this.repository.findByEmail(challenge.email);if(existing&&existing.id!==account.id)fail('email_already_linked','This verified email belongs to another account. Sign in to that account.');if(account.verifiedEmail!==challenge.email){this.securityChanged(account);delete account.noticeWaiver;}account.verifiedEmail=challenge.email;account.emailVerifiedAt=this.clock();account.emailLoginEnabled=false;delete account.setupEmailChallenge;this.audit(account,'setup-email-verified');await this.save(account,revision);return this.setupProjection(account);}
  async setupPushStart(input,context){this.origin(context);if(input.locale!==undefined&&!['en','es'].includes(input.locale))fail('invalid_locale','Choose English or Spanish.');const account=await this.pending(input.pendingToken,context),revision=account.revision;if(typeof this.pushTransport?.send!=='function')fail('push_unavailable','Push delivery is not configured.');const subscription=input.subscription;if(!subscription||typeof subscription.endpoint!=='string'||subscription.endpoint.length>4096||!subscription.keys||typeof subscription.keys.p256dh!=='string'||typeof subscription.keys.auth!=='string'||JSON.stringify(subscription).length>8192)fail('invalid_subscription','Use a browser-created push subscription.');await this.setupSendAdmission(account,'Push',context,account.handle);const proof=account.id+'.'+this.crypto.random();account.setupPushChallenge={subscription:structuredClone(subscription),hash:await this.crypto.hash('setup-push',proof),pendingHash:account.pendingHash,expiresAt:this.clock()+300000};delete account.setupPushVerified;await this.save(account,revision);await this.pushTransport.send(subscription,{type:'bindle-setup-challenge',proof,owner:account.id,locale:input.locale??'en'});return {sent:true,...this.setupProjection(account)};}
  async setupPushConfirm(input,context){this.origin(context);const account=await this.pending(input.pendingToken,context),revision=account.revision,challenge=account.setupPushChallenge;if(typeof this.pushTransport?.send!=='function'||!challenge||challenge.pendingHash!==account.pendingHash||challenge.expiresAt<=this.clock()||typeof input.proof!=='string'||!secureEqual(challenge.hash,await this.crypto.hash('setup-push',input.proof)))fail('invalid_challenge','Enable notifications and request a fresh push check.');account.setupPushVerified={subscription:challenge.subscription,verifiedAt:this.clock(),expiresAt:account.pendingExpiresAt};delete account.setupPushChallenge;this.audit(account,'setup-push-verified');await this.save(account,revision);return this.setupProjection(account);}
  async requireSetupChannel(account){if(this.config.requireReachability!==true&&!account.systemIdentity)return;if(account.systemIdentity?.requiredEmail&&account.admission?.initialSystemActivationRequired!==false&&account.verifiedEmail!==emailAddress(account.systemIdentity.requiredEmail))fail('contact_required','Verify the contact address assigned by the system invitation.');if(account.verifiedEmail&&Number.isFinite(account.emailVerifiedAt)){const owner=await this.repository.findByEmail(account.verifiedEmail);if(owner?.id===account.id)return;}if(typeof this.pushTransport?.send==='function'&&account.setupPushVerified?.expiresAt>this.clock()){if(typeof this.pushTransport.register!=='function')fail('push_unavailable','Push registration is not configured.');await this.pushTransport.register({owner:account.id,subscription:account.setupPushVerified.subscription});if(account.pendingExpiresAt<=this.clock()||account.setupPushVerified.expiresAt<=this.clock())fail('unauthorized','This setup proof expired. Start another check.');return;}fail('contact_required','Verify an email address or enable and verify push notifications before activating your account.');}
  async confirmRecovery(input, context) {
    this.origin(context); const account = await this.pending(input.pendingToken,context); const revision = account.revision,activationDeadline=account.pendingExpiresAt;
    if (input.downloadConfirmed !== true || !account.recoveryHash || typeof input.recoveryToken !== 'string' || !secureEqual(account.recoveryHash, await this.crypto.hash('recovery', input.recoveryToken))) fail('recovery_confirmation_required', 'Download and confirm your recovery file before continuing.');
    if (!account.passwordHash && !account.credentials.length) fail('credential_required');
    await this.requireSetupChannel(account);
    if(account.admission?.kind==='paid'&&account.admission.initialPaymentRequired!==false){if(!this.setupBilling)fail('payment_required','Verify your paid subscription before activating this account.');const payment=await this.setupBilling.status(account.id,account.admission);if(payment?.paymentVerified!==true||payment.signupPlan!==account.admission.plan||payment.validUntil<=this.clock())fail('payment_required','Payment is still being verified. Recheck before activating your account.');account.admission.initialPaymentRequired=false;}
    if(account.systemIdentity)account.admission={...account.admission,initialSystemActivationRequired:false};
    const source=account.status==='recovering'?'recovery':'activation',activationCredentialAt=account.pendingCredentialAt;if(source==='recovery')raiseAuthorityEpoch(account,{reason:'recovery'});delete account.pendingCredentialAt;
    account.status = 'active'; account.pendingHash = null; account.pendingExpiresAt = null; account.challenges = [];delete account.setupBindingHash;delete account.setupEmailChallenge;delete account.setupPushChallenge;delete account.setupEmailSends;delete account.setupEmailSentAt;delete account.setupPushSends;delete account.setupPushSentAt;delete account.setupEmailWindowAt;delete account.setupPushWindowAt;
    delete account.recoveryResumeHash; delete account.recoveryResumeBackupVersion; delete account.recoveryResumeKeyKid;
    this.audit(account, 'account-activated'); const result = await this.session(account,{source,activationCredentialAt});if(activationDeadline<=this.clock())fail('unauthorized','This setup session expired.');
    await this.save(account, revision); if (account.pendingSever) await this.flushSever(account.id); return result;
  }
  async resumeSetupCredential(account,context,revision=account.revision){const pendingToken=await this.newPending(account,context);account.pendingCredentialAt=this.clock();account.challenges=[];this.audit(account,'setup-credential-resumed');await this.save(account,revision);return {pendingToken,account:await this.projectAccount(account),readyForRecovery:Boolean(account.passwordHash||account.credentials.length),credentialRequired:false,resumed:true,signupPlan:account.admission?.plan??'free',paymentRequired:account.admission?.kind==='paid'&&account.admission.initialPaymentRequired!==false,setup:this.setupProjection(account)};}
  async loginPassword(input, context) {
    this.origin(context);input={...input,handle:handle(input.handle)};await this.guard('login', input, context); password(input.password);
    // Wargame 2026-10-23 #3: the per-handle window is only consulted here (after Turnstile, before the KDF) and is
    // charged below only by a completed check that failed, so neither CAPTCHA-less traffic nor the owner's successful
    // sign-ins consume it.
    const budget=phase=>this.rateLimiter.check({phase,operation:'login',remoteIP:context.remoteIP,region:context.region,handle:input.handle});
    if(!await budget('credential'))fail('rate_limited','Please wait before trying again.');
    const account = await this.repository.findByHandle(input.handle);
    // The dummy hash performs equivalent KDF work for unknown accounts.
    this.dummyPasswordHash ??= this.passwordHasher.dummyHash || this.passwordHasher.hash(this.crypto.random());
    const dummyHash = await this.dummyPasswordHash;
    const hash = account?.passwordHash || dummyHash;
    const verified = await this.passwordHasher.verify(input.password, hash);
    if(!verified){try{await budget('failure');}catch{}fail('unauthorized','Authentication failed.');}
    if (['suspended','moved'].includes(account?.status) && account.passwordHash && verified && await this.closureWindow(account)) return this.closureSession(account, account.revision, { label: input.label });
    if (!account || !['active',...(this.config.requireReachability===true||account?.systemIdentity||account?.onboardingIdentity)?['pending','recovering']:[]].includes(account.status) || !account.passwordHash || !verified) fail('unauthorized', 'Authentication failed.');
    if(account.status!=='active')return this.resumeSetupCredential(account,context);
    const revision = account.revision; this.interactive(account,'sign-in',context); const result = await this.session(account, { label: input.label }); await this.save(account, revision); return result;
  }
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
    // waits until the window ends; the previous one can only cancel the reissue. Both answers come after full file
    // verification, so they reveal the window only to a holder of a genuine file.
    const pending = account?.status === 'active' ? pendingReissue(account, this.clock()) : null;
    if (pending && !resumed) {
      const previous = typeof pending.hash === 'string' && secureEqual(pending.hash, proofHash), current = secureEqual(account.recoveryHash, proofHash);
      if (previous || current) {
        const version = previous ? pending.version : account.recoveryBackupVersion, kid = previous ? pending.kid : account.recoveryKeyKid;
        if (version === 2) { if (!this.identityBackup || !input.identityBackup) fail('unauthorized', 'Provide the signed identity recovery file.'); try { await this.identityBackup.verify(input.identityBackup, account, input.recoveryToken, typeof kid === 'string' ? { expectedKid: kid } : {}); } catch { fail('unauthorized', 'Recovery failed.'); } }
        if (previous && pending.fileLocked === true) throw Object.assign(new IdentityFault('recovery_reissue_locked', 'This recovery file was replaced recently with a passkey confirmation. It cannot recover the account or cancel the replacement. Cancel it from a device that was signed in before it started, or from the link in the email notice.'), { status: 409, usableAt: pending.until, cancellable: false });
        if (previous) throw Object.assign(new IdentityFault('recovery_reissue_pending', 'This recovery file was replaced recently. During the 7-day waiting period you can use it only to cancel that replacement; once cancelled it works again.'), { status: 409, usableAt: pending.until, cancellable: true });
        throw Object.assign(new IdentityFault('recovery_not_ready', 'This recovery file is new. It can start a recovery once its 7-day waiting period ends.'), { status: 409, usableAt: pending.until });
      }
    }
    // Organization recovery (break-glass, design §5.11) is phase B (ORG-12): until then an organization file recovers nothing.
    if (!account || !interactiveIdentity(account) || (!resumed && (!['active','pending'].includes(account.status) || !secureEqual(account.recoveryHash, proofHash)))) fail('unauthorized', 'Recovery failed.');
    if((resumed?account.recoveryResumeBackupVersion:account.recoveryBackupVersion)===2){
      if(!this.identityBackup||!input.identityBackup)fail('unauthorized','Provide the signed identity recovery file.');
      const expectedKid=resumed?account.recoveryResumeKeyKid:account.recoveryKeyKid;
      try{await this.identityBackup.verify(input.identityBackup,account,input.recoveryToken,typeof expectedKid==='string'?{expectedKid}:{});}catch{fail('unauthorized','Recovery failed.');}
    }
    const revision = account.revision;
    if (!resumed) {
      account.recoveryResumeHash = account.recoveryHash;
      account.recoveryResumeBackupVersion=account.recoveryBackupVersion||1;
      if(typeof account.recoveryKeyKid==='string')account.recoveryResumeKeyKid=account.recoveryKeyKid;else delete account.recoveryResumeKeyKid;delete account.recoveryKeyKid;
      account.status = 'recovering'; account.recoveryHash = null; account.credentials = []; account.passwordHash = null; delete account.passwordSetAt; account.sessions = []; revokeAllLineage(account, this.clock()); account.emailChallenges = [];
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
    const credentialRequired = !account.passwordHash && !account.credentials.length;
    return { pendingToken, account: await this.projectAccount(account), credentialRequired, readyForRecovery: !credentialRequired, resumed };
  }
  async owner(input, context) {
    const { account, session } = await this.authorized(context);
    if(account.pendingSever&&await this.flushSever(account.id)){const fresh=await this.repository.get(account.id);if(fresh){for(const key of Object.keys(account))if(!(key in fresh))delete account[key];Object.assign(account,fresh);}}
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
  async credentialBegin(input, context) {
    const { account, session } = await this.recent(context); const revision = account.revision;
    if (account.credentials.length >= 5) fail('credential_limit', 'You can register up to five passkeys.');
    if (!await this.rateLimiter.check({ operation: 'credential-begin', remoteIP: context.remoteIP, region: context.region, handle: account.id })) fail('rate_limited', 'Please wait before trying again.');
    const registrationOptions = await this.webauthn.registrationOptions({ account, config: this.config });
    const challengeId = this.crypto.id();
    account.challenges = [...account.challenges.filter(c => c.expiresAt > this.clock() && c.purpose !== 'credential').slice(-4), {
      id: challengeId, purpose: 'credential', value: registrationOptions.challenge, sessionHash: session.hash,
      label: safeLabel(input.label, 'Passkey'), expiresAt: this.clock() + this.config.challengeTtlMs }];
    await this.save(account, revision); return { registrationOptions, challengeId };
  }
  async credentialFinish(input, context) {
    const { account, session } = await this.recent(context); const revision = account.revision;
    const challenge = account.challenges.find(c => c.purpose === 'credential' && c.id === input.challengeId && c.expiresAt > this.clock() && secureEqual(c.sessionHash, session.hash));
    if (!challenge) fail('invalid_challenge');
    let credential;
    try { credential = await this.webauthn.verifyRegistration({ response: input.response, challenge: challenge.value, config: this.config }); } catch { fail('invalid_passkey', 'Passkey verification failed.'); }
    if (!credential?.id || !credential.publicKey || account.credentials.length >= 5 || account.credentials.some(c => c.id === credential.id)) fail('invalid_passkey');
    account.credentials.push({ ...credential, label: challenge.label, createdAt: this.clock() });
    account.challenges = account.challenges.filter(c => c !== challenge); this.audit(account, 'passkey-added'); this.securityChanged(account);
    this.queueNotice(account, 'passkey-added', await this.sessionID(session)); await this.save(account, revision); return { credentials: publicCredentials(account) };
  }
  async renamePasskey(input, context) {
    const { account } = await this.recent(context); const revision = account.revision;
    const credential = account.credentials.find(c => c.id === input.credentialId);
    if (!credential) fail('not_found', 'Passkey not found.');
    credential.label = safeLabel(input.label, 'Passkey'); this.audit(account, 'passkey-renamed');
    await this.save(account, revision); return { credentials: publicCredentials(account) };
  }
  async removePasskey(input, context) {
    const { account, session } = await this.recent(context); const revision = account.revision;
    if (!account.credentials.some(c => c.id === input.credentialId)) fail('not_found', 'Passkey not found.');
    if (!account.recoveryHash || (account.credentials.length === 1 && !account.passwordHash)) fail('credential_required', 'Keep a working login method and your recovery file before removing this passkey.');
    account.credentials = account.credentials.filter(c => c.id !== input.credentialId);
    await this.pruneSessions(account,s=>s.credentialId===input.credentialId);
    account.challenges = account.challenges.filter(c => c.purpose !== 'credential'); this.audit(account, 'passkey-removed'); this.securityChanged(account);
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
    const keep=new Set([await this.sessionID(session)]);let parent=session.parentSessionId;while(parent&&!keep.has(parent)){keep.add(parent);parent=account.sessions.find(s=>s.id===parent)?.parentSessionId;}const before=account.sessions.filter(s=>s.expiresAt>this.clock()).length;const ids=new Map(await Promise.all(account.sessions.map(async s=>[s,await this.sessionID(s)])));await this.pruneSessions(account,s=>!keep.has(ids.get(s)));const count=before-account.sessions.filter(s=>s.expiresAt>this.clock()).length; this.audit(account, 'other-device-sessions-revoked'); if (count > 0) { this.authorityEvent(account, 'sessions-revoked'); this.queueNotice(account, 'sessions-revoked', await this.sessionID(session)); }
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
  async emailStart(input, context) {
    if (!this.mailer) fail('email_unavailable', 'Email delivery is not configured.');
    const { account, session } = await this.authorized(context, true); const revision = account.revision;
    if (this.authAt(session) + 900000 <= this.clock()) fail('reauthentication_required', 'Sign in again before changing recovery email.');
    const email = emailAddress(input.email);
    if (!await this.rateLimiter.check({ operation: 'email', remoteIP: context.remoteIP, handle: account.handle })) fail('rate_limited');
    const token = `${account.id}.${this.crypto.random()}`;
    account.emailChallenges = [{ purpose: 'link', email, hash: await this.crypto.hash('email', token), sessionHash: session.hash, expiresAt: this.clock() + 600000 }];
    this.audit(account, 'email-link-requested'); await this.save(account, revision);
    // Tokens only leave through the mail transport, never through API results.
    await this.mailer.sendVerification({ email, token, purpose: 'link', issuer: this.config.origin });
    return { sent: true };
  }
  async emailConfirm(input, context) {
    const { account, session } = await this.authorized(context, true); const revision = account.revision;
    if (input.confirmed !== true || typeof input.token !== 'string') fail('confirmation_required');
    const hash = await this.crypto.hash('email', input.token);
    const challenge = account.emailChallenges?.find(c => c.purpose === 'link' && secureEqual(c.hash, hash) && secureEqual(c.sessionHash, session.hash) && c.expiresAt > this.clock());
    if (!challenge) fail('invalid_challenge', 'This email confirmation is expired or belongs to another browser session.');
    const changed = account.verifiedEmail !== challenge.email, replaced = changed && typeof account.verifiedEmail === 'string';
    if (changed) { this.rememberPreviousEmail(account); account.emailLoginEnabled = false; this.securityChanged(account); delete account.noticeWaiver; if (replaced) { this.authorityEvent(account, 'email-changed'); this.queueNotice(account, 'email-changed', await this.sessionID(session)); } }
    account.verifiedEmail = challenge.email; account.emailVerifiedAt = this.clock(); account.emailChallenges = [];
    this.audit(account, 'email-linked'); await this.save(account, revision); return { linked: true, account: await this.projectAccount(account) };
  }
  /** Email sign-in, phase 1. The answer is `{sent:true}` for every address (wargame 2026-10-23 #7, #8): after Turnstile a
   * pseudonymized mailbox window and a global window are charged whether or not an account exists; both branches do
   * the same token work; the challenge write and the provider call run in the background on a hit, so latency does not
   * depend on the address, and provider errors never reach the caller. */
  async emailLoginStart(input, context) {
    if (!this.mailer || typeof this.repository.findByEmail !== 'function') fail('email_unavailable', 'Email delivery is not configured.');
    await this.guard('email', input, context); const email = emailAddress(input.email);
    if (!await this.rateLimiter.check({ phase: 'mailbox', operation: 'email-login', remoteIP: context.remoteIP, region: context.region, handle: `mailbox\0${email}` })) fail('rate_limited', 'Please wait before trying again.');
    const account = await this.repository.findByEmail(email);
    const eligible = candidate => candidate?.status === 'active' && candidate.emailLoginEnabled === true && candidate.verifiedEmail === email;
    const token = `${account?.id ?? this.crypto.id()}.${this.crypto.random()}`, hash = await this.crypto.hash('email', token), expiresAt = this.clock() + 600000;
    if (eligible(account)) this.background(context, async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const current = attempt ? await this.repository.get(account.id) : account; if (!eligible(current)) return;
        const revision = current.revision;
        current.emailChallenges = [...(current.emailChallenges || []).filter(c => c.expiresAt > this.clock()).slice(-3), { purpose: 'login', email, emailRevision: current.emailVerifiedAt, hash, expiresAt }];
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
    if (!account || account.status !== 'active' || account.emailLoginEnabled !== true || !challenge || challenge.email !== account.verifiedEmail || challenge.emailRevision !== account.emailVerifiedAt) fail('unauthorized', 'Email login failed.');
    const revision = account.revision; account.emailChallenges = account.emailChallenges.filter(c => c !== challenge);
    this.interactive(account,'sign-in',context); const result = await this.session(account,{source:'email'}); await this.save(account, revision); return result;
  }
  async configureEmailLogin(input, context) {
    const { account } = await this.recent(context); const revision = account.revision;
    if (typeof input.enabled !== 'boolean') fail('invalid_request', 'Choose whether email can sign in to this account.');
    if (input.enabled && !account.verifiedEmail) fail('verified_email_required', 'Verify a contact email before enabling email sign-in.');
    if (input.enabled && account.emailLoginEnabled !== true) this.securityChanged(account);
    account.emailLoginEnabled = input.enabled;
    account.emailChallenges = (account.emailChallenges || []).filter(challenge => challenge.purpose !== 'login');
    this.audit(account, input.enabled ? 'email-login-enabled' : 'email-login-disabled');
    await this.save(account, revision); return { emailLoginEnabled: account.emailLoginEnabled, account: await this.projectAccount(account) };
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
  /** Wire identity.email-remove (account-deletion-export.md §3): one CAS removes the verified email, clears email
   * sign-in and every email challenge, releases the email index (repository CAS), records the notice waiver when
   * it is needed, and bumps `security`. Step-up (5 min) and CSRF; never removes credentials or recovery. */
  async emailRemove(input, context) {
    const { account, session } = await this.authorized(context, true); const revision = account.revision;
    if (!this.emailRemovalEnabled(account.id)) fail('email_removal_unavailable', 'Email removal is not available.', 404);
    this.requireStepUp(session, 300000);
    if (!input || typeof input !== 'object' || Object.keys(input).some(name => !['confirmed', 'waiveNotice', 'expectedEmail'].includes(name)) || input.waiveNotice !== undefined && typeof input.waiveNotice !== 'boolean') fail('invalid_request', 'Unsupported email removal request.', 400);
    if (input.confirmed !== true) fail('confirmation_required', 'Confirm that you want to remove your email.', 400);
    const removed = account.verifiedEmail;
    if (!removed) fail('email_not_linked', 'This account has no verified email.', 409);
    // A removal confirmed while looking at one address never removes a different, newer one.
    if (input.expectedEmail !== undefined && input.expectedEmail !== removed) fail('email_changed', 'Your email changed. Reload and try again.', 409);
    const channels = await this.noticeChannels(account.id), waived = !channels.ready;
    if (waived && input.waiveNotice !== true) fail('last_notice_channel', 'Email is your only notice channel. Enable notifications on a device first, or confirm that you accept in-app notices only.', 409);
    // The waiver is consent under the current terms; it is recorded only when no other channel exists.
    if (waived) { this.requireCurrentTerms(account); account.noticeWaiver = { at: this.clock(), termsVersion: this.config.termsVersion }; }
    this.rememberPreviousEmail(account); this.authorityEvent(account, 'email-changed'); account.verifiedEmail = null; account.emailVerifiedAt = null; account.emailLoginEnabled = false; account.emailChallenges = [];
    this.audit(account, 'email-removed'); this.securityChanged(account);
    await this.save(account, revision);
    // Notices are best effort after commit; acceptance is not delivery.
    const notified = { email: false, push: false };
    try { if (typeof this.mailer?.sendSecurityAlert === 'function') { await this.mailer.sendSecurityAlert({ email: removed, type: 'email-removed', owner: account.id }); notified.email = true; } } catch {}
    try { if (channels.ready && typeof this.accountChannels?.notify === 'function') notified.push = (await this.accountChannels.notify(account.id, 'email-removed'))?.accepted > 0; } catch {}
    return { removed: true, noticeWaived: waived, notified, account: await this.projectAccount(account) };
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
