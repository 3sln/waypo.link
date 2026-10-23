// ORG-4, 3sln.me as a HOME provider (packages/identity/member-certificates.mjs), engine level: the key-delegation.v1
// member-certificate profile (exact members, certification key, never the identity key), consent per (organization,
// client) with the observed client, `aep` (packages/identity/authority-epoch.mjs), lifetime choice, several keys per
// consent, status and revocation, flag scope, and seeded issuance/revocation races.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteMetadata } from '../apps/node/resources.mjs';
import { createAppEngine, perform, read } from '../packages/app/engine.mjs';
import { memoryAudit } from '../packages/app/providers.mjs';
import { IdentityKeyRegistry } from '../packages/identity/keys.mjs';
import { authorityEpoch, raiseAuthorityEpoch, AUTHORITY_EPOCH_FIELD } from '../packages/identity/authority-epoch.mjs';
import { MemberCertificateIssuer, memberCertificatesProvider, certificationSigner, certificationKeyList, parseMemberCertificate, verifyMemberSignature, memberHolderKey, signMemberPop, memberCertificateLifetime, memberStatusCacheControl, GrantMemberConsent, AcquireMemberConsentCertificate, IssueMemberCertificate, RevokeMemberConsent, RevokeMemberKey, MemberCertificateList, MemberCertificateStatus, MEMBER_PURPOSES, MEMBER_CERTIFICATE_TYP, MEMBER_CERTIFICATE_MEMBERS, MEMBER_KEYS_PER_CONSENT, MEMBER_POP_DOMAIN } from '../packages/identity/member-certificates.mjs';
import { DELEGATION_TYP, POP_DOMAIN } from '../packages/identity/delegation.mjs';
import { fakeClock, forEachSeed, concurrently } from './helpers/chaos.mjs';
import { holder, sealing, registryStore } from './helpers/member-certificates.mjs';

const ISSUER = 'https://3sln.example', ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ORG = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', OTHER_ORG = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const AUD = `${ISSUER}/identity/${ORG}`, OTHER_AUD = `${ISSUER}/identity/${OTHER_ORG}`;
const ERP = { client_id: 'https://erp.example/client.json', origin: 'https://erp.example' }, EVIL = { client_id: 'https://erp.example/client.json', origin: 'https://evil.example' };
const ACCESS = [MEMBER_PURPOSES.access], BOTH = Object.values(MEMBER_PURPOSES).sort();
const code = c => ({ code: c });

async function fixture({ seed = 1, enabled = true } = {}) {
  const metadata = new SqliteMetadata(':memory:'), clock = fakeClock(1800000000000), state = { status: 'active', aep: 0, enabled, orgLifetime: null };
  await metadata.put('owner', ALICE);
  const keys = new IdentityKeyRegistry({ store: registryStore(metadata), ...sealing, clock: clock.now });
  await keys.ensure(ALICE, 'signing');
  const issuer = new MemberCertificateIssuer({ metadata, issuer: ISSUER, account: async owner => owner === ALICE ? { status: state.status } : null, authorityEpoch: async () => { if (state.aep === 'broken') throw new Error('unreadable'); return state.aep; }, identityURI: owner => `${ISSUER}/identity/${owner}`, signer: certificationSigner({ metadata, ...sealing, clock: clock.now }), orgLifetime: async () => state.orgLifetime, enabled: () => state.enabled, clock: clock.now });
  const engine = createAppEngine({ providers: { clock: { now: clock.now }, random: { uuid: () => crypto.randomUUID() }, audit: memoryAudit({ clock: { now: clock.now } }), memberCertificates: memberCertificatesProvider(issuer) } });
  const owner = { kind: 'owner', owner: ALICE }, session = client => ({ ...owner, client }), app = client => ({ kind: 'app', owner: ALICE, client });
  const consent = (input = {}, client = ERP) => perform(engine, new GrantMemberConsent({ actor: session(client), input: { aud: AUD, purposes: ACCESS, ...input } }));
  const pop = async (key, { aud = AUD, client = ERP, iat = Math.floor(clock.now() / 1000), subject = ALICE } = {}) => signMemberPop({ privateKey: key.privateKey, aud, clientId: client.client_id, iat, issuer: ISSUER, jkt: key.jkt, subject });
  const issue = async (key, { actor = app(ERP), aud = AUD, purposes = ACCESS, client = ERP, proof, lifetime, extra = {} } = {}) => perform(engine, new IssueMemberCertificate({ actor, input: { aud, purposes, delegate: key.jwk, proof: proof ?? await pop(key, { aud, client }), ...lifetime === undefined ? {} : { lifetime }, ...actor.kind === 'owner' ? { client } : {}, ...extra } }));
  const status = jkt => read(engine, new MemberCertificateStatus({ actor: { kind: 'public', owner: ALICE }, input: { jkt } }));
  const list = () => read(engine, new MemberCertificateList({ actor: owner }));
  const revokeConsent = (input, actor = owner) => perform(engine, new RevokeMemberConsent({ actor, input }));
  const revokeKey = (input, actor = owner) => perform(engine, new RevokeMemberKey({ actor, input }));
  return { metadata, clock, state, keys, issuer, engine, owner, session, app, consent, pop, issue, status, list, revokeConsent, revokeKey };
}

test('a certificate has exactly the profile members, the member typ, the current aep and the certification key', async () => {
  const f = await fixture(), key = await holder();
  await f.consent();
  const issued = await f.issue(key);
  const parsed = parseMemberCertificate(issued.certificate);
  assert.deepEqual(Object.keys(parsed.header), ['alg', 'kid', 'typ']); assert.equal(parsed.header.typ, MEMBER_CERTIFICATE_TYP);
  assert.deepEqual(Object.keys(parsed.payload), MEMBER_CERTIFICATE_MEMBERS);
  assert.deepEqual({ ...parsed.payload, jti: undefined, iat: undefined, exp: undefined }, { bindle: 'member-certificate', v: 1, iss: ISSUER, sub: ALICE, identity: `${ISSUER}/identity/${ALICE}`, aud: AUD, purposes: ACCESS, client: ERP, cnf: { jkt: key.jkt }, delegate: key.jwk, aep: 0, jti: undefined, iat: undefined, exp: undefined });
  assert.equal(parsed.payload.exp - parsed.payload.iat, 660, '3sln.me defaults to about 11 minutes');
  assert.ok(await memberHolderKey(parsed.payload));
  const certification = await certificationKeyList(f.metadata, ALICE);
  assert.equal(certification.length, 1); assert.equal(certification[0].kid, parsed.header.kid); assert.equal(certification[0].state, 'active');
  assert.equal(await verifyMemberSignature(parsed, certification[0].publicJwk), true);
  // R4-H1: never the identity signing key (the key in recovery files).
  const signing = await f.keys.current(ALICE, { purpose: 'signing' });
  assert.notEqual(signing.kid, parsed.header.kid); assert.equal(await verifyMemberSignature(parsed, signing.publicJwk), false);
  assert.equal(issued.status, `${ISSUER}/identity/${ALICE}/delegations/${key.jkt}`); assert.equal(issued.aep, 0);
  // Domains differ from BindleBox's profile and PoP.
  assert.notEqual(MEMBER_CERTIFICATE_TYP, DELEGATION_TYP); assert.notEqual(MEMBER_POP_DOMAIN, POP_DOMAIN);
  assert.deepEqual(await f.status(key.jkt), { status: 'active', final: false });
  // A second issuance reuses the certification key (no churn); concurrent first uses keep exactly one key.
  await f.issue(key); assert.equal((await certificationKeyList(f.metadata, ALICE)).length, 1);
});

test('concurrent first certification-key uses keep exactly one active key', async () => {
  const metadata = new SqliteMetadata(':memory:'), signer = certificationSigner({ metadata, ...sealing });
  const results = await Promise.all(Array.from({ length: 6 }, () => signer(ALICE)));
  assert.equal(new Set(results.map(r => r.kid)).size, 1);
  const listed = await certificationKeyList(metadata, ALICE); assert.equal(listed.filter(k => k.state === 'active').length, 1);
});

test('issuance needs a live consent for exactly this (organization, client), with the observed origin', async () => {
  const f = await fixture(), key = await holder();
  await assert.rejects(f.issue(key), code('consent_required'));
  await f.consent();
  // The same client_id observed at another origin is another client (R2-M3).
  await assert.rejects(f.issue(key, { actor: f.app(EVIL), client: EVIL }), code('consent_required'));
  // Another organization is another consent.
  await assert.rejects(f.issue(key, { aud: OTHER_AUD }), code('consent_required'));
  // Purposes beyond the consent.
  await assert.rejects(f.issue(key, { purposes: BOTH }), code('consent_required'));
  // The member's session may issue for a consented client; it names the client, which must match the consent.
  const viaSession = await f.issue(key, { actor: f.owner, client: ERP }); assert.ok(viaSession.certificate);
  await assert.rejects(f.issue(await holder(), { actor: f.owner, client: EVIL }), code('consent_required'));
  // An app actor without an observed client is refused; a body cannot name the client for it.
  await assert.rejects(perform(f.engine, new IssueMemberCertificate({ actor: { kind: 'app', owner: ALICE }, input: { aud: AUD, purposes: ACCESS, delegate: key.jwk, proof: await f.pop(key) } })), code('forbidden'));
  await assert.rejects(perform(f.engine, new IssueMemberCertificate({ actor: f.app(ERP), input: { aud: AUD, purposes: ACCESS, delegate: key.jwk, proof: await f.pop(key), client: EVIL } })), code('invalid_request'));
  // A consent comes only from a session actor with an observed client.
  await assert.rejects(perform(f.engine, new GrantMemberConsent({ actor: f.app(ERP), input: { aud: AUD, purposes: ACCESS } })), code('forbidden'));
  await assert.rejects(perform(f.engine, new GrantMemberConsent({ actor: f.owner, input: { aud: AUD, purposes: ACCESS } })), code('invalid_request'));
});

test('proof of possession, key aliasing and malformed requests are refused', async () => {
  const f = await fixture(), key = await holder(), other = await holder(), now = Math.floor(f.clock.now() / 1000);
  await f.consent();
  await assert.rejects(f.issue(key, { proof: await f.pop(other) }), code('invalid_request'), 'PoP by another key');
  await assert.rejects(f.issue(key, { proof: await f.pop(key, { aud: OTHER_AUD }) }), code('invalid_request'), 'PoP for another organization');
  await assert.rejects(f.issue(key, { proof: await f.pop(key, { iat: now - 121 }) }), code('invalid_request'), 'stale PoP');
  await assert.rejects(f.issue(key, { proof: await f.pop(key, { subject: ORG }) }), code('invalid_request'), 'PoP for another subject');
  await assert.rejects(f.issue(key, { extra: { since: 1 } }), code('invalid_request'));
  await assert.rejects(f.issue({ ...key, jwk: { ...key.jwk, d: 'x' } }), code('invalid_request'));
  await assert.rejects(f.issue(key, { purposes: [MEMBER_PURPOSES.access, MEMBER_PURPOSES.access] }), code('invalid_request'));
  await assert.rejects(f.issue(key, { lifetime: 59 }), code('invalid_request'));
  // A holder key equal to an identity key (current or former) of the account is refused.
  const alias = await holder();
  await f.keys.register(ALICE, { kid: 'imported-identity-key', alg: 'ES256', publicJwk: alias.jwk });
  await assert.rejects(f.issue(alias), code('invalid_request'));
});

test('aep: certificates carry the current epoch; an authority reset retires every earlier consent and key; no epoch, no certificate', async () => {
  const f = await fixture(), key = await holder();
  await f.consent(); const before = await f.issue(key); assert.equal(parseMemberCertificate(before.certificate).payload.aep, 0);
  f.state.aep = 1; // recovery completed elsewhere (identity record CAS)
  assert.deepEqual(await f.status(key.jkt), { status: 'revoked', revokedHour: Math.floor(f.clock.now() / 3600000), final: true }, 'the first observed mismatch is persisted');
  await assert.rejects(f.issue(await holder()), code('consent_required'), 'a consent from before the reset does not carry over');
  await f.consent();
  await assert.rejects(f.issue(key), code('delegation_revoked'), 'a key from before the reset is never certified again');
  const after = await f.issue(await holder()); assert.equal(parseMemberCertificate(after.certificate).payload.aep, 1);
  f.state.aep = 'broken';
  await assert.rejects(f.issue(await holder()), code('member_certificates_unavailable'));
  await assert.rejects(f.status(parseMemberCertificate(after.certificate).payload.cnf.jkt), code('member_certificates_unavailable'));
  // The record helpers: absent reads as 0, raise is monotonic with a floor, malformed fails closed.
  const account = {}; assert.equal(authorityEpoch(account), 0); assert.equal(raiseAuthorityEpoch(account, { reason: 'recovery' }), 1); assert.equal(raiseAuthorityEpoch(account, { reason: 'transfer-in', floor: 7 }), 7); assert.equal(raiseAuthorityEpoch(account, { reason: 'transfer-in', floor: 3 }), 8);
  assert.throws(() => authorityEpoch({ [AUTHORITY_EPOCH_FIELD]: -1 }), code('identity_authority_epoch_unavailable')); assert.throws(() => raiseAuthorityEpoch({}, { reason: 'session' }), TypeError);
});

test('lifetime is the issuer choice: host setting, a same-host organization setting and a shorter client request', async () => {
  assert.equal(memberCertificateLifetime(undefined), 660); assert.equal(memberCertificateLifetime('300'), 300); assert.equal(memberCertificateLifetime(86400), 660); assert.equal(memberCertificateLifetime(59), null); assert.equal(memberCertificateLifetime('abc'), null);
  const f = await fixture(), key = await holder(); await f.consent();
  const span = issued => { const p = parseMemberCertificate(issued.certificate).payload; return p.exp - p.iat; };
  f.state.orgLifetime = 300; assert.equal(span(await f.issue(key)), 300, 'the organization shortened it');
  assert.equal(span(await f.issue(key, { lifetime: 120 })), 120, 'the client asked for less');
  f.state.orgLifetime = 'nonsense'; assert.equal(span(await f.issue(key)), 660, 'an unusable organization value is ignored');
  const broken = new MemberCertificateIssuer({ metadata: f.metadata, issuer: ISSUER, lifetime: 10, enabled: () => true, account: async () => ({ status: 'active' }), authorityEpoch: async () => 0, identityURI: o => `${ISSUER}/identity/${o}`, signer: async () => null });
  await assert.rejects(broken.issue(ALICE, f.app(ERP), { aud: AUD, purposes: ACCESS, delegate: key.jwk, proof: await f.pop(key) }), code('member_certificates_unavailable'));
});

test('several keys per consent stay active (R2-M5); beyond the bound the oldest is superseded', async () => {
  const f = await fixture(); await f.consent();
  const keys = []; for (let i = 0; i < MEMBER_KEYS_PER_CONSENT; i++) { keys.push(await holder()); await f.issue(keys[i]); }
  for (const key of keys) assert.equal((await f.status(key.jkt)).status, 'active');
  // A second organization or client never revokes the first.
  await f.consent({ aud: OTHER_AUD }); await f.issue(await holder(), { aud: OTHER_AUD });
  assert.equal((await f.status(keys[0].jkt)).status, 'active');
  const extra = await holder(); await f.issue(extra);
  assert.equal((await f.status(keys[0].jkt)).status, 'revoked'); assert.equal((await f.status(keys[1].jkt)).status, 'active'); assert.equal((await f.status(extra.jkt)).status, 'active');
  // A key never moves to another consent: presenting it for another organization revokes it there and refuses.
  await assert.rejects(f.issue(keys[1], { aud: OTHER_AUD }), code('delegation_revoked')); assert.equal((await f.status(keys[1].jkt)).status, 'revoked');
});

test('revocation: by consent, by key (an app only its own), all; status privacy; the member sees consents with their keys', async () => {
  const f = await fixture(), a = await holder(), b = await holder(), c = await holder();
  await f.consent(); await f.consent({}, EVIL);
  await f.issue(a); await f.issue(b); await f.issue(c, { actor: f.app(EVIL), client: EVIL });
  const view = await f.list();
  assert.equal(view.consents.length, 2); assert.deepEqual(view.consents.find(x => x.client.origin === ERP.origin).keys.map(k => k.jkt).sort(), [a.jkt, b.jkt].sort());
  assert.ok(!JSON.stringify(view).includes('eyJ'), 'no certificate bytes in the owner view');
  await assert.rejects(f.revokeKey({ jkt: c.jkt }, f.app(ERP)), code('not_found'), 'an app sees only its own keys');
  assert.deepEqual(await f.revokeKey({ jkt: b.jkt }, f.app(ERP)), { revoked: 1 });
  assert.equal((await f.status(b.jkt)).final, true);
  const consentId = view.consents.find(x => x.client.origin === ERP.origin).id;
  assert.deepEqual(await f.revokeConsent({ consent: consentId }), { consents: 1, keys: 1 });
  assert.equal((await f.status(a.jkt)).status, 'revoked'); assert.equal((await f.status(c.jkt)).status, 'active');
  await assert.rejects(f.issue(await holder()), code('consent_required'));
  assert.deepEqual(await f.revokeConsent({ all: true, reason: 'suspended' }, { kind: 'system', owner: ALICE }), { consents: 1, keys: 1 });
  await assert.rejects(f.revokeConsent({ all: true, reason: 'suspended' }), code('invalid_request'), 'an owner cannot choose a system reason');
  // Unknown keys, malformed jkts and other subjects all answer the same non-final revoked.
  assert.deepEqual(await f.status((await holder()).jkt), { status: 'revoked', final: false });
  assert.deepEqual(await f.status('nope'), { status: 'revoked', final: false });
  assert.deepEqual(await f.issuer.status(ORG, a.jkt), { status: 'revoked', final: false });
  assert.equal(memberStatusCacheControl({ final: true }), 'public, max-age=86400, immutable'); assert.equal(memberStatusCacheControl({ status: 'active' }), 'public, max-age=60');
  // An inactive account answers non-final revoked for live keys and issues nothing.
  await f.consent(); const d = await holder(); await f.issue(d); f.state.status = 'suspended';
  assert.deepEqual(await f.status(d.jkt), { status: 'revoked', final: false }); await assert.rejects(f.issue(await holder()), code('forbidden'));
});

test('MEMBER_CERTIFICATES_ENABLED gates consent and issuance only; listing, revocation and status stay available', async () => {
  const f = await fixture(), key = await holder(); await f.consent(); await f.issue(key);
  f.state.enabled = false;
  await assert.rejects(f.consent({ aud: OTHER_AUD }), code('not_found'));
  await assert.rejects(f.issue(await holder()), code('not_found'));
  assert.equal((await f.list()).consents.length, 1);
  assert.equal((await f.status(key.jkt)).status, 'active');
  assert.deepEqual(await f.revokeKey({ jkt: key.jkt }), { revoked: 1 });
});

test('a narrower consent revokes keys holding a dropped purpose; re-consent is idempotent', async () => {
  const f = await fixture(), wide = await holder(), narrow = await holder();
  await f.consent({ purposes: BOTH }); await f.issue(wide, { purposes: BOTH }); await f.issue(narrow);
  const again = await f.consent({ purposes: BOTH }); assert.equal(again.keys.filter(k => k.state === 'active').length, 2);
  await f.consent({ purposes: ACCESS });
  assert.equal((await f.status(wide.jkt)).status, 'revoked'); assert.equal((await f.status(narrow.jkt)).status, 'active');
});

test('seeded races: issuance against consent revocation and authority resets never leaves an active key behind a dead consent', async () => {
  await forEachSeed(12, async random => {
    const f = await fixture({ seed: random.seed }); await f.consent();
    const keys = await Promise.all(Array.from({ length: 4 }, () => holder()));
    const issued = new Map(), tasks = [...keys.map(key => async () => { const r = await f.issue(key); issued.set(key.jkt, r); return r; }), () => f.revokeConsent({ aud: AUD }), () => { f.state.aep = random.chance(0.5) ? 1 : 0; return null; }, () => f.consent()];
    await concurrently(random.shuffle(tasks));
    const view = await f.list(), consent = view.consents[0];
    for (const key of keys) {
      const s = await f.status(key.jkt);
      if (s.status === 'active') { assert.equal(consent.state, 'active', `seed=${random.seed}`); assert.equal(parseMemberCertificate(issued.get(key.jkt).certificate).payload.aep, f.state.aep, `seed=${random.seed} active key from another epoch`); }
    }
    for (const row of view.consents) if (row.state === 'revoked') for (const k of row.keys) assert.equal(k.state, 'revoked', `seed=${random.seed}`);
  });
});

// ---- ORG-6a review M1: consent and first issuance commit together ----
const acquireWith = (f, key, { proof, client = ERP, actor } = {}) => (async () => perform(f.engine, new AcquireMemberConsentCertificate({ actor: actor ?? f.session(client), input: { aud: AUD, purposes: ACCESS, delegate: key.jwk, proof: proof ?? await f.pop(key, { client }) } })))();

test('M1: a stale or refused proof at acquisition leaves no active consent behind, and a fresh proof then succeeds', async () => {
  const f = await fixture(), key = await holder(), stale = await f.pop(key, { iat: Math.floor(f.clock.now() / 1000) - 121 });
  await assert.rejects(acquireWith(f, key, { proof: stale }), code('invalid_request'));
  await assert.rejects(acquireWith(f, key, { proof: { ...await f.pop(key), signature: 'A'.repeat(86) } }), code('invalid_request'));
  assert.deepEqual((await f.list()).consents, [], 'no consent survives a failed acquisition');
  const issued = await acquireWith(f, key);
  assert.equal(parseMemberCertificate(issued.certificate).payload.cnf.jkt, key.jkt);
  const [consent] = (await f.list()).consents;
  assert.equal(consent.state, 'active'); assert.deepEqual(consent.keys.map(k => k.jkt), [key.jkt]);
  assert.equal((await f.status(key.jkt)).status, 'active');
});

test('M1: a failed re-acquisition never revives a revoked consent nor changes an active one', async () => {
  const f = await fixture(), first = await holder(), second = await holder();
  await acquireWith(f, first); await f.revokeConsent({ aud: AUD, clientId: ERP.client_id });
  const stale = await f.pop(second, { iat: Math.floor(f.clock.now() / 1000) - 600 });
  await assert.rejects(acquireWith(f, second, { proof: stale }), code('invalid_request'));
  let [consent] = (await f.list()).consents; assert.equal(consent.state, 'revoked');
  await acquireWith(f, second); [consent] = (await f.list()).consents;
  assert.equal(consent.state, 'active'); assert.deepEqual(consent.keys.map(k => [k.jkt, k.state]), [[first.jkt, 'revoked'], [second.jkt, 'active']]);
  const before = JSON.stringify((await f.list()).consents);
  await assert.rejects(acquireWith(f, await holder(), { proof: { iat: 1, signature: 'A'.repeat(86) } }), code('invalid_request'));
  assert.equal(JSON.stringify((await f.list()).consents), before);
});

test('M1: acquisition is owner-session only with the observed client', async () => {
  const f = await fixture(), key = await holder();
  await assert.rejects(acquireWith(f, key, { actor: f.app(ERP) }), code('forbidden'));
  await assert.rejects(acquireWith(f, key, { actor: f.owner }), code('invalid_request'));
  assert.deepEqual((await f.list()).consents, []);
});

test('M1: seeded concurrent first acquisitions and revocations never leave a key active under a revoked consent', async () => {
  await forEachSeed(10, async random => {
    const f = await fixture(), keys = await Promise.all([holder(), holder(), holder()]);
    const tasks = random.shuffle([...keys.map(key => () => acquireWith(f, key)), () => f.revokeConsent({ all: true })]);
    await Promise.allSettled(tasks.map(task => task()));
    const consents = (await f.list()).consents;
    assert.ok(consents.length <= 1);
    for (const key of keys) {
      const status = (await f.status(key.jkt)).status;
      if (status === 'active') assert.equal(consents[0]?.state, 'active');
    }
    if (consents[0]?.state === 'revoked') assert.ok(consents[0].keys.every(k => k.state === 'revoked'));
  });
});
