import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeIntent} from '../packages/intents/format.mjs';

const b64=s=>Buffer.from(s).toString('base64url');
const payload={bintent:1,kind:{artefact:'https://spec.bindle.example/intents/test/v1',version:1,digest:'sha256-'+'A'.repeat(43)},data:{},iat:1,minter:{iss:'https://issuer.example',sub:'123e4567-e89b-42d3-a456-426614174000'}};
const signed=kid=>b64(JSON.stringify({alg:'ES256',kid,typ:'bindle-intent+jwt'}))+'.'+b64(JSON.stringify(payload))+'.'+Buffer.alloc(64).toString('base64url');

test('a signed intent header kid with a control character is malformed (links §3.1 header syntax)',()=>{
 for(const kid of ['bad\nkey','tab\tkid','nul\u0000','del\u007f'])assert.throws(()=>decodeIntent(signed(kid)),e=>e?.code==='intent_malformed'||/malformed/.test(e?.code??e?.message??''),JSON.stringify(kid));
 assert.doesNotThrow(()=>decodeIntent(signed('good-key')));
});
