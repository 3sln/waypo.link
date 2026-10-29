// Shared byte-level IP literal parser and non-public classifier (packages/core/ip-address.mjs), used by signaling
// candidate screening and, re-exported by the SDK, the classifier fetch guard.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAddress,nonPublicAddress} from '../packages/core/ip-address.mjs';
import * as sdk from '../packages/sdk/src/item-classification-fetch.mjs';
import {nonPublicAddress as signalingNonPublic} from '../packages/signaling/messages.mjs';

const NON_PUBLIC=[
 '0.0.0.0','10.1.2.3','100.64.0.1','127.0.0.1','169.254.1.1','172.16.0.1','192.0.0.1','192.168.1.1','198.18.0.1','224.0.0.1','240.0.0.1','255.255.255.255',
 '192.0.2.1','198.51.100.1','203.0.113.7','2001:db8::1','2001:0DB8:ffff::1',
 '::','::1','0:0:0:0:0:0:0:1','[::1]','::ffff:127.0.0.1','::ffff:7f00:1','::FFFF:10.0.0.1','::127.0.0.1','::a00:1','::ffff:203.0.113.7','::ffff:192.0.2.1',
 '64:ff9b::7f00:1','64:ff9b::10.0.0.1','64:ff9b::c000:201','2002:7f00:1::','2002:a00:1::1','2002:c0a8:101::','2002:cb00:7107::',
 'fc00::1','fd12::1','fe80::1','fec0::1','ff02::1',
 '','abc.local','objects.example','1.2.3','01.2.3.4','256.1.1.1','fe80::1%en0','1::2::3','::ffff:1.2.3',null,undefined,42,{},
];
const PUBLIC=['8.8.8.8','93.184.216.34','100.63.255.255','172.32.0.1','223.255.255.255','2606:4700::1111','2a00:1450:4001:80b::200e','::ffff:8.8.8.8','::ffff:808:808','64:ff9b::8.8.8.8','2002:808:808::1'];
test('non-public classification: table over ranges, spellings and non-literals',()=>{
 for(const a of NON_PUBLIC)assert.equal(nonPublicAddress(a),true,`non-public: ${JSON.stringify(a)}`);
 for(const a of PUBLIC)assert.equal(nonPublicAddress(a),false,`public: ${a}`);
});
test('one implementation: the SDK re-export and signaling agree with the shared module',()=>{
 assert.equal(sdk.nonPublicAddress,nonPublicAddress);assert.equal(signalingNonPublic,nonPublicAddress);assert.equal(sdk.parseAddress,parseAddress);
 for(const a of [...NON_PUBLIC,...PUBLIC])assert.equal(signalingNonPublic(a),nonPublicAddress(a));
});
test('parsing yields bytes; equivalent spellings agree',()=>{
 assert.deepEqual([...parseAddress('::ffff:127.0.0.1')],[...parseAddress('::ffff:7f00:1')]);
 assert.deepEqual([...parseAddress('8.8.4.4')],[8,8,4,4]);
});
