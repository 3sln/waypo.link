// Screenshot mode (spike §5): a versioned catalogue of moments, each captured across en/es × light/dark × 390/1280,
// written to artifacts/sim/<run-id>/shots/<scenario>/<nn>-<moment>--<locale>-<scheme>-<width>.png with a manifest
// entry. Outside screenshot mode every moment still runs the layout checks (G5) at 390 px, without saving images.
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export const CATALOGUE_VERSION=2;
/** `surface`: which app renders it; `locale`: how to switch language in place ('notes': in-page preference; 'provider':
 * preference plus reload, only for pages that survive a reload; null: English only, with `localeNote` saying why). */
const BASE_MOMENTS=Object.freeze({
 'provider-home':{title:'Provider home, signed out',surface:'provider',locale:'provider'},
 'signup-questions':{title:'Signup: before we create your account',surface:'provider',locale:null,localeNote:'mid-flow page: a reload to switch language would restart the flow'},
 'signup-recovery':{title:'Signup: keep a way back in',surface:'provider',locale:null,localeNote:'mid-flow page: a reload to switch language would restart the flow'},
 'signup-ready':{title:'Signup: recovery file tested',surface:'provider',locale:null,localeNote:'mid-flow page: a reload to switch language would restart the flow'},
 'provider-console':{title:'Provider console after signup',surface:'provider',locale:'provider'},
 'notes-empty-signed-out':{title:'Notes, first run, signed out (local-only)',surface:'notes',locale:'notes',element:'sign-in: signed out (promo)'},
 'notes-local-notes':{title:'Notes with local notes, signed out',surface:'notes',locale:'notes',element:'signed out'},
 'notes-sign-in-island':{title:'Sign-in sheet with the provider island',surface:'notes',locale:'notes',element:'<bindle-sign-in> island (alpha)'},
 'notes-sign-in-other-provider':{title:'Sign-in sheet: use a different provider',surface:'notes',locale:'notes',element:'<bindle-sign-in> handle form'},
 'notes-sign-in-error':{title:'Sign-in sheet: invalid identity error',surface:'notes',locale:'notes',element:'<bindle-sign-in> error'},
 'provider-entry-choose':{title:'Provider: choose an account for Notes',surface:'provider',locale:null,localeNote:'mid-flow page: a reload to switch language would restart the flow',element:'signing in (provider)'},
 'provider-consent':{title:'Provider: review what Notes can access',surface:'provider',locale:null,localeNote:'mid-flow page: a reload to switch language would restart the flow'},
 'provider-consent-configured':{title:'Provider: consent with storage chosen',surface:'provider',locale:null,localeNote:'mid-flow page: a reload to switch language would restart the flow'},
 'notes-synced':{title:'Notes synced to the account',surface:'notes',locale:'notes',element:'<bindle-account> signed in'},
 'notes-account-menu':{title:'Account menu open (switcher)',surface:'notes',locale:'notes',element:'<bindle-account> menu open'},
 'notes-editor':{title:'Editing a note',surface:'notes',locale:'notes'},
 'notes-settings':{title:'Notes settings',surface:'notes',locale:'notes'},
 'provider-grant-more':{title:'Provider: incremental request for app messages',surface:'provider',locale:null,localeNote:'mid-flow page: a reload to switch language would restart the flow'},
 'notes-reminders-on':{title:'Notes settings with reminders on',surface:'notes',locale:'notes'},
 'provider-messages':{title:'Provider: the reminder in messages',surface:'provider',locale:'provider'},
 'provider-connected-apps':{title:'Provider: connected apps',surface:'provider',locale:null,localeNote:'the console rewrites ?view=connections on load, so a reload lands on Messages'},
 'provider-removal-confirm':{title:'Provider: remove Notes',surface:'provider',locale:null,localeNote:'mid-flow page: a reload to switch language would restart the flow'},
 'notes-removal':{title:'Notes clean-removal page',surface:'notes',locale:'notes'},
 'provider-removal-done':{title:'Provider: removal result',surface:'provider',locale:'provider'},
 'photos-explore-signed-out':{title:'Photos: public gallery, signed out',surface:'photos',locale:'photos',element:'signed out (guest)'},
 'photos-viewer-public':{title:'Photos: viewing a public photo',surface:'photos',locale:'photos'},
 'photos-sign-in':{title:'Photos: sign-in sheet (handle form, redirect)',surface:'photos',locale:'photos',element:'<bindle-sign-in> identity-required, islands off'},
 'photos-library-locked':{title:'Photos: library before storage is granted',surface:'photos',locale:'photos',element:'signed in, limited'},
 'provider-grant-more-storage':{title:'Provider: incremental request for photo storage',surface:'provider',locale:null,localeNote:'mid-flow page: a reload to switch language would restart the flow'},
 'photos-library-reconnect':{title:'Photos: finish connecting storage',surface:'photos',locale:'photos'},
 'photos-library':{title:'Photos: personal library',surface:'photos',locale:'photos',element:'<bindle-account> signed in'},
 'photos-viewer-own':{title:'Photos: viewing your own photo',surface:'photos',locale:'photos'},
 'notes-signed-out-app':{title:'Notes after signing out of the app (notes kept on the device)',surface:'notes',locale:'notes',element:'signed out (app sign-out)'},
 'notes-signed-out-after-removal':{title:'Notes after removal (disconnected)',surface:'notes',locale:'notes',element:'disconnected'}
});

/** The catalogue: base moments plus each scenario part's own (tests/sim/parts/*.mjs `moments`). */
export const MOMENTS={...BASE_MOMENTS};
export function registerMoments(moments={}){for(const [id,meta] of Object.entries(moments)){if(MOMENTS[id]&&MOMENTS[id]!==meta)throw new Error(`Moment ${id} is declared twice.`);MOMENTS[id]=meta;}}

const VARIANTS={locales:['en','es'],schemes:['light','dark'],widths:[390,1280]};
const heightFor=width=>width<=390?844:900;
const settle=page=>page.evaluate(async()=>{await document.fonts?.ready;document.activeElement?.blur?.();window.scrollTo(0,0);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));}).catch(()=>{});

/** G5 checks on the current page: no horizontal overflow; the background follows the scheme. */
async function layoutCheck(page){
 return page.evaluate(()=>{
  const overflow=document.documentElement.scrollWidth>innerWidth+1;
  // The first opaque background among body, html and the app's top container (transparent means the canvas).
  const parse=value=>{const n=(value.match(/[\d.]+/g)??[]).map(Number);return n.length>=3&&(n[3]===undefined||n[3]>0.5)?n.slice(0,3):null;};
  const canvas=matchMedia('(prefers-color-scheme: dark)').matches&&getComputedStyle(document.documentElement).colorScheme.includes('dark')?[18,18,18]:[255,255,255];
  const rgb=[document.body,document.documentElement,document.body.firstElementChild].map(el=>el&&parse(getComputedStyle(el).backgroundColor)).find(Boolean)??canvas;
  const [r,g,b]=rgb.map(v=>v/255).map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);
  return {overflow,luminance:0.2126*r+0.7152*g+0.0722*b,width:innerWidth};
 });
}
async function setLocale(page,kind,locale){
 if(kind==='notes')return page.evaluate(l=>window.__notes?.engine.run('preference',{locale:l}),locale).then(()=>true);
 if(kind==='photos')return page.evaluate(l=>window.__photos?.engine.run('preference',{locale:l}),locale).then(()=>true);
 // Any other sample exposes `window.__<surface>.engine` with a `preference` operation (the kit's convention).
 if(kind&&kind!=='provider'&&/^[a-z]+$/.test(kind))return page.evaluate(([k,l])=>window['__'+k]?.engine?.run('preference',{locale:l}).then(()=>true,()=>false)??false,[kind,locale]);
 if(kind==='provider'){
  await page.evaluate(l=>{let v={};try{v=JSON.parse(localStorage.getItem('personal-space-preferences'))??{};}catch{}v.locale=l;localStorage.setItem('personal-space-preferences',JSON.stringify(v));},locale);
  // Static pages may move to a localized path (index.es.html): always return to the moment's own URL.
  page.__simMomentUrl??=page.url();await page.goto(page.__simMomentUrl,{waitUntil:'networkidle'}).catch(()=>{});
  if(locale==='en')delete page.__simMomentUrl;return true;
 }
 return false;
}

export function createShots({runDir,enabled,profile,log=()=>{}}){
 const manifest=[],findings=[];let counter=0;
 return {manifest,findings,
  /** Captures (or, outside screenshot mode, only checks) one catalogue moment on `page`. */
  async moment(page,id,{scenario,step,actor,prepare}={}){
   const meta=MOMENTS[id];if(!meta)throw new Error(`Unknown moment ${id}`);
   const n=String(++counter).padStart(2,'0'),original=page.viewportSize();
   if(prepare)await prepare(page);
   // G5 at 390 px in both schemes, every run.
   for(const scheme of VARIANTS.schemes){
    await page.emulateMedia({colorScheme:scheme});await page.setViewportSize({width:390,height:844});await settle(page);
    const check=await layoutCheck(page);
    if(check.overflow)findings.push({gate:'G5',moment:id,scheme,issue:'horizontal overflow at 390 px'});
    if(scheme==='dark'&&check.luminance>0.4||scheme==='light'&&check.luminance<0.3)findings.push({gate:'G5',moment:id,scheme,issue:`background luminance ${check.luminance.toFixed(2)} does not follow ${scheme}`,severity:'info'});
   }
   if(enabled){
    const dir=join(runDir,'shots',scenario);await mkdir(dir,{recursive:true});
    const locales=meta.locale?VARIANTS.locales:['en'];
    for(const locale of locales){
     if(locale!=='en'&&!await setLocale(page,meta.locale,locale).catch(()=>false))continue;
     for(const scheme of VARIANTS.schemes)for(const width of VARIANTS.widths){
      await page.emulateMedia({colorScheme:scheme});await page.setViewportSize({width,height:heightFor(width)});await settle(page);
      // A modal (dialog or viewer) covers the viewport only: capture the viewport, not the full page behind it.
      const modal=await page.evaluate(()=>!!document.querySelector('dialog[open],.viewer')).catch(()=>false);
      const file=`${n}-${id}--${locale}-${scheme}-${width}.png`,bytes=await page.screenshot({fullPage:!modal,animations:'disabled',caret:'hide'});
      await writeFile(join(dir,file),bytes);
      manifest.push({scenario,step,moment:id,title:meta.title,...meta.localeNote?{localeNote:meta.localeNote}:{},element:meta.element??null,surface:meta.surface,actor,origin:new URL(page.url()).origin,path:`shots/${scenario}/${file}`,viewport:{width,height:heightFor(width)},locale,scheme,profile,pixelHash:createHash('sha256').update(bytes).digest('hex').slice(0,16)});
     }
    }
    if(locales.length>1)await setLocale(page,meta.locale,'en').catch(()=>{});
    log(`  📷 ${id} (${locales.length*4} images)`);
   }
   await page.emulateMedia({colorScheme:'light'});if(original)await page.setViewportSize(original);await settle(page);
  }
 };
}
