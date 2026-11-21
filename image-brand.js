'use strict';
/* Brand kits and finished-picture export for Image Studio (Image Level 4, 21 Nov 2026, branch image-l5-native).
   - A brand kit holds colours, words to use, words to avoid and a logo (a picture already in Studio) with its place
     and size. While a kit is on, new pictures carry its colours and words, and the logo is placed on published and
     downloaded pictures. Kits are kept in this browser (localStorage), shared by every story.
   - place(): draws the logo onto a picture in a canvas and returns PNG bytes.
   - pngText(): writes prompt, model, seed and credit into a PNG's text chunks so a downloaded file says how it was made. */
(function(root){
 const KEY='ecco-brand-kits',POSITIONS=['Bottom right','Bottom left','Top right','Top left'],SIZES={Small:.12,Medium:.18,Large:.26};
 const HEX=/^#[0-9a-f]{6}$/i;
 const clean=k=>({id:String(k.id||('kit-'+Date.now().toString(36))),name:String(k.name||'Brand kit').slice(0,60),
  colors:(Array.isArray(k.colors)?k.colors:[]).filter(c=>HEX.test(c)).slice(0,5),
  use:String(k.use||'').slice(0,300),avoid:String(k.avoid||'').slice(0,300),
  logo:String(k.logo||''),position:POSITIONS.includes(k.position)?k.position:'Bottom right',size:SIZES[k.size]?k.size:'Medium'});
 function read(){let v;try{v=JSON.parse(root.localStorage?.getItem(KEY)||'null');}catch{v=null;}return v&&Array.isArray(v.kits)?{kits:v.kits.map(clean),active:v.active||''}:{kits:[],active:''};}
 function write(v){try{root.localStorage?.setItem(KEY,JSON.stringify(v));}catch{}return v;}
 const kits=()=>read().kits;
 const active=()=>{const v=read();return v.kits.find(k=>k.id===v.active)||null;};
 function save(kit){const v=read(),k=clean(kit),i=v.kits.findIndex(x=>x.id===k.id);if(i>=0)v.kits[i]=k;else v.kits.push(k);write(v);return k;}
 function use(id){const v=read();v.active=v.kits.some(k=>k.id===id)?id:'';write(v);return active();}
 function remove(id){const v=read();v.kits=v.kits.filter(k=>k.id!==id);if(v.active===id)v.active='';write(v);}
 // Words added to a new picture's prompt and negative prompt.
 function prompt(text,kit){
  if(!kit)return text;const parts=[];
  if(kit.colors.length)parts.push('Brand colours: '+kit.colors.join(', ')+'; use them as the main colours.');
  if(kit.use.trim())parts.push('Brand look: '+kit.use.trim()+'.');
  return parts.length?String(text).trim()+'\n'+parts.join(' '):text;
 }
 const negative=(text,kit)=>kit&&kit.avoid.trim()?[String(text||'').trim(),kit.avoid.trim()].filter(Boolean).join(', '):text;
 /* ---------- picture with logo ---------- */
 function load(blob){return new Promise((resolve,reject)=>{const url=URL.createObjectURL(blob),im=new Image();im.onload=()=>{resolve(im);setTimeout(()=>URL.revokeObjectURL(url),1000);};im.onerror=()=>{URL.revokeObjectURL(url);reject(Error('A picture could not be read.'));};im.src=url;});}
 // Where the logo goes: a share of the picture's width, inset by 3% from the chosen corner.
 function box(w,h,lw,lh,position,size){
  const width=Math.round(w*(SIZES[size]||SIZES.Medium)),height=Math.round(width*lh/Math.max(1,lw)),pad=Math.round(Math.min(w,h)*.03);
  const x=/right/i.test(position)?w-width-pad:pad,y=/bottom/i.test(position)?h-height-pad:pad;return {x,y,width,height};
 }
 async function place(pictureBlob,logoBlob,kit){
  const [pic,logo]=await Promise.all([load(pictureBlob),load(logoBlob)]);
  const w=pic.naturalWidth||pic.width,h=pic.naturalHeight||pic.height,c=document.createElement('canvas');c.width=w;c.height=h;
  const x=c.getContext('2d');x.drawImage(pic,0,0,w,h);const b=box(w,h,logo.naturalWidth||logo.width,logo.naturalHeight||logo.height,kit.position,kit.size);x.drawImage(logo,b.x,b.y,b.width,b.height);
  const out=await new Promise(r=>c.toBlob(r,'image/png'));return new Uint8Array(await out.arrayBuffer());
 }
 /* ---------- PNG text chunks ---------- */
 const TABLE=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
 const crc=bytes=>{let c=0xFFFFFFFF;for(const b of bytes)c=TABLE[(c^b)&0xFF]^(c>>>8);return (c^0xFFFFFFFF)>>>0;};
 const isPNG=b=>b&&b.length>8&&b[0]===0x89&&b[1]===0x50&&b[2]===0x4E&&b[3]===0x47;
 // iTXt keeps UTF-8 text (prompts can hold any language). Inserted just before IEND.
 function pngText(bytes,entries){
  if(!isPNG(bytes))return bytes;
  const enc=new TextEncoder(),chunks=[];
  for(const [k,v] of Object.entries(entries||{})){
   if(v==null||v==='')continue;const keyword=enc.encode(String(k).replace(/[^\x20-\x7e]/g,'').slice(0,79)),text=enc.encode(String(v).slice(0,20000));
   const data=new Uint8Array(keyword.length+5+text.length);data.set(keyword,0);data.set(text,keyword.length+5);
   const type=enc.encode('iTXt'),out=new Uint8Array(12+data.length),view=new DataView(out.buffer);
   view.setUint32(0,data.length);out.set(type,4);out.set(data,8);const body=new Uint8Array(4+data.length);body.set(type,0);body.set(data,4);view.setUint32(8+data.length,crc(body));chunks.push(out);
  }
  let end=bytes.length-12;
  for(let i=8;i<bytes.length-8;){const len=new DataView(bytes.buffer,bytes.byteOffset+i,4).getUint32(0);const t=String.fromCharCode(...bytes.subarray(i+4,i+8));if(t==='IEND'){end=i;break;}i+=12+len;}
  const extra=chunks.reduce((s,c)=>s+c.length,0),out=new Uint8Array(bytes.length+extra);out.set(bytes.subarray(0,end),0);let at=end;for(const c of chunks){out.set(c,at);at+=c.length;}out.set(bytes.subarray(end),at);return out;
 }
 function readText(bytes){
  const out={};if(!isPNG(bytes))return out;const dec=new TextDecoder();
  for(let i=8;i<bytes.length-8;){const len=new DataView(bytes.buffer,bytes.byteOffset+i,4).getUint32(0),t=String.fromCharCode(...bytes.subarray(i+4,i+8));
   if(t==='iTXt'){const d=bytes.subarray(i+8,i+8+len),z=d.indexOf(0);out[dec.decode(d.subarray(0,z))]=dec.decode(d.subarray(z+5));}
   if(t==='IEND')break;i+=12+len;}
  return out;
 }
 const api={POSITIONS,SIZES:Object.keys(SIZES),kits,active,save,use,remove,prompt,negative,box,place,pngText,readText,clean};
 if(typeof module==='object'&&module.exports)module.exports=api;
 root.EccoImageBrand=api;
})(typeof window!=='undefined'?window:globalThis);
