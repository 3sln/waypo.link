import { Provider } from '../shared/stack.mjs';
// Recovery file v3 (docs/3sln/accounts/recovery-file.md): the payload is an opaque credential checked by the provider,
// so the browser only validates its schema and that it belongs to the selected provider. No authority fetch.
async function validatePayload(payload,issuer){
 const core=await import('/packages/recovery/index.mjs');const result=core.validateRecoveryPayload(payload);
 if(result.issuer!==issuer)throw new Error('This recovery file belongs to another service.');
 return result;
}
export default class RecoveryFileProvider extends Provider {
 #workers=new Set();#operations=new Set();#disposed=false;
 async #run(operation){
  if(this.#disposed||this.#operations.size)throw new Error('Recovery operation is unavailable.');
  const controller=new AbortController();this.#operations.add(controller);
  try{const result=await operation(controller.signal);controller.signal.throwIfAborted();return result;}finally{this.#operations.delete(controller);}
 }
 async obtain(){return Object.freeze({
  inspect:async file=>{const text=await this.#read(file),core=await import('/packages/recovery/index.mjs');return {text,header:core.inspectRecoveryFile(text)};},
  encrypt:async(payload,questions,answers,issuer)=>this.#run(async signal=>{payload=await validatePayload(payload,issuer);signal.throwIfAborted();const core=await import('/packages/recovery/index.mjs');return core.encryptRecoveryFile(payload,questions,answers,{deriveKey:options=>this.#derive(options,signal),crypto:globalThis.crypto});}),
  decrypt:async(file,answers,issuer)=>this.#run(async signal=>{const core=await import('/packages/recovery/index.mjs');const result=await core.decryptRecoveryFile(file,answers,{deriveKey:options=>this.#derive(options,signal),crypto:globalThis.crypto});signal.throwIfAborted();return validatePayload(result,issuer);}),
  // The download acknowledgement: SHA-256 of the exact encrypted bytes, never decrypted. `input` is the text this
  // browser offered for download, or a File the owner picked again (read as bytes, bounded before reading).
  digest:async input=>{const core=await import('/packages/recovery/index.mjs');if(typeof input==='string')return core.recoveryFileDigest(input);if(!input||input.size>131072||typeof input.arrayBuffer!=='function')throw new Error('Choose an encrypted recovery file smaller than 128 KB.');return core.recoveryFileDigest(await input.arrayBuffer());},
  cancel:()=>this.#cancel()
 });}
 release(){}
 async #read(file){if(!file||file.size>131072||typeof file.text!=='function')throw new Error('Choose an encrypted recovery file smaller than 128 KB.');const text=await file.text();if(new TextEncoder().encode(text).length>131072)throw new Error('This encrypted recovery file is too large.');return text;}
 #derive(options,signal){signal?.throwIfAborted();if(this.#disposed)throw new Error('Recovery operation was closed.');if(this.#workers.size)throw new Error('A recovery operation is already running.');return new Promise((resolve,reject)=>{
  const worker=new Worker(import.meta.resolve('/recovery-kdf-worker.mjs'),{type:'module'});const record={worker,reject,timer:null};this.#workers.add(record);
  const stop=()=>{clearTimeout(record.timer);worker.terminate();this.#workers.delete(record);};
  record.timer=setTimeout(()=>{stop();reject(new Error('Recovery key derivation timed out. Try again on a device with more available memory.'));},90000);
  worker.onmessage=event=>{stop();if(event.data?.key instanceof Uint8Array&&event.data.key.length===32)resolve(event.data.key);else reject(new Error('Recovery key derivation could not be completed on this device.'));};
  worker.onerror=event=>{event.preventDefault();stop();reject(new Error('Recovery key derivation could not be completed on this device.'));};
  // Structured clone preserves the caller's buffer so the core can wipe it.
  worker.postMessage({options});
 });}
 #cancel(){for(const operation of this.#operations)operation.abort();for(const record of this.#workers){clearTimeout(record.timer);record.worker.terminate();record.reject(new Error('Recovery operation canceled.'));}this.#workers.clear();}
 dispose(){this.#disposed=true;this.#cancel();}
}
