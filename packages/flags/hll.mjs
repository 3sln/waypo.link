/** Daily, disposable HLL. Registers contain no hashes or identifiers. Hashes are
 * HMAC-SHA-256(dailyKey,owner), used transiently; never persist either input or
 * digest. Merge compatible registers by max, never by adding daily estimates.
 * Precision 12 gives about 1.63% relative standard error; thresholds are estimates.
 */
export const HLL_PRECISION=12;
export function createHll(p=HLL_PRECISION){if(!Number.isInteger(p)||p<4||p>16)throw new TypeError('Invalid HLL precision.');return {p,registers:Array(2**p).fill(0)};}
function check(h){if(!h||!Number.isInteger(h.p)||h.p<4||h.p>16||!Array.isArray(h.registers)||h.registers.length!==2**h.p||h.registers.some(n=>!Number.isInteger(n)||n<0||n>65-h.p))throw new TypeError('Invalid HLL sketch.');return h;}
export function addHll(h,digest){
 const bytes=new Uint8Array(digest);if(bytes.length<8)throw new TypeError('HLL needs a 64-bit digest.');let index=0;for(let bit=0;bit<h.p;bit++)index=index*2+(bytes[bit>>3]>>(7-(bit&7))&1);
 let rank=1;for(let bit=h.p;bit<64;bit++){if(bytes[bit>>3]>>(7-(bit&7))&1)break;rank++;}h.registers[index]=Math.max(h.registers[index],rank);return h;
}
export async function accountHll(h,dailyKey,owner){
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(dailyKey),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return addHll(h,await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(owner)));
}
export function mergeHll(sketches){
 if(!sketches.length)return createHll();const out=createHll(check(sketches[0]).p);
 for(const h of sketches){check(h);if(h.p!==out.p)throw new TypeError('HLL precision mismatch.');for(let i=0;i<out.registers.length;i++)out.registers[i]=Math.max(out.registers[i],h.registers[i]);}return out;
}
export function estimateHll(h){
 check(h);const m=h.registers.length,alpha=m===16?.673:m===32?.697:m===64?.709:.7213/(1+1.079/m),zeros=h.registers.filter(n=>n===0).length,raw=alpha*m*m/h.registers.reduce((n,r)=>n+2**-r,0);
 return raw<=2.5*m&&zeros?m*Math.log(m/zeros):raw;
}
