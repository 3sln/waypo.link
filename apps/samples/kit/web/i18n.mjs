// Tiny message catalogue helper for the samples: `t(key, vars)` with {name} placeholders, English fallback.
export function createI18n(catalogues,locale='en'){
 const pick=value=>String(value||'en').toLowerCase().startsWith('es')&&catalogues.es?'es':'en';
 let current=pick(locale);
 const t=(key,vars={})=>{const text=catalogues[current]?.[key]??catalogues.en[key]??key;return text.replace(/\{(\w+)\}/g,(_,name)=>vars[name]??'');};
 return {t,get locale(){return current;},set locale(value){current=pick(value);},
  relative(ms,now=Date.now()){const s=Math.max(0,Math.round((now-ms)/1000)),rtf=new Intl.RelativeTimeFormat(current,{numeric:'auto'});if(s<45)return t('time.now');const m=Math.round(s/60);if(m<60)return rtf.format(-m,'minute');const h=Math.round(m/60);if(h<24)return rtf.format(-h,'hour');const d=Math.round(h/24);if(d<7)return rtf.format(-d,'day');return new Intl.DateTimeFormat(current,{month:'short',day:'numeric'}).format(ms);}};
}
