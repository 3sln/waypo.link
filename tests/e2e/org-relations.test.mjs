// Built Worker assets and the real shell; API fixtures do not assert provider conformance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {launch,baseURL} from './browser.mjs';
let browser;test.before(async()=>{browser=await launch();});test.after(async()=>browser?.close());
const org='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',person='cccccccc-cccc-4ccc-8ccc-cccccccccccc',account={id:person,handle:'member',status:'active'};
for(const locale of ['en','es'])test(`ORG-10g built shell ${locale}: Relationships tab, default-off notice and member imports`,async()=>{
 for(const member of [false,true]){
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),calls=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{await context.addInitScript(locale=>localStorage.setItem('personal-space-preferences',JSON.stringify({locale})),locale);
 await context.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;calls.push(path);const powers=member?[]:['admin'];let value={};
 if(path==='/api/config')value={origin:baseURL,localDevelopment:true,organizationsEnabled:true,providers:{}};
 else if(path==='/api/session')value={authenticated:true,account,sessionContext:'ctx',csrfToken:'csrf'};
 else if(path==='/api/account')value={account,features:{organizationsEnabled:true},collections:[],messages:[],contacts:[],rules:[],resources:[],grants:[],views:[]};
 else if(path==='/api/incoming')value={items:[],cursor:null,indexRevision:1};
 else if(path==='/api/orgs')value={organizations:[{id:org,name:'Example',powers,available:true}],pending:[]};
 else if(path==='/api/orgs/'+org)value={id:org,name:'Example',label:'team',state:'active',revision:1,powers};
 else if(path.endsWith('/membership'))value={organization:{id:org,name:'Example',label:'team',state:'active'},membership:{id:'m',grants:[]},powers};
 else if(path.endsWith('/relations/imports'))value={imports:[{id:'imp1',grantor:{iss:'https://grantor.example',sub:org},grantorName:'Granted files',status:'available',contracts:[]}]};
 else if(path.endsWith('/relations'))value={enabled:false,billing:'active',instances:[],invitations:[],inbound:{items:[],introductions:[]},holds:{holds:[],unreachable:[]},imports:[]};
 else if(path.endsWith('/ownership'))value={billing:{standing:'paid'},decisions:[]};
 else value={organizations:[],members:[],requests:[],connections:[],preferences:[],entries:[],views:[]};
 await route.fulfill({json:value});});
 await page.goto(baseURL+'/console?view=organizations&org='+org);await page.locator('.org-rel-tabs').waitFor();await page.locator('[data-org-action="rel-tab-relationships"]').click();await page.locator('#org-relations').waitFor();
 const text=await page.locator('#org-relations').locator('..').innerText();assert.match(text,member?/Granted files/:locale==='es'?/desactivado/:/is off/);assert.equal(await page.locator('[data-org-action="rel-wizard-open"]').count(),0);
 if(member)assert.equal(calls.some(p=>p==='/api/orgs/'+org+'/relations'),false);
 assert.doesNotMatch(text,/\b[a-z]+(?:_[a-z]+)+\b/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
 }finally{await context.close();}
 }
});
