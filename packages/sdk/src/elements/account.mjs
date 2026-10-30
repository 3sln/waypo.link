// <bindle-account>: the composed profile button (decision note §6.2, CP-8). This
// host element is all define.mjs carries; the implementation (AccountView in
// account-view.mjs: dialog container, capability-driven actions, standard
// avatar, island hook, events) loads on connect. Until then the element shows
// its signed-out control in exactly the tree the view renders signed out, so the
// view reuses the same nodes and a control focused before it loads keeps focus.
// While the session restores persisted app sessions (W11) that control is busy
// (spinner, aria-busy), never a flash of a plain signed-out state.
//
// Signed out (owner direction 2026-10-29, provisional): signed-out="avatar" (default) shows a placeholder avatar of
// the same fixed 44 px size as the signed-in trigger, with an attention bead and a tooltip carrying the sign-in prompt
// (sign-in-prompt attribute or slot); it opens the sign-in composition (the slotted signed-out content, else a
// <bindle-sign-in>) in the same popover the account menu uses (G1). signed-out="panel" does the same from a labelled
// "Sign in" button; signed-out="button" is a "Sign in" button (or the slotted signed-out content) that starts sign-in.
import {ElementBase,baseStyles,h,icon,localize,reconcileShadow} from './shared.mjs';
import {css} from '../../../../vendor/dodo/style.js';

export const accountActions=Object.freeze(['accounts','switch','provider','reauth','sign-out','provider-sign-out','manage']);
const signedOut=Object.freeze({status:'signed-out',session:null,sessions:Object.freeze([]),open:false,mode:null,islands:Object.freeze({avatar:'off',switcher:'off'}),actions:Object.freeze([]),capabilities:null});

// Trigger rules shared by the placeholder and the view, so the first paint already has the final look and size.
export const triggerStyles=view=>css.in(view)`
.anchor{position:relative;display:inline-flex;vertical-align:middle;max-inline-size:100%}
.wrap{position:relative;display:inline-flex;vertical-align:middle;max-inline-size:100%}
.trigger{color:var(--bindle-text,inherit);display:inline-flex;align-items:center;gap:8px;padding:5px;border-color:transparent;background:transparent;border-radius:999px;max-inline-size:100%;text-align:start;font-weight:inherit}
.trigger:hover{background:color-mix(in srgb,currentColor 8%,transparent)}
.trigger:active,.trigger[aria-expanded=true]{background:color-mix(in srgb,currentColor 12%,transparent)}
.ghost-avatar{position:relative;display:inline-grid;place-items:center;box-sizing:border-box;inline-size:var(--bindle-avatar-size,32px);block-size:var(--bindle-avatar-size,32px);border-radius:50%;background:var(--_raised);color:var(--_muted);border:1px dashed var(--_border)}
.ghost-avatar .icon{inline-size:62%;block-size:62%}
/* Attention bead: a filled dot with a surface-coloured ring at the avatar's top end, so it reads by shape and position,
   not colour alone; contrast 3.6:1 (light) / 7.9:1 (dark) against the surface ring. One gentle pulse, none under reduced motion. */
.bead{position:absolute;inset-block-start:-1px;inset-inline-end:-1px;inline-size:10px;block-size:10px;border-radius:50%;background:var(--bindle-attention,#ea580c);box-shadow:0 0 0 2px var(--_surface);animation:bindle-bead 1.6s var(--_ease) 2}
.root.dark .bead{background:var(--bindle-attention,#fb923c)}
@media (prefers-color-scheme:dark){.root.auto .bead{background:var(--bindle-attention,#fb923c)}}
@keyframes bindle-bead{0%,100%{scale:1}50%{scale:1.25}}
.tip{position:absolute;inset-block-start:calc(100% + 6px);inset-inline-end:0;z-index:2;box-sizing:border-box;inline-size:max-content;max-inline-size:min(16rem,calc(100vw - 16px));padding:6px 10px;border-radius:6px;background:var(--_text);color:var(--_surface);font-size:.86em;line-height:1.35;pointer-events:none;opacity:0;visibility:hidden;transition:opacity 120ms var(--_ease),visibility 0s linear 120ms}
.trigger:hover ~ .tip,.trigger:focus-visible ~ .tip{opacity:1;visibility:visible;transition-delay:0s}
.trigger[aria-expanded=true] ~ .tip,.wrap.tip-off .tip{opacity:0;visibility:hidden}
@media (forced-colors:active){.ghost-avatar{border:1px solid CanvasText}.bead{forced-color-adjust:none;background:Highlight;box-shadow:0 0 0 2px Canvas}.tip{border:1px solid CanvasText;background:Canvas;color:CanvasText}}
`;
/** The signed-out control both the placeholder and the view render (same tags, keys and nesting). */
// `restoring` (W11: persisted sessions are being read): the avatar and panel modes show the neutral avatar placeholder,
// busy, without the sign-in bead, label or action, because the most likely next state is a signed-in avatar of the
// same size. The button mode keeps its slot (slotted sign-in content shows its own restoring state), only busy.
export function signedOutControl({t,mode='avatar',busy=false,open=false,onClick,onKey,extra=[],prompt,restoring=false}){
  const label=h('span',t('Sign in')).classes('label');
  if(restoring&&mode==='button'){busy=true;restoring=false;}
  if(restoring){mode='avatar';busy=true;onClick=undefined;onKey=undefined;}
  if(mode==='avatar')return h('div',
    h('button',h('span',busy?icon('spinner'):icon('person'),!restoring&&h('span').classes('bead').attrs({'aria-hidden':'true'})).classes('ghost-avatar').attrs({part:'avatar placeholder'}))
      .props({type:'button'}).classes('trigger','avatar-only','signin-avatar').attrs({part:restoring?'trigger restoring':'trigger sign-in','aria-label':restoring?t('Restoring your session…'):t('Sign in'),'aria-describedby':'sign-in-tip','aria-haspopup':'dialog','aria-expanded':String(open),'aria-controls':'panel','aria-busy':busy?'true':'false'}).on({click:onClick,keydown:onKey}),
    h('span',h('slot',prompt??t('Sign in to save your work across devices')).attrs({name:'sign-in-prompt'})).props({id:'sign-in-tip'}).classes('tip').attrs({role:'tooltip',part:'tooltip'}).key('tip'),
    ...extra,
  ).classes('wrap',restoring&&'tip-off').attrs({part:'wrap'}).key('wrap');
  if(mode==='panel')return h('div',
    h('button',busy?icon('spinner'):icon('sign-in'),label).props({type:'button'}).classes('primary','signin-trigger').attrs({part:'sign-in','aria-haspopup':'dialog','aria-expanded':String(open),'aria-controls':'panel','aria-busy':busy?'true':'false'}).on({click:onClick,keydown:onKey}),
    ...extra,
  ).classes('wrap').attrs({part:'wrap'}).key('wrap');
  return h('slot',h('button',busy?icon('spinner'):icon('sign-in'),label).props({type:'button'}).classes('primary').attrs({part:'sign-in','aria-busy':busy?'true':'false'}).on({click:onClick})).attrs({name:'signed-out'}).key('signed-out');
}

// An explicit signed-out attribute wins. Without one the default is "avatar", except that markup slotting its own
// signed-out content (the earlier documented header pattern) keeps rendering it in place ("button").
export const signedOutMode=element=>{const value=element.getAttribute('signed-out');if(['avatar','panel','button'].includes(value))return value;return element.querySelector?.(':scope > [slot=signed-out]')?'button':'avatar';};
export class BindleAccountElement extends ElementBase {
  static observedAttributes=['actions','lang','theme','trigger','density','signed-out','sign-in-prompt','prominent'];
  #view=null;#loading=null;#connected=false;
  connectedCallback(){
    this.#connected=true;
    if(this.#view)return this.#view.connected();
    const run=()=>this.#loading?.then(()=>this.#view?.run('sign-in'));
    const restoring=this.closest?.('bindle-session')?.state==='restoring';
    reconcileShadow(this,[h('div',h('div',signedOutControl({t:localize(this).t,mode:signedOutMode(this),restoring,prompt:this.getAttribute('sign-in-prompt')||undefined,onClick:run})).classes('anchor').key('anchor')).classes('root','auto')],[baseStyles(this.ownerDocument.defaultView),triggerStyles(this.ownerDocument.defaultView)]);
    this.#loading??=import('./account-view.mjs').then(({AccountView})=>{this.#view=new AccountView(this);if(this.#connected)this.#view.connected();});
  }
  disconnectedCallback(){this.#connected=false;this.#view?.disconnected();}
  attributeChangedCallback(){if(this.#connected)this.#view?.render();}
  // Re-evaluates the effective scheme after an embedder theme change the element cannot observe.
  refreshTheme(){if(this.isConnected)this.#view?.render();}
  get session(){return this.#view?.session??null;}
  // Organization context (provisional): an app-supplied entity {subject, name?, picture?} shown with the person in the
  // trigger and panel header (prominent="entity" default, or "person"). Assign after the user selected the entity.
  #entity=null;
  get entity(){return this.#view?.entity??null;}
  set entity(value){this.#entity=value??null;if(this.#view)this.#view.entity=this.#entity;}
  get pendingEntity(){return this.#entity;}
  get open(){return this.#view?.open??false;}
  // Read-only snapshot, updated before the corresponding event (late listeners read it).
  get state(){return this.#view?.state??signedOut;}
  // Opens or closes the panel from script (for example a keyboard shortcut); returns the new state.
  toggle(open){return this.#view?.toggle(open)??false;}
  // Called by the island mounter (components profile §5.4).
  islandSelect(subject){this.#view?.islandSelect(subject);}
  islandClose(reason){this.#view?.islandClose(reason);}
  islandFlow(phase,outcome,code){this.#view?.islandFlow(phase,outcome,code);}
}
