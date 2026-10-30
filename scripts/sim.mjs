#!/usr/bin/env node
// Multi-provider simulation CLI (docs/architecture/simulation-and-sample-apps-spike.md §4).
//   node scripts/sim.mjs [--scenario small] [--seed 7] [--screenshots] [--replay] [--headed] [--keep] [--out artifacts/sim]
// Requires `npm run build:assets` (the providers serve .output/public), openssl and Playwright Chromium.
import {existsSync} from 'node:fs';
import {runSimulation} from '../tests/sim/run.mjs';

const args=process.argv.slice(2),flag=name=>args.includes('--'+name),value=(name,fallback)=>{const i=args.indexOf('--'+name);return i>=0&&args[i+1]&&!args[i+1].startsWith('--')?args[i+1]:fallback;};
if(flag('help')){console.log('Usage: node scripts/sim.mjs [--scenario small] [--scale small] [--seed N] [--screenshots] [--replay] [--headed] [--keep] [--parts core,board,...] [--out DIR]');process.exit(0);}
for(let i=0;i<60&&!existsSync('.output/public/build-manifest.json');i++)await new Promise(r=>setTimeout(r,2000));// a concurrent build may be replacing the directory
if(!existsSync('.output/public/build-manifest.json')){console.error('Run `npm run build:assets` first: the simulated providers serve .output/public.');process.exit(2);}
const scenario=value('scenario',value('scale','small')),seed=Number(value('seed',process.env.SIM_SEED??7));
if(!Number.isSafeInteger(seed)){console.error('--seed must be an integer');process.exit(2);}
try{
 const {passed}=await runSimulation({scenario,seed,screenshots:flag('screenshots'),parts:value('parts',null)?.split(',').filter(Boolean)??null,replay:flag('replay'),headed:flag('headed'),keep:flag('keep'),out:value('out','artifacts/sim')});
 process.exit(passed?0:1);
}catch(error){console.error('Simulation could not run:',error?.stack??error);process.exit(2);}
