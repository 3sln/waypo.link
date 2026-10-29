// The email-link helper page (sign-in and intents spike §4.4): the request card from server-captured context (device,
// approximate location, time, and whether this browser asked), one explicit decision, and the copy-code fallback with
// its warning. Renders the LinkState projection and bubbles intents; decisions are armed by the composition root.
import {dodo} from '../shared/stack.mjs';
import {interfaceText} from './interface-text.mjs';
const h=dodo.h;
const fire=(event,kind)=>event.currentTarget.dispatchEvent(new CustomEvent('3sln-intent',{bubbles:true,detail:{kind,nativeEvent:event}}));
const button=(s,text,kind,cls='button primary')=>h('button',text).props({type:'button',disabled:s.busy}).classes(...cls.split(' ')).on({click:event=>fire(event,kind)});
/** `Chrome · Windows` from the fixed vocabulary (product names need no translation), or null. */
export function deviceLabel(ua){const parts=[ua?.browser,ua?.system].filter(value=>typeof value==='string'&&value);return parts.length?parts.join(' · '):null;}
export function placeLabel(location,locale){if(!location)return null;let country=location.country;try{if(country)country=new Intl.DisplayNames([locale],{type:'region'}).of(country);}catch{}const parts=[location.city,location.city?null:location.region,country].filter(Boolean);return parts.length?parts.join(', '):null;}
export function agoLabel(at,now,locale){const minutes=Math.max(0,Math.round((now-at)/60000));try{return new Intl.RelativeTimeFormat(locale,{numeric:'auto'}).format(-minutes,'minute');}catch{return `${minutes} min`;}}
const codeText=code=>`${code.slice(0,3)} ${code.slice(3)}`;
export function emailLinkPage(s,{now=Date.now()}={}){
 const view=s.view,signIn=view?.purpose==='sign-in';
 const header=h('header',h('strong','3sln.me'),h('button',s.locale==='es'?'English':'Español').props({type:'button'}).classes('text-button').on({click:event=>fire(event,'link-locale')})).classes('landing-nav');
 let content;
 if(s.phase==='loading')content=h('p','Checking your link…').attrs({role:'status'});
 else if(s.phase==='invalid')content=h('div',h('h1','This link has expired or was already used.').attrs({tabindex:'-1',id:'email-link-heading'}),h('p','Ask for a new one on the device you are signing in to.'));
 else if(s.phase==='review'||s.phase==='confirm-cancel'){
  const place=placeLabel(view.requester?.approxLocation,s.locale);
  content=h('div',
   h('h1',signIn?interfaceText('Sign in to 3sln.me as {handle}?',{handle:'⁨@'+view.account.handle+'⁩'}):interfaceText('Create a 3sln.me account for {address}?',{address:'⁨'+view.maskedAddress+'⁩'})).attrs({tabindex:'-1',id:'email-link-heading'}),
   h('dl',h('dt','Requested from'),h('dd',deviceLabel(view.requester?.uaSummary)?h('bdi',deviceLabel(view.requester.uaSummary)).attrs({translate:'no'}):'An unknown browser'),place?h('dt','Near'):null,place?h('dd',h('bdi',place).attrs({translate:'no'})):null,h('dt','When'),h('dd',agoLabel(view.requester?.createdAt,now,s.locale))).classes('email-link-request'),
   h('p','Device and location are approximate; a VPN can change them.').classes('field-help'),
   view.sameBrowser?h('p','This browser asked for this link.').attrs({role:'status'}).classes('muted'):
    h('div',h('p',h('strong','Another device asked for this link.')),h('p','Only continue if you are signing in on that device right now and it is in front of you. If someone asked you for a code or to click this link, choose No.')).attrs({role:'alert'}).classes('security-note','email-link-warning'),
   s.phase==='review'?h('div',button(s,'Yes, this is me','confirm-link'),button(s,'No, cancel it','ask-cancel','button secondary')).classes('card-actions'):
    h('div',h('p',h('strong',signIn?'Cancel the sign-in request?':'Cancel the account request?')),h('div',button(s,'Yes, cancel it','cancel-link','button danger'),button(s,'Back','back-to-review','button secondary')).classes('card-actions')).classes('email-link-cancel'));
 }
 else if(s.phase==='waiting-ack')content=h('p','Telling the other tab…').attrs({role:'status'});
 else if(s.phase==='done')content=h('div',h('h1','Done.').attrs({tabindex:'-1',id:'email-link-heading'}),h('p','You can close this tab and return to the other one.').attrs({role:'status'}));
 else if(s.phase==='closed-tab')content=h('div',h('h1','The tab that asked for this is closed.').attrs({tabindex:'-1',id:'email-link-heading'}),h('p',signIn?'Sign in in this tab instead?':'Continue creating your account in this tab instead?'),h('p','If you were opening a link, open it again afterwards.').classes('field-help'),h('div',button(s,signIn?'Sign in here':'Continue here','complete-here')).classes('card-actions'));
 else if(s.phase==='signed-in')content=h('p','Opening your space…').attrs({role:'status'});
 else if(s.phase==='code')content=h('div',h('h1','Your code').attrs({tabindex:'-1',id:'email-link-heading'}),h('strong',codeText(s.code)).classes('device-code').attrs({translate:'no',dir:'ltr','aria-label':s.code.split('').join(' ')}),
  h('p',deviceLabel(s.codeDevice)?interfaceText('Type it on the device you are signing in to ({device}).',{device:deviceLabel(s.codeDevice)}):'Type it on the device you are signing in to.'),
  h('p',h('strong','Never read it out or send it to anyone; 3sln.me will never ask for it.')).classes('security-note'),
  h('p',interfaceText('Expires in {minutes} minutes.',{minutes:Math.max(1,Math.ceil((s.codeExpiresAt-now)/60000))})).classes('field-help'));
 else if(s.phase==='cancelled')content=h('div',h('h1','Request cancelled.').attrs({tabindex:'-1',id:'email-link-heading'}),h('p','Nothing changed. You can close this tab.'));
 const error=s.error?h('p',s.error==='rate_limited'?'Too many attempts. Wait a few minutes, then open the link again.':'Something went wrong. Open the link again.').attrs({role:'alert'}).classes('alert','error'):null;
 return h('div',header,h('main',h('section',error,content).classes('auth-card','email-link-card')).classes('public-main'));
}
