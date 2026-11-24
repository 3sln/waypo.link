// Server-only operation-scoped registry, not a cookie, bearer API or browser
// identity cache. Capture only after the maintained resolver verifies a Native
// owner; every use rechecks that exact SID inside the caller's transaction.
export function createFinancialOwnerProofs({issuer,authorizeOwnerInTransaction,clock=Date.now,random=()=>crypto.getRandomValues(new Uint8Array(32)),maxProofs=16,ttlMs=30000}){
 if(typeof issuer!=='string'||typeof authorizeOwnerInTransaction!=='function'||typeof clock!=='function'||typeof random!=='function'||!Number.isSafeInteger(maxProofs)||maxProofs<1||maxProofs>64||!Number.isSafeInteger(ttlMs)||ttlMs<1||ttlMs>30000)throw TypeError('Bounded transaction-local financial owner authority required');
 const origin=new URL(issuer).origin,records=new Map();let closed=false,last=0;
 const now=()=>{const at=clock();if(!Number.isSafeInteger(at)||at<last||at>Number.MAX_SAFE_INTEGER-ttlMs)throw Error('financial_owner_clock');last=at;return at;};
 const validOwner=owner=>owner&&Object.keys(owner).sort().join(',')==='issuer,sessionId,subject'&&owner.issuer===issuer&&typeof owner.subject==='string'&&owner.subject.length>0&&owner.subject.length<=256&&typeof owner.sessionId==='string'&&owner.sessionId.length>0&&owner.sessionId.length<=256;
 function live(hash,subject){if(closed)return null;const row=records.get(hash);if(!row||row.owner.subject!==subject||row.expiresAt<=now()||row.request.signal.aborted||new URL(row.request.url).origin!==origin)return null;const expected=row.request.headers.get('x-waypo-expected-user');return expected&&expected!==row.owner.subject?null:row;}
 return Object.freeze({
  async withOwner({request,owner},callback){
   if(closed||!(request instanceof Request)||new URL(request.url).origin!==origin||request.signal.aborted||!validOwner(owner)||typeof callback!=='function')throw Error('financial_owner_required');
   const at=now();for(const [id,row]of records)if(row.expiresAt<=at)records.delete(id);if(records.size>=maxProofs)throw Error('financial_owner_busy');
   const bytes=random();if(!(bytes instanceof Uint8Array)||bytes.length!==32)throw TypeError('Fresh private financial proof nonce required');const ownerProofHash=Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');if(records.has(ownerProofHash))throw Error('financial_owner_nonce_collision');
   const row={request,owner:Object.freeze({...owner}),expiresAt:at+ttlMs};records.set(ownerProofHash,row);
   try{return await callback(Object.freeze({ownerProofHash}));}finally{if(records.get(ownerProofHash)===row)records.delete(ownerProofHash);}
  },
  async authorizeInTransaction(tx,{subject,ownerProofHash}){
   const row=live(ownerProofHash,subject);if(!row)return false;
   const allowed=await authorizeOwnerInTransaction(tx,row.owner);return allowed===true&&live(ownerProofHash,subject)===row;
  },
  async authorizeDisclosure(tx,{subject,ownerProofHash,request,owner}){
   const row=live(ownerProofHash,subject);if(!row||row.request!==request||!validOwner(owner)||owner.sessionId!==row.owner.sessionId||owner.subject!==row.owner.subject)return false;
   const allowed=await authorizeOwnerInTransaction(tx,row.owner);return allowed===true&&live(ownerProofHash,subject)===row;
  },
  close(){closed=true;records.clear();}
 });
}
