// The optional contact profile (Account & security) and per-link profile sharing for the contact links the owner's
// apps created. Contact links are made and managed in those apps; nothing here creates, shares or revokes one.
import {h,field,checkbox,badge,helpers,interfaceText} from './release-primitives.mjs';
import {sharingLinks} from '../bl/contact-profile.mjs';
const fieldLabels={displayName:'Display name',bio:'About you',avatar:'Avatar URL'};
const shortDate=(value,locale)=>Number.isFinite(value)?new Intl.DateTimeFormat(locale,{year:'numeric',month:'short',day:'numeric'}).format(new Date(value)):null;
function linkRow(state,link){const {btn}=helpers(state),fields=(link.profileFields??[]).filter(name=>fieldLabels[name]),created=shortDate(link.createdAt,state.locale),expires=shortDate(link.expiresAt,state.locale);
 return h('div',h('div',h('strong',typeof link.name==='string'&&link.name?h('bdi',link.name).attrs({dir:'auto',translate:'no'}):'Contact link'),link.conditional?badge('Conditional','warning'):null,
   link.issuer?.clientId?h('p',h('bdi',link.issuer.clientId).attrs({dir:'ltr',translate:'no'})).classes('field-help'):null,
   created||expires?h('p',created?interfaceText('Created {date}',{date:created}):null,created&&expires?' · ':null,expires?interfaceText('Expires {date}',{date:expires}):null).classes('field-help'):null,
   h('p',...(fields.length?['Shares:',' ',...fields.flatMap((name,index)=>index?[', ',fieldLabels[name]]:[fieldLabels[name]])]:['Shares no profile fields.'])).classes('field-help','link-sharing-fields')),
  btn('Choose shared fields',{kind:'open-modal',modal:{kind:'contact-permissions',contact:{id:link.id,profileFields:fields}}},'text-button')).classes('credential-row','link-sharing-row').key(link.id);}
function sharingSection(state){const links=sharingLinks(state);return h('div',h('h3','Sharing on your contact links'),
 h('p','Contact links are created by your apps. Choose which profile fields each link shows to people who hold it.').classes('field-help'),
 ...links.map(link=>linkRow(state,link)),links.length?null:h('p','None of your apps has created a contact link yet.').classes('muted')).classes('link-sharing');}
// The profile fields stay editable while the profile loads, but Save is disabled and the form is aria-busy until it
// has loaded (bug hunt F1). Loaded values arrive as `defaultValue`: the browser keeps whatever the owner typed
// meanwhile (a dirty field ignores a new default), and an untouched field shows the stored value.
export function contactProfilePanel(state){
 const {form}=helpers(state),book=state.contactProfile??{},profile=book.profile??{},ready=book.status==='loaded',initial=name=>ready?{defaultValue:profile[name]??''}:{};
 const body=form([field('displayName','Display name','text',{...initial('displayName'),maxLength:80}),field('bio','About you','text',{...initial('bio'),maxLength:280}),field('avatar','Avatar URL','url',{...initial('avatar'),maxLength:2048,placeholder:'https://images.example/avatar.png'}),ready?checkbox('discloseToContacts','Enable the profile fields allowed by each contact link',profile.discloseToContacts===true):checkbox('discloseToContacts','Enable the profile fields allowed by each contact link',false,true),h('p','Profile sharing is off by default. Set exact sharing permissions on each contact link.').classes('field-help'),book.status==='error'?h('p','Your contact profile could not be loaded. Reload to try again before saving.').classes('field-help'):ready?null:h('p','Loading your contact profile…').attrs({role:'status'}).classes('field-help')],{kind:'save-profile'},'Save contact profile',!ready);
 return h('section',h('h2','Your contact profile'),h('p','Your name and avatar are optional. Share them on each contact link when you choose.').classes('muted'),body.attrs({'aria-busy':!ready&&book.status!=='error'?'true':'false'}).key(`profile:${state.session?.account?.id??''}:${state.beamGeneration??0}:${book.epoch??0}`),sharingSection(state)).classes('panel','contact-profile-settings');
}
export function contactSharingDialog(state){const m=state.modal;if(m?.kind!=='contact-permissions')return null;const {form}=helpers(state),contact=m.contact,fields=contact.profileFields??[];return {title:'Choose what this contact link shares.',body:form([h('p','Anyone with this signed contact link can read the selected profile fields. Profile sharing also requires your profile switch to be on.').classes('muted'),h('h3','Profile fields shared by this link'),checkbox('profile:displayName','Display name',fields.includes('displayName')),checkbox('profile:bio','About you',fields.includes('bio')),checkbox('profile:avatar','Avatar URL',fields.includes('avatar'))],{kind:'update-contact-sharing',id:contact.id},'Save sharing permissions')};}
