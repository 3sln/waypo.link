// Entry of the email-link helper page (/email/link; sign-in and intents spike §4.3, EL-2). The token is read from the
// fragment and removed from the address bar before anything else runs or any request is made; GET did nothing.
const fragment=new URLSearchParams(location.hash.slice(1)),query=new URLSearchParams(location.search);
let token=fragment.getAll('t').length===1?fragment.get('t'):null;
history.replaceState(null,'',location.pathname+(query.get('lang')==='es'?'?lang=es':''));
const [{Engine,Provider,dodo,watch,queryCell},bl,{emailLinkPage},{createArming},{createLocalization},{default:localizeTree}]=await Promise.all([import('./shared/stack.mjs'),import('./bl/email-link.mjs'),import('./ui/email-link-page.mjs'),import('./bl/authorize-entry-arming.mjs'),import('./shared/i18n.mjs'),import('./ui/localize.mjs')]);
const root=document.getElementById('app'),locale=query.get('lang')==='es'||!query.has('lang')&&navigator.language?.startsWith('es')?'es':'en';
const state=bl.linkState(bl.initialLinkState({locale})),link=bl.createLinkResource({token});token=null;
const engine=new Engine({providers:{state:Provider.fromSingleton(state),link:Provider.fromSingleton(link)}});
// EL-4: every decision is inert until this page has been visible and focused for 600 ms; a new surface re-arms it.
const arming=createArming({});let surface=-1;
root.removeAttribute('role');
root.addEventListener('3sln-intent',event=>{event.stopPropagation();const {kind,nativeEvent}=event.detail,Type=bl.LINK_INTENTS[kind];if(!Type)return;if(bl.ARMED_INTENTS.includes(kind)){arming.guard(()=>engine.dispatch(new Type()))(nativeEvent);return;}engine.dispatch(new Type());});
const cell=queryCell(engine.query(new bl.LinkState()));
dodo.reconcile(root,[watch(cell,s=>{document.documentElement.lang=s.locale;const localization=createLocalization({locale:s.locale});if(s.surface!==surface){surface=s.surface;arming.reset();queueMicrotask(()=>document.getElementById('email-link-heading')?.focus());}return localizeTree(emailLinkPage(s),localization);})]);
engine.dispatch(new bl.InitializeLink());
window.addEventListener('pagehide',()=>{arming.dispose();dodo.reconcile(root,[]);engine.dispose();},{once:true});
