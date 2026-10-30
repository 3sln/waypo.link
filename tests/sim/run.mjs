// The orchestrator: one function used by the CLI (scripts/sim.mjs), Docker and CI alike.
import {mkdir,writeFile,readFile,rm,cp,mkdtemp,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {startWorld} from './world.mjs';
import {launchBrowser,personContext} from './browser.mjs';
import {createRun} from './engine.mjs';
import {createShots,CATALOGUE_VERSION} from './shots.mjs';
import {evaluateGates} from './gates.mjs';
import {galleryHtml} from './gallery.mjs';
import * as small from './scenarios/small.mjs';
import * as medium from './scenarios/medium.mjs';

const SCENARIOS={small,medium};
const REPO=fileURLToPath(new URL('../..',import.meta.url));
const gitSha=()=>{try{return execFileSync('git',['rev-parse','--short','HEAD'],{encoding:'utf8',cwd:REPO}).trim();}catch{return 'nogit';}};
/** The providers serve `.output/public` relative to the working directory. A private snapshot (as
 * scripts/run-browser-checks.mjs does) keeps a concurrent `npm run build:assets` from changing assets mid-run. */
async function assetSnapshot(){
 const source=join(REPO,'.output/public');await access(join(source,'build-manifest.json'));
 // sw.js is written last: without it the build stopped part-way (for example at build-docs), and is recorded.
 const complete=await access(join(source,'sw.js')).then(()=>true,()=>false);
 const dir=await mkdtemp(join(tmpdir(),'3sln-sim-cwd-'));await cp(source,join(dir,'.output/public'),{recursive:true});
 const previous=process.cwd();process.chdir(dir);
 return {dir,complete,async restore(){process.chdir(previous);await rm(dir,{recursive:true,force:true});}};
}

/** Captures process console output (providers log here) so it can be scanned (G3) and kept out of the terminal. */
function captureConsole(){
 const lines=[],original={log:console.log,warn:console.warn,error:console.error,info:console.info};
 for(const name of Object.keys(original))console[name]=(...args)=>{lines.push(args.map(a=>typeof a==='string'?a:a instanceof Error?a.stack??a.message:JSON.stringify(a)).join(' '));if(lines.length>20000)lines.shift();};
 return {lines,restore(){Object.assign(console,original);}};
}

async function once({scenarioName,seed,screenshots,headed,runDir,log,keep,parts}){
 const scenario=SCENARIOS[scenarioName];if(!scenario)throw new Error(`Unknown scenario ${scenarioName}`);
 const captured=captureConsole();let world,browser,snapshot;const health=[];
 try{
  snapshot=await assetSnapshot();
  world=await startWorld({runId:runDir.split('/').pop()});
  browser=await launchBrowser(world.network,{headed});
  const run=createRun({scenario:scenarioName,seed,log});
  const people=scenario.define(run,world,parts?{parts}:{});
  const persons=new Map();
  const shots=createShots({runDir,enabled:screenshots,profile:world.profile,log});
  const ctx={world,scenario:scenarioName,ledger:run.ledger,shots,random:run.random,
   person(p){if(!persons.has(p.name))throw new Error(`No browser for ${p.name}`);return persons.get(p.name);},
   async onFailure(step){const person=step.actor&&persons.get(step.actor);if(!person)return;const dir=join(runDir,'failures');await mkdir(dir,{recursive:true});let i=0;for(const page of person.browser.context.pages()){await page.screenshot({path:join(dir,`${step.id}-${++i}.png`),fullPage:true}).catch(()=>{});}}};
  // Seeded, distinct public-looking addresses (TEST-NET-3 is not used: it is a documentation range some policies refuse).
  for(const [i,p] of people.entries()){p.address=`203.${10+i}.${run.random.int(1,250)}.${run.random.int(1,250)}`;const proxy=await world.network.personProxy(p.address);const b=await personContext(browser,{name:p.name,health,proxy});persons.set(p.name,Object.assign(p,{browser:b}));}
  const results=await run.execute(ctx);
  if(keep){log(`\nWorld kept running. Proxy: ${world.network.proxyServer}  (Ctrl-C to stop)\n  npm run sim:browser -- --proxy ${world.network.proxyServer}`);await new Promise(()=>{});}
  return {timings:run.timings??null,incompleteBuild:snapshot.complete===false,results,health,world,shots,ledger:run.ledger,processLog:captured.lines,secrets:people.map(p=>p.passphrase),people};
 }finally{
  captured.restore();
  if(!keep){await browser?.close().catch(()=>{});await world?.close().catch(()=>{});await snapshot?.restore();}
 }
}

export async function runSimulation({scenario='small',seed=7,screenshots=false,headed=false,replay=false,keep=false,parts=null,out='artifacts/sim',log=line=>process.stdout.write(line+'\n')}={}){
 const started=new Date(),runId=`${started.toISOString().slice(0,10)}-${scenario}-s${seed}-${gitSha()}${screenshots?'-shots':''}`,runDir=resolve(out,runId);
 await rm(runDir,{recursive:true,force:true});await mkdir(runDir,{recursive:true});
 log(`Simulation ${runId}\n  output ${runDir}`);
 const first=await once({scenarioName:scenario,seed,screenshots,headed,runDir,log,keep,parts});
 let replayResult=null;
 if(replay){
  log('\nReplay with the same seed (G6)…');
  const second=await once({scenarioName:scenario,seed,screenshots:false,headed,runDir:join(runDir,'replay'),log:line=>log('  '+line),keep:false,parts});
  const replayFailures=second.results.filter(r=>!r.ok).map(r=>r.id);
  replayResult={digest:first.ledger.digest(),replayDigest:second.ledger.digest(),replayFailures,match:first.ledger.digest()===second.ledger.digest()&&!replayFailures.length};
 }
 let previous=null;try{previous=JSON.parse(await readFile(resolve(out,`latest-${scenario}.json`),'utf8'));}catch{}
 const {gates,budget,passed}=evaluateGates({parts,incompleteBuild:first.incompleteBuild,results:first.results,health:first.health,world:first.world,processLog:first.processLog,shots:first.shots,replay:replayResult,previous,secrets:first.secrets});
 const durationMs=Date.now()-started.getTime();
 const manifest={runId,scenario,seed,parts:parts??'all',startedAt:started.toISOString(),durationMs,catalogueVersion:CATALOGUE_VERSION,
  profile:first.world.profile,world:first.world.description(),
  testOnly:{passkeys:'soft passkeys per person (tests/helpers/soft-passkey.mjs) behind navigator.credentials; real adapter verification',turnstile:'third-party stand-in for Cloudflare Turnstile (widget script and siteverify), tokens bound to host and action, single use',tls:'per-run local CA; browsers ignore certificate errors; servers trust only the run CA',network:'DNS and socket replaced at the providers\' injection seams; screening unchanged',addresses:'each person browses through their own proxy port carrying a seeded address, passed to providers in the operator trusted client-IP header (TRUSTED_CLIENT_IP_HEADER)',clock:'real time (see gaps: a frozen browser clock breaks DPoP proof iat checks against real-time providers)'},
  caveat:'Self-consistency, not interoperability: every provider here shares authors.',
  environment:{incompleteAssetBuild:first.incompleteBuild},
 ledger:{digest:first.ledger.digest(),entries:first.ledger.entries},replay:replayResult,loadTimings:first.timings,
  steps:first.results,gates,budget,passed,health:first.health,shots:first.shots.manifest,
  egress:{violations:first.world.network.violations,tunnels:first.world.network.events.filter(e=>e.kind==='proxy-tunnel').length,serverDials:first.world.network.events.filter(e=>e.kind==='socket').length}};
 await writeFile(join(runDir,'manifest.json'),JSON.stringify(manifest,null,1));
 await writeFile(join(runDir,'index.html'),galleryHtml(manifest));
 await writeFile(resolve(out,`latest-${scenario}.json`),JSON.stringify({runId,budget}));
 if(first.timings){log('\nLoad phase');for(const [k,v] of Object.entries(first.timings))log(`  ${k}: ${v.ms} ms (budget ${v.budgetMs} ms) ${JSON.stringify(Object.fromEntries(Object.entries(v).filter(([n])=>!['ms','budgetMs'].includes(n))))}`);}
 log('\nGates');for(const g of gates)log(`  ${g.status==='pass'?'✓':g.status==='fail'?'✗':'·'} ${g.id} ${g.title}: ${g.summary}`);
 log(`\n${passed?'PASS':'FAIL'} in ${Math.round(durationMs/1000)} s · ${first.shots.manifest.length} screenshots · ${join(runDir,'index.html')}`);
 return {passed,manifest,runDir};
}
