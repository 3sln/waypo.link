// Byte-level IP literal parser and non-public address classifier, shared by the classifier fetch guard
// (item-classification/v1 §5.2 rule 2, re-exported from packages/sdk/src/item-classification-fetch.mjs) and signaling
// candidate screening (docs/spec/extensions/signaling.md §16.4). Pure, no I/O, imports nothing. Provisional, unsigned.
/** Parses a dotted-quad IPv4 literal (four decimal octets, no leading zeros) to 4 bytes, or null. */
export function parseIPv4(text){
 const parts=String(text).split('.');if(parts.length!==4)return null;
 const bytes=parts.map(p=>/^(0|[1-9]\d{0,2})$/.test(p)?Number(p):256);
 return bytes.every(b=>b<=255)?Uint8Array.from(bytes):null;
}
/**
 * Parses an IPv6 literal (RFC 4291 §2.2 text forms: compressed `::`, uncompressed, leading zeros, a dotted IPv4 tail,
 * optional surrounding brackets) to 16 bytes, or null. A zone identifier (`%eth0`) is refused: it names a local link.
 */
export function parseIPv6(text){
 let s=String(text);if(s.startsWith('[')&&s.endsWith(']'))s=s.slice(1,-1);
 if(!s.includes(':')||s.includes('%')||!/^[0-9A-Fa-f:.]+$/.test(s))return null;
 // A dotted IPv4 tail becomes its two 16-bit groups.
 const lastColon=s.lastIndexOf(':'),last=s.slice(lastColon+1);
 if(last.includes('.')){const v4=parseIPv4(last);if(!v4)return null;s=s.slice(0,lastColon+1)+((v4[0]<<8|v4[1]).toString(16))+':'+((v4[2]<<8|v4[3]).toString(16));}
 const halves=s.split('::');if(halves.length>2)return null;
 const group=g=>/^[0-9A-Fa-f]{1,4}$/.test(g)?parseInt(g,16):NaN;
 const side=h=>h===''?[]:h.split(':').map(group);
 let groups;
 if(halves.length===2){
  const head=side(halves[0]),rest=side(halves[1]),fill=8-head.length-rest.length;
  if(fill<1)return null;groups=[...head,...Array(fill).fill(0),...rest];
 }else groups=s.split(':').map(group);
 if(groups.length!==8||groups.some(g=>!Number.isInteger(g)))return null;
 const out=new Uint8Array(16);groups.forEach((g,i)=>{out[2*i]=g>>8;out[2*i+1]=g&255;});return out;
}
/** Parses an IPv4 or IPv6 literal to its bytes (4 or 16), or null. */
export function parseAddress(text){return parseIPv4(text)??parseIPv6(text);}

const prefix=(bytes,pattern,bits)=>{for(let i=0;i<bits;i++){const bit=7-i%8;if((bytes[i>>3]>>bit&1)!==(pattern[i>>3]>>bit&1))return false;}return true;};
// IPv4 special-purpose and non-global space (IANA IPv4 Special-Purpose Address Registry, RFC 6890 and successors).
const V4_BLOCKED=[[[0,0,0,0],8],[[10,0,0,0],8],[[100,64,0,0],10],[[127,0,0,0],8],[[169,254,0,0],16],[[172,16,0,0],12],[[192,0,0,0],24],[[192,0,2,0],24],[[192,88,99,0],24],[[192,168,0,0],16],[[198,18,0,0],15],[[198,51,100,0],24],[[203,0,113,0],24],[[224,0,0,0],4],[[240,0,0,0],4]];
const v6=(...groups)=>{const b=new Uint8Array(16);groups.forEach((g,i)=>{b[2*i]=g>>8;b[2*i+1]=g&255;});return b;};
// IPv6 non-global space (IANA IPv6 Special-Purpose Address Registry). Embedded-IPv4 forms are unwrapped separately.
const V6_BLOCKED=[[v6(),128],[v6(0,0,0,0,0,0,0,1),128],[v6(0x0100),64],[v6(0x2001),23],[v6(0x2001,0x0db8),32],[v6(0x3fff),20],[v6(0x5f00),16],[v6(0xfc00),7],[v6(0xfe80),10],[v6(0xfec0),10],[v6(0xff00),8],[v6(0x64,0xff9b,1),48]];
const v4Blocked=b=>V4_BLOCKED.some(([p,bits])=>prefix(b,p,bits));
/** The IPv4 address an IPv6 address carries, for the forms that route to it: IPv4-mapped ::ffff:0:0/96, NAT64 64:ff9b::/96 and 6to4 2002::/16. Null otherwise. */
function embeddedIPv4(b){
 if(b.slice(0,10).every(x=>x===0)&&b[10]===0xff&&b[11]===0xff)return b.slice(12);
 if(prefix(b,v6(0x64,0xff9b),96))return b.slice(12);
 if(b[0]===0x20&&b[1]===0x02)return b.slice(2,6);
 return null;
}
/**
 * True for an address a classifier must never fetch from (§5.2 rule 2): anything that is not a parseable IP literal,
 * and every loopback, private, link-local, shared (CGNAT), multicast, reserved, documentation or other special-purpose
 * address, in any valid spelling. IPv6 forms that embed an IPv4 address are judged by that address as well.
 */
export function nonPublicAddress(address){
 const b=parseAddress(address);if(!b)return true;
 if(b.length===4)return v4Blocked(b);
 if(V6_BLOCKED.some(([p,bits])=>prefix(b,p,bits)))return true;
 // The deprecated IPv4-compatible block ::/96 is never fetched from; mapped, NAT64 and 6to4 addresses are judged by the
 // IPv4 address they carry.
 if(b.slice(0,12).every(x=>x===0))return true;
 const inner=embeddedIPv4(b);
 return inner?v4Blocked(inner):false;
}
