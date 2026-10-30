// <bindle-avatar>: the current app session's identity picture (decision note
// §6.3). Always the standard avatar chain (granted picture → initials → subject
// monogram); with a declared avatar island, the transparent island is layered
// over it and covers it only with a bound picture. No events.
// Signed out, the box stays reserved at its size so sign-in never shifts the layout (V33): `signed-out="empty"`
// (default) keeps it blank, `signed-out="glyph"` draws a neutral person glyph.
import {ElementBase,h,icon,islandPart,localize,mountIsland,reconcileShadow,requestSession,schemeFor,watchScheme} from './shared.mjs';
import {css} from '../../../../vendor/dodo/style.js';

export class BindleAvatarElement extends ElementBase {
  static observedAttributes=['lang','theme','size','label','signed-out','prominent'];
  #session=null;#connected=false;#listeners=[];#unwatch=null;#island=null;#islandState='off';#islandKey='';#pictureFailed=null;#source='monogram';#views=null;#entity=null;
  connectedCallback(){this.#connected=true;this.#unwatch=watchScheme(this,()=>this.render());this.render();requestSession(this,session=>{if(this.#connected)this.#attach(session);});}
  disconnectedCallback(){this.#connected=false;this.#unwatch?.();for(const [type,listener] of this.#listeners)this.#session?.removeEventListener(type,listener);this.#listeners=[];this.#unmount();}
  attributeChangedCallback(){if(this.#connected)this.render();}
  // `source` reflects only what the element itself rendered ('island' while an island is live).
  get state(){return Object.freeze({islands:this.#islandState,source:this.#islandState==='live'?'island':this.#source});}
  // Organization context (provisional): an app-supplied entity {subject, name?, picture?} composes the avatar with the
  // person (prominent="entity" default, or "person"). The app learns the entity only after the user selected it.
  get entity(){return this.#entity;}
  set entity(value){this.#entityRaw=value??null;this.#entity=null;if(this.#connected)this.render();}
  #entityRaw=null;
  // Re-evaluates the effective scheme after an embedder theme change the element cannot observe.
  refreshTheme(){if(this.isConnected)this.render();}
  #attach(session){
    this.#session=session;const rerender=()=>this.render();
    for(const type of ['bindle-session-change','bindle-capabilities-change']){session.addEventListener(type,rerender);this.#listeners.push([type,rerender]);}
    this.render();
  }
  #unmount(){try{this.#island?.destroy?.();}catch{}this.#island=null;if(this.#islandState!=='fallback')this.#islandState='off';}
  render(){
    if(!this.#connected)return;
    const {t}=localize(this),session=this.#session,view=session?.session,win=this.ownerDocument.defaultView,size=Number.parseInt(this.getAttribute('size')??'',10);
    // The avatar view loads with the first session (fresh pages are always signed out).
    if(view&&!this.#views){import('./avatar-view.mjs').then(module=>{this.#views=module;this.render();});return;}
    const {theme,colorScheme}=schemeFor(this,session),{avatarModel,avatarStyles,avatarView}=this.#views??{};
    const model=view&&avatarModel(view,{pictureFailed:this.#pictureFailed===view.profile?.picture});this.#source=model?.source??'monogram';
    if(this.#entityRaw&&this.#views)this.#entity=this.#views.entityIdentity(this.#entityRaw);
    const entity=view&&this.#entity,personName=view?.profile?.displayName??view?.profile?.handle;
    const composedLabel=entity&&(entity.name&&personName?t('{entity} — signed in as {name}',{entity:entity.name,name:personName}):this.getAttribute('label')||t('Identity picture'));
    reconcileShadow(this,[h('span',
      model&&entity?this.#views.composedAvatarView(model,this.#views.entityModel(entity),{prominent:this.getAttribute('prominent')==='person'?'person':'entity',label:composedLabel,onPictureError:()=>{this.#pictureFailed=view.profile?.picture;this.render();}}):
      model?avatarView(model,{label:this.getAttribute('label')||t('Identity picture'),onPictureError:()=>{this.#pictureFailed=view.profile?.picture;this.render();}}):h('span',this.getAttribute('signed-out')==='glyph'?icon('person'):null).classes('empty',this.getAttribute('signed-out')==='glyph'&&'glyph').attrs({part:'avatar','aria-hidden':'true'}),
      // The island draws only the person's bound picture; over a composed avatar it would not line up, so it is hidden
      // (still mounted, so sign-out reaches it).
      h('span',h('span').classes('island-host')).classes('island').attrs({part:'avatar-frame','aria-hidden':'true'}).props({hidden:!!entity}).key('island'),
    ).classes('root',theme).style({...colorScheme?{'color-scheme':colorScheme}:{},...size>=16&&size<=512?{'--bindle-avatar-size':`${size}px`}:{}})],[...avatarStyles?[avatarStyles(win)]:[],css.in(win)`:host{display:inline-block;vertical-align:middle}.root{position:relative;display:inline-grid;--_surface:var(--bindle-surface,#ffffff)}.root.dark{--_surface:var(--bindle-surface,#1b1d22)}@media (prefers-color-scheme:dark){.root.auto{--_surface:var(--bindle-surface,#1b1d22)}}.empty{display:inline-grid;place-items:center;box-sizing:border-box;inline-size:var(--bindle-avatar-size,32px);block-size:var(--bindle-avatar-size,32px);border-radius:50%}.empty.glyph{background:var(--bindle-surface-raised,#f6f7f9);color:var(--bindle-text-muted,#5b6270)}.root.dark .empty.glyph{background:var(--bindle-surface-raised,#24272e);color:var(--bindle-text-muted,#a9b0bb)}@media (prefers-color-scheme:dark){.root.auto .empty.glyph{background:var(--bindle-surface-raised,#24272e);color:var(--bindle-text-muted,#a9b0bb)}}.empty .icon{inline-size:60%;block-size:60%}@media (forced-colors:active){.empty.glyph{border:1px solid CanvasText;color:CanvasText}}.island{position:absolute;inset:0;pointer-events:none;border-radius:50%;overflow:hidden;clip-path:circle(50%)}.island[hidden]{display:none}.island-host{display:block;inline-size:100%;block-size:100%}`]);
    // Once mounted, the island stays while the element is connected, so app sign-out reaches it (session{null}, forget).
    const spec=view||this.#islandKey?islandPart(session,'avatar'):null,key=spec?`${spec.issuer} ${spec.version}`:'';
    if(key!==this.#islandKey){this.#islandKey=key;this.#unmount();if(spec)queueMicrotask(async()=>{const container=this.shadowRoot?.querySelector('.island > .island-host');if(!container||this.#islandKey!==key)return;const island=await mountIsland(this,{part:'avatar',container,session,onState:state=>{if(this.#islandKey===key)this.#islandState=state;}});if(this.#islandKey!==key||!this.#connected)island?.destroy();else this.#island=island;});}
    else this.#island?.refresh?.();
  }
}
