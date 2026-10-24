const bytes=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const encode=value=>btoa(String.fromCharCode(...value));
async function key(secret){if(typeof secret!=='string'||bytes(secret).length!==32)throw new Error('Credential encryption key is not configured');return crypto.subtle.importKey('raw',bytes(secret),'AES-GCM',false,['encrypt','decrypt']);}
// ORG-12d review L6: an optional `purpose` becomes the AES-GCM additional data, so a record sealed for one purpose (for
// example `operator-signer/<kid>`) never opens as another. Without it the AAD stays '3sln.me/credentials/v1', so every
// existing credential record is unchanged.
const aad=purpose=>new TextEncoder().encode(purpose===undefined?'3sln.me/credentials/v1':'3sln.me/purpose/v1/'+String(purpose));
export async function encryptSecret(value,secret,purpose){const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(purpose)},await key(secret),new TextEncoder().encode(JSON.stringify(value)));return {version:1,iv:encode(iv),ciphertext:encode(new Uint8Array(encrypted))};}
export async function decryptSecret(value,secret,purpose){if(value?.version!==1)throw new Error('Unknown credential record');const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(value.iv),additionalData:aad(purpose)},await key(secret),bytes(value.ciphertext));return JSON.parse(new TextDecoder().decode(clear));}
