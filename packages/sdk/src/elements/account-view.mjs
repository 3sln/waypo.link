// AccountView: the implementation behind <bindle-account> (account.mjs), loaded
// when the element connects so define.mjs stays small. The composed profile
// button (decision note §6.2, CP-8). One
// <dialog> container (an anchored popover; disclosure pattern, no role=menu) in
// every composition. The trigger shows only approved, app-granted identity: the
// standard avatar (granted picture → initials → subject monogram) and the granted
// display name or handle. It never shows the handle typed into <bindle-sign-in>.
// Actions come from the session issuer's capability set, so nothing renders that
// the provider cannot do. Provider islands (avatar, switcher) mount through the
// island hook when declared; the standard composition is used otherwise.
//
// Header patterns (ui-elements-audit W4, provisional): a ghost trigger whose label truncates to one line (V3, V4);
// a panel header with the current account (V5); grouped actions with icons (V6); held accounts as rows with a
// per-row sign-out when no switcher island is live (G4, G5); signed-out="panel" puts the sign-in composition in the
// same popover (G1); flow and sign-out notices appear inside the open panel or in a bubble anchored to the control,
// never inline in the header (G9, G6); busy states on the control that started a flow (G16).
import {parseIdentity} from '../handle.mjs';
import {attrs,baseStyles,emit,emitLater,flowNotice,flowStatus,h,icon,islandPart,localize,mountIsland,reconcileShadow,requestSession,schemeFor,startFlow,watchScheme} from './shared.mjs';
import {avatarModel,avatarStyles,avatarView,composedAvatarView,entityIdentity,entityModel} from './avatar-view.mjs';
import {css} from '../../../../vendor/dodo/style.js';
import {accountActions,signedOutControl,signedOutMode,triggerStyles} from './account.mjs';
const defaultActions=['accounts','switch','provider','sign-out','manage'];
const styles=view=>css.in(view)`
/* Ghost trigger (V4): transparent at rest, a tint on hover and press, a chevron as the menu affordance; it keeps the
   44 px target. The label is one line with an ellipsis (V3); the full name stays in the accessible name and header. */
.trigger:not(.avatar-only){padding-inline:5px 10px}
.trigger.avatar-only .chevron:not(.icon-spinner){display:none}
.trigger .chevron{color:var(--_muted);transition:rotate 120ms var(--_ease)}
.trigger[aria-expanded=true] .chevron{rotate:180deg}
.label{min-inline-size:0;max-inline-size:var(--bindle-label-max,14em);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (max-width:480px){.label{max-inline-size:var(--bindle-label-max,10em)}}
/* trigger="avatar" (default, owner direction 2026-10-29): the avatar alone, the name in the accessible name.
   trigger="avatar-label": avatar and name. trigger="auto": avatar and name, avatar only on narrow viewports. */
@media (max-width:600px){.trigger.auto{padding:5px}.trigger.auto .chevron:not(.icon-spinner){display:none}.trigger.auto .label{position:absolute;inline-size:1px;block-size:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}}
.signin-trigger .label,.anchor > slot > button .label{max-inline-size:none}
.avatar-box{position:relative;display:inline-grid;flex:none;anchor-name:--bindle-avatar}
/* The avatar island covers the standard avatar exactly (V1): same box, centred like the trigger's content, and
   clipped to the circle so a square raster never overhangs the pill. Size and position are embedder-side facts
   (C1); anchor positioning follows embedder ::part(trigger) padding where supported. */
.avatar-island{position:absolute;inset-block-start:50%;inset-inline-start:calc(1px + 5px);translate:0 -50%;inline-size:var(--bindle-avatar-size,32px);block-size:var(--bindle-avatar-size,32px);pointer-events:none;border-radius:50%;overflow:hidden;clip-path:circle(50%)}
@supports (anchor-name:--a) and (top:anchor(top)){.avatar-island{position-anchor:--bindle-avatar;inset:auto;top:anchor(top);left:anchor(left);translate:none}}
.avatar-island[hidden],.wrap[hidden]{display:none}
.island-host{display:block;inline-size:100%;block-size:100%}
/* Panel = island surface (V8): one surface, decorative 1 px edges, 120 ms fade and 4 px rise on open, 90 ms close.
   A fixed inline size (20rem inside the borders) gives the switcher island its v1 default 320 px width (G4b), an
   embedder-side constant never derived from island content (C1). */
.panel,.bubble{box-sizing:border-box;inline-size:min(calc(20rem + 2px),calc(100vw - 16px));max-inline-size:calc(100vw - 16px);margin:0;padding:0;border:1px solid var(--_line);border-radius:calc(var(--_radius) + 4px);background:var(--_surface);color:var(--_text);box-shadow:var(--_shadow);overflow:auto;overscroll-behavior:contain;transition:opacity 120ms var(--_ease),transform 120ms var(--_ease),overlay 120ms allow-discrete,display 120ms allow-discrete}
.panel[popover]:not(:popover-open),.bubble[popover]:not(:popover-open){opacity:0;transform:translateY(4px);transition-duration:90ms}
@starting-style{.panel:popover-open,.panel.inline[open],.bubble:popover-open{opacity:0;transform:translateY(4px)}}
.panel.inline,.bubble.inline{position:absolute;inset-inline-end:0;inset-block-start:calc(100% + 4px);z-index:1}
.panel[open]{display:block}
.panel:popover-open,.bubble:popover-open{display:block}
.panel:focus-visible{outline:2px solid var(--_focus);outline-offset:2px}
/* Current account header (V5): 40 px avatar, name, then the granted handle and provider host. */
.header{display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:12px;align-items:center;padding:14px 16px 12px;--bindle-avatar-size:40px}
.header .who{display:grid;min-inline-size:0}
.header .name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.header .meta{font-size:.86em;color:var(--_muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.header[hidden],.accounts[hidden]{display:none}
.switcher{display:block;inline-size:100%;block-size:320px;border-block-end:1px solid var(--_line)}
.switcher.compact{block-size:248px}
.switcher[hidden]{display:none}
.group{display:block;padding:4px}
.group + .group{border-block-start:1px solid var(--_line)}
.group:empty{display:none}
.caption{display:block;padding:8px 12px 4px;font-size:.8em;font-weight:600;letter-spacing:.02em;color:var(--_muted)}
.item,::slotted(a),::slotted(button){display:flex;align-items:center;gap:12px;box-sizing:border-box;inline-size:100%;min-block-size:44px;padding:8px 12px;border:0;border-radius:calc(var(--_radius) - 2px);background:transparent;color:var(--_text);text-align:start;text-decoration:none;font:inherit;font-weight:inherit;justify-content:flex-start;cursor:pointer;transition:background-color 80ms linear}
.item .icon{color:var(--_muted)}
.item > .icon:first-child{margin-inline:4px}
.item .trail{margin-inline-start:auto}
.item:hover,::slotted(a:hover),::slotted(button:hover){background:color-mix(in srgb,var(--_text) 6%,transparent)}
.item:active{background:color-mix(in srgb,var(--_text) 12%,transparent)}
/* Inside the panel the ring sits inside the row, clear of the panel edge (V7). */
.item:focus-visible,.row-out:focus-visible,::slotted(a:focus-visible),::slotted(button:focus-visible){outline:2px solid var(--_focus);outline-offset:-2px}
.danger,.danger .icon{color:var(--_danger)}
.note{display:block;font-size:.85em;color:var(--_muted);padding:0 16px 12px}
/* Held accounts (G4): one row per other account, selecting makes it current; a trailing per-row sign-out (G5). */
.account-row{display:flex;align-items:center;gap:2px}
.account-row .item{flex:1;min-inline-size:0;--bindle-avatar-size:28px}
.account-row .who{display:grid;min-inline-size:0}
.account-row .name,.account-row .meta{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.account-row .meta{font-size:.86em;color:var(--_muted)}
.row-out{flex:none;min-inline-size:44px;padding:0;border:0;background:transparent;color:var(--_muted);border-radius:calc(var(--_radius) - 2px)}
.row-out:hover{background:color-mix(in srgb,var(--_text) 6%,transparent);color:var(--_text)}
/* Handle form (V9): replaces the list, with a back button, the field component, help and an inline error. */
.handle{display:block;padding:8px 16px 16px}
.handle .top{display:flex;align-items:center;gap:4px;margin:0 0 8px -8px}
.handle .back{min-inline-size:36px;min-block-size:36px;padding:0;border:0;background:transparent;color:var(--_text);border-radius:50%}
.handle .back .icon{rotate:90deg}
.handle .back:hover{background:color-mix(in srgb,var(--_text) 6%,transparent)}
:host(:dir(rtl)) .handle .back .icon,.root[dir=rtl] .handle .back .icon{rotate:-90deg}
.handle .title{font-weight:600}
.handle label{display:block;font-size:.9em;font-weight:600;margin-block-end:6px}
.handle .field{display:flex;align-items:center;min-block-size:44px;box-sizing:border-box;border:1px solid var(--_border);border-radius:var(--_radius);padding:4px 12px;background:var(--_surface);cursor:text}
.handle .field:focus-within{border-color:var(--_focus);outline:2px solid var(--_focus);outline-offset:2px}
.handle .field.invalid{border-color:var(--_danger)}
.handle .field.invalid:focus-within{outline-color:var(--_danger)}
.handle .entry{display:inline-grid;flex:0 1 auto;min-inline-size:0}
.handle .entry > *{grid-area:1 / 1;font:inherit}
.handle .mirror{visibility:hidden;white-space:pre;overflow:hidden;min-inline-size:1ch;padding-inline-end:1px}
.handle input{inline-size:auto;justify-self:stretch;min-inline-size:0;border:0;outline:none;background:transparent;color:var(--_text);font:inherit;padding:0;min-block-size:32px}
.handle input::placeholder{color:var(--_muted);opacity:1}
.handle .suffix{flex:none;color:var(--_muted);white-space:nowrap}
.handle .hint,.handle .field-error{margin:6px 0 0;font-size:.86em;color:var(--_muted);overflow-wrap:anywhere}
.handle .field-error{display:flex;gap:6px;color:var(--_danger)}
.handle .field-error .icon{margin-block-start:.1em}
.handle .submit{inline-size:100%;margin-block-start:12px}
.signin-pane{display:block;padding:16px}
.signin-pane .title{margin:0 0 12px;font-weight:600;font-size:1.05em}
/* Notices (G9, G6): inside the open panel, or in a bubble anchored to the control. */
.panel .notice{margin:0 12px 12px}
.bubble{padding:12px 12px 12px 14px;inline-size:min(calc(18rem + 2px),calc(100vw - 16px))}
.bubble .notice{margin:0;padding:0;border:0;background:transparent}
.bubble .close{position:absolute;inset-block-start:4px;inset-inline-end:4px;min-inline-size:36px;min-block-size:36px;padding:0;border:0;background:transparent;color:var(--_muted);border-radius:50%}
.bubble .close:hover{background:color-mix(in srgb,var(--_text) 6%,transparent)}
.bubble .notice p{padding-inline-end:28px}
.bubble[hidden]{display:none}
@media (forced-colors:active){.panel,.bubble{border-color:CanvasText;background:Canvas;color:CanvasText}.item{color:ButtonText}.group + .group{border-color:CanvasText}.trigger{border-color:ButtonText}}
`;
const failureCodes={canceled:'canceled',dismissed:'canceled','network-error':'network-error','discovery-error':'network-error'};
const keyOf=view=>view?`${view.issuer} ${view.subject}`:'';

export class AccountView {
  constructor(host){this.host=host;this.#entity=entityIdentity(host.pendingEntity);}
  #entity=null;
  get entity(){return this.#entity;}
  set entity(value){this.#entity=entityIdentity(value);this.render();}
  #session=null;#open=false;#listeners=[];#connected=false;#unwatch=null;#reason=null;#keyboard=false;#handleMode=null;#handleError='';#handleValue='';#pictureFailed=new Set();
  #reported;#switching=false;#islands={avatar:null,switcher:null};#islandStates={avatar:'off',switcher:'off'};#islandKeys={avatar:'',switcher:''};#switcherWanted=false;#dismissedAt=-Infinity;#selected=null;
  #ended=null;#reauthing=false;
  connected(){this.#connected=true;this.#unwatch=watchScheme(this.host,()=>this.render());this.render();requestSession(this.host,session=>{if(this.#connected)this.#attach(session);});}
  disconnected(){this.#connected=false;this.#unwatch?.();this.#setOpen(false,'disconnect',{restoreFocus:false});this.#detach();for(const name of ['avatar','switcher'])this.#unmount(name);}
  get session(){return this.#session;}
  get open(){return this.#open;}
  #panelMode(){return signedOutMode(this.host)!=='button';}
  #tipOff=false;
  #signInWanted=false;
  // The sign-in prompt: the sign-in-prompt attribute, else the slotted prompt's text, else the default copy.
  #prompt(t){return this.host.getAttribute('sign-in-prompt')||this.host.querySelector(':scope > [slot=sign-in-prompt]')?.textContent?.trim()||t('Sign in to save your work across devices');}
  // Read-only snapshot, updated before the corresponding event (late listeners read it).
  get state(){
    const view=this.#session?.session??null;
    return Object.freeze({status:!view?(this.#session?.state==='restoring'?'restoring':'signed-out'):this.#switching?'changing':'signed-in',session:view,sessions:this.#sessions(),open:this.#open,mode:view||this.#panelMode()?'popover':null,islands:Object.freeze({...this.#islandStates}),actions:Object.freeze(this.#available()),capabilities:this.#session?.capabilities??null});
  }
  #sessions(){return this.#session?.sessions??Object.freeze([]);}
  toggle(open=!this.#open){if(!this.#session?.session&&!this.#panelMode())return false;this.#setOpen(!!open,'trigger',{restoreFocus:!open,focusInside:!!open});return this.#open;}
  #attach(session){
    this.#detach();this.#session=session;
    const changed=()=>{
      const view=session.session,key=keyOf(view);
      if(this.#reported!==undefined&&key!==this.#reported){
        // The slotted sign-in (or the signed-out button) that held focus is about to unassign: focus the trigger.
        if(this.#focusInside())this.#refocus=true;
        // The cause comes from the session controller (engine-first; G6): sign-in, switch, sign-out, expired,
        // revoked or removed. A sign-in from the signed-out panel closes it; focus follows to the trigger.
        const change=session.lastChange,previous=change?.previous?.subject??null,cause=change&&keyOf(change.session)===key?change.cause:!view?'sign-out':this.#reported?'switch':'sign-in';
        this.#switching=false;this.#handleMode=null;
        this.#ended=['revoked','removed','expired'].includes(cause)?Object.freeze({cause,continued:!!view,host:change?.previous?.issuer?new URL(change.previous.issuer).host:null}):null;
        if(this.#open){const inside=this.#focusInside();this.#setOpen(false,'session',{restoreFocus:false});if(inside)this.#refocus=true;}
        emitLater(this.host,'bindle-account-change',{previous,session:view,cause});
      }
      this.#reported=key;
      this.render();
    };
    const ended=event=>{
      if(session.flowInitiator!==this.host)return;
      const {intent,outcome,code,authTime}=event.detail;
      if(intent==='reauthenticate'&&this.#reauthing&&!['redirecting','popup-blocked'].includes(outcome)){this.#reauthing=false;emitLater(this.host,'bindle-account-reauth',{outcome:outcome==='completed'?'completed':outcome==='network-error'?'network-error':'canceled',...authTime!==undefined?{authTime}:{}});this.render();return;}
      if(!this.#switching)return;
      if(['completed','redirecting','popup-blocked'].includes(outcome))return;
      this.#switching=false;
      if(code==='identity-required'){this.#handleMode='another';this.#setOpen(true,'action',{focusInside:true});return;}
      emitLater(this.host,'bindle-account-change-failed',{code:code==='no-session'?'no-session':outcome==='network-error'&&code!=='network-error'?'exchange-failed':failureCodes[outcome]??'canceled'});
      this.render();
    };
    const flowStarted=()=>{if(session.flowInitiator===this.host)this.#ended=null;this.render();};
    for(const [type,listener] of [['bindle-session-change',changed],['bindle-flow-state',()=>this.render()],['bindle-flow-start',flowStarted],['bindle-flow-end',ended],['bindle-capabilities-change',()=>this.render()],['bindle-sessions-change',()=>this.render()],['bindle-session-restored',()=>this.render()]]){session.addEventListener(type,listener);this.#listeners.push([type,listener]);}
    changed();
  }
  #detach(){for(const [type,listener] of this.#listeners)this.#session?.removeEventListener(type,listener);this.#listeners=[];}
  #trigger(){return this.host.shadowRoot?.querySelector('.trigger,.signin-trigger,.anchor > slot > button');}
  #panel(){return this.host.shadowRoot?.querySelector('.panel');}
  #bubble(){return this.host.shadowRoot?.querySelector('.bubble');}
  #refocus=false;
  #focusInside(){let active=this.host.ownerDocument.activeElement;return active===this.host||this.host.contains(active);}
  // Requested actions filtered by what the session issuer can do (A7). Without a
  // known capability set only the always-available actions render.
  #available(){
    const value=this.host.getAttribute('actions'),requested=(value===null?defaultActions:value.split(/\s+/)).filter(action=>accountActions.includes(action));
    const capabilities=this.#session?.capabilities,live=this.#islandStates.switcher==='live';
    return requested.filter(action=>action==='reauth'?!!capabilities?.reauthenticate:action==='provider-sign-out'?!!capabilities?.endSession:live?!['switch','manage','accounts'].includes(action):true);
  }
  #setOpen(open,reason,{restoreFocus=true,focusInside=false}={}){
    if(this.#open===open)return;
    this.#open=open;this.#reason=null;
    const doc=this.host.ownerDocument,view=doc?.defaultView,panel=this.#panel();
    // The built-in sign-in composition is created on the first opening only (no discovery or island before intent).
    if(open&&!this.#signInWanted){this.#signInWanted=true;}
    if(open){this.#ended=null;doc?.addEventListener('pointerdown',this.#onOutside,true);view?.addEventListener('resize',this.#place);view?.addEventListener('scroll',this.#place,{capture:true,passive:true});this.#wantSwitcher();}
    else{doc?.removeEventListener('pointerdown',this.#onOutside,true);view?.removeEventListener('resize',this.#place);view?.removeEventListener('scroll',this.#place,{capture:true});this.#handleError='';}
    this.render();
    const target=this.#panel()??panel;
    if(this.#popover(target)){try{if(open&&!target.matches(':popover-open'))target.showPopover({source:this.#trigger()});else if(!open&&target.matches(':popover-open'))target.hidePopover();}catch{}}
    if(open){this.#place();if(focusInside)this.#focusFirst(target);else target?.focus?.({preventScroll:true});}
    emit(this.host,'bindle-menu-toggle',{open,reason});
    if(!open&&restoreFocus)this.#trigger()?.focus();
  }
  // First focusable control in the panel, including the signed-out sign-in composition (its own focus()).
  #focusFirst(panel){
    if(!panel)return;
    const signIn=panel.querySelector('slot[name=signed-out]')?.assignedElements?.()[0]??panel.querySelector('.signin-pane > :not(.title)');
    if(signIn&&typeof signIn.focus==='function'){signIn.focus({preventScroll:true});if(this.host.ownerDocument.activeElement!==this.host.ownerDocument.body&&this.#focusInside())return;}
    (panel.querySelector('input,button:not([disabled]),a[href]')??panel).focus({preventScroll:true});
  }
  #popover(panel){return !!panel&&typeof panel.showPopover==='function'&&panel.hasAttribute('popover');}
  // Popover state changes the element did not request (light dismiss, Escape).
  #onToggle=event=>{
    const open=event.newState==='open';if(open===this.#open)return;
    const reason=this.#reason??(open?'trigger':'outside');this.#reason=null;
    if(!open)this.#dismissedAt=globalThis.performance?.now?.()??Date.now();
    this.#setOpen(open,reason,{restoreFocus:reason==='escape'});
  };
  #onOutside=event=>{if(!event.composedPath().includes(this.host)&&!event.composedPath().includes(this.#panel()))this.#setOpen(false,'outside',{restoreFocus:false});};
  #onTriggerKey=event=>{if(['Enter',' ','ArrowDown'].includes(event.key)){this.#keyboard=true;if(event.key==='ArrowDown'&&!this.#open){event.preventDefault();this.#setOpen(true,'trigger',{focusInside:true});}}};
  #onTriggerClick=()=>{
    // Without invoker-aware light dismiss, a press on the trigger first dismisses the popover; never reopen it.
    if(!this.#open&&(globalThis.performance?.now?.()??Date.now())-this.#dismissedAt<300)return;
    const keyboard=this.#keyboard||this.#panelMode()&&!this.#session?.session;this.#keyboard=false;this.#setOpen(!this.#open,'trigger',{restoreFocus:false,focusInside:keyboard});};
  // Escape hides the tooltip without moving the pointer (WCAG 1.4.13); it returns on the next hover or focus.
  #onSignInKey=event=>{if(event.key==='Escape'&&!this.#open){if(!this.#tipOff){this.#tipOff=true;this.render();}return;}this.#onTriggerKey(event);};
  #onPanelKey=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(this.#handleMode){this.#back();return;}this.#setOpen(false,'escape');}};
  // Focus leaving the panel closes it (CPR-20: hostile islands cannot hold it open).
  #onFocusOut=()=>setTimeout(()=>{
    if(!this.#open)return;let active=this.host.ownerDocument.activeElement;
    while(active?.shadowRoot?.activeElement)active=active.shadowRoot.activeElement;
    const panel=this.#panel();if(!active||active===this.host.ownerDocument.body||active===this.host||this.host.contains(active)||panel?.contains(active)||this.host.shadowRoot?.contains(active))return;
    // The nested sign-in composition renders inside its own shadow root.
    if(active.getRootNode?.()?.host&&panel?.contains(active.getRootNode().host))return;
    this.#setOpen(false,'focus',{restoreFocus:false});
  },0);
  // Anchored placement in the top layer: below the control, flipped above when it fits better, kept 8px inside the
  // viewport; the panel aligns to the control's inline end in a header (it sits at the end of most app bars).
  #place=()=>{
    const view=this.host.ownerDocument.defaultView,trigger=this.#trigger();if(!view||!trigger)return;
    for(const panel of [this.#open?this.#panel():null,this.#bubble()]){
      if(!panel||!this.#popover(panel)||!panel.matches(':popover-open'))continue;
      const rect=trigger.getBoundingClientRect(),width=panel.offsetWidth,height=panel.offsetHeight,below=view.innerHeight-rect.bottom-12,above=rect.top-12;
      const up=height>below&&above>below,rtl=view.getComputedStyle(this.host).direction==='rtl';
      const startAligned=rtl?rect.right-width:rect.left,endAligned=rtl?rect.left:rect.right-width;
      // Prefer start alignment when the panel fits that way, else end alignment (header end), clamped to the viewport.
      const fitsStart=rtl?startAligned>=8:startAligned+width<=view.innerWidth-8,preferred=fitsStart?startAligned:endAligned;
      const left=Math.min(Math.max(8,preferred),Math.max(8,view.innerWidth-width-8));
      Object.assign(panel.style,{position:'fixed',inset:'auto',insetInlineStart:'auto',left:`${left}px`,top:up?'auto':`${rect.bottom+6}px`,bottom:up?`${view.innerHeight-rect.top+6}px`:'auto',maxHeight:`${Math.max(120,up?above:below)}px`});
    }
  };
  // Flow methods run synchronously in the click so a popup opens inside the activation.
  #start(intent,options){const session=this.#session;return session[startFlow]?session[startFlow](intent,options,this.host):({login:()=>session.signIn(options),'select-account':()=>session.switchAccount(options),reauthenticate:()=>session.reauthenticate(options),'end-session':()=>session.endProviderSession()})[intent]();}
  run(action){return this.#run(action);}
  #run(action,detail){
    const session=this.#session;if(!session)return;
    const capabilities=session.capabilities;
    if(action==='sign-in'&&this.#panelMode()){this.#onTriggerClick();return;}
    // "Use another account" without select-account or identity-optional login, and
    // "Use a different provider", need a typed handle first (CP-10).
    if(action==='provider'||action==='switch'&&capabilities&&!capabilities.selectAccount&&!capabilities.identityless){this.#handleMode=action==='provider'?'provider':'another';this.#handleError='';this.#handleValue='';this.render();this.host.shadowRoot?.querySelector('.handle input')?.focus();return;}
    if(action==='select'){this.#selectHeld(detail);return;}
    if(action==='sign-out-one'){this.#signOutOne(detail);return;}
    this.#setOpen(false,'action');
    let result;
    if(action==='switch'){this.#switching=true;result=this.#start('select-account',{revokePrevious:this.host.hasAttribute('revoke-on-switch')});}
    if(action==='reauth'){this.#reauthing=true;result=this.#start('reauthenticate',{maxAge:Number.parseInt(this.host.getAttribute('reauth-max-age')??'300',10)||300});}
    if(action==='provider-sign-out')result=this.#start('end-session',{});
    if(action==='sign-out')result=session.signOut({revoke:this.host.hasAttribute('revoke-on-sign-out')});
    if(action==='sign-out-current'){const view=session.session;result=view&&session.signOut({subject:view.subject,issuer:view.issuer,revoke:this.host.hasAttribute('revoke-on-sign-out')});}
    if(action==='sign-in')result=this.#start('login',{});
    result?.catch?.(()=>{});
    this.render();
  }
  // A held account picked in the fallback rows (G4): only a held app session for exactly that subject becomes current.
  #selectHeld(subject){
    const result=this.#session?.controller?.selectAccount?.(subject)??{outcome:'canceled',code:'no-session'};
    this.#setOpen(false,'select');
    if(result.outcome==='completed')emitLater(this.host,'bindle-account-select',{subject});
    else emitLater(this.host,'bindle-account-change-failed',{code:'no-session'});
  }
  // Per-row sign-out (G5): ends exactly that held session; focus moves to the next row, else the first panel control.
  #signOutOne(subject){
    const session=this.#session,view=session?.session;if(!session||!view)return;
    const rows=[...this.host.shadowRoot.querySelectorAll('.account-row')],index=rows.findIndex(row=>row.dataset.subject===subject);
    session.signOut({subject,issuer:view.issuer,revoke:this.host.hasAttribute('revoke-on-sign-out')})?.catch?.(()=>{});
    queueMicrotask(()=>{const next=[...this.host.shadowRoot.querySelectorAll('.account-row .item')];(next[Math.min(index,next.length-1)]??this.#panel()?.querySelector('.item'))?.focus({preventScroll:true});});
  }
  #back=()=>{this.#handleMode=null;this.#handleError='';this.render();this.host.shadowRoot?.querySelector(`[data-action=${this.#lastAction??'switch'}]`)?.focus({preventScroll:true});};
  #lastAction=null;
  #tipOn=()=>{if(this.#tipOff){this.#tipOff=false;this.render();}};
  #onHandleInput=event=>{this.#handleValue=event.target.value;if(this.#handleError)this.#handleError='';this.render();};
  #onHandleSubmit=event=>{
    event.preventDefault();
    const t=localize(this.host).t,value=this.host.shadowRoot.querySelector('.handle input').value.trim(),session=this.#session;
    const host=this.#handleMode==='another'?new URL(session.session.issuer).host:'none';
    try{parseIdentity(value,host,{allowInsecureLocalhost:session.client?.allowInsecureLocalhost===true});}
    catch(error){this.#handleError=value?t(error.message):t('Enter your handle.');this.render();this.host.shadowRoot.querySelector('.handle input')?.focus();return;}
    const identity=this.#handleMode==='another'&&!value.includes('@')?`${value}@${host}`:value;
    this.#handleMode=null;this.#setOpen(false,'action');this.#switching=true;
    this.#start('select-account',{identity,revokePrevious:this.host.hasAttribute('revoke-on-switch')})?.catch?.(()=>{});
  };
  // ---- Island hook (avatar on sign-in, switcher on first intent) ----
  #wantSwitcher=()=>{if(!this.#switcherWanted){this.#switcherWanted=true;this.render();}};
  #syncIsland(name,part,selector,wanted){
    const spec=wanted?islandPart(this.#session,part):null,key=spec?`${spec.issuer} ${spec.version}`:'';
    if(key===this.#islandKeys[name])return;this.#islandKeys[name]=key;this.#unmount(name);
    if(!spec)return;
    queueMicrotask(async()=>{
      const container=this.host.shadowRoot?.querySelector(selector);if(!container||this.#islandKeys[name]!==key)return;
      const island=await mountIsland(this.host,{part,container,session:this.#session,onState:state=>{if(this.#islandKeys[name]===key){this.#islandStates[name]=state;this.render();}}});
      // A mount that finished after its key changed or the element disconnected is discarded.
      if(this.#islandKeys[name]!==key||!this.#connected)island?.destroy();else this.#islands[name]=island;
    });
  }
  #unmount(name){try{this.#islands[name]?.destroy?.();}catch{}this.#islands[name]=null;if(this.#islandStates[name]!=='fallback')this.#islandStates[name]='off';}
  // Called by the island mounter for the switcher's `select` (profile §5.4): only a
  // held app session for exactly that subject is ever made current.
  islandSelect(subject){
    // Repeats for the same subject within 500 ms are one selection (embed-islands §10.2).
    const now=globalThis.performance?.now?.()??Date.now();if(subject===this.#selected?.subject&&now-this.#selected.at<500)return;this.#selected={subject,at:now};
    this.#selectHeld(subject);
  }
  islandClose(reason='escape'){this.#setOpen(false,reason==='dismiss'?'action':'escape');}
  // The switcher's "Use another account" (profile §5.4). `completed` arrives after the app's exchange settled, so the
  // controller's session change (bindle-account-change) has already been dispatched; failures keep the session.
  islandFlow(phase,outcome,code){
    if(phase==='started'){this.#switching=true;this.render();return;}
    if(phase!=='ended'||!this.#switching)return;
    this.#switching=false;
    if(outcome!=='completed')emitLater(this.host,'bindle-account-change-failed',{code:outcome==='network-error'?(code==='network-error'?'network-error':'exchange-failed'):'canceled'});
    this.render();
  }
  #avatar(view,label,{composed=false}={}){
    const model=avatarModel(view,{pictureFailed:this.#pictureFailed.has(view.profile?.picture)}),onPictureError=()=>{this.#pictureFailed.add(view.profile?.picture);this.render();};
    if(composed&&this.#entity)return composedAvatarView(model,entityModel(this.#entity,{pictureFailed:this.#pictureFailed.has(this.#entity.picture)}),{prominent:this.host.getAttribute('prominent')==='person'?'person':'entity',label,onPictureError:()=>{this.#pictureFailed.add(view.profile?.picture);this.#pictureFailed.add(this.#entity?.picture);this.render();}});
    return avatarView(model,{label,onPictureError});
  }
  #endNotice(t){
    const ended=this.#ended;if(!ended)return null;
    const host=ended.host??'';
    // When another held account took over, the copy says one account ended rather than "you were signed out".
    const text=ended.continued?(ended.cause==='revoked'?t('Access through {host} ended for one of your accounts, so it was signed out.',{host}):ended.cause==='removed'?t('This app was removed at {host} for one of your accounts, so it was signed out.',{host}):t('One of your sessions expired, so that account was signed out.')):ended.cause==='revoked'?t('Access through {host} ended, so you were signed out.',{host}):ended.cause==='removed'?t('This app was removed at {host}, so you were signed out.',{host}):t('Your session expired. Sign in again to continue.');
    return h('div',icon('alert'),h('p',text)).classes('notice','alert').attrs({part:'notice'});
  }
  render(){
    if(!this.#connected)return;
    const {t,direction}=localize(this.host),session=this.#session,view=session?.session,flow=session?.flow,mine=session?.flowInitiator===this.host;
    const {theme,colorScheme}=schemeFor(this.host,session),win=this.host.ownerDocument.defaultView;
    const panelMode=this.#panelMode(),popover=typeof win?.HTMLElement?.prototype?.showPopover==='function';
    const hadFocus=this.#focusInside()&&!!this.host.shadowRoot?.activeElement;
    // Island containers are keyed and stay in place across sign-in and sign-out, so mounted islands live as long as
    // the element is connected (embed-islands §8.2): on app sign-out they still receive session{null} and `forget`.
    // The iframe goes into a constant inner host: dodo replaces the children of any node whose vnode changed, so only
    // the outer box may toggle `hidden`.
    const avatarBox=h('span',h('span').classes('island-host')).classes('avatar-island').attrs({part:'avatar-frame','aria-hidden':'true'}).props({hidden:!view||!!this.#entity}).key('avatar-frame');
    // Fixed island height by density (profile §6: 320 or 248 CSS px), an embedder-side input only.
    const switcherLive=this.#islandStates.switcher==='live';
    const switcherBox=h('div',h('div').classes('island-host')).classes('switcher',this.host.getAttribute('density')==='compact'&&'compact').attrs({part:'switcher-frame'}).props({hidden:!view||!switcherLive}).key('switcher-frame');
    const working=mine&&!!flow&&!flow.done&&['opening','waiting','completing'].includes(flow.phase);
    const notice=mine&&flowNotice(flow,t,session),endNotice=!notice&&this.#endNotice(t);
    const panelAttrs=open=>({props:{id:'panel',tabIndex:-1,...popover?{}:{open}},attrs:attrs({part:'panel','aria-label':t('Account'),popover:popover?'auto':undefined})});
    let anchorChildren,panelBody=null;
    if(!view){
      // Restoring persisted sessions (W11): a busy neutral placeholder until the real state is known.
      const busy=working&&flow.intent==='login',restoring=session?.state==='restoring';
      if(panelMode){
        panelBody=[
          h('div',h('p',this.#prompt(t)).classes('title').attrs({id:'panel-title'}),h('slot',this.#signInWanted&&h(this.host.localName.replace(/-account$/,'-sign-in')).attrs(attrs({'default-host':this.host.getAttribute('default-host')??undefined,controller:this.host.getAttribute('controller')??undefined}))).attrs({name:'signed-out'})).classes('signin-pane').key('signin'),
          switcherBox,
          this.#open&&notice,
        ];
        const {props,attrs:panelAttributes}=panelAttrs(this.#open);
        const mode=signedOutMode(this.host);
        anchorChildren=[signedOutControl({t,mode,busy,restoring,open:this.#open,prompt:this.host.getAttribute('sign-in-prompt')||undefined,onClick:this.#onTriggerClick,onKey:this.#onSignInKey,extra:[
          avatarBox,
          h('dialog',...panelBody).props(props).classes('panel',!popover&&'inline').attrs(attrs({...panelAttributes,'aria-label':undefined,'aria-labelledby':'panel-title'})).on({toggle:this.#onToggle,keydown:this.#onPanelKey,focusout:this.#onFocusOut}).key('panel'),
        ]})];
        if(mode==='avatar'){const wrap=anchorChildren[0];wrap.classes('wrap',this.#tipOff&&'tip-off');}
      } else {
        anchorChildren=[signedOutControl({t,mode:'button',busy,restoring,onClick:()=>this.#run('sign-in')}),
          (this.#islandKeys.avatar||this.#islandKeys.switcher)&&h('div',avatarBox,h('dialog',switcherBox).props({id:'panel'}).classes('panel').key('panel')).classes('wrap').props({hidden:true}).key('wrap')];
      }
    } else {
      // Without a granted name the trigger names the provider host (G: "Signed in · host" read as a status, not an account).
      const capabilities=session.capabilities,host=new URL(view.issuer).host,name=view.profile?.displayName??view.profile?.handle,label=name??host;
      const actions=this.#available(),triggerMode=this.host.getAttribute('trigger'),autoLabel=triggerMode==='auto',avatarOnly=!autoLabel&&triggerMode!=='avatar-label';
      const others=actions.includes('accounts')&&!switcherLive?this.#sessions().filter(item=>keyOf(item)!==keyOf(view)):[];
      const multiple=this.#sessions().length>1;
      const item=(action,text,iconName,{danger=false,trail=null,extra={}}={})=>h('div',h('button',icon(iconName,{size:20}),h('span',text),trail).props({type:'button'}).attrs(attrs({part:danger?'item item-danger':'item','data-action':action,...extra})).classes('item',danger&&'danger').on({click:()=>{this.#lastAction=action;this.#run(action);}})).attrs({role:'listitem'});
      const account=[
        actions.includes('switch')&&item('switch',t('Use another account'),'plus'),
        actions.includes('provider')&&item('provider',t('Use a different provider'),'globe'),
        actions.includes('reauth')&&item('reauth',t("Confirm it's you"),'shield'),
        actions.includes('manage')&&h('div',h('a',icon('person',{size:20}),h('span',t('Manage at {host}',{host})),icon('external',{className:'trail'})).attrs({part:'item',href:capabilities?.manageUrl??view.issuer+'/',target:'_blank',rel:'noopener noreferrer'}).classes('item')).attrs({role:'listitem'}),
      ].filter(Boolean);
      const sessionGroup=[
        actions.includes('sign-out')&&(multiple?[item('sign-out-current',t('Sign out of this account'),'sign-out'),item('sign-out',t('Sign out of all accounts'),'sign-out')]:[item('sign-out',t('Sign out of this app'),'sign-out')]),
        actions.includes('provider-sign-out')&&item('provider-sign-out',t('Sign out of {host}…',{host}),'sign-out',{danger:true,extra:{'aria-describedby':'provider-note'}}),
      ].flat().filter(Boolean);
      const note=actions.includes('provider-sign-out')&&h('span',t('Other apps and accounts stay signed in unless you choose otherwise at {host}.',{host})).props({id:'provider-note'}).classes('note');
      const hasEnd=!!this.host.querySelector(':scope > [slot=menu-end]'),hasStart=!!this.host.querySelector(':scope > [slot=menu-start]');
      const rows=others.length>0&&h('div',
        h('span',t('Other accounts')).classes('caption').attrs({'aria-hidden':'true'}),
        ...others.map(other=>{
          const otherName=other.profile?.displayName??other.profile?.handle??t('Account at {host}',{host:new URL(other.issuer).host});
          return h('div',h('div',
            h('button',this.#avatar(other),h('span',h('bdi',otherName).classes('name').attrs({dir:'auto'}),other.profile?.handle&&other.profile.handle!==otherName?h('bdi',other.profile.handle).classes('meta').attrs({dir:'auto'}):null).classes('who')).props({type:'button'}).classes('item').attrs({part:'item account','aria-label':t('Switch to {name}',{name:otherName})}).on({click:()=>this.#run('select',other.subject)}),
            h('button',icon('sign-out')).props({type:'button'}).classes('row-out').attrs({part:'item','aria-label':t('Sign out of {name}',{name:otherName}),title:t('Sign out of {name}',{name:otherName})}).on({click:()=>this.#run('sign-out-one',other.subject)}),
          ).classes('account-row').attrs({'data-subject':other.subject})).attrs({role:'listitem'}).key(other.subject);
        }),
      ).classes('group','accounts').attrs({role:'list','aria-label':t('Other accounts'),part:'accounts'}).key('accounts');
      const handleForm=this.#handleMode&&this.#handleForm(t,view);
      // With the switcher island live, its current-account card is the header (V5); an app header slot still shows.
      const headerHidden=switcherLive&&!this.host.querySelector(':scope > [slot=menu-header]');
      panelBody=[
        h('div',h('slot',this.#avatar(view,undefined,{composed:true}),h('span',h('bdi',name??t('Account at {host}',{host})).classes('name').attrs({dir:'auto'}),h('span',this.#entity?.name?t('Acting for {entity}',{entity:this.#entity.name}):!name?t('No name shared with this app'):view.profile?.handle&&view.profile.handle!==name?(view.profile.handle.endsWith(`@${host}`)?view.profile.handle:t('{handle} · via {host}',{handle:view.profile.handle,host})):t('via {host}',{host})).classes('meta')).classes('who')).attrs({name:'menu-header'})).classes('header').attrs({part:'menu-header'}).props({hidden:headerHidden||!!handleForm}).key('header'),
        switcherBox,
        handleForm||null,
        !handleForm&&rows,
        !handleForm&&h('div',...account).classes('group').attrs({role:'list',part:'menu','aria-label':t('Account actions')}).key('account'),
        !handleForm&&(hasStart||hasEnd)&&h('div',
          h('div',h('slot').attrs({name:'menu-start'})).attrs({role:'listitem'}),
          h('div',h('slot').attrs({name:'menu-end'})).attrs({role:'listitem'}),
        ).classes('group').attrs({role:'list',part:'menu-app'}).key('app'),
        !handleForm&&sessionGroup.length>0&&h('div',...sessionGroup).classes('group').attrs({role:'list',part:'menu-session','aria-label':t('Sign out')}).key('session'),
        !handleForm&&note,
        this.#open&&(notice||endNotice),
        h('slot').attrs({name:'panel-footer'}),
      ];
      const busy=this.#switching||this.#reauthing&&working;
      const {props,attrs:panelAttributes}=panelAttrs(this.#open);
      anchorChildren=[h('div',
        h('button',
          h('span',h('slot',this.#avatar(view,undefined,{composed:true})).attrs({name:'badge'})).classes('avatar-box'),
          h('bdi',label).classes('label',avatarOnly&&'visually-hidden').attrs({part:'label',dir:'auto'}),
          busy?icon('spinner',{className:'chevron'}):icon('chevron-down',{className:'chevron'}),
        ).props({type:'button'}).classes('trigger',avatarOnly&&'avatar-only',autoLabel&&'auto').attrs({part:'trigger badge','aria-haspopup':'dialog','aria-expanded':String(this.#open),'aria-controls':'panel','aria-label':this.#entity?.name?t('{entity} — signed in as {name}',{entity:this.#entity.name,name:label}):t('Account: {name}',{name:label}),'aria-busy':busy?'true':'false'}).on({click:this.#onTriggerClick,keydown:this.#onTriggerKey,pointerenter:this.#wantSwitcher,focus:this.#wantSwitcher}),
        avatarBox,
        h('dialog',...panelBody).props(props).classes('panel',!popover&&'inline').attrs(panelAttributes).on({toggle:this.#onToggle,keydown:this.#onPanelKey,focusout:this.#onFocusOut}).key('panel'),
      ).classes('wrap').attrs({part:'wrap'}).key('wrap')];
    }
    // Notices outside an open panel go into a bubble anchored to the control (G9): never inline in the header.
    const bubbleContent=!this.#open&&(notice||endNotice);
    const bubble=h('div',bubbleContent||null,bubbleContent&&!notice&&h('button',icon('close')).props({type:'button'}).classes('close').attrs({'aria-label':t('Dismiss')}).on({click:()=>{this.#ended=null;this.render();this.#trigger()?.focus();}})).classes('bubble',!popover&&'inline').attrs(attrs({popover:popover?'manual':undefined,part:'bubble',role:endNotice&&!notice?'status':undefined})).props({hidden:!bubbleContent}).key('bubble');
    reconcileShadow(this.host,[h('div',
      h('div',...anchorChildren,!popover&&bubble).classes('anchor').key('anchor'),
      // The status line stays a live region; the notice carries the visible text (V17).
      h('p',(mine&&flowStatus(flow,t))||'').attrs({role:'status',part:'status'}).classes('status','visually-hidden'),
      popover&&bubble,
    ).classes('root',theme).attrs({dir:direction}).style(colorScheme?{'color-scheme':colorScheme}:{})],[baseStyles(win),triggerStyles(win),avatarStyles(win),styles(win)]);
    if(this.#tipOff&&!view){const trigger=this.#trigger();trigger?.addEventListener('blur',this.#tipOn,{once:true});trigger?.addEventListener('pointerleave',this.#tipOn,{once:true});}
    const bubbleNode=this.#bubble();
    if(this.#popover(bubbleNode)){try{if(bubbleContent&&!bubbleNode.matches(':popover-open')){bubbleNode.showPopover();}else if(!bubbleContent&&bubbleNode.matches(':popover-open'))bubbleNode.hidePopover();}catch{}if(bubbleContent)this.#place();}
    // A control that held focus and was replaced (the signed-out button becoming the trigger, a closed signed-out
    // panel) hands focus to the element's primary control instead of dropping it on the body.
    if((hadFocus&&!this.host.shadowRoot.activeElement&&!this.#open)||this.#refocus){this.#refocus=false;this.#trigger()?.focus({preventScroll:true});}
    this.#syncIsland('avatar','avatar','.avatar-island > .island-host',(!!view||!!this.#islandKeys.avatar)&&!this.host.querySelector(':scope > [slot=badge]'));
    this.#syncIsland('switcher','account-switcher','.switcher > .island-host',(!!view||!!this.#islandKeys.switcher)&&this.#switcherWanted);
    for(const island of Object.values(this.#islands))island?.refresh?.();
  }
  #handleForm(t,view){
    const another=this.#handleMode==='another',host=new URL(view.issuer).host,suffix=another?`@${host}`:'',error=this.#handleError,value=this.#handleValue;
    return h('form',
      h('div',h('button',icon('chevron-down',{size:20})).props({type:'button'}).classes('back').attrs({'aria-label':t('Back')}).on({click:this.#back}),h('span',another?t('Use another account'):t('Use a different provider')).classes('title')).classes('top'),
      h('label',t('Your handle')).attrs({for:'switch-handle'}),
      h('div',
        h('span',h('span',value||(another?t('name'):t('name@provider'))).classes('mirror').attrs({'aria-hidden':'true'}),
          h('input').props({id:'switch-handle',value}).attrs(attrs({size:'1',name:'identity',autocomplete:'username',autocapitalize:'none',spellcheck:'false',inputmode:'email',placeholder:another?t('name'):t('name@provider'),part:'input','aria-invalid':error?'true':undefined,'aria-describedby':error?'switch-error':'switch-hint'})).on({input:this.#onHandleInput})).classes('entry'),
        suffix&&!value.includes('@')&&h('span',suffix).classes('suffix').attrs({'aria-hidden':'true'}),
      ).classes('field',error&&'invalid').on({pointerdown:event=>{if(!event.target.closest?.('input')){event.preventDefault();this.host.shadowRoot.querySelector('.handle input')?.focus();}}}),
      error?h('p',icon('alert'),h('span',error)).props({id:'switch-error'}).attrs({role:'alert'}).classes('field-error'):h('p',another?t('{suffix} will be added unless you type @',{suffix}):t('Enter a full handle, like ada@provider.example.')).props({id:'switch-hint'}).classes('hint'),
      h('button',t('Continue')).attrs({type:'submit',part:'submit'}).classes('primary','submit'),
    ).classes('handle').attrs({part:'handle-form',novalidate:''}).on({submit:this.#onHandleSubmit,keydown:event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.#back();}}}).key('handle');
  }
}
