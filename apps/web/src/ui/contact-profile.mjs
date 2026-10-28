// The account profile (Account & security): display name and avatar only. Contact links, per-link sharing and the
// disclosure switch were removed (contacts spike §4.8; provisional, unsigned).
import {h,field,helpers} from './release-primitives.mjs';
// The profile fields stay editable while the profile loads, but Save is disabled and the form is aria-busy until it
// has loaded (bug hunt F1). Loaded values arrive as `defaultValue`: the browser keeps whatever the owner typed
// meanwhile (a dirty field ignores a new default), and an untouched field shows the stored value.
export function contactProfilePanel(state){
 const {form}=helpers(state),book=state.contactProfile??{},profile=book.profile??{},ready=book.status==='loaded',initial=name=>ready?{defaultValue:profile[name]??''}:{};
 const body=form([field('displayName','Display name','text',{...initial('displayName'),maxLength:80}),field('avatar','Avatar URL','url',{...initial('avatar'),maxLength:2048,placeholder:'https://images.example/avatar.png'}),book.status==='error'?h('p','Your profile could not be loaded. Reload to try again before saving.').classes('field-help'):ready?null:h('p','Loading your profile…').attrs({role:'status'}).classes('field-help')],{kind:'save-profile'},'Save profile',!ready);
 return h('section',h('h2','Your profile'),h('p','Your name and avatar are optional.').classes('muted'),body.attrs({'aria-busy':!ready&&book.status!=='error'?'true':'false'}).key(`profile:${state.session?.account?.id??''}:${state.beamGeneration??0}:${book.epoch??0}`)).classes('panel','contact-profile-settings');
}
