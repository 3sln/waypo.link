// Deterministic "photos" for simulated people: small PNGs (a seeded sky gradient, sun and hills), encoded with zlib.
import {deflateSync} from 'node:zlib';
const crcTable=new Int32Array(256).map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c;});
const crc=bytes=>{let c=-1;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^-1)>>>0;};
const chunk=(type,data)=>{const out=Buffer.alloc(12+data.length);out.writeUInt32BE(data.length,0);out.write(type,4,'latin1');data.copy(out,8);out.writeUInt32BE(crc(out.subarray(4,8+data.length)),8+data.length);return out;};
export function landscapePng(random,{width=480,height=360}={}){
 const hue=random.next(),mix=(a,b,t)=>Math.round(a+(b-a)*t),top=[mix(60,240,hue),mix(120,200,random.next()),mix(160,250,random.next())],bottom=[250,mix(200,240,random.next()),mix(170,230,random.next())];
 const hill=[mix(40,120,random.next()),mix(80,150,random.next()),mix(60,110,random.next())],sun=[255,mix(170,230,random.next()),mix(90,160,random.next())],sx=width*(0.25+0.5*random.next()),sy=height*(0.2+0.2*random.next()),phase=random.next()*6;
 const rows=Buffer.alloc((width*3+1)*height);
 for(let y=0;y<height;y++){rows[y*(width*3+1)]=0;for(let x=0;x<width;x++){const t=y/height,ridge=height*(0.62-0.08*Math.sin(x/width*Math.PI*2+phase)),inSun=(x-sx)**2+(y-sy)**2<(height*0.08)**2;
  const c=y>ridge?hill:inSun?sun:top.map((v,i)=>mix(v,bottom[i],t));const o=y*(width*3+1)+1+x*3;rows[o]=c[0];rows[o+1]=c[1];rows[o+2]=c[2];}}
 const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows,{level:9})),chunk('IEND',Buffer.alloc(0))]);
}
