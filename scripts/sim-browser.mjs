#!/usr/bin/env node
// Opens a headed Chromium through a running simulation's proxy (start it with `npm run sim -- --keep`), so the .example
// world can be explored by hand: https://alpha.example/console, https://notes.example and so on. No hosts-file edits.
//   node scripts/sim-browser.mjs --proxy http://127.0.0.1:<port> [--url https://notes.example/]
import {chromium} from 'playwright';
const args=process.argv.slice(2),value=(name,fallback)=>{const i=args.indexOf('--'+name);return i>=0?args[i+1]:fallback;};
const proxy=value('proxy',process.env.SIM_PROXY??'http://127.0.0.1:3128'),url=value('url','https://notes.example/');
const browser=await chromium.launch({headless:false,proxy:{server:proxy},args:['--ignore-certificate-errors']});
const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:null});
await (await context.newPage()).goto(url);
console.log(`Browsing the simulation through ${proxy}. Close the window to exit.`);
browser.on('disconnected',()=>process.exit(0));
