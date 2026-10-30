// The public Explore collection: a fixed set of landscape studies drawn as SVG (no image corpus, no network).
const WORKS=[
 {id:'harbor-dawn',title:'Harbor at dawn',by:'Inês Carvalho',place:'Porto',sky:['#f6c9a8','#f3e2c7'],sun:'#f7a35c',hills:['#5d7f8f','#3e5c6b'],sea:'#7aa7b8',sunY:0.42},
 {id:'fjord-noon',title:'Fjord at noon',by:'Magnus Aas',place:'Geiranger',sky:['#9cc7e6','#e3f1f8'],sun:'#fff3c4',hills:['#3d6a5a','#28493e'],sea:'#3f7e8c',sunY:0.22},
 {id:'desert-dusk',title:'Desert dusk',by:'Salma Idrissi',place:'Merzouga',sky:['#e97a5b','#f9c784'],sun:'#fde3a7',hills:['#c46a3c','#8f4528'],sea:null,sunY:0.55},
 {id:'lake-mist',title:'Lake in the mist',by:'Aino Virtanen',place:'Saimaa',sky:['#cfd8dc','#eef2f3'],sun:'#f5f5f0',hills:['#7d8f8a','#5c6e69'],sea:'#a9bcc0',sunY:0.35},
 {id:'terraces',title:'Rice terraces',by:'Linh Tran',place:'Mù Cang Chải',sky:['#bfe0c9','#f1f7e9'],sun:'#fff7cc',hills:['#6f9e4f','#4a7a33'],sea:null,sunY:0.25},
 {id:'night-coast',title:'Night coast',by:'Tomás Rivera',place:'Cabo de Gata',sky:['#1d2b4c','#3c4f7a'],sun:'#e8e4d0',hills:['#18233b','#0f1828'],sea:'#2c3e63',sunY:0.3},
 {id:'autumn-ridge',title:'Autumn ridge',by:'Hana Kobayashi',place:'Nikkō',sky:['#f2d0a4','#fbecd5'],sun:'#f6b26b',hills:['#b5532b','#7e3a20'],sea:null,sunY:0.38},
 {id:'glacier',title:'Glacier light',by:'Sigrún Jónsdóttir',place:'Vatnajökull',sky:['#bcd7e8','#f0f6fa'],sun:'#ffffff',hills:['#8fb1c4','#5f8399'],sea:'#d6e6ee',sunY:0.2},
 {id:'olive-grove',title:'Olive grove',by:'Giorgos Pappas',place:'Crete',sky:['#f1dcae','#faf1db'],sun:'#f4c26b',hills:['#7c8a4d','#55623a'],sea:null,sunY:0.33}
];
export const PUBLIC_WORKS=WORKS.map(({id,title,by,place})=>({id,title,by,place}));
export function artSvg(id,{width=800,height=600}={}){
 const w=WORKS.find(x=>x.id===id)??WORKS[0],H=height,W=width,horizon=H*0.62;
 const ridge=(base,amp,seed)=>{let d=`M0 ${H} L0 ${base}`;for(let x=0;x<=W;x+=W/8){const y=base-amp*(0.5+0.5*Math.sin((x/W)*Math.PI*2+seed));d+=` L${x.toFixed(0)} ${y.toFixed(0)}`;}return d+` L${W} ${H} Z`;};
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${w.sky[0]}"/><stop offset="1" stop-color="${w.sky[1]}"/></linearGradient></defs>`+
  `<rect width="${W}" height="${H}" fill="url(#s)"/><circle cx="${W*0.68}" cy="${H*w.sunY}" r="${H*0.09}" fill="${w.sun}" opacity="0.95"/>`+
  `<path d="${ridge(horizon-H*0.1,H*0.16,1.3)}" fill="${w.hills[0]}" opacity="0.85"/><path d="${ridge(horizon,H*0.12,4.1)}" fill="${w.hills[1]}"/>`+
  (w.sea?`<rect y="${horizon+H*0.06}" width="${W}" height="${H}" fill="${w.sea}"/><rect y="${horizon+H*0.06}" width="${W}" height="2" fill="#ffffff" opacity="0.35"/>`:'')+`</svg>`;
}
export const artUrl=(id,size)=>'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(artSvg(id,size));
