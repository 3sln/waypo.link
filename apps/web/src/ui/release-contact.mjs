import {h,badge,field,helpers,interfaceText} from './release-primitives.mjs';
import {intentLink,handoffAvailable} from '../bl/contact-link.mjs';
// Bidi isolation for interpolated identities/origins (FSI…PDI; origins are always LTR).
const iso=v=>'⁨'+v+'⁩',ltr=v=>'⁦'+v+'⁩';
export const fullDate=(value,locale)=>value?new Intl.DateTimeFormat(locale,{year:'numeric',month:'short',day:'numeric'}).format(new Date(value)):'—';
function profileBlock(profile){return profile?h('section',h('p','Shared by this contact link').classes('field-help'),profile.displayName?h('strong',h('bdi',profile.displayName).attrs({dir:'auto'})).attrs({translate:'no'}):null,profile.bio?h('p',profile.bio).attrs({translate:'no',dir:'auto'}).classes('contact-profile-bio'):null,profile.avatar?h('a','View shared avatar').props({href:profile.avatar,target:'_blank',rel:'noreferrer noopener'}).classes('text-button'):null).classes('contact-recipient-profile'):null;}
// Public page (links §9): the recipient preview and the hand-off to the visitor's own messaging app. Contact links
// belong to the owner's apps; the core neither composes nor delivers messages.
export function contactPage(state){
 const {btn,form,alerts}=helpers(state),page=state.contactPage??{},account=state.session?.account,endpoint=page.link,signup=page.signup;
 const heading=h('div',badge('A PERSONAL INVITATION'),h('h2',interfaceText('Send a message to {recipient}.',{recipient:iso(page.profile?.displayName??state.route.recipient)})).classes('contact-recipient-heading'),h('p',interfaceText('Contact identity: {identity}',{identity:iso(`${state.route.recipient}@${state.config.handleOriginHost??state.brand?.host??''}`)})).classes('field-help'),profileBlock(page.checked?page.profile:null));
 if(!page.checked)return h('div',heading,alerts(),state.error&&endpoint&&!page.refused?h('div',btn('Try again',{kind:'reload-contact-page'},'button secondary',page.retrying)).classes('buttons'):state.error?null:h('p','Checking this contact link…').attrs({role:'status'}).classes('field-help'));
 const intents=endpoint?h('nav',h('a','Send a message with your Bindle app').props({href:intentLink('send-message',endpoint),rel:'noreferrer'}).classes('button','secondary','contact-intent'),h('a','Add to contacts in your Bindle app').props({href:intentLink('add-contact',endpoint),rel:'noreferrer'}).classes('button','secondary','contact-intent')).attrs({'aria-label':'Open with a Bindle app'}).classes('buttons','contact-intents'):null;
 const host=state.config.handleOriginHost??state.brand?.host??'',identity=account?`${account.handle}@${host}`:'';
 const options=account?h('section',h('p',interfaceText('Signed in as {identity}.',{identity:iso(identity)})).classes('contact-sender'),
   endpoint&&handoffAvailable(state,endpoint)?h('div',btn('Open in your messaging app',{kind:'contact-handoff',intent:'send-message'},'button primary'),btn('Add to contacts',{kind:'contact-handoff',intent:'add-contact'},'button secondary')).classes('buttons'):h('p','Open this link from your messaging app to write a message or save this contact.').attrs({role:'status'}).classes('field-help')).classes('contact-signed-in')
  :h('section',h('p','No Bindle app?').classes('field-help'),btn(interfaceText('Sign in or sign up with {brand}',{brand:state.brand?.name??'3sln.me'}),{kind:'contact-auth',mode:'signin'},'button primary'),
   form([field('handle','Your handle on another provider','text',{autoComplete:'username',placeholder:'alex@provider.example',maxLength:300,required:true})],{kind:'discover-provider'},'Find my provider'),
   page.providerError?h('p',page.providerError).attrs({role:'alert'}).classes('alert','error'):null,
   page.provider?h('div',h('p',interfaceText('This contact link carries a capability. It will be sent to {host} so you can continue there.',{host:ltr(page.provider.host)})).classes('security-note'),h('div',...page.provider.intents.map(intent=>btn(interfaceText(intent==='send-message'?'Continue with {host} to send a message':'Continue with {host} to add this contact',{host:ltr(page.provider.host)}),{kind:'continue-with-provider',intent},'button primary'))).classes('buttons')).classes('contact-provider'):null,
   signup&&!signup.free&&signup.paid?h('p',h('span','Free accounts are closed for now. '),btn('Create a paid account',{kind:'contact-auth',mode:'paid'},'text-button')).classes('field-help'):null,
   signup&&!signup.open&&signup.waitlist?h('p',h('span','New accounts are paused. '),h('a','Join the waitlist').props({href:'/console?waitlist=1'}).classes('text-button')).classes('field-help'):null,
   h('p','After signing in, your messaging app opens so you can write to this person or save the contact.').classes('field-help')).classes('contact-signin');
 return h('div',heading,h('p','You write and send from your own messaging app. This page only passes the link to it.').classes('muted'),alerts(),intents,options);
}
