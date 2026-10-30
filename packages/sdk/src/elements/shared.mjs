// Shared pieces for the Bindle custom elements. Nothing here touches window,
// document, crypto or storage at module top level, so importing under SSR
// (Node, Workers) is safe. Classes extend HTMLElement only where it exists.
import {h} from '../../../../vendor/dodo/index.js';
import {css,reconcileShadow} from '../../../../vendor/dodo/style.js';
import {createSdkLocalization} from '../../../i18n/sdk-catalogue.mjs';
import {icon,iconCss} from './icons.mjs';

export {h,reconcileShadow,icon};
export const ElementBase=globalThis.HTMLElement??class {};
export const sessionContext='bindle-session';
// Internal entry point that records which element started a flow, so only that
// element renders the flow's notices. Public methods remain the API.
export const startFlow=Symbol('bindle.startFlow');
// Every defined session tag (one per prefix), for late-upgrade discovery.
export const registry={sessionTags:new Set(['bindle-session'])};
const sessionDefined=()=>Promise.race([...registry.sessionTags].map(tag=>globalThis.customElements.whenDefined(tag)));

// Attribute maps for dodo: drop null/undefined/false, render true as present.
export const attrs=map=>{const result={};for(const [key,value] of Object.entries(map))if(value!==undefined&&value!==null&&value!==false)result[key]=value===true?'':String(value);return result;};
const realm=node=>node.ownerDocument?.defaultView??globalThis;
export const emit=(target,type,detail)=>target.dispatchEvent(new (realm(target).CustomEvent)(type,{detail,bubbles:true,composed:true}));

export function localeFor(element){
  const own=element.getAttribute('lang')||element.closest?.('[lang]')?.getAttribute('lang');
  return own||globalThis.navigator?.language||'en';
}
export function localize(element){return createSdkLocalization({locale:localeFor(element)});}
export function themeFor(element,session){
  const value=element.getAttribute('theme')??session?.getAttribute?.('theme')??'auto';
  return ['light','dark'].includes(value)?value:'auto';
}
// Effective scheme (decision note §7.1 step 4): the theme attribute (own, then the
// session's); else the luminance of an embedder-set --bindle-surface (dark below
// 0.18); else the embedder's used color-scheme; else prefers-color-scheme. The
// returned class drives the token defaults and `colorScheme` is set on the shadow
// root container, so light-dark() tones follow live changes without script.
const channel=value=>{const c=value/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;};
function surfaceScheme(element){
  const view=element.ownerDocument?.defaultView,raw=view?.getComputedStyle?.(element)?.getPropertyValue?.('--bindle-surface')?.trim();if(!raw)return null;
  let match=/^#([0-9a-f]{6})$/i.exec(raw),rgb;
  if(match){const n=Number.parseInt(match[1],16);rgb=[n>>16&255,n>>8&255,n&255];}
  else{const probe=element.ownerDocument.createElement('span');probe.style.color=raw;(element.shadowRoot??element).append(probe);const used=view.getComputedStyle(probe).color;probe.remove();match=/^rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/.exec(used);rgb=match?.slice(1,4).map(Number);}
  if(!rgb)return null;
  return 0.2126*channel(rgb[0])+0.7152*channel(rgb[1])+0.0722*channel(rgb[2])<0.18?'dark':'light';
}
export function schemeFor(element,session){
  let theme=themeFor(element,session);
  if(theme==='auto')theme=surfaceScheme(element)??'auto';
  if(theme!=='auto')return {theme,colorScheme:theme};
  const inherited=element.ownerDocument?.defaultView?.getComputedStyle?.(element)?.colorScheme;
  // An embedder color-scheme is inherited as is; an unset one follows the OS preference.
  return {theme,colorScheme:!inherited||inherited==='normal'?'light dark':undefined};
}
// Re-renders an element when the OS scheme changes (embedder color-scheme changes apply through CSS).
// Embedder color-scheme/--bindle-surface changes made through the root, body or
// host attributes (class, style, data-*) are observed too; other changes call
// element.refreshTheme().
export function watchScheme(element,rerender){
  const view=element.ownerDocument?.defaultView,media=view?.matchMedia?.('(prefers-color-scheme: dark)');
  media?.addEventListener?.('change',rerender);
  let observer=null;
  try{observer=new view.MutationObserver(()=>rerender());for(const node of [element.ownerDocument.documentElement,element.ownerDocument.body,element].filter(Boolean))observer.observe(node,{attributes:true,attributeFilter:['class','style','data-theme','color-scheme']});}catch{observer=null;}
  return ()=>{media?.removeEventListener?.('change',rerender);observer?.disconnect();};
}
// Derived element events dispatch in a microtask after the controller event that
// caused them, so document listeners always see bindle-session-change first.
export const emitLater=(target,type,detail)=>queueMicrotask(()=>emit(target,type,Object.freeze(detail)));

// Island hook (components profile; embed-islands §8.2, §12.4). Mounting belongs
// to the islands slice (elements/islands.mjs, loaded only for declaring
// providers). Elements decide only whether a part may mount: the capability set
// must list it, which already applies the embedder's islands="auto|off" and
// island-issuers policy and the profile's cross-checks. Until the mounter reports
// 'live', the standard composition is what the user sees.
export function islandPart(session,part,capabilities=session?.capabilities){
  const name={avatar:'avatar','account-switcher':'switcher','sign-in':'signIn'}[part];
  const value=capabilities?.islands?.[name];
  return value?Object.freeze({part,issuer:capabilities.issuer,embedOrigin:capabilities.embedOrigin,version:value.version}):null;
}
export async function mountIsland(element,{part,container,session,onState,capabilities}){
  const spec=islandPart(session,part,capabilities);if(!spec||!container)return null;
  try{const module=await import('./islands.mjs');return await module.mountIsland({element,container,session,onState,...spec});}catch{return null;}
}

// Context protocol (Web Components Community Group): descendants ask for the
// nearest <bindle-session>, crossing shadow roots via a composed event. An
// explicit controller="<id>" attribute links to a session anywhere in the root.
export function requestSession(element,callback){
  const id=element.getAttribute('controller');
  if(id){
    const find=()=>element.getRootNode?.().getElementById?.(id)??globalThis.document?.getElementById(id);
    const found=find();
    if(found?.ready)return found.ready.then(()=>callback(found));
    if(globalThis.customElements)sessionDefined().then(()=>{const later=find();later?.ready?.then(()=>callback(later));});
    return;
  }
  let answered=false;
  const ask=()=>{
    const event=new (realm(element).Event)('context-request',{bubbles:true,composed:true});
    Object.assign(event,{context:sessionContext,contextTarget:element,subscribe:false,callback:value=>{if(!answered){answered=true;callback(value);}}});
    element.dispatchEvent(event);
  };
  ask();
  // The session element may upgrade after its descendants; ask again once it is defined.
  if(!answered&&globalThis.customElements)sessionDefined().then(()=>queueMicrotask(()=>{if(!answered&&element.isConnected)ask();}));
}

// Neutral defaults (no 3sln palette) meeting the §8.5 contrast rules in both schemes. They equal the island defaults
// (islands-protocol THEME_DEFAULTS, apps/embed/styles/shell.css) so a composition reads as one component whatever
// mounts (ui-elements-audit §4.3, provisional). WCAG ratios, light / dark: text on surface 17.8 / 14.5, muted 6.1 /
// 7.7 (5.7 / 6.8 on raised), accent 6.1 / 6.8, on-accent on accent 6.1 / 7.6, control border 3.4 / 4.5 (3.1 / 4.0
// on raised), focus 6.1 / 8.8, danger 6.6 / 7.4. `--_line` is decorative (dividers, panel edge) and carries no
// information. Embedders override with the public --bindle-* custom properties or ::part().
const light='--_surface:var(--bindle-surface,#ffffff);--_raised:var(--bindle-surface-raised,#f6f7f9);--_text:var(--bindle-text,#16181d);--_muted:var(--bindle-text-muted,#5b6270);--_accent:var(--bindle-accent,#2b59d1);--_on-accent:var(--bindle-on-accent,#ffffff);--_border:var(--bindle-border,#868d98);--_line:var(--bindle-divider,#e3e6eb);--_focus:var(--bindle-focus,#2b59d1);--_danger:var(--bindle-danger,#b42318);--_shadow:0 1px 2px rgb(16 24 40 / .06),0 10px 28px -4px rgb(16 24 40 / .16);--_mono-l:38%;';
const dark='--_surface:var(--bindle-surface,#1b1d22);--_raised:var(--bindle-surface-raised,#24272e);--_text:var(--bindle-text,#eceef2);--_muted:var(--bindle-text-muted,#a9b0bb);--_accent:var(--bindle-accent,#7aa2ff);--_on-accent:var(--bindle-on-accent,#0b1020);--_border:var(--bindle-border,#7d8590);--_line:var(--bindle-divider,#343840);--_focus:var(--bindle-focus,#9dbaff);--_danger:var(--bindle-danger,#ff8a7a);--_shadow:0 1px 2px rgb(0 0 0 / .4),0 14px 36px -6px rgb(0 0 0 / .55);--_mono-l:72%;';
// One button spec for elements and islands (§4.2): 500 weight, 8 px icon gap, 16 px icons, 44 px minimum target,
// 80 ms tints for hover (6 %) and press (12 %) without movement, a 2 px focus ring 2 px outside the control,
// disabled as muted text on the raised surface (no opacity), busy keeps the label and shows a spinner.
export const baseStyles=view=>css.in(view)`
:host{display:block;font:inherit;font-size:calc(1em * var(--bindle-font-scale,1));${light}}
:host([hidden]){display:none}
/* Text that sits on the embedder's own background inherits the embedder's color. */
.root{color:var(--bindle-text,inherit);--_radius:calc(var(--bindle-radius,8) * 1px);--_ease:cubic-bezier(.2,0,0,1);--_system:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.root.dark{${dark}}
@media (prefers-color-scheme:dark){.root.auto{${dark}}}
.visually-hidden{position:absolute;inline-size:1px;block-size:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
${iconCss}
button,.button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:8px;margin:0;font:inherit;font-weight:500;line-height:1.25;text-align:center;min-block-size:44px;min-inline-size:44px;padding-block:.55em;padding-inline:1em;border-radius:var(--_radius);border:1px solid var(--_border);background:var(--_surface);color:var(--_text);cursor:pointer;-webkit-tap-highlight-color:transparent;transition:background-color 80ms linear,border-color 80ms linear,color 80ms linear}
button:hover{background:color-mix(in srgb,var(--_text) 6%,var(--_surface))}
button:active{background:color-mix(in srgb,var(--_text) 12%,var(--_surface))}
button.primary{background:var(--_accent);color:var(--_on-accent);border-color:var(--_accent)}
button.primary:hover{background:color-mix(in srgb,var(--_accent) 90%,var(--_text));border-color:color-mix(in srgb,var(--_accent) 90%,var(--_text))}
button.primary:active{background:color-mix(in srgb,var(--_accent) 82%,var(--_text))}
button.tonal{background:color-mix(in srgb,var(--_accent) 10%,var(--_surface));color:var(--_text);border-color:color-mix(in srgb,var(--_accent) 80%,var(--_surface))}
button.tonal .icon{color:var(--_accent)}
button.tonal:hover{background:color-mix(in srgb,var(--_accent) 16%,var(--_surface))}
button.tonal:active{background:color-mix(in srgb,var(--_accent) 22%,var(--_surface))}
button:focus-visible,a:focus-visible,input:focus-visible{outline:2px solid var(--_focus);outline-offset:2px}
button:disabled:not([aria-busy=true]){cursor:not-allowed;background:var(--_raised);color:var(--_muted);border-color:var(--_line)}
button:disabled:not([aria-busy=true]) .icon{color:inherit}
button[aria-busy=true]{cursor:progress}
.notice{display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:.6em;align-items:start;margin-block-start:.75em;padding:.75em .85em;border:1px solid var(--_line);border-radius:var(--_radius);background:var(--_raised);color:var(--_text)}
.notice > .icon{margin-block-start:.1em;color:var(--_muted)}
.notice.alert > .icon{color:var(--_danger)}
.notice p{margin:0;grid-column:2}
.notice .actions{grid-column:1 / -1;display:flex;flex-wrap:wrap;gap:.5em;margin-block-start:.65em}
.notice .actions button{flex:1 1 auto}
.status{color:var(--bindle-text-muted,color-mix(in srgb,currentColor 78%,transparent));margin:.5em 0 0;overflow-wrap:anywhere}
.error{display:flex;gap:.4em;align-items:flex-start;color:var(--_danger);margin:.5em 0 0;overflow-wrap:anywhere}
.error .icon{margin-block-start:.15em}
.error:empty,.status:empty{display:none}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
@media (forced-colors:active){button,.button,.notice{border-color:ButtonText;background:ButtonFace;color:ButtonText}button.primary{forced-color-adjust:none;background:ButtonText;color:ButtonFace;border-color:ButtonText}button.primary:focus-visible{outline-color:Highlight}button:disabled:not([aria-busy=true]){color:GrayText;border-color:GrayText}.error{color:Mark}button:focus-visible,a:focus-visible,input:focus-visible{outline-color:Highlight}}
`;

// Flow notices rendered only by the element that started the flow (§6.3).
export function flowNotice(flow,t,session){
  if(!flow||!session)return null;
  const host=flow.host;
  const action=(label,run,primary)=>h('button',label).props({type:'button'}).classes(primary&&'primary').on({click:run});
  if(flow.phase==='blocked')return h('div',icon('alert'),
    h('p',t('Your browser blocked the sign-in window.')),
    h('div',action(t('Try again'),()=>session.retry(),true),action(t('Continue in this tab'),()=>session.continueInTab())).classes('actions'),
  ).classes('notice','alert').attrs({role:'alert',part:'notice'});
  if(flow.phase==='waiting'&&flow.presentation==='popup')return h('div',icon('spinner'),
    h('p',host?t('Waiting for {host}…',{host}):t('Waiting for your provider…')),
    h('div',
      flow.lingering&&action(t('Show window'),()=>session.showWindow()),
      // Always visible in popup mode: embedded webviews may never show the window.
      action(t('Continue in this tab'),()=>session.continueInTab()),
      flow.lingering&&action(t('Cancel'),()=>session.cancelFlow()),
    ).classes('actions'),
  ).classes('notice').attrs({part:'notice'});
  return null;
}
// Text for the shared role=status live region.
export function flowStatus(flow,t){
  if(!flow)return '';
  const host=flow.host;
  if(flow.phase==='waiting'&&flow.presentation==='popup')return host?t('A sign-in window from {host} opened.',{host}):t('A sign-in window opened.');
  if(flow.phase==='redirecting')return flow.fallback?t('Your browser blocked the sign-in window. Continuing in this tab…'):host?t('Continuing at {host}…',{host}):'';
  if(flow.phase==='opening'||flow.phase==='completing')return t('Contacting your identity provider…');
  return '';
}
export function failureText(result,t){
  switch(result?.code){
    case 'invalid-identity':return t(result.message??'Enter a handle like alex@provider.example.');
    case 'discovery-unavailable':return t("We couldn't reach this provider. Check the address and try again.");
    case 'unsupported-provider':return t("This provider isn't supported.");
    case 'no-provider':return result.fallback?t('No Bindle provider was found. Email sign-in requires a configured email service; your app can offer that separately.'):t('No Bindle provider was found at this address.');
    case 'identity-required':return t('Enter your handle.');
    case 'unregistered-client':return result.host?t("This app isn't connected to {host}.",{host:result.host}):t("This app isn't connected to this provider.");
    case 'not-configured':return t('Bindle sign-in is not configured.');
    default:return t('Sign-in could not be completed. Try again.');
  }
}
