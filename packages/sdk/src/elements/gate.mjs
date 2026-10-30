// <bindle-gate>: the "sign-in required" pattern (ui-elements-audit G2). Its children (the default slot) show only
// while the nearest <bindle-session> holds an app session; until the controller has loaded (and restored any persisted
// sessions, W11) it shows the `loading` slot, and signed out the `signed-out` slot, whose default is a sign-in card around a <bindle-sign-in>. The
// decision is the controller's `state` (engine-first: BindleSession), never anything provider-side.
//
// Presentation only: the gated children stay in the light DOM (hidden, so not rendered or exposed to assistive
// technology). Access control belongs to the app's own back end, which checks the app session's tokens.
//
// The host reflects `state="loading|signed-out|signed-in"` for embedder CSS. When the gate opens while focus was in
// its signed-out content (the sign-in form just completed), focus moves to the content region so keyboard and
// screen-reader users are not stranded on a removed control.
import {ElementBase,baseStyles,h,icon,localize,reconcileShadow,requestSession,schemeFor,watchScheme} from './shared.mjs';
import {css} from '../../../../vendor/dodo/style.js';

const styles=view=>css.in(view)`
:host{display:block}
.region[hidden]{display:none}
.content{outline:none}
.loading{display:flex;justify-content:center;padding:32px 16px;color:var(--_muted)}
.card{box-sizing:border-box;max-inline-size:min(24rem,100%);margin:32px auto;padding:24px;border:1px solid var(--_line);border-radius:calc(var(--_radius) + 4px);background:var(--_surface);color:var(--_text);box-shadow:var(--_shadow)}
.card h2{margin:0 0 4px;font-size:1.25em;line-height:1.3;font-weight:600}
.card .lead{margin:0 0 20px;color:var(--_muted)}
@media (max-width:480px){.card{margin:16px auto;padding:20px 16px;box-shadow:none}}
@media (forced-colors:active){.card{border-color:CanvasText}}
`;

/** The gate's state from the controller's (pure; tested at the engine level): 'loading' | 'signed-out' | 'signed-in'. */
export function gateState({loaded,state}){return !loaded||state==='restoring'?'loading':state==='signed-in'?'signed-in':'signed-out';}

export class BindleGateElement extends ElementBase {
  static observedAttributes=['lang','theme'];
  #session=null;#loaded=false;#connected=false;#listeners=[];#unwatch=null;#state=null;
  connectedCallback(){
    this.#connected=true;this.#unwatch=watchScheme(this,()=>this.render());this.render();
    requestSession(this,session=>{if(!this.#connected)return;this.#attach(session);});
  }
  disconnectedCallback(){this.#connected=false;this.#unwatch?.();for(const [type,listener] of this.#listeners)this.#session?.removeEventListener(type,listener,{capture:true});this.#listeners=[];}
  attributeChangedCallback(){if(this.#connected)this.render();}
  get session(){return this.#session;}
  /** 'loading' | 'signed-out' | 'signed-in'. */
  get state(){return gateState({loaded:this.#loaded,state:this.#session?.state});}
  refreshTheme(){if(this.isConnected)this.render();}
  #attach(session){
    this.#session=session;const rerender=()=>this.render();
    // Capture listeners run before the nested sign-in's own (at-target order), so the gate still sees where focus was
    // before the sign-in composition re-renders into its signed-in state.
    for(const type of ['bindle-session-change','bindle-flow-state','bindle-session-restored']){session.addEventListener(type,rerender,{capture:true});this.#listeners.push([type,rerender]);}
    // `ready` resolves once the controller exists (or failed to load: then the gate stays signed out).
    Promise.resolve(session.ready).then(()=>{this.#loaded=true;this.render();});
  }
  render(){
    if(!this.#connected)return;
    const {t,direction}=localize(this),state=this.state,previous=this.#state;this.#state=state;
    if(this.getAttribute('state')!==state)this.setAttribute('state',state);
    // Focus inside the signed-out region at the moment the gate opens?
    let active=this.ownerDocument.activeElement;while(active?.shadowRoot?.activeElement&&active!==this)active=active.shadowRoot.activeElement;
    const region=this.shadowRoot?.querySelector('.region.signed-out'),stranded=previous==='signed-out'&&state==='signed-in'&&(!!region&&(region.contains(this.shadowRoot.activeElement)||[...this.querySelectorAll(':scope > [slot=signed-out]')].some(node=>node.contains(this.ownerDocument.activeElement))));
    const signIn=this.localName.replace(/-gate$/,'-sign-in'),{theme,colorScheme}=schemeFor(this,this.#session);
    const controller=this.getAttribute('controller');
    reconcileShadow(this,[h('div',
      h('div',h('slot',h('div',icon('spinner',{size:20}),h('span',t('Loading…')).classes('visually-hidden')).classes('loading').attrs({role:'status'})).attrs({name:'loading'})).classes('region','loading-region').props({hidden:state!=='loading'}).key('loading'),
      h('div',h('slot',h('div',
        h('slot',h('h2',t('Sign in to continue'))).attrs({name:'heading'}),
        h('p',h('slot',t('Use your Bindle account to open this app.')).attrs({name:'lead'})).classes('lead'),
        h(signIn).attrs(controller?{controller}:{}),
      ).classes('card').attrs({part:'card'})).attrs({name:'signed-out'})).classes('region','signed-out').props({hidden:state!=='signed-out'}).key('signed-out'),
      h('div',h('slot')).classes('region','content').attrs({part:'content',tabindex:'-1'}).props({hidden:state!=='signed-in'}).key('content'),
    ).classes('root',theme).attrs({dir:direction}).style(colorScheme?{'color-scheme':colorScheme}:{})],[baseStyles(this.ownerDocument.defaultView),styles(this.ownerDocument.defaultView)]);
    if(stranded)this.shadowRoot.querySelector('.content')?.focus({preventScroll:true});
  }
}
