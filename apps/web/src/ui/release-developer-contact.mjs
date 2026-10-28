import {h,badge,helpers,interfaceText} from './release-primitives.mjs';
import {intentsAvailable} from '../bl/incoming.mjs';
const fullDate=(value,locale)=>value?new Intl.DateTimeFormat(locale,{year:'numeric',month:'short',day:'numeric'}).format(new Date(value)):'—';
const unavailable={'developer-unavailable':'The platform developer account is not ready to receive messages.','contact-unavailable':'Developer contact is not available right now. Try again later.'};
const eligibility={eligible:'Your account can currently message the developer. Eligibility is checked again when you start.',ineligible:'Your account is not currently eligible to message the developer.',unavailable:'Your eligibility could not be checked right now. Try again shortly.'};
const reasons={'paid-required':'Developer contact is currently available to paid accounts.','eligibility-unavailable':'Your eligibility could not be verified. Recheck your subscription or try again shortly.'};
// "Message the developer" (contacts spike CR-C5/CR-C8; provisional, unsigned). The card shows this account's
// eligibility; when eligible, the button asks 3sln.me for a one-time invitation bound to this account and hands it to the
// user's own messaging app. The plan label is disclosed to the developer's messaging app only (rethink §4.7, L9). The
// invitation itself stays in browser secret storage; only its expiry is rendered.
export function developerContact(state){const {btn}=helpers(state),result=state.developerContact,e=result?.eligibility,eligible=e?.state==='eligible',invitation=result?.invitation,intents=intentsAvailable(state);return h('section',h('h2','Message the developer'),
 result?.available?h('div',badge('Platform developer'),h('p',eligibility[e?.state]??eligibility.unavailable).attrs({role:'status'}).classes('developer-eligibility',`eligibility-${e?.state??'unavailable'}`),e?.reason&&reasons[e.reason]?h('p',reasons[e.reason]).classes('field-help'):null,
  eligible?h('p',intents?'Your messaging app opens with a one-time invitation from the developer, valid for one hour. The developer sees your plan as a label; it does not guarantee a response time.':'Your browser hands a one-time invitation from the developer, valid for one hour, to your messaging app. The developer sees your plan as a label; it does not guarantee a response time.').classes('field-help'):null,
  eligible&&invitation?.expiresAt?h('p',interfaceText('Your invitation works once and is valid until {date}.',{date:fullDate(invitation.expiresAt,state.locale)})).classes('field-help'):null,
  eligible?h('div',btn(invitation?'Open in your messaging app':'Message the developer',{kind:'open-developer-contact'},'button primary',state.developerContactLoading===true),invitation?btn('Copy invitation link',{kind:'copy-developer-contact'},'button secondary'):null).classes('buttons'):null)
 :result?h('p',unavailable[result.reason]??unavailable['contact-unavailable']).classes('muted'):h('p','Messages are accepted from paid accounts, and from every account while the service is in early access.').classes('muted'),
 btn(result?'Check eligibility again':'Check eligibility',{kind:'load-developer-contact'},'button secondary',state.developerContactLoading===true)).classes('panel','developer-contact-panel').attrs({'aria-busy':state.developerContactLoading===true?'true':'false'});}
