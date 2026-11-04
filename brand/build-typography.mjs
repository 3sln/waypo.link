// Render the outlined social card only; icon-only assets remain unchanged.
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const asset=new URL('../site/assets/waypo-link-social.svg',import.meta.url),target=new URL('../site/assets/waypo-link-social.png',import.meta.url);
const browser=await chromium.launch({headless:true});try{const page=await browser.newPage({viewport:{width:1200,height:630},deviceScaleFactor:1});await page.setContent('<style>html,body{margin:0}svg{display:block}</style>'+await readFile(asset,'utf8'));await page.screenshot({path:target.pathname});}finally{await browser.close();}
