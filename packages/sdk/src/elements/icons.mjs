// One inline-SVG icon set for the elements and the embed islands (ui-elements-audit §4.4, provisional): 24-unit
// paths drawn at 16 or 20 CSS px with a 1.5 px non-scaling stroke, round caps and currentColor, so an icon follows
// the text colour of its control in every scheme and in forced colours. No provider logos. The islands bundle
// this module into their own same-origin assets (embed CSP: no inline style, no data: images, Trusted Types),
// so both sides render identical glyphs from DOM nodes only.
import {h} from '../../../../vendor/dodo/index.js';

const paths=Object.freeze({
  'chevron-down':['M6 9l6 6 6-6'],
  check:['M5 12.5l4.5 4.5L19 7.5'],
  plus:['M12 5v14','M5 12h14'],
  globe:['M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0','M3.5 9h17','M3.5 15h17','M12 3c2.4 2.6 3.6 5.6 3.6 9s-1.2 6.4-3.6 9c-2.4-2.6-3.6-5.6-3.6-9S9.6 5.6 12 3z'],
  shield:['M12 3l7 3v5c0 4.6-3 8.3-7 10-4-1.7-7-5.4-7-10V6z','M9 12l2 2 4-4'],
  'sign-in':['M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4','M10 16l4-4-4-4','M14 12H4'],
  'sign-out':['M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4','M16 16l4-4-4-4','M20 12H10'],
  external:['M14 4h6v6','M20 4l-9 9','M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4'],
  person:['M8 8a4 4 0 1 0 8 0a4 4 0 1 0 -8 0','M4.5 20.5c.8-3.8 3.8-6 7.5-6s6.7 2.2 7.5 6'],
  lock:['M6 11h12a1 1 0 0 1 1 1v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7a1 1 0 0 1 1-1z','M8.5 11V8a3.5 3.5 0 0 1 7 0v3'],
  sliders:['M4 7h9','M17 7h3','M4 17h3','M11 17h9','M13 7a2 2 0 1 0 4 0a2 2 0 1 0 -4 0','M7 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0'],
  alert:['M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0','M12 7.5v5.5','M12 16.5v.01'],
  close:['M6.5 6.5l11 11','M17.5 6.5l-11 11'],
  // The spinner is a 3/4 arc; CSS rotates it (800 ms linear), and reduced motion leaves it still.
  spinner:['M12 3a9 9 0 1 1 -9 9'],
});
export const ICONS=Object.freeze(Object.keys(paths));

/** An aria-hidden icon vnode. `size` is 16 (controls) or 20 (rows); anything else falls back to 16. */
export function icon(name,{size=16,className}={}){
  const d=paths[name];if(!d)return null;const px=size===20?20:16;
  return h('svg',...d.map(value=>h('path').attrs({d:value,'vector-effect':'non-scaling-stroke'})))
    .attrs({viewBox:'0 0 24 24',width:String(px),height:String(px),fill:'none',stroke:'currentColor','stroke-width':'1.5','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'}).classes('icon',`icon-${name}`,className);
}

/** Shared icon rules (elements' baseStyles and the islands' parts.css carry the same declarations). */
export const iconCss='.icon{display:block;flex:none;overflow:visible}.icon-spinner{animation:bindle-spin .8s linear infinite}@keyframes bindle-spin{to{transform:rotate(1turn)}}';
