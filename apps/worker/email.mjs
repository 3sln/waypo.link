import {capability,siteGlobal} from '../../packages/flags/read.mjs';
import {approvalNoticeTemplate} from './approval-notices.mjs';
import { emailLogoBase64 } from '../../packages/branding/email-logo.mjs';
import { createLocalization } from '../../packages/i18n/index.mjs';
import { waitlistMailLocalization } from '../../packages/i18n/waitlist-mail.mjs';
import { UUID } from '../../packages/core/primitives.mjs';
import {deletionNoticeTemplate} from '../../packages/runtime/deletion-notices.mjs';
import {transferNoticeTemplate} from '../../packages/identity/transfer-out.mjs';
import {redirectReminderTemplate} from '../../packages/identity/redirect-records.mjs';

const SENDER_ROLES = Object.freeze({
  link: 'verify', login: 'login', reminder: 'notify',
  account: 'accounts', security: 'security'
});
const PROVIDER_CODES = new Set([
  'E_VALIDATION_ERROR', 'E_FIELD_MISSING', 'E_SENDER_NOT_VERIFIED',
  'E_RECIPIENT_NOT_ALLOWED', 'E_RECIPIENT_SUPPRESSED', 'E_SENDER_DOMAIN_NOT_AVAILABLE',
  'E_CONTENT_TOO_LARGE', 'E_DELIVERY_FAILED', 'E_RATE_LIMIT_EXCEEDED',
  'E_DAILY_LIMIT_EXCEEDED', 'E_INTERNAL_SERVER_ERROR', 'E_HEADER_NOT_ALLOWED',
  'E_HEADER_USE_API_FIELD', 'E_HEADER_VALUE_INVALID', 'E_HEADER_VALUE_TOO_LONG',
  'E_HEADER_NAME_INVALID', 'E_HEADERS_TOO_LARGE', 'E_HEADERS_TOO_MANY'
]);
const ACCOUNT_NOTICES = Object.freeze({
  'app-removal-reminder': ['An app has not finished cleanup on {brand}', 'An app you asked to remove has not finished cleaning up. It still has all its access and keeps working normally. Sign in, open Connections and choose Remove now to end its access, or wait for cleanup.'],
  'suspension-warning': ['Action required: your {brand} account will be suspended in {days} days', 'We have tried to reach you about your unpaid account. Sign in and confirm you still want to use it before the deadline. Otherwise, your account will be suspended in {days} days. Suspension retains your hosted data but blocks normal account access and changes.'],
  'deletion-warning': ['Action required: your {brand} account will be deleted in {days} days', 'Your unpaid account is suspended. Sign in and confirm you still want to use it within {days} days to reactivate it. Otherwise, your account and data stored on {brand} will be deleted. Data in connected external storage providers will not be deleted by us.'],
  'suspended-notice': ['Action required: your {brand} account is suspended', 'Your unpaid account is suspended after a period without use. Sign in and confirm you still want to use it to reactivate it. Suspension retains your hosted data but blocks normal account access and changes.'],
  'inactivity-warning': ['Review your {brand} account', 'Your account needs an activity review. Open your personal space to review its current status and options.'],
  'deletion-scheduled': ['Review scheduled {brand} account deletion', 'Account deletion has been scheduled. Open your personal space to review the schedule and available options.'],
  'deletion-cancelled': ['{brand} account deletion cancelled', 'Scheduled account deletion has been cancelled. Open your personal space to review your account.']
});
const SECURITY_ALERTS = Object.freeze({
  'recovery-used': ['{brand} account recovery used', 'An account recovery file was used.'],
  'passkey-added': ['{brand} passkey added', 'A passkey was added to your account. Not you? Sign in from a device you already use, remove the passkey and replace your recovery file, or recover the account with your recovery file.'],
  'email-changed': ['{brand} account email changed', 'The email address of your account was changed. This address keeps receiving security notices for 30 days. Not you? Sign in from a device you already use and secure your account, or recover it with your recovery file.'],
  'sessions-revoked': ['{brand} devices signed out', 'Other devices were signed out of your account. Not you? Recover the account with your recovery file, or sign in again and secure it.'],
  'passkey-removed': ['{brand} passkey removed', 'A passkey was removed from your account. Not you? Recover the account with your recovery file, or sign in from a device you already use and secure it.'],
  'sessions-evicted': ['{brand} devices signed out by new sign-ins', 'Many new sign-ins to your account signed out older devices. Not you? Recover the account with your recovery file, or sign in again and secure it.'],
  // Sign-in emails (sign-in and intents spike §3.3, §6.4): sent to every address and push channel of the account.
  'email-sign-in-enabled': ['{brand} sign-in email turned on', 'An email address on your account can now be used to sign in. Not you? Sign in from a device you already use and secure your account, or recover it with your recovery file.'],
  'email-sign-in-removed': ['{brand} sign-in email turned off', 'An email address on your account can no longer be used to sign in. Not you? Sign in from a device you already use and secure your account, or recover it with your recovery file.'],
  // Choosing another notice address (review 2026-10-29 M3): sent to every address, including the previous and the new one.
  'notice-email-changed': ['{brand} notice email changed', 'Your account now sends its ordinary notices to a different email address. Security notices still go to every verified address. Not you? Sign in from a device you already use and secure your account, or recover it with your recovery file.'],
  // DX-6: sent to the removed address. No other account detail is included.
  'email-removed': ['{brand} email removed', 'This email address was removed from a {brand} account. If you did not do this, sign in and secure your account.'],
  // DX-1 export notices (§1.4): sent on creation and on the first download from each session or CLI grant.
  'export-created': ['{brand} data export requested', 'An export of your account data was requested. Not you? Sign in, cancel the export and secure your account.'],
  'export-downloaded': ['{brand} data export downloaded', 'Your account data export was downloaded from a new session or device. Not you? Sign in, cancel the export and secure your account.'],
  // Active-account recovery reissue: the previous recovery file no longer works.
  'recovery-reissued': ['{brand} recovery file replaced', 'A new recovery file was created for your account. For the next 7 days it cannot be used to recover the account, and the replacement can be cancelled from a device that was signed in before it started, from the link below, or with your previous recovery file. Not you? Cancel it and secure your account.'],
  'recovery-reissue-started': ['{brand} recovery file replacement started', 'Someone signed in to your account started replacing its recovery file. Not you? Sign in from a device you already use and secure your account.'],
  'recovery-reissue-cancelled': ['{brand} recovery file replacement cancelled', 'The recovery file replacement was cancelled. Your previous recovery file works again and the new one never will.'],
  // The annual reissue offer (recovery file v3, 2026-10-28): a reminder only; nothing changes or expires.
  'recovery-reissue-reminder': ['{brand} time for a new recovery file', 'Your recovery file is about a year old. We suggest creating a new one: sign in, open Account & security and choose Replace recovery file. Nothing stops working; your current file keeps working until you confirm a new one.']
});
// The reissue cancel page (packages/runtime/routes/recovery-reissue.mjs); the capability stays in the fragment.
const REISSUE_CANCEL_PATH = '/account/recovery/cancel';
// ORG-12b break-glass owner notices (organizations design §12d.8; provisional). English then Spanish in one message:
// the owner's language is not known to the organization. The organization is named only by its public handle, and the
// abort link (packages/runtime/routes/org-claim-abort.mjs) carries its single-use capability in the fragment.
const ORG_CLAIM_ABORT_PATH = '/org-claim/abort';
const BREAK_GLASS_NOTICES = Object.freeze({
  'claim-started': [['Someone is claiming ownership of your organization{org}', 'Admins of your organization{org} on {brand} started a claim to make another person its owner, saying they cannot reach you. Nothing changes yet. If you did not agree to this, stop the claim with the link below: it needs no sign-in and no proof. Any sign-in to your account also puts the claim on hold for review.'], ['Alguien reclama la propiedad de tu organización{org}', 'Administradores de tu organización{org} en {brand} iniciaron una reclamación para que otra persona sea su propietaria, diciendo que no pueden contactarte. Todavía no cambia nada. Si no estás de acuerdo, detén la reclamación con el enlace de abajo: no necesita iniciar sesión ni ninguna prueba. Cualquier inicio de sesión en tu cuenta también pone la reclamación en espera para revisión.']],
  'wait-started': [['An ownership claim on your organization{org} is now waiting', 'The candidate paid, so the claim on your organization{org} now waits at least 30 days before it could take effect. You can stop it at any time before then with the link below.'], ['Una reclamación de propiedad sobre tu organización{org} está en espera', 'La persona candidata pagó, así que la reclamación sobre tu organización{org} espera al menos 30 días antes de poder surtir efecto. Puedes detenerla en cualquier momento antes con el enlace de abajo.']],
  reminder: [['Reminder: an ownership claim on your organization{org} is pending', 'A claim to change the owner of your organization{org} is still pending. If you did not agree to it, stop it with the link below.'], ['Recordatorio: hay una reclamación de propiedad pendiente sobre tu organización{org}', 'Sigue pendiente una reclamación para cambiar la propiedad de tu organización{org}. Si no estás de acuerdo, detenla con el enlace de abajo.']],
  'final-reminder': [['Final notice: your organization{org} may change owner in 3 days', 'Unless you stop it, a claim will make another person the owner of your organization{org} in about 72 hours. Stop it with the link below if you did not agree.'], ['Último aviso: tu organización{org} puede cambiar de propietario en 3 días', 'Salvo que la detengas, una reclamación hará que otra persona sea propietaria de tu organización{org} en unas 72 horas. Detenla con el enlace de abajo si no estás de acuerdo.']],
  held: [['The ownership claim on your organization{org} is on hold', '3sln.me support will review the claim on your organization{org} before anything can happen. You can still stop it with the link below.'], ['La reclamación sobre tu organización{org} está en espera', 'El soporte de 3sln.me revisará la reclamación sobre tu organización{org} antes de que pueda pasar nada. Aún puedes detenerla con el enlace de abajo.']],
  proceed: [['Support allowed an ownership claim on your organization{org}', 'After review, 3sln.me support decided that the claim on your organization{org} may proceed. It takes effect in 7 days unless you answer. Use the link below to dispute it, or sign in with a passkey you had before the claim began to end it.'], ['El soporte permitió una reclamación sobre tu organización{org}', 'Tras revisarla, el soporte de 3sln.me decidió que la reclamación sobre tu organización{org} puede continuar. Surte efecto en 7 días salvo que respondas. Usa el enlace de abajo para disputarla, o inicia sesión con una llave de acceso que tuvieras antes de la reclamación para terminarla.']],
  effective: [['Your organization{org} has a new owner', 'A break-glass claim made another person the owner of your organization{org}. You remain a member. For 90 days you can contest the change: sign in with a passkey you had before the claim began and open the organization.'], ['Tu organización{org} tiene una nueva persona propietaria', 'Una reclamación de emergencia hizo que otra persona sea propietaria de tu organización{org}. Sigues siendo miembro. Durante 90 días puedes impugnar el cambio: inicia sesión con una llave de acceso que tuvieras antes de la reclamación y abre la organización.']],
  ended: [['The ownership claim on your organization{org} has ended', 'The claim on your organization{org} has ended. Its owner did not change. Sign in to review the organization and its members.'], ['La reclamación sobre tu organización{org} terminó', 'La reclamación sobre tu organización{org} terminó. Su propiedad no cambió. Inicia sesión para revisar la organización y sus miembros.']],
  update: [['News about an ownership claim on your organization{org}', 'There is news about a claim on your organization{org}. Sign in to review it.'], ['Novedades sobre una reclamación de tu organización{org}', 'Hay novedades sobre una reclamación de tu organización{org}. Inicia sesión para revisarla.']]
});

function safeHeader(value, max = 2048) {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}
function validEmail(value) {
  if (!safeHeader(value, 254) || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+$/.test(value)) return false;
  const [local, domain] = value.split('@');
  return local.length <= 64 && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..') && domain.includes('.') && domain.split('.').every(part => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(part));
}
function validOrigin(value) {
  if (!safeHeader(value)) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && url.origin === value; }
  catch { return false; }
}
function validSenderDomain(value) {
  // Longest fixed local part is eight characters; complete address <=254.
  return safeHeader(value, 245) && value.includes('.') && !/^\d+\.\d+\.\d+\.\d+$/.test(value) && value.split('.').every(part => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(part));
}
function requireToken(value) {
  if (!safeHeader(value, 1024)) throw new Error('Invalid mail link.');
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
function emailPresentation({ subject, text, brand, origin }) {
  const branded = origin === 'https://3sln.me' && brand === '3sln.me';
  // Only trusted, generated HTTPS links are made clickable. Every text and
  // attribute value is escaped; no remote image requests or tracking pixels.
  const paragraphs = text.split('\n\n').map(paragraph => `<p style="margin:0 0 20px;line-height:1.6">${paragraph.split('\n').map(line => {
    const match = line.match(/https:\/\/[^\s]+$/);
    if (!match) return escapeHtml(line);
    const url = match[0];
    if (!url.startsWith(`${origin}/`)) return escapeHtml(line);
    return `${escapeHtml(line.slice(0, match.index))}<a href="${escapeHtml(url)}" style="color:#3156c8;overflow-wrap:anywhere">${escapeHtml(url)}</a>`;
  }).join('<br>')}</p>`).join('');
  return {
    html: `<!doctype html><html><body style="margin:0;background:#f4f5f7;color:#202532;font-family:Arial,sans-serif"><main style="max-width:560px;margin:24px auto;background:#fff;padding:32px;border-radius:16px">${branded ? '<img src="cid:3sln-logo" alt="3sln" width="56" height="56" style="display:block;margin-bottom:20px">' : ''}<div style="font-size:14px;color:#596170;margin-bottom:12px">${escapeHtml(brand)}</div><h1 style="font-size:23px;line-height:1.3;margin:0 0 24px">${escapeHtml(subject)}</h1>${paragraphs}</main></body></html>`,
    ...(branded ? { attachments: [{ content: emailLogoBase64, filename: '3sln-avatar.png', type: 'image/png', disposition: 'inline', contentId: '3sln-logo' }] } : {})
  };
}

/** Hosted Cloudflare resource; portable services receive this through injection.
 * EMAIL.send acknowledges acceptance with messageId, without a documented
 * idempotency facility. Retry keys are not forwarded as deduplication promises.
 */
export function mailTransport(env = {}) {
  if (!capability(env,'MAIL_ENABLED') || typeof env.EMAIL?.send !== 'function' || !validOrigin(env.APP_ORIGIN)) return null;
  const origin = env.APP_ORIGIN;
  const domain = env.MAIL_SENDER_DOMAIN ?? new URL(origin).hostname;
  const brand = env.BRAND_NAME ?? new URL(origin).hostname;
  if (!validSenderDomain(domain) || !safeHeader(brand, 80) || !brand.trim()) return null;
  const senders = Object.fromEntries(Object.entries(SENDER_ROLES).map(([role, local]) => [role, `${local}@${domain.toLowerCase()}`]));
  const send = async ({ from, to, subject, text, headers = {} }) => {
    if (!Object.values(senders).includes(from) || !validEmail(to) || !safeHeader(subject) || typeof text !== 'string' || !text || Object.entries(headers).some(([name, value]) => name !== 'List-Unsubscribe' || !safeHeader(value))) throw new Error('Invalid mail envelope.');
    try {
      const result = await env.EMAIL.send({ from, to, subject, text, ...emailPresentation({ subject, text, brand, origin }), ...(Object.keys(headers).length ? { headers } : {}) });
      if (!safeHeader(result?.messageId)) throw new Error('Invalid mail acceptance result.');
      return { messageId: result.messageId };
    } catch (error) {
      // Never include provider messages, causes, recipient addresses, or tokens.
      throw Object.assign(new Error('Mail delivery is temporarily unavailable.'), {
        code: PROVIDER_CODES.has(error?.code) ? error.code : 'mail_delivery_unavailable'
      });
    }
  };
  const notice = (templates, from, { email, type, days, owner, cancelToken, count, trailing }) => {
    // Coalesced account notices carry how many changes they stand for (IdentityService#queueNotice); a trailing one
    // reports changes made after the previous notice.
    if (count !== undefined && (!Number.isSafeInteger(count) || count < (trailing === true ? 1 : 2) || count > 100000)) throw new Error('Invalid notice count.');
    if (!Object.hasOwn(templates, type)) throw new Error('Invalid mail notice type.');
    if (owner !== undefined && (typeof owner !== 'string' || !UUID.test(owner))) throw new Error('Invalid mail notice account.');
    const [subject, text] = templates[type];
    if ((subject.includes('{days}') || text.includes('{days}')) && (!Number.isInteger(days) || days < 1 || days > 3650)) throw new Error('Invalid account notice deadline.');
    const format = value => value.replaceAll('{brand}', () => brand).replaceAll('{days}', () => String(days));
    // Lifecycle notices link to the signed-in review prompt; the link carries no secret.
    if (templates === ACCOUNT_NOTICES && ['suspension-warning', 'deletion-warning', 'suspended-notice'].includes(type)) return send({ from, to: email, subject: format(subject), text: `${format(text)}\n\nKeep your account: ${origin}/console?${owner ? `account=${owner}&` : ''}lifecycle=review\n\nThis notice was sent to the email associated with your account.` });
    // A reissue notice may carry its cancel capability (an `<owner>.<random>` token) in a fragment: opening the link
    // changes nothing until the page confirms with POST, and it never signs in.
    if (templates === SECURITY_ALERTS && type === 'recovery-reissued' && cancelToken !== undefined) {
      if (typeof cancelToken !== 'string' || !/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(cancelToken) || cancelToken.slice(0, 36) !== owner) throw new Error('Invalid reissue cancel link.');
      return send({ from, to: email, subject: format(subject), text: `${format(text)}\n\nCancel the replacement: ${origin}${REISSUE_CANCEL_PATH}#token=${cancelToken}\n\nOpening this link does not cancel anything until you confirm on the page. It cannot sign you in.` });
    }
    return send({ from, to: email, subject: format(subject), text: `${format(text)}${count ? (trailing === true ? `\n\n${count} more such change(s) happened shortly after the previous notice.` : `\n\nThis notice covers ${count} such changes in the last few minutes.`) : ''}\n\nOpen ${origin}/console\n\nIf you did not request this change, review your account security in your personal space.` });
  };
  return {
    // DX-7: admin-assisted deletion confirmation, sent only to the account's own verified address. The capability
    // stays in the fragment; opening the link changes nothing until the page confirms with POST.
    async sendAdminDeletionConfirmation({email,handle,link,expiresAt}) {
      const prefix=`${origin}/api/admin/users/deletion/confirmation#owner=`;
      if(typeof link!=='string'||!link.startsWith(prefix)||!/^[0-9a-f-]{36}&token=[A-Za-z0-9_-]{43}$/.test(link.slice(prefix.length))||typeof handle!=='string'||!safeHeader(handle,64)||!Number.isSafeInteger(expiresAt))throw new Error('Invalid deletion confirmation request.');
      return send({from:senders.account,to:email,subject:`Confirm deletion of your ${brand} account`,text:[`Someone asked ${brand} to delete the account @${handle} on your behalf. Only continue if you asked for this.`,link,`The link expires on ${new Date(expiresAt).toISOString().slice(0,16).replace('T',' ')} UTC. Opening it does not delete anything until you confirm on the page. Deletion is then scheduled for 30 days later, and you can cancel it during that time.`,'If you did not ask for this, ignore this email.'].join('\n\n')});
    },
    // ORG-12b break-glass owner notice: fixed templates, the organization's public handle and an optional abort link.
    async sendBreakGlassNotice({ email, event, orgHandle, abortUrl }) {
      if (!Object.hasOwn(BREAK_GLASS_NOTICES, event) || (orgHandle !== null && orgHandle !== undefined && (typeof orgHandle !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(orgHandle)))) throw new Error('Invalid break-glass notice.');
      const prefix = `${origin}${ORG_CLAIM_ABORT_PATH}#org=`;
      if (abortUrl !== null && abortUrl !== undefined && (typeof abortUrl !== 'string' || !abortUrl.startsWith(prefix) || !/^[0-9a-f-]{36}&token=bg1\.[0-9a-f-]{36}\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}(?:&handle=[A-Za-z0-9][A-Za-z0-9._-]{0,63})?$/.test(abortUrl.slice(prefix.length)))) throw new Error('Invalid break-glass link.');
      const [[subject, text], [asunto, texto]] = BREAK_GLASS_NOTICES[event], org = orgHandle ? ` @${orgHandle}` : '';
      const format = value => value.replaceAll('{brand}', () => brand).replaceAll('{org}', () => org);
      const link = abortUrl ? [`Stop the claim: ${abortUrl}`, 'Opening the link does not stop anything until you confirm on the page. It cannot sign you in.'] : [`Open ${origin}/console`];
      const enlace = abortUrl ? [`Detener la reclamación: ${abortUrl.replace(ORG_CLAIM_ABORT_PATH + '#', ORG_CLAIM_ABORT_PATH + '?lang=es#')}`, 'Abrir el enlace no detiene nada hasta que confirmes en la página. No puede iniciar sesión.'] : [`Abre ${origin}/console`];
      return send({ from: senders.security, to: email, subject: format(subject), text: [format(text), ...link, '—', format(asunto), format(texto), ...enlace].join('\n\n') });
    },
    // DX-7: closure and reopening notices (terms §10). The export window is stated; no reason text is mailed.
    async sendClosureNotice({email,handle,exportUntil,executeAfter}) {
      if(typeof handle!=='string'||!safeHeader(handle,64)||!Number.isSafeInteger(executeAfter)||exportUntil!==null&&!Number.isSafeInteger(exportUntil))throw new Error('Invalid closure notice.');
      const day=value=>new Date(value).toISOString().slice(0,10);
      return send({from:senders.account,to:email,subject:`Your ${brand} account was closed`,text:[`The account @${handle} was closed by the service operator. It will be deleted on ${day(executeAfter)}.`,exportUntil===null?'No export is offered for this account.':`Until ${day(exportUntil)} you can sign in to export your data. Only export and deletion status are available.`,`Open ${origin}/console`,'To appeal, reply to the service operator.'].join('\n\n')});
    },
    async sendReopenNotice({email,handle}) {
      if(typeof handle!=='string'||!safeHeader(handle,64))throw new Error('Invalid reopening notice.');
      return send({from:senders.account,to:email,subject:`Your ${brand} account was reopened`,text:[`The account @${handle} was reopened by the service operator and its scheduled deletion was cancelled. Sign in again to continue.`,`Open ${origin}/console`].join('\n\n')});
    },
    // PORT-2: identity transfer notices carry the dispute link in a fragment, from the fixed security@ sender.
    async sendTransferNotice({email,notice}) {
      const template=transferNoticeTemplate(notice,{origin});
      return send({from:senders.security,to:email,subject:template.subject,text:template.text});
    },
    // Redirect expiry reminder (opt-in at transfer-out): the only message sent to the address kept on a moved tombstone,
    // from the fixed notify@ sender. Acceptance is the caller's evidence; delivery is never claimed.
    async sendRedirectReminder({email,notice}) {
      const template=redirectReminderTemplate(notice,{origin,brand});
      return send({from:senders.reminder,to:email,subject:template.subject,text:template.text});
    },
    // DX-5: deletion notices carry the cancel-only link in a fragment, from the fixed accounts@ sender.
    async sendDeletionNotice({email,notice,locale='en'}) {
      const template=deletionNoticeTemplate(notice,{origin,locale});
      return send({from:senders.account,to:email,subject:template.subject,text:template.text});
    },
    async sendApprovalNotice({email,notice,locale='en'}) {
      if(!siteGlobal(env,'DEVICE_AUTHORIZATION_ENABLED',true))return {enabled:false};
      const template=approvalNoticeTemplate(notice,{origin,locale});
      return send({from:senders.security,to:email,subject:template.subject,text:template.text});
    },
    async sendWaitlistConfirmation({email,token,issuer,locale='en'}) {
      if(issuer!==origin)throw new Error('Invalid waitlist verification request.');
      requireToken(token);
      const {t}=waitlistMailLocalization(locale);
      const url=`${origin}/waitlist/confirm#token=${encodeURIComponent(token)}`;
      return send({from:senders.link,to:email,subject:t('Confirm your {brand} waitlist request',{brand}),
        text:[t('Confirm that you want your email added to the {brand} waitlist.',{brand}),url,t('This link expires in ten minutes. Opening it does not join the waitlist; confirm on the page. Joining does not create an account or reserve a place.'),t('If you did not request this message, ignore it. Your address will not be added without confirmation.')].join('\n\n')});
    },
    async sendSetupCode({ email, code, issuer, locale = 'en' }) {
      if (issuer !== origin || typeof code !== 'string' || !/^\d{8}$/.test(code)) throw new Error('Invalid setup verification request.');
      const {t} = createLocalization({locale});
      return send({ from: senders.link, to: email, subject: t('Confirm your {brand} account email', {brand}),
        text: [t('Only continue if you requested a new {brand} account.', {brand}), t('Your verification code: {code}', {code}), t('Enter this code in the browser where you started account setup. It expires in ten minutes. This code verifies your email; it does not sign you in or replace your passkey or recovery file.'), t('If you did not request this code, ignore this message.')].join('\n\n') });
    },
    async sendVerification({ email, token, purpose, issuer }) {
      if (!['link', 'login'].includes(purpose) || issuer !== origin) throw new Error('Invalid mail verification request.');
      requireToken(token);
      const login = purpose === 'login';
      const url = `${origin}${login ? '/email/login' : '/email/confirm'}#token=${encodeURIComponent(token)}`;
      return send({ from: senders[purpose], to: email,
        subject: `Confirm your ${brand} ${login ? 'sign-in' : 'email'}`,
        text: `Only continue if you requested this ${login ? 'sign-in' : 'email association'}.\n\n${url}\n\nThe link expires in ten minutes. Opening it does not sign in or link the email until you confirm.${login ? '' : ' Confirm in the browser session that requested the association.'}` });
    },
    async sendReminder({ email, owner, token }) {
      requireToken(token);
      if (!safeHeader(owner, 128) || !/^[A-Za-z0-9_-]+$/.test(owner)) throw new Error('Invalid mail link.');
      const url = `${origin}/unsubscribe#token=${encodeURIComponent(`${owner}.${token}`)}`;
      return send({ from: senders.reminder, to: email, subject: `You have unread messages in ${brand}`,
        text: `You have unread messages in your personal space.\n\nOpen ${origin}/console\n\nTurn off email notifications: ${url}`,
        headers: { 'List-Unsubscribe': `<${url}>` } });
    },
    // sendAccountNotice is called by the account lifecycle executor (packages/runtime/lifecycle-runner.mjs);
    // security alert callers remain unconnected. Acceptance is not proof of delivery.
    sendAccountNotice: input => notice(ACCOUNT_NOTICES, senders.account, input),
    sendSecurityAlert: input => notice(SECURITY_ALERTS, senders.security, input)
  };
}
