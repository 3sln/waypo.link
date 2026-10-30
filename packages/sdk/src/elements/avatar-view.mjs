// Standard avatar chain (components-profile §6.2, §7, §7.1): granted picture →
// initials → subject monogram, on one scheme-aware identity tile. Colours come
// from islands-protocol so islands and elements paint identical tones (M6).
import {h} from '../../../../vendor/dodo/index.js';
import {css} from '../../../../vendor/dodo/style.js';
import {identityStyle,monogramCells,tileCss} from './tile.mjs';
export {identityStyle,monogramCells,tileCss};
import {initials} from './initials.mjs';

const freeze=Object.freeze;
export function avatarModel(view,{pictureFailed=false}={}){
  const subject=view?.subject,profile=view?.profile??{};
  if(!pictureFailed&&typeof profile.picture==='string'&&profile.picture)return freeze({source:'picture',subject,picture:profile.picture});
  const text=initials(profile.displayName,profile.handle);
  return text?freeze({source:'initials',subject,text}):freeze({source:'monogram',subject});
}
export function avatarView(model,{label,onPictureError}={}){
  const a11y=label?{role:'img','aria-label':label}:{'aria-hidden':'true'};
  let content;
  if(model.source==='picture')content=h('img').attrs({src:model.picture,alt:'',referrerpolicy:'no-referrer',decoding:'async',loading:'lazy',part:'picture'}).on({error:()=>onPictureError?.()});
  else if(model.source==='initials')content=h('bdi',model.text).attrs({dir:'auto',part:'initials'}).classes('initials');
  else content=h('span',...monogramCells(model.subject)).classes('monogram-grid').attrs({part:'monogram'});
  return h('span',content).classes('avatar','id-tile',model.source).attrs({part:'avatar',...a11y}).style(identityStyle(model.subject));
}
// Organization context (owner direction 2026-10-29, provisional; the entity API is not implemented yet, see
// docs/architecture/org-context-and-layered-preferences-spike.md): an app-supplied entity identity, known to the app
// only after the user selected it. Validated like a granted profile: an HTTPS subject, a bounded name without
// control or bidi characters, an HTTPS picture. Anything else is null (no composed avatar).
const bidi=/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
export function entityIdentity(value){
  if(!value||typeof value!=='object')return null;
  let subject;try{subject=new URL(value.subject);}catch{return null;}
  if(subject.protocol!=='https:'||subject.username||subject.password||String(value.subject).length>2048)return null;
  const name=typeof value.name==='string'&&value.name.trim()&&[...value.name].length<=100&&!/[\x00-\x1f\x7f]/.test(value.name)&&!bidi.test(value.name)?value.name.trim():undefined;
  let picture;try{const url=new URL(value.picture);if(url.protocol==='https:'&&!url.username&&!url.password&&String(value.picture).length<=2048)picture=url.href;}catch{}
  return freeze({subject:subject.href,...name?{name}:{},...picture?{picture}:{}});
}
export const entityModel=(entity,options)=>avatarModel({subject:entity.subject,profile:{displayName:entity.name,picture:entity.picture}},options);
/** Person + entity in one fixed box (the single avatar's size): the prominent identity large at the top start, the
 * other small at the bottom end with a surface ring; the entity is a rounded square, the person a circle, so the two
 * read apart by shape, not colour. Mirrors in RTL (logical insets). */
export function composedAvatarView(person,entity,{prominent='entity',label,onPictureError}={}){
  const a11y=label?{role:'img','aria-label':label}:{'aria-hidden':'true'};
  const major=prominent==='person'?['person',person]:['entity',entity],minor=prominent==='person'?['entity',entity]:['person',person];
  return h('span',
    h('span',avatarView(major[1],{onPictureError})).classes('major',major[0]),
    h('span',avatarView(minor[1],{onPictureError})).classes('minor',minor[0]),
  ).classes('composed').attrs({part:'avatar composed',...a11y});
}
export const avatarStyles=view=>css.in(view)`
.composed{position:relative;display:inline-block;flex:none;inline-size:var(--bindle-avatar-size,32px);block-size:var(--bindle-avatar-size,32px);--_c:var(--bindle-avatar-size,32px)}
.composed > span{position:absolute;display:inline-grid}
.composed .major{inset-block-start:0;inset-inline-start:0;--bindle-avatar-size:calc(var(--_c) * .78)}
.composed .minor{inset-block-end:0;inset-inline-end:0;--bindle-avatar-size:calc(var(--_c) * .5)}
.composed .minor .avatar{box-shadow:0 0 0 max(1.5px,calc(var(--_c) * .05)) var(--_surface,#fff)}
.composed .entity .avatar{border-radius:28%}
.composed .avatar .initials{font-size:calc(var(--bindle-avatar-size) * .42)}
.composed .minor .avatar .initials{font-size:calc(var(--bindle-avatar-size) * .46)}
.avatar{display:inline-grid;place-items:center;inline-size:var(--bindle-avatar-size,32px);block-size:var(--bindle-avatar-size,32px)}
.avatar img{inline-size:100%;block-size:100%;object-fit:cover;display:block}
.avatar .initials{unicode-bidi:isolate;font-family:system-ui,sans-serif;font-size:calc(var(--bindle-avatar-size,32px) * .4);font-weight:600;line-height:1;overflow:hidden;white-space:nowrap}
${tileCss}`;
