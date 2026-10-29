// "Continue with email" on the original tab (sign-in and intents spike §3.6, §4.3 step 1, §4.4, §3.4 step 3; P3). It renders
// the `emailFlow` projection and bubbles intents; the secret, polling and BroadcastChannel stay in the BL and provider.
import {h,icon,badge,field,helpers,interfaceText} from './release-primitives.mjs';
import {legalText,legalLink} from './legal.mjs';
import {signupAge} from '../bl/signup-steps.mjs';

const minutesLeft=(state,until)=>Math.max(1,Math.ceil((until-(state.now??Date.now()))/60000));
const ENDED={'cancelled':'The request was cancelled.','link-cancelled':'The request was cancelled from the email link.','expired':'This sign-in request expired. Start again.','locked':'Too many wrong codes. Start again.'};

export function emailFlowCard(state){
 const {btn,form,alerts,captcha}=helpers(state),flow=state.emailFlow;
 const back=btn('Back to sign in',{kind:'cancel-email-flow'},'text-button');
 if(flow?.stage==='waiting')return h('div',badge('CONTINUE WITH EMAIL'),h('h2','Check your email.').attrs({tabindex:'-1'}),alerts(),
  h('p',interfaceText('We sent a link to {address}. Open it on any device. Keep this tab open.',{address:'⁨'+flow.email+'⁩'})).attrs({role:'status'}),
  h('p',interfaceText('The request expires in {minutes} minutes.',{minutes:minutesLeft(state,flow.expiresAt)})).classes('field-help'),
  h('p',h('span').classes('spinner').attrs({'aria-hidden':'true'}),flow.codeRequested?'Enter the code shown on your other device.':'Waiting for you to open the link…').classes('device-progress').attrs({role:'status','aria-live':'polite'}),
  h('section',h('h3','Opened the link on another device?'),h('p','Type the 6-digit code it shows. Never type a code someone sent you.').classes('muted'),
   form([field('code','Code from your other device','text',{inputMode:'numeric',autoComplete:'one-time-code',pattern:'[0-9 ]{6,7}',maxLength:7,required:true,spellcheck:false}),flow.codeError?h('p',flow.codeError,Number.isSafeInteger(flow.remaining)?h('span',' ',interfaceText('{count} tries left.',{count:flow.remaining})):null).attrs({role:'alert'}).classes('alert','error'):null,flow.challenge?captcha():null],{kind:'email-flow-code'},'Continue')).classes('email-flow-code'),
  h('div',btn('Send a new link',{kind:'resend-email-flow'},'button secondary'),btn('Cancel',{kind:'cancel-email-flow'},'text-button')).classes('card-actions')).classes('auth-card','email-flow-card').key('email-flow-waiting');
 if(flow?.stage==='signup'){const minimumAge=signupAge(state);return h('div',badge('CREATE ACCOUNT'),h('h2','Create your account.').attrs({tabindex:'-1'}),alerts(),
  h('p',interfaceText('{address} is confirmed. It will be your sign-in email.',{address:'⁨'+flow.maskedAddress+'⁩'})).attrs({role:'status'}),
  h('p','Next you save a private recovery file. You can add a passkey later to make signing in easier.').classes('muted'),
  form([h('label',h('input').props({type:'checkbox',name:'ageConfirmed',value:String(minimumAge),required:true}),h('span',legalText(state,`I am ${minimumAge} or older`,`Tengo ${minimumAge} años o más`))).classes('checkbox-field'),
   h('label',h('input').props({type:'checkbox',name:'termsAccepted',required:true}),h('span',legalText(state,'I agree to the ','Acepto los '),legalLink(state,'terms'),legalText(state,' and ',' y la '),legalLink(state,'privacy'),'.')).classes('checkbox-field')],{kind:'confirm-email-signup'},'Create account'),back).classes('auth-card','email-flow-card').key('email-flow-signup');}
 if(flow?.stage==='ended')return h('div',badge('CONTINUE WITH EMAIL'),h('h2','Email sign-in stopped.').attrs({tabindex:'-1'}),alerts(),h('p',ENDED[flow.reason]??ENDED.expired).attrs({role:'status'}).classes('security-note'),btn('Start again',{kind:'cancel-email-flow'},'button primary full')).classes('auth-card','email-flow-card').key('email-flow-ended');
 return h('div',badge('CONTINUE WITH EMAIL'),h('h2','Continue with email.'),h('p','We email you a link. Open it on this device or any other: this tab finishes signing you in, or creates your account if you are new.').classes('muted'),alerts(),
  form([field('email','Email address','email',{required:true,autoComplete:'email',maxLength:254}),captcha()],{kind:'start-email-flow'},'Continue with email'),
  h('p',icon('shield'),'Nobody from 3sln.me will ever ask you for a code from that email.').classes('passkey-hint'),btn('Back to sign in',{kind:'set-auth',auth:'login'},'text-button')).classes('auth-card','email-flow-card').key('email-flow-start');
}

/** 3sln.me system items in the account's queue (spike §3.4 step 6): the passkey suggestion after an email sign-up. */
export function hostItemsSection(state){
 const items=(state.data?.account??state.session?.account)?.hostItems;if(!Array.isArray(items)||!items.length)return null;const {btn}=helpers(state);
 return h('section',...items.filter(item=>item?.id==='passkey-suggestion').map(item=>h('article',h('div',badge('3sln.me'),badge('System','muted')).classes('host-item-source'),h('h3','Make signing in easier: add a passkey'),
  h('p','A passkey signs you in with your fingerprint, face or screen lock, and cannot be phished like an email link.'),
  h('div',btn('Add a passkey',{kind:'navigate',view:'security'},'button primary'),btn('Not now',{kind:'dismiss-host-item',id:item.id},'text-button')).classes('card-actions')).classes('host-item').attrs({'data-host-item':item.id}))).classes('host-items').attrs({'aria-label':'Messages from 3sln.me'});
}
