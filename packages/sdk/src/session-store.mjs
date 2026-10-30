// Persisted app sessions (ui-elements-audit W11; account-chooser-island §5.4), loaded on first use by BindleClient.
// A record holds one DPoP-bound app session of one client for exactly (issuer, subject): the non-extractable session
// key (a structured-cloned CryptoKey, never exported), the current rotating refresh token and the metadata the account
// list renders (granted profile and fragments). Access tokens are never persisted. Records live in the app origin's own
// IndexedDB (never localStorage, cookies or an island); script on the app origin can use the key but never read it, so
// a refresh token copied out of storage is unusable elsewhere (auth.md: browser persistence only when DPoP-bound).
//
// A store also serializes refresh-token rotation across documents (Web Locks; an in-document queue where the API is
// missing) and tells other documents of the same origin when records change (BroadcastChannel), so a sign-out in one
// tab signs the account out in every tab and two tabs never present the same refresh token.
//
// Store interface (also implemented by memorySessionStore for engine tests):
//   list(scope) → records · get(id) → record|null · put(id, record) · replace(id, record, expect) → boolean
//   remove(id, expect?) → removed record|null · clear(scope) → removed records · lock(name, signal, fn) → fn()
//   subscribe(listener) → unsubscribe · close()
// `expect` ({refreshToken?, jkt?}) makes a write conditional on the stored record, inside one transaction. An
// unconditional remove and every clear are explicit sign-outs: they are announced even when nothing was stored (site
// data cleared earlier), so the other documents still sign the account out.
export const SESSION_DB='bindle-sdk-sessions';
const STORE='sessions',VERSION=1,CHANNEL='bindle-sdk-sessions';

/** The record key: a client scope (storage key and callback) plus exactly (issuer, subject). */
export const recordId=(scope,issuer,subject)=>JSON.stringify([scope,issuer,subject]);
const scopeOf=id=>{try{return String(JSON.parse(id)[0]);}catch{return '';}};
export const matches=(record,expect={})=>!!record&&(expect.refreshToken===undefined||record.refreshToken===expect.refreshToken)&&(expect.jkt===undefined||record.key?.jkt===expect.jkt);

// Web Locks where available (Chromium 69+, Firefox 96+, Safari 15.4+); otherwise one queue per name in this document.
function lockRunner(locks){
  const queues=new Map();
  return (name,signal,fn)=>{
    if(typeof locks?.request==='function')return locks.request(name,{mode:'exclusive',...signal?{signal}:{}},()=>fn());
    const previous=queues.get(name)??Promise.resolve(),run=previous.then(()=>{if(signal?.aborted)throw signal.reason??new DOMException('The operation was canceled.','AbortError');return fn();});
    const tail=run.catch(()=>{});queues.set(name,tail);tail.then(()=>{if(queues.get(name)===tail)queues.delete(name);});
    return run;
  };
}
const validMessage=data=>!!data&&typeof data==='object'&&data.v===1&&['put','delete','clear'].includes(data.op)&&typeof data.scope==='string'&&(data.op==='clear'||typeof data.id==='string');

/**
 * The browser store: one IndexedDB database on the app origin. Every call opens, runs one transaction and closes, so
 * no connection outlives it (a Clear-Site-Data or "clear site data" deletion is never blocked). Returns null where
 * IndexedDB does not exist; calls reject where it exists but is unusable (some private modes), and the client then
 * keeps sessions in memory only.
 */
export function indexedDBSessionStore({indexedDB=globalThis.indexedDB,locks=globalThis.navigator?.locks,BroadcastChannel:Channel=globalThis.BroadcastChannel,name=SESSION_DB}={}){
  if(!indexedDB)return null;
  const open=()=>new Promise((resolve,reject)=>{
    let request;try{request=indexedDB.open(name,VERSION);}catch(error){reject(error);return;}
    request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE);};
    request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();resolve(db);};
    request.onerror=()=>reject(request.error??new Error('Session storage is unavailable.'));
    request.onblocked=()=>reject(new Error('Session storage is blocked.'));
  });
  const transact=(mode,body)=>open().then(db=>new Promise((resolve,reject)=>{
    let out,tx;try{tx=db.transaction(STORE,mode);}catch(error){db.close();reject(error);return;}
    tx.oncomplete=()=>{db.close();resolve(out);};
    tx.onerror=tx.onabort=()=>{db.close();reject(tx.error??new Error('Session storage failed.'));};
    try{body(tx.objectStore(STORE),value=>{out=value;});}catch(error){try{tx.abort();}catch{}db.close();reject(error);}
  }));
  let channel=null;const listeners=new Set();
  const bus=()=>{if(!channel&&typeof Channel==='function'){try{channel=new Channel(CHANNEL);channel.onmessage=event=>{if(validMessage(event.data))for(const listener of [...listeners])try{listener(event.data);}catch{}};}catch{channel=null;}}return channel;};
  const announce=message=>{try{bus()?.postMessage({v:1,...message});}catch{}};
  const lock=lockRunner(locks);
  return {
    kind:'indexeddb',
    list:scope=>transact('readonly',(objects,done)=>{const request=objects.getAll();request.onsuccess=()=>done((request.result??[]).filter(record=>record?.scope===scope));}),
    get:id=>transact('readonly',(objects,done)=>{const request=objects.get(id);request.onsuccess=()=>done(request.result??null);}),
    put:async(id,record)=>{await transact('readwrite',objects=>{objects.put(record,id);});announce({op:'put',id,scope:record.scope});},
    replace:async(id,record,expect)=>{const ok=await transact('readwrite',(objects,done)=>{const request=objects.get(id);request.onsuccess=()=>{if(matches(request.result,expect)){objects.put(record,id);done(true);}else done(false);};});if(ok)announce({op:'put',id,scope:record.scope});return !!ok;},
    remove:async(id,expect)=>{const removed=await transact('readwrite',(objects,done)=>{const request=objects.get(id);request.onsuccess=()=>{const value=request.result;if(value&&(!expect||matches(value,expect))){objects.delete(id);done(value);}else done(null);};});if(removed||!expect)announce({op:'delete',id,scope:removed?.scope??scopeOf(id)});return removed??null;},
    clear:async scope=>{const removed=await transact('readwrite',(objects,done)=>{const out=[];done(out);const request=objects.openCursor();request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;if(cursor.value?.scope===scope){out.push(cursor.value);cursor.delete();}cursor.continue();};});announce({op:'clear',scope});return removed??[];},
    lock,
    subscribe(listener){listeners.add(listener);bus();return ()=>listeners.delete(listener);},
    close(){listeners.clear();try{channel?.close();}catch{}channel=null;},
  };
}

/**
 * In-memory backend shared by several "documents" (tabs) in engine tests and simulations: records, a cross-document
 * lock (like Web Locks) and an asynchronous bus. `wipe()` models clearing site data; `failing` makes the named
 * operations reject (storage that became unusable). Never used by production code.
 */
export function memorySessionBackend({locks=true}={}){
  const records=new Map(),handles=new Set(),failing=new Set(),log=[];
  const lock=lockRunner(null);
  return {records,failing,log,locks,
    handle(){
      const self={listeners:new Set()};handles.add(self);
      const check=op=>{log.push(op);if(failing.has(op)||failing.has('*'))throw new Error(`Session storage failed (${op}).`);};
      const announce=message=>{for(const other of handles)if(other!==self)for(const listener of [...other.listeners])setTimeout(()=>{try{listener({v:1,...message});}catch{}},0);};
      const copy=value=>value?{...value}:null;
      return {
        kind:'memory',
        list:async scope=>{check('list');return [...records.values()].filter(record=>record.scope===scope).map(copy);},
        get:async id=>{check('get');return copy(records.get(id));},
        put:async(id,record)=>{check('put');records.set(id,{...record});announce({op:'put',id,scope:record.scope});},
        replace:async(id,record,expect)=>{check('replace');if(!matches(records.get(id),expect))return false;records.set(id,{...record});announce({op:'put',id,scope:record.scope});return true;},
        remove:async(id,expect)=>{check('remove');const value=records.get(id);if(!value||expect&&!matches(value,expect)){if(!expect)announce({op:'delete',id,scope:scopeOf(id)});return null;}records.delete(id);announce({op:'delete',id,scope:value.scope});return copy(value);},
        clear:async scope=>{check('clear');const out=[];for(const [id,value] of records)if(value.scope===scope){out.push(copy(value));records.delete(id);}announce({op:'clear',scope});return out;},
        // Without cross-document locks each document only queues its own refreshes (a browser without Web Locks).
        lock:locks?lock:lockRunner(null),
        subscribe(listener){self.listeners.add(listener);return ()=>self.listeners.delete(listener);},
        close(){self.listeners.clear();handles.delete(self);},
      };
    },
    wipe(){records.clear();},
  };
}
