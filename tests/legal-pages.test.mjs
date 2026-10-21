import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildLegalPages,renderLegalMarkdown} from '../apps/web/legal-page.mjs';
import {buildLanding} from '../scripts/build-landing.mjs';

test('legal Markdown renders the reviewed subset without interpreting HTML or unsafe URLs',()=>{
 const markdown='# Heading\n\nParagraph **bold** and `code <x>` with [privacy](./privacy.md#age) and [terms](terms.md).\n\n<!-- operator-only\ncomment -->\n- Parent\n  - Child **strong**\n- Second\n\n1. First\n2. Next\n\n| Name | Value |\n|---|:---:|\n| **One** | `two` |\n\n<script>alert(1)</script> [bad](javascript:alert) [remote](//bad.example) [safe](https://good.example/privacy)';
 const html=renderLegalMarkdown(markdown);assert.match(html,/<h1 id="heading">Heading<\/h1>/);assert.match(html,/<strong>bold<\/strong>/);assert.match(html,/<code>code &lt;x&gt;<\/code>/);assert.match(html,/href="\/privacy#age"/);assert.match(html,/href="\/terms"/);assert.match(html,/<li>Parent<ul><li>Child <strong>strong<\/strong><\/li><\/ul><\/li>/);assert.match(html,/<ol><li>First<\/li><li>Next<\/li><\/ol>/);assert.match(html,/<th scope="col">Name<\/th>/);assert.match(html,/<td><strong>One<\/strong><\/td>/);assert.match(html,/tabindex="0"/);assert(!html.includes('operator-only'));assert(!html.includes('<script'));assert(!html.includes('href="javascript:'));assert(!html.includes('href="//'));assert.match(html,/href="https:\/\/good.example\/privacy"/);
});
test('legal builds preserve source text, localize the shell, and prominently mark drafts without JavaScript',async()=>{
 const out=await mkdtemp(join(tmpdir(),'3sln-legal-'));try{
  const files=await buildLegalPages({out,css:'/assets/site.css'});assert.deepEqual(files,['privacy.html','privacy.es.html','terms.html','terms.es.html']);
  for(const file of files){const html=await readFile(join(out,file),'utf8');assert(!html.includes('<script'));assert(!html.includes('<!--'));assert.match(html,/<article lang="en">/);assert.match(html,/<h2 id="14-contact">|<h2 id="15-contact">/);assert.match(html,/\[COMPANY\]/);assert.match(html,/class="legal-draft" role="note"/);assert.match(html,/href="\/privacy(?:\?lang=es)?"/);assert.match(html,/href="\/terms(?:\?lang=es)?"/);assert.match(html,new RegExp('<html lang="'+(file.includes('.es.')?'es':'en')+'">'));assert.match(html,file.includes('.es.')?/Borrador — sin vigencia/:/Draft — not in effect/);if(file.includes('.es.'))assert.match(html,/No hay una traducción al español revisada/);}
  const terms=await readFile(join(out,'terms.html'),'utf8');assert(!terms.includes('href="privacy.md"'));assert.match(terms,/<a href="\/privacy">Privacy Policy<\/a>/);
 }finally{await rm(out,{recursive:true,force:true});}
});
test('the draft banner follows the document header rather than mentions in body text',async()=>{
 const out=await mkdtemp(join(tmpdir(),'3sln-legal-release-')),source=await mkdtemp(join(tmpdir(),'3sln-legal-source-'));try{
  for(const name of ['privacy','terms'])await writeFile(join(source,name+'.md'),'# Legal\n\nVersion: 2026-10-21. In effect.\n\nDraft history is available by request.');
  await buildLegalPages({out,source,css:'/styles.css'});assert(!(await readFile(join(out,'privacy.html'),'utf8')).includes('class="legal-draft"'));
  await writeFile(join(source,'privacy.md'),'# Legal\n\nDRAFT for review.\n\nNot in effect.');await buildLegalPages({out,source,css:'/styles.css'});assert((await readFile(join(out,'privacy.html'),'utf8')).includes('class="legal-draft"'));
 }finally{await rm(out,{recursive:true,force:true});await rm(source,{recursive:true,force:true});}
});
test('the landing build links both legal documents in each localized footer',async()=>{
 const out=await mkdtemp(join(tmpdir(),'3sln-legal-landing-'));try{await mkdir(join(out,'assets'));await buildLanding({out,css:'/assets/site.css'});const en=await readFile(join(out,'index.html'),'utf8'),es=await readFile(join(out,'index.es.html'),'utf8');assert.match(en,/<a href="\/privacy">Privacy policy<\/a>/);assert.match(en,/<a href="\/terms">Terms of service<\/a>/);assert.match(es,/<a href="\/privacy\?lang=es">Política de privacidad<\/a>/);assert.match(es,/<a href="\/terms\?lang=es">Términos del servicio<\/a>/);}finally{await rm(out,{recursive:true,force:true});}
});
