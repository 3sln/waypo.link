import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readHostedAsset} from '../branding.mjs';
import {assetHashes} from '../branding-assets.mjs';

test('hosted user/admin assets match the approved distinct service family and remain portable public responses',async()=>{
 for(const admin of [false,true]){const family='waypo-link'+(admin?'-admin':'');for(const [path,file,type]of [['/icon.svg',family+'-icon.svg','image/svg+xml'],['/icon-192.png',family+'-192.png','image/png'],['/icon-512.png',family+'-512.png','image/png'],['/maskable-512.png',family+'-maskable-512.png','image/png'],['/apple-touch-icon.png',family+'-180.png','image/png'],['/favicon.ico',family+'-favicon.ico','image/x-icon'],['/social-card.png','waypo-link-social.png','image/png'],['/wordmark.svg','waypo-link-wordmark.svg','image/svg+xml']]){const approved=await readFile(new URL('../node_modules/@3sln/waypo/brand/assets/'+file,import.meta.url)),response=readHostedAsset(path,admin,false),bytes=Buffer.from(await response.arrayBuffer());assert.equal(response.headers.get('content-type'),type);assert.deepEqual(bytes,approved);assert.equal(createHash('sha256').update(bytes).digest('hex'),assetHashes[file]);assert.equal((await readHostedAsset(path,admin,true).arrayBuffer()).byteLength,0);}
 const manifest=await readHostedAsset('/manifest.webmanifest',admin,false).json();assert.equal(manifest.theme_color,admin?'#403A60':'#174B3E');assert.equal(manifest.icons.find(row=>row.purpose==='maskable').src,'/maskable-512.png');}
 assert.notEqual(await readHostedAsset('/icon.svg',false,false).text(),await readHostedAsset('/icon.svg',true,false).text());assert.equal(readHostedAsset('/api/auth/get-session',false,false),null);
});
