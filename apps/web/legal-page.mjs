import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const withoutComments=markdown=>markdown.replace(/<!--[\s\S]*?(?:-->|$)/g,'');
const link=value=>{
 const legal=/^(?:\.\/)?(privacy|terms)\.md(#[^\s]*)?$/.exec(value);if(legal)return '/'+legal[1]+(legal[2]??'');
 return /^(?:https?:\/\/|mailto:|\/(?!\/)|#)/i.test(value)?value:null;
};
function inline(text){
 let output='';
 for(let i=0;i<text.length;){
  const rest=text.slice(i);let match;
  if((match=/^`([^`]+)`/.exec(rest))){output+='<code>'+escape(match[1])+'</code>';i+=match[0].length;}
  else if((match=/^\*\*(.+?)\*\*/.exec(rest))){output+='<strong>'+inline(match[1])+'</strong>';i+=match[0].length;}
  else if((match=/^\[([^\]]+)\]\(([^\s)]+)\)/.exec(rest))){const href=link(match[2]);output+=href?`<a href="${escape(href)}">${inline(match[1])}</a>`:escape(match[0]);i+=match[0].length;}
  else{output+=escape(text[i]);i++;}
 }
 return output;
}
const listItem=line=>/^(\s*)([-+*]|\d+\.)\s+(.+)$/.exec(line);
const tableCells=line=>line.trim().replace(/^\||\|$/g,'').split('|').map(cell=>cell.trim());
const tableDivider=line=>/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
// The legal sources use this intentionally small subset. Raw HTML is escaped,
// not interpreted, and links accept only public web/mail or local destinations.
export function renderLegalMarkdown(markdown,{tableLabel='Scrollable table'}={}){
 const lines=withoutComments(markdown).replaceAll('\r','').split('\n');let index=0;
 function list(indent){
  const ordered=/\d/.test(listItem(lines[index])[2]),tag=ordered?'ol':'ul';let html='<'+tag+'>';
  while(index<lines.length){const item=listItem(lines[index]);if(!item||item[1].length!==indent||/\d/.test(item[2])!==ordered)break;index++;html+='<li>'+inline(item[3]);
   while(index<lines.length){const child=listItem(lines[index]);if(child&&child[1].length>indent)html+=list(child[1].length);else break;}
   html+='</li>';
  }return html+'</'+tag+'>';
 }
 let html='';
 while(index<lines.length){
  const line=lines[index],heading=/^(#{1,6})\s+(.+)$/.exec(line);if(!line.trim()){index++;continue;}
  if(heading){const id=heading[2].toLowerCase().replace(/[^a-z0-9\s-]/g,'').trim().replace(/\s+/g,'-');html+=`<h${heading[1].length} id="${escape(id)}">${inline(heading[2])}</h${heading[1].length}>`;index++;continue;}
  const item=listItem(line);if(item){html+=list(item[1].length);continue;}
  if(line.includes('|')&&tableDivider(lines[index+1]??'')){
   const headers=tableCells(line);index+=2;html+=`<div class="legal-table" role="region" aria-label="${escape(tableLabel)}" tabindex="0"><table><thead><tr>${headers.map(cell=>'<th scope="col">'+inline(cell)+'</th>').join('')}</tr></thead><tbody>`;
   while(index<lines.length&&lines[index].trim()&&lines[index].includes('|')){const cells=tableCells(lines[index++]);html+='<tr>'+headers.map((_,i)=>'<td>'+inline(cells[i]??'')+'</td>').join('')+'</tr>';}
   html+='</tbody></table></div>';continue;
  }
  const paragraph=[];do{paragraph.push(lines[index++].trim());}while(index<lines.length&&lines[index].trim()&&!/^#{1,6}\s/.test(lines[index])&&!listItem(lines[index])&&!(lines[index].includes('|')&&tableDivider(lines[index+1]??'')));
  html+='<p>'+inline(paragraph.join(' '))+'</p>';
 }
 return html;
}
const style=`:root{color-scheme:light dark}.legal-page{max-width:100%;overflow-wrap:anywhere}.legal-page .landing-nav,.legal-page .landing-footer{max-width:1040px;padding:24px}.legal-page nav{display:flex;flex-wrap:wrap;gap:12px 24px;align-items:center}.legal-page nav a{min-height:36px;display:inline-flex;align-items:center}.legal-page a{text-decoration:underline;text-underline-offset:3px}.legal-page .logo{text-decoration:none}.legal-content{max-width:860px;padding:24px;margin:auto;font-size:15px;line-height:1.75}.legal-content h1{font-size:clamp(27px,5vw,38px);margin-bottom:24px}.legal-content h2{font-size:23px;margin-top:38px;scroll-margin-top:20px}.legal-content h3{margin-top:28px}.legal-content ul,.legal-content ol{padding-left:24px;margin:12px 0 20px}.legal-content li{padding-left:3px;margin:7px 0}.legal-content li ul,.legal-content li ol{margin:8px 0}.legal-content code{font-size:.88em;background:var(--line);padding:2px 4px;border-radius:4px;overflow-wrap:anywhere}.legal-table{width:100%;overflow:auto;margin:20px 0;border:1px solid var(--line);border-radius:8px}.legal-table table{border-collapse:collapse;width:100%;font-size:13px;min-width:480px}.legal-table th,.legal-table td{padding:12px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line)}.legal-table th{background:var(--surface)}.legal-draft{border:2px solid #8d651e;border-radius:8px;padding:16px 20px;margin:0 0 24px;background:#fbf1dd;color:#63450d;font-weight:700;font-size:18px}.legal-language-note{border-left:3px solid var(--focus);padding-left:16px;color:var(--muted)}.legal-page .landing-footer{gap:20px;flex-wrap:wrap}.legal-skip{position:absolute;left:16px;top:-80px;background:var(--surface);padding:12px;z-index:1}.legal-skip:focus{top:12px}@media(max-width:600px){.legal-page .landing-nav{flex-direction:column;align-items:flex-start;gap:16px;padding:20px}.legal-page .landing-nav nav{gap:8px 20px;font-size:13px}.legal-content{padding:20px;font-size:14px}.legal-content h2{font-size:21px}.legal-page .landing-footer{padding:20px}.legal-table th,.legal-table td{padding:10px}.legal-draft{padding:12px 14px}}@media(prefers-color-scheme:dark){.legal-draft{background:#47391f;color:#ffe6aa;border-color:#d8b665}}`;
const labels={en:{privacy:'Privacy policy',terms:'Terms of service',draft:'Draft — not in effect',navigation:'Legal information',home:'Home',skip:'Skip to document',table:'Scrollable table',note:''},es:{privacy:'Política de privacidad',terms:'Términos del servicio',draft:'Borrador — sin vigencia',navigation:'Información legal',home:'Inicio',skip:'Ir al documento',table:'Tabla desplazable',note:'Este documento legal está disponible en inglés. No hay una traducción al español revisada.'}};
export async function buildLegalPages({out,css,source='docs/legal'}){
 await mkdir(join(out,'assets'),{recursive:true});const styleURL='/assets/legal.'+createHash('sha256').update(style).digest('hex').slice(0,20)+'.css';await writeFile(join(out,styleURL.slice(1)),style);const files=[];
 for(const name of ['privacy','terms']){
  const markdown=await readFile(join(source,name+'.md'),'utf8'),header=withoutComments(markdown).split('\n').find(line=>line.trim()&&!/^#/.test(line)),draft=/\bdraft\b/i.test(header??'');
  for(const locale of ['en','es']){
   const t=labels[locale],suffix=locale==='es'?'?lang=es':'',title=t[name],html=`<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#f6f7f2" media="(prefers-color-scheme:light)"><meta name="theme-color" content="#151619" media="(prefers-color-scheme:dark)"><title>${title} · 3sln.me</title><link rel="icon" type="image/svg+xml" href="/icon.svg"><link rel="stylesheet" href="${escape(css)}"><link rel="stylesheet" href="${styleURL}"></head><body><div id="app" class="legal-page"><a class="legal-skip" href="#document">${t.skip}</a><header class="landing-nav"><a class="logo" href="/${suffix}"><picture><source media="(prefers-color-scheme:dark)" srcset="/branding/3sln-lockup-ondark.svg"><img src="/branding/3sln-lockup.svg" alt="3sln" width="91" height="34"></picture><span class="logo-suffix">.me</span></a><nav aria-label="${t.navigation}"><a href="/privacy${suffix}"${name==='privacy'?' aria-current="page"':''}>${t.privacy}</a><a href="/terms${suffix}"${name==='terms'?' aria-current="page"':''}>${t.terms}</a><a href="/${name}?lang=${locale==='en'?'es':'en'}" lang="${locale==='en'?'es':'en'}">${locale==='en'?'Español':'English'}</a></nav></header><main id="document" class="legal-content" tabindex="-1">${draft?`<aside class="legal-draft" role="note">${t.draft}</aside>`:''}${t.note?`<p class="legal-language-note">${t.note}</p>`:''}<article lang="en">${renderLegalMarkdown(markdown,{tableLabel:t.table})}</article></main><footer class="landing-footer"><span>3sln.me</span><nav aria-label="${t.navigation}"><a href="/${suffix}">${t.home}</a><a href="/privacy${suffix}">${t.privacy}</a><a href="/terms${suffix}">${t.terms}</a></nav></footer></div></body></html>`;
   const file=name+(locale==='es'?'.es':'')+'.html';await writeFile(join(out,file),html);files.push(file);
  }
 }
 return files;
}
