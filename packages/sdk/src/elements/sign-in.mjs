// <bindle-sign-in>: sign-in for any Bindle provider (decision note §6.1). It
// composes from the default provider's capability set: a provider island when
// declared and mounted; otherwise a "Continue with {host}" button when the
// provider allows identity-optional sign-in, plus the handle form (then optional);
// otherwise the handle form with a complete handle required. One event API in
// every composition. Everything typed here is readable by the embedder; nothing
// here learns anything about provider sessions. Security copy is not slottable.
//
// Composition (owner direction 2026-10-29, provisional): with app sessions held, the account list is the main UI
// (`signed-in="accounts"`, default; G2b): each held account continues as itself (bindle-account-select), with a
// per-row sign-out, and "Add account" reveals the handle form. Without held sessions the handle form shows directly:
// an email-like field with the default host affixed after the typed text until "@" is typed (V14), "Continue with
// {host}" when the provider allows identity-optional sign-in, and "Create a {host} account". `signed-in="hide"`
// renders nothing; `signed-in="form"` keeps the form. The list holds only this app's own sessions; with islands the
// embedder-visible layout is the same whether or not the provider holds accounts (no account-presence signal, C3).
import {parseIdentity} from '../handle.mjs';
import {ElementBase,attrs,baseStyles,emit,emitLater,failureText,flowNotice,flowStatus,h,icon,localize,mountIsland,islandPart,reconcileShadow,requestSession,schemeFor,startFlow,watchScheme} from './shared.mjs';
import {css} from '../../../../vendor/dodo/style.js';

const styles=view=>css.in(view)`
form{display:grid;gap:0}
/* Restoring persisted sessions (W11): about the height of one account row, so the list that usually follows does not jump far. */
.restoring{display:flex;align-items:center;justify-content:center;gap:10px;min-block-size:64px;color:var(--_muted)}
label{display:block;font-weight:600;margin-block-end:.45em}
.identity{display:flex;align-items:center;flex-wrap:nowrap;min-block-size:44px;box-sizing:border-box;border:1px solid var(--_border);border-radius:var(--_radius);padding:.3em .8em;background:var(--_surface);color:var(--_text);cursor:text;overflow:hidden;transition:border-color 80ms linear}
.identity:hover{border-color:color-mix(in srgb,var(--_border) 55%,var(--_text))}
.identity:focus-within{border-color:var(--_focus);outline:2px solid var(--_focus);outline-offset:2px}
/* One ring per field (V12): the wrapper draws it, the input never does. */
.identity input:focus-visible{outline:none}
.identity.invalid,.identity.invalid:focus-within{border-color:var(--_danger)}
.identity.invalid:focus-within{outline-color:var(--_danger)}
/* The suffix follows the typed text (V14): an invisible mirror of the value sizes the input, so "@host" sits right
   after the caret and reads as part of the handle, not as a placeholder at the far end. */
.entry{display:inline-grid;flex:0 1 auto;min-inline-size:0;max-inline-size:100%}
.entry > *{grid-area:1 / 1;font:inherit;letter-spacing:inherit}
.mirror{visibility:hidden;white-space:pre;overflow:hidden;min-inline-size:1ch;padding-inline-end:1px}
input{inline-size:auto;justify-self:stretch;min-inline-size:0;border:0;outline:none;font:inherit;background:transparent;color:inherit;min-block-size:32px;padding:0;text-overflow:ellipsis}
input::placeholder{color:var(--_muted);opacity:1}
.suffix{flex:none;color:var(--_muted);white-space:nowrap}
.identity > .icon-alert{margin-inline-start:auto;padding-inline-start:.5em;color:var(--_danger)}
.help{font-size:.9em;color:var(--bindle-text-muted,color-mix(in srgb,currentColor 78%,transparent));margin:.45em 0 0}
.help[hidden],.field-error[hidden]{display:none}
/* Field errors sit under the field in place of the help line (V15); role=alert stays on the message. */
.field-error{display:flex;gap:.4em;align-items:flex-start;font-size:.9em;color:var(--_danger);margin:.45em 0 0;overflow-wrap:anywhere}
.field-error .icon{margin-block-start:.1em}
.submit{margin-block-start:1em;inline-size:100%}
/* Discovery placeholder (V16) and island mounting placeholder (V25): constant, embedder-side boxes of the final size,
   so the first paint already has the final layout. */
.placeholder{box-sizing:border-box;display:block;inline-size:100%;block-size:44px;border-radius:var(--_radius);background:linear-gradient(90deg,var(--_raised) 0 40%,color-mix(in srgb,var(--_raised) 55%,var(--_surface)) 50%,var(--_raised) 60% 100%) 0 0 / 300% 100%;animation:bindle-shimmer 1.4s linear infinite}
@keyframes bindle-shimmer{from{background-position:100% 0}to{background-position:0 0}}
@media (pointer:coarse){.placeholder{block-size:48px}}
.accounts{display:grid;gap:8px}
.accounts .caption{margin:0 0 4px;font-size:.9em;font-weight:600;color:var(--_muted)}
.account-row{display:flex;align-items:stretch;gap:4px;border:1px solid var(--_line);border-radius:calc(var(--_radius) + 2px);background:var(--_surface);--bindle-avatar-size:40px;transition:border-color 80ms linear}
.account-row:hover{border-color:var(--_border)}
.account-row .pick{flex:1;min-inline-size:0;justify-content:flex-start;gap:12px;border:0;background:transparent;padding:10px 12px;text-align:start;font-weight:inherit}
.account-row .pick:hover{background:transparent}
.account-row .pick:focus-visible,.account-row .out:focus-visible{outline-offset:-2px}
.account-row .who{display:grid;min-inline-size:0}
.account-row .name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.account-row .via{font-size:.9em;color:var(--_muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.account-row .current{margin-inline-start:auto;color:var(--_accent)}
.account-row .out{flex:none;border:0;background:transparent;color:var(--_muted);padding:0;min-inline-size:44px}
.account-row .out:hover{color:var(--_text);background:color-mix(in srgb,var(--_text) 6%,transparent)}
.add{justify-content:flex-start;gap:12px;border-style:dashed;background:transparent;font-weight:500}
.back{display:inline-flex;gap:4px;margin:0 0 12px -8px;padding:4px 8px;min-block-size:36px;border:0;background:transparent;color:var(--_text);font-weight:500}
.back .icon{rotate:90deg}
.root[dir=rtl] .back .icon{rotate:-90deg}
/* Tertiary (ghost) action on the embedder's own background: inherited text colour, the glyph carries the accent. */
.create{display:flex;inline-size:100%;margin-block-start:8px;border-color:transparent;background:transparent;color:var(--bindle-text,inherit)}
.create .icon{color:var(--_accent)}
.create span{flex:0 1 auto;min-inline-size:0;overflow-wrap:anywhere;text-align:start}
.create:hover{background:color-mix(in srgb,currentColor 7%,transparent)}
@media (forced-colors:active){.account-row{border-color:CanvasText}.create{color:LinkText}}
/* Controls that sit where an island may mount use the islands' system font and button spec (§4.2, V24). The
   provider-labelled control ("Continue with {host}") and everything composed around a live or mounting island use
   the provider defaults (= island defaults), not embedder tokens: islands take no tokens (rev 3.3, C5), so this is
   the only way the island and standard compositions look the same; embedder presets that reach both sides are W9.
   The rest of the standard composition (form, submit, summary) follows the embedder's --bindle-* tokens. */
.continue,.other,.placeholder,.island,.root.island-mode{${providerSpec.light}}
.root.dark :is(.continue,.other,.placeholder,.island),.root.dark.island-mode{${providerSpec.dark}}
@media (prefers-color-scheme:dark){.root.auto :is(.continue,.other,.placeholder,.island),.root.auto.island-mode{${providerSpec.dark}}}
.continue,.other{display:flex;inline-size:100%;font-family:var(--_system)}
.other{margin-block-start:8px}
.divider{display:flex;align-items:center;gap:.75em;margin:1em 0;color:var(--bindle-text-muted,color-mix(in srgb,currentColor 78%,transparent));font-size:.85em}
.divider::before,.divider::after{content:"";flex:1;border-block-start:1px solid var(--_line)}
/* G10: the island's inline size comes from the static per-locale table (never measured, C1). The iframe's host is
   size-contained, so its 300 px intrinsic width never sizes a shrink-to-fit container; a zero-height spacer carries
   the table width (capped by the viewport and the container) instead, and block containers still stretch the island. */
/* A minmax(0,1fr) grid track: the spacer sets the max-content size, but contributes nothing to the min-content size,
   so a crowded header can still shrink the island instead of overflowing the page. */
.island{display:grid;grid-template-columns:minmax(0,1fr);min-block-size:44px;border-radius:var(--_radius)}
.island::before{content:"";display:block;block-size:0;inline-size:min(var(--_island-min,200px),calc(100vw - 32px));max-inline-size:100%}
.island-host{display:block;contain:inline-size}
.island.mounting{background:var(--_raised)}
.island[hidden]{display:none}
@media (forced-colors:active){.identity{border-color:FieldText;background:Field;color:FieldText}.identity:focus-within{outline-color:Highlight}.divider::before,.divider::after{border-color:CanvasText}.placeholder{background:none;border:1px dashed GrayText;animation:none}.field-error{color:Mark}}
`;
// Provider default palette and radius (islands-protocol THEME_DEFAULTS, apps/embed/styles/shell.css; ui-elements-audit
// §4.3), ignoring embedder tokens.
const providerSpec={
  light:'--_surface:#ffffff;--_raised:#f6f7f9;--_text:#16181d;--_muted:#5b6270;--_accent:#2b59d1;--_on-accent:#ffffff;--_border:#868d98;--_line:#e3e6eb;--_focus:#2b59d1;--_danger:#b42318;--_radius:8px;',
  dark:'--_surface:#1b1d22;--_raised:#24272e;--_text:#eceef2;--_muted:#a9b0bb;--_accent:#7aa2ff;--_on-accent:#0b1020;--_border:#7d8590;--_line:#343840;--_focus:#9dbaff;--_danger:#ff8a7a;--_radius:8px;',
};
const endOutcomes={completed:'completed',canceled:'canceled',dismissed:'canceled','popup-blocked':'popup-blocked','discovery-error':'discovery-error','network-error':'network-error'};
// Sign-in island inline size (G10, embed-islands §3.2): a static per-locale table, never measured from the island
// (C1). Characters of each label template outside {host}; the island draws 15 px system-ui at weight 500 (about
// 8.4 px per character), 16 px padding and 1 px border per side, a 16 px glyph and an 8 px gap. At least 200 px.
const islandLabelChars={en:{continue:14,'sign-in':13,'sign-up':13},es:{continue:13,'sign-in':21,'sign-up':16}};
export function signInIslandWidth({locale='en',label='continue',host=''}={}){
  const table=islandLabelChars[String(locale).toLowerCase().split('-')[0]]??islandLabelChars.en,chars=(table[label]??table.continue)+String(host).length;
  return Math.max(200,Math.ceil(58+chars*8.4));
}

export class BindleSignInElement extends ElementBase {
  static observedAttributes=['lang','theme','default-host','identity-required','island-label','island-variant','signed-in'];
  #session=null;#value='';#status='';#error='';#listeners=[];#connected=false;#unwatch=null;#island=null;#islandState='off';#islandKey='';#form=false;#islandPath=false;#last=null;#started=false;#discovering=null;#discoveryFailed=new Set();#mountFailed=false;#via='form';#views=null;#pictureFailed=null;#adding=false;
  connectedCallback(){
    this.#connected=true;this.#unwatch=watchScheme(this,()=>this.render());
    this.render();
    requestSession(this,session=>{if(!this.#connected)return;this.#attach(session);});
  }
  disconnectedCallback(){this.#connected=false;this.#unwatch?.();this.#detach();this.#unmount();}
  attributeChangedCallback(){if(this.#connected)this.render();}
  get session(){return this.#session;}
  get defaultHost(){return this.getAttribute('default-host')||this.#session?.defaultHost||'3sln.me';}
  set defaultHost(value){if(value)this.setAttribute('default-host',value);else this.removeAttribute('default-host');}
  // Read-only snapshot, updated before the corresponding event (late listeners read it).
  get state(){return Object.freeze({status:this.#mine()&&this.#session?.flow&&!this.#session.flow.done?'pending':'idle',islands:this.#islandState,last:this.#last});}
  // Re-evaluates the effective scheme after an embedder theme change the element cannot observe.
  refreshTheme(){if(this.isConnected)this.render();}
  focus(options){this.shadowRoot?.querySelector('input')?.focus(options);}
  #mine(){return !!this.#session&&this.#session.flowInitiator===this;}
  #attach(session){
    this.#detach();this.#session=session;
    const rerender=()=>this.render();
    const started=event=>{if(this.#mine()&&!this.#started){this.#started=true;emitLater(this,'bindle-sign-in-start',{source:this.#via==='sign-up'?'sign-up':'form',presentation:event.detail?.presentation??null});}};
    const ended=event=>{
      if(!this.#mine())return;
      const result=event.detail;
      if(['discovery-error','network-error'].includes(result.outcome)){this.#error=failureText({...result,host:this.#hostFor(result)},this.#t());this.#status='';if(result.code==='no-provider'&&result.fallback)emit(this,'bindle-email-fallback',result.fallback);}
      else if(result.outcome==='canceled'){this.#status=this.#t()('Sign-in was canceled.');}
      else if(result.outcome==='completed'||result.outcome==='dismissed'){this.#status='';if(result.outcome==='completed'){this.#adding=false;this.#form=false;}}
      // One end per start; a redirect continues on the callback page instead.
      const outcome=endOutcomes[result.outcome];
      if(outcome&&this.#started){this.#started=false;this.#last=Object.freeze({outcome,...result.code?{code:result.code}:{}});const view=session.session;emitLater(this,'bindle-sign-in-end',{outcome,...result.code?{code:result.code}:{},...outcome==='completed'&&view?{session:view}:{}});}
      this.render();
    };
    for(const [type,listener] of [['bindle-flow-state',rerender],['bindle-flow-start',started],['bindle-flow-end',ended],['bindle-session-change',rerender],['bindle-capabilities-change',rerender],['bindle-session-restored',rerender]]){session.addEventListener(type,listener);this.#listeners.push([type,listener]);}
    this.render();
  }
  #detach(){for(const [type,listener] of this.#listeners)this.#session?.removeEventListener(type,listener);this.#listeners=[];}
  #t(){return localize(this).t;}
  #hostFor(result){try{return result.code==='unregistered-client'?parseIdentity(this.#value.trim()||'x',this.defaultHost).host:undefined;}catch{return undefined;}}
  #onInput=event=>{this.#value=event.target.value;this.#error='';this.render();};
  #onSubmit=event=>{
    event.preventDefault();
    const t=this.#t(),input=this.shadowRoot.querySelector('input'),value=input.value;this.#value=value;this.#via='form';
    if(this.#session)return this.#submit(value.trim(),t,input);
    // Without a <bindle-session> the element only reports the parsed handle.
    try{const identity=parseIdentity(value,this.defaultHost);this.#status='';this.#error='';emit(this,'bindle-sign-in-request',identity);}
    catch(error){this.#status=t(error.message);this.render();input.focus();}
  };
  // Capabilities of the provider this element names (its own default host), never another issuer's.
  #capabilities(){
    const session=this.#session,host=this.defaultHost;if(!session?.controller||['','none'].includes(host))return null;
    let issuer;try{issuer=new URL(parseIdentity('x',host,{allowInsecureLocalhost:session.client?.allowInsecureLocalhost===true}).manifestUrl).origin;}catch{return null;}
    const capabilities=session.controller.capabilitiesFor(issuer);
    if(!capabilities&&this.#discovering!==issuer){this.#discovering=issuer;session.client.discoverHost(host).then(()=>this.render(),()=>{this.#discoveryFailed.add(issuer);this.render();});}
    return capabilities;
  }
  #required(){
    const capabilities=this.#capabilities();
    return this.hasAttribute('identity-required')||['','none'].includes(this.defaultHost)||!!capabilities&&!capabilities.identityless||!this.#session;
  }
  // Discovery of this element's provider is still running (no capabilities, no failure yet): the layout reserves the
  // provider-button row instead of inserting it later (V16).
  #discoveryPending(){
    const session=this.#session,host=this.defaultHost;if(!session?.controller||['','none'].includes(host)||this.hasAttribute('identity-required'))return false;
    let issuer;try{issuer=new URL(parseIdentity('x',host,{allowInsecureLocalhost:session.client?.allowInsecureLocalhost===true}).manifestUrl).origin;}catch{return false;}
    return !session.controller.capabilitiesFor(issuer)&&!this.#discoveryFailed.has(issuer);
  }
  #submit(trimmed,t,input){
    this.#error='';this.#status='';
    if(!trimmed&&this.#required()){this.#error=t('Enter your handle.');this.render();input?.focus();return;}
    let host=this.defaultHost,identity;
    // Parse synchronously before any window opens (EE-15); the flow receives the
    // complete handle (or this element's host), so it goes where the UI says.
    if(trimmed){try{({host,handle:identity}=parseIdentity(trimmed,this.defaultHost,{allowInsecureLocalhost:this.#session.client?.allowInsecureLocalhost===true}));}catch(error){this.#error=t(error.message);this.render();input?.focus();return;}}
    this.#status=t("You'll continue at {host}.",{host});this.#started=false;this.render();
    const options=identity?{identity}:{host};
    const started=this.#session[startFlow]?this.#session[startFlow]('login',options,this):this.#session.signIn(options);
    started.catch(error=>{this.#error=error?.name==='NotAllowedError'?t('Sign-in could not be completed. Try again.'):failureText(error,t);this.#status='';this.render();});
  }
  #onContinue=()=>{this.#via='continue';this.#submit('',this.#t(),null);};
  // Island hook (decision note §6.1): mounts only when the capability set lists the part.
  #syncIsland(){
    const capabilities=this.#capabilities(),spec=islandPart(this.#session,'sign-in',capabilities),key=spec?`${spec.issuer} ${spec.version}`:'';
    if(key===this.#islandKey)return;this.#islandKey=key;this.#mountFailed=false;this.#unmount();
    if(!spec)return;
    queueMicrotask(async()=>{
      const container=this.shadowRoot?.querySelector('.island > .island-host');if(!container||this.#islandKey!==key)return;
      const island=await mountIsland(this,{part:'sign-in',container,session:this.#session,capabilities,onState:state=>{if(this.#islandKey===key){this.#islandState=state;this.render();}}});
      if(this.#islandKey!==key||!this.#connected){island?.destroy();return;}
      this.#island=island;if(!island){this.#mountFailed=true;if(this.#islandState!=='fallback')this.#islandState='off';this.render();}
    });
  }
  // A degraded part stays 'fallback' for the document (profile §11); the standard composition shows.
  #unmount(){try{this.#island?.destroy?.();}catch{}this.#island=null;if(this.#islandState!=='fallback')this.#islandState='off';}
  // Called by the island mounter for the island's translated `flow` (profile §5.4). `completed` arrives only
  // after the app's own exchange of the island's code settled, so the session is ready (EIR-17).
  islandFlow(phase,outcome,code){
    if(phase==='started'){this.#started=true;this.#islandPath=false;this.#error='';emitLater(this,'bindle-sign-in-start',{source:'island',presentation:'island'});this.render();return;}
    if(phase!=='ended'||!this.#started)return;
    this.#started=false;
    const mapped=outcome==='unavailable'?'unavailable':endOutcomes[outcome]??'canceled',view=this.#session?.session;
    // The island cannot finish here (opener lost, popup blocked, sandboxed): offer the app's own path (EI-11).
    if(['unavailable','popup-blocked'].includes(mapped))this.#islandPath=true;
    if(mapped==='network-error')this.#error=this.#t()('Sign-in could not be completed. Try again.');
    this.#last=Object.freeze({outcome:mapped,...code?{code}:{}});
    emitLater(this,'bindle-sign-in-end',{outcome:mapped,...code?{code}:{},...mapped==='completed'&&view?{session:view}:{}});
    this.render();
  }
  // Account list actions (G2b): a held account continues as itself (made current; never a flow), per-row sign-out.
  #pick(subject){
    const result=this.#session?.controller?.selectAccount?.(subject)??{outcome:'canceled',code:'no-session'};
    if(result.outcome==='completed')emitLater(this,'bindle-account-select',{subject});
  }
  #signOutOne(subject,issuer){
    const rows=[...this.shadowRoot.querySelectorAll('.account-row')],index=rows.findIndex(row=>row.dataset.subject===subject);
    this.#session?.signOut({subject,issuer})?.catch?.(()=>{});
    queueMicrotask(()=>{const next=[...this.shadowRoot.querySelectorAll('.account-row .pick,.add')];next[Math.min(index,next.length-1)]?.focus({preventScroll:true});});
  }
  #onCreate=()=>{this.#via='sign-up';this.#submit('',this.#t(),null);};
  #accounts(view,t){
    // The avatar view loads with the first session (fresh pages are always signed out).
    if(!this.#views){import('./avatar-view.mjs').then(module=>{this.#views=module;if(this.#connected)this.render();});}
    const {avatarModel,avatarView}=this.#views??{},held=this.#session.sessions?.length?this.#session.sessions:[view];
    const row=item=>{
      const host=new URL(item.issuer).host,name=item.profile?.displayName??item.profile?.handle,handle=item.profile?.handle,current=item.subject===view.subject&&item.issuer===view.issuer;
      const title=name??t('Account at {host}',{host}),meta=!name?t('Signed in'):handle&&handle!==name?(handle.endsWith(`@${host}`)?handle:t('{handle} · via {host}',{handle,host})):t('via {host}',{host});
      const model=avatarModel?.(item,{pictureFailed:this.#pictureFailed===item.profile?.picture});
      return h('div',
        h('button',model?avatarView(model,{onPictureError:()=>{this.#pictureFailed=item.profile?.picture;this.render();}}):h('span').classes('avatar'),h('span',h('bdi',title).classes('name').attrs({dir:'auto'}),h('bdi',meta).classes('via').attrs({dir:'auto'})).classes('who'),current?icon('check',{size:20,className:'current'}):null)
          .props({type:'button'}).classes('pick').attrs(attrs({part:'account','aria-label':t('Continue as {name}',{name:title}),'aria-current':current?'true':undefined})).on({click:()=>this.#pick(item.subject)}),
        h('button',icon('sign-out')).props({type:'button'}).classes('out').attrs({part:'account-sign-out','aria-label':t('Sign out of {name}',{name:title}),title:t('Sign out of {name}',{name:title})}).on({click:()=>this.#signOutOne(item.subject,item.issuer)}),
      ).classes('account-row').attrs({'data-subject':item.subject,role:'listitem'}).key(item.subject);
    };
    return h('div',
      h('p',held.length>1?t('Choose an account'):t('Signed in')).classes('caption').attrs({id:'accounts-caption'}),
      h('div',...held.map(row)).classes('accounts').attrs({role:'list','aria-labelledby':'accounts-caption'}),
      h('slot').attrs({name:'signed-in'}),
      h('button',icon('plus',{size:20}),h('span',t('Add account'))).props({type:'button'}).classes('add').attrs({part:'add-account'}).on({click:()=>{this.#adding=true;this.render();this.focus();}}),
    ).classes('accounts').attrs({part:'accounts'}).key('accounts');
  }
  render(){
    if(!this.#connected)return;
    const t=this.#t(),session=this.#session,flow=session?.flow,mine=this.#mine(),host=this.defaultHost,noDefault=['','none'].includes(host),suffix=noDefault?'':`@${host}`;
    // Persisted app sessions are being restored (W11): a loading state, never the form or an island first.
    if(session?.state==='restoring'){
      const {theme,colorScheme}=schemeFor(this,session);
      reconcileShadow(this,[h('div',h('div',icon('spinner',{size:20}),h('span',t('Restoring your session…'))).classes('restoring').attrs({role:'status',part:'restoring','aria-busy':'true'}).key('restoring')).classes('root',theme).attrs({dir:localize(this).direction}).style(colorScheme?{'color-scheme':colorScheme}:{})],[baseStyles(this.ownerDocument.defaultView),styles(this.ownerDocument.defaultView)]);
      return;
    }
    const capabilities=this.#capabilities(),required=this.#required();
    // Island phases: a declared part mounts ('mounting' shows a same-size placeholder, V25), then 'live'; the
    // standard composition shows only when it is off or degraded to 'fallback'.
    const mounting=!!this.#islandKey&&!this.#mountFailed&&['off','mounting'].includes(this.#islandState);
    const island=this.#islandState==='live',islandBox=island||mounting,appPath=!islandBox||this.#islandPath;
    const pending=!islandBox&&this.#discoveryPending(),identityless=!this.hasAttribute('identity-required')&&!!capabilities?.identityless&&!noDefault;
    const status=(mine&&flow?.phase==='opening'&&this.#status)||(mine&&flowStatus(flow,t))||this.#status;
    const busy=mine&&flow?.phase==='opening';
    // The clicked control shows the flow is under way (spinner, label kept); only `opening` makes it inert.
    const working=mine&&!!flow&&!flow.done&&(flow.phase==='opening'||flow.phase==='waiting');
    const notice=mine&&flowNotice(flow,t,session);
    // With a live island the handle form moves behind "Use a different provider".
    const showForm=!islandBox||this.#form;
    this.#syncIsland();this.#island?.refresh?.();
    const {theme,colorScheme}=schemeFor(this,session),locale=localize(this).locale;
    // Held app sessions: the account list is the main UI unless "Add account" was chosen (G2b, owner direction).
    const view=session?.session,mode=this.getAttribute('signed-in');if(!view)this.#adding=false;
    const chooser=!!view&&!['form','hide'].includes(mode)&&!this.#adding,signedIn=!!view&&mode==='hide'||chooser;
    const label=['sign-in','sign-up'].includes(this.getAttribute('island-label'))?this.getAttribute('island-label'):'continue';
    const islandStyle={'--_island-min':`${signInIslandWidth({locale,label,host})}px`};
    const errorShown=!!this.#error&&showForm;
    reconcileShadow(this,[h('div',
      !signedIn&&h('slot').attrs({name:'heading'}),
      // The iframe lives in a constant inner host (dodo replaces children of a changed node); the box toggles hidden.
      h('div',h('div').classes('island-host')).classes('island',mounting&&!island&&'mounting').attrs({part:'island'}).style(islandStyle).props({hidden:!islandBox||signedIn}).key('island'),
      chooser&&this.#accounts(view,t),
      !!view&&this.#adding&&h('button',icon('chevron-down',{size:20}),h('span',t('Back'))).props({type:'button'}).classes('back').attrs({part:'back'}).on({click:()=>{this.#adding=false;this.#form=false;this.render();this.shadowRoot.querySelector('.add')?.focus();}}),
      !signedIn&&islandBox&&!this.#form&&h('button',t('Use a different provider')).props({type:'button'}).classes('other').attrs({part:'other-provider'}).on({click:()=>{this.#form=true;this.render();this.focus();}}),
      !signedIn&&islandBox&&!this.#form&&identityless&&h('button',working&&this.#via==='sign-up'?icon('spinner'):icon('plus'),h('span',t('Create a {host} account',{host}))).props({type:'button',disabled:busy}).classes('create','ghost').attrs(attrs({part:'create-account','aria-busy':working&&this.#via==='sign-up'?'true':undefined})).on({click:this.#onCreate}),
      !signedIn&&appPath&&pending&&h('span').classes('placeholder','continue').attrs({'aria-hidden':'true',part:'placeholder'}),
      !signedIn&&appPath&&identityless&&h('button',working&&this.#via==='continue'?icon('spinner'):icon('sign-in'),h('span',t('Continue with {host}',{host}))).props({type:'button',disabled:busy}).classes('primary','continue').attrs(attrs({part:'continue','aria-busy':working&&this.#via==='continue'?'true':undefined})).on({click:this.#onContinue}),
      !signedIn&&appPath&&(identityless||pending)&&showForm&&h('div',t('or')).classes('divider').attrs({'aria-hidden':'true'}),
      !signedIn&&showForm&&h('form',
        h('label',t('Your handle')).attrs({for:'handle',id:'label',part:'label'}),
        h('div',
          h('span',
            h('span',this.#value||t('name')).classes('mirror').attrs({'aria-hidden':'true'}),
            // inputmode=email shows the @ key; autocomplete=username lets password managers offer saved handles without
            // treating the field as an e-mail address; no autocorrect or capitalisation (handles are case-insensitive ASCII).
            h('input').props({id:'handle',disabled:busy}).attrs(attrs({size:'1',name:'identity',autocomplete:'username',autocapitalize:'none',autocorrect:'off',spellcheck:'false',inputmode:'email',enterkeyhint:'go',placeholder:suffix?t('name'):t('name@provider'),required,'aria-describedby':errorShown?(suffix?'suffix-hint field-error':'field-error'):(suffix?'suffix-hint help':'help'),'aria-invalid':this.#error?'true':undefined,'aria-errormessage':this.#error?'field-error':undefined,part:'input'})).on({input:this.#onInput,change:this.#onInput}),
          ).classes('entry'),
          // Rendered only until "@" is typed (or pasted, or autofilled): never a hidden-but-present suffix.
          suffix&&!this.#value.includes('@')&&h('span',suffix).props({id:'suffix'}).attrs({'aria-hidden':'true',part:'suffix'}).classes('suffix'),
          errorShown&&icon('alert'),
        ).classes('identity',this.#error&&'invalid').attrs({part:'field',dir:'ltr'}).on({pointerdown:event=>{if(!event.target.closest?.('input')){event.preventDefault();this.focus();const input=this.shadowRoot.querySelector('input');try{input.setSelectionRange(input.value.length,input.value.length);}catch{}}}}),
        suffix&&h('span',t('{suffix} will be added unless you type @',{suffix})).props({id:'suffix-hint'}).classes('visually-hidden'),
        h('p',h('slot',t('Use your Bindle handle, or a full handle from your own provider.')).attrs({name:'help'})).props({id:'help',hidden:errorShown}).classes('help'),
        h('p',...errorShown?[icon('alert'),h('span',this.#error)]:[]).props({id:'field-error',hidden:!errorShown}).attrs({role:'alert',part:'error'}).classes('field-error'),
        h('button',working&&this.#via==='form'?icon('spinner'):null,h('span',t('Continue'))).props({disabled:busy}).attrs(attrs({type:'submit',part:'submit','aria-busy':working&&this.#via==='form'?'true':undefined})).classes(identityless||pending?'':'primary','submit'),
        // Sign-up (owner direction): starts the same identity-optional flow at the default host, whose sign-in page offers
        // account creation; no Bindle entry member asks a provider to open on sign-up yet (reported, not invented).
        appPath&&identityless&&h('button',working&&this.#via==='sign-up'?icon('spinner'):icon('plus'),h('span',t('Create a {host} account',{host}))).props({type:'button',disabled:busy}).classes('create','ghost').attrs(attrs({part:'create-account','aria-busy':working&&this.#via==='sign-up'?'true':undefined})).on({click:this.#onCreate}),
        h('slot').attrs({name:'footer'}),
      ).attrs({part:'form',novalidate:''}).on({submit:this.#onSubmit}),
      // With a notice on screen the status line stays a live region but is not shown twice (V17).
      h('p',status).props({id:'status'}).attrs({role:'status',part:'status'}).classes('status',notice&&'visually-hidden'),
      // Errors without a visible field (island path, summary) keep the shared alert line.
      h('p',...this.#error&&!errorShown?[icon('alert'),h('span',this.#error)]:[]).props({id:'error'}).attrs({role:'alert',part:'error'}).classes('error'),
      notice,
    ).classes('root',theme,islandBox&&!signedIn&&'island-mode').attrs({dir:localize(this).direction}).style(colorScheme?{'color-scheme':colorScheme}:{})],[baseStyles(this.ownerDocument.defaultView),...this.#views?[this.#views.avatarStyles(this.ownerDocument.defaultView)]:[],styles(this.ownerDocument.defaultView)]);
  }
}
