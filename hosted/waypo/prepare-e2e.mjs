// Test setup uses the installed core package, never a named adjacent checkout.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const entry=new URL(import.meta.resolve('@3sln/waypo/node'));
const root=new URL('../../',entry);
const metadata=JSON.parse(await readFile(new URL('package.json',root),'utf8'));
if(metadata.name!=='@3sln/waypo')throw Error('Selected Waypo package required');
execFileSync(process.execPath,[fileURLToPath(new URL('apps/worker/build-assets.mjs',root))],{cwd:fileURLToPath(root),stdio:'inherit'});
