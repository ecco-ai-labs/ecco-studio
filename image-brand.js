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
 // Fonts people have on every computer, plus one uploaded font per kit (kept with the kit, up to 600 KB).
 const FONTS={'Clean sans':'system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif','Classic serif':'Georgia, "Times New Roman", serif','Bold condensed':'Impact, "Arial Narrow Bold", "Helvetica Neue", sans-serif','Typewriter':'"Courier New", Courier, monospace','Rounded':'"Trebuchet MS", "Verdana", sans-serif'};
 const TEXT_PLACES=['Bottom','Top','Middle'],FONT_LIMIT=600*1024;
 const clean=k=>({id:String(k.id||('kit-'+Date.now().toString(36))),name:String(k.name||'Brand kit').slice(0,60),
  colors:(Array.isArray(k.colors)?k.colors:[]).filter(c=>HEX.test(c)).slice(0,5),
  use:String(k.use||'').slice(0,300),avoid:String(k.avoid||'').slice(0,300),
  logo:String(k.logo||''),position:POSITIONS.includes(k.position)?k.position:'Bottom right',size:SIZES[k.size]?k.size:'Medium',
  font:FONTS[k.font]||k.font==='Uploaded'&&k.fontData?k.font:'Clean sans',fontName:String(k.fontName||'').slice(0,80),fontData:typeof k.fontData==='string'&&k.fontData.length<=FONT_LIMIT*1.4?k.fontData:'',
  textColor:HEX.test(k.textColor)?k.textColor:'#ffffff',band:k.band!==false});
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
 // The logo alone on a clear picture of the same size: a layer that design tools can stack over the original.
 async function layer(pictureBlob,logoBlob,kit){
  const [pic,logo]=await Promise.all([load(pictureBlob),load(logoBlob)]);
  const w=pic.naturalWidth||pic.width,h=pic.naturalHeight||pic.height,c=document.createElement('canvas');c.width=w;c.height=h;
  const b=box(w,h,logo.naturalWidth||logo.width,logo.naturalHeight||logo.height,kit.position,kit.size);c.getContext('2d').drawImage(logo,b.x,b.y,b.width,b.height);
  const out=await new Promise(r=>c.toBlob(r,'image/png'));return new Uint8Array(await out.arrayBuffer());
 }
 /* ---------- brand font and words on the picture (IMG-4.1, IMG-4.2) ---------- */
 const loaded=new Map();
 // The family name to draw with. An uploaded font is registered once per browser session.
 async function font(kit){
  if(!kit)return FONTS['Clean sans'];
  if(kit.font!=='Uploaded'||!kit.fontData)return FONTS[kit.font]||FONTS['Clean sans'];
  const family='EccoBrand-'+crc(new TextEncoder().encode(kit.fontData.slice(0,4096)+kit.fontData.length)).toString(16);
  if(!loaded.has(family)){
   loaded.set(family,(async()=>{const bin=Uint8Array.from(atob(kit.fontData),c=>c.charCodeAt(0));const f=new FontFace(family,bin.buffer);await f.load();document.fonts.add(f);})().catch(()=>{loaded.delete(family);}));
  }
  await loaded.get(family);return '"'+family+'", '+FONTS['Clean sans'];
 }
 function wrap(ctx,text,width){const words=String(text).trim().split(/\s+/),lines=[];let line='';for(const w of words){const t=line?line+' '+w:w;if(line&&ctx.measureText(t).width>width){lines.push(line);line=w;}else line=t;}if(line)lines.push(line);return lines;}
 // Headline (up to 2 lines, shrunk to fit) and price, on a soft band for contrast, at the top, middle or bottom.
 function drawText(ctx,w,h,text,kit,family){
  const headline=String(text?.headline||'').trim(),price=String(text?.price||'').trim();if(!headline&&!price)return false;
  // Ad-sized words: start near 6% of the width and shrink until the headline fits in 2 lines and the block in a third of the height.
  const place=TEXT_PLACES.includes(text.place)?text.place:'Bottom',maxW=w*.88,height=(n,sz)=>n*sz*1.15+(price?sz*.8*1.2+(n?sz*.25:0):0);let size=Math.round(Math.min(w*.06,h*.12)),lines=[];
  for(;size>10;size=Math.round(size*.92)){ctx.font='700 '+size+'px '+family;lines=headline?wrap(ctx,headline,maxW):[];if(lines.length<=2&&lines.every(l=>ctx.measureText(l).width<=maxW)&&height(lines.length,size)<=h*.3)break;}
  const ps=Math.round(size*.8),gap=Math.round(size*.25),blockH=height(lines.length,size),pad=Math.round(Math.min(w,h)*.04);
  const top=place==='Top'?pad*1.5:place==='Middle'?(h-blockH)/2:h-blockH-pad*1.5;
  if(kit?.band!==false){ctx.fillStyle='rgba(0,0,0,0.45)';ctx.fillRect(0,top-pad,w,blockH+pad*2);}
  ctx.fillStyle=kit?.textColor||'#ffffff';ctx.textAlign='center';ctx.textBaseline='top';
  let y=top;ctx.font='700 '+size+'px '+family;for(const l of lines){ctx.fillText(l,w/2,y);y+=size*1.15;}
  if(price){y+=lines.length?gap:0;ctx.font='800 '+ps+'px '+family;ctx.fillText(price,w/2,y);}
  return true;
 }
 // Every layer of a finished picture, each a canvas of the picture's size: picture, logo (or null), words (or null).
 async function layers(pictureBlob,{kit=null,logoBlob=null,text=null}={}){
  const pic=await load(pictureBlob),w=pic.naturalWidth||pic.width,h=pic.naturalHeight||pic.height;
  const canvas=()=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
  const picture=canvas();picture.getContext('2d').drawImage(pic,0,0,w,h);
  let logo=null;
  if(kit&&logoBlob){const im=await load(logoBlob);logo=canvas();const b=box(w,h,im.naturalWidth||im.width,im.naturalHeight||im.height,kit.position,kit.size);logo.getContext('2d').drawImage(im,b.x,b.y,b.width,b.height);}
  let words=null;
  if(text&&(String(text.headline||'').trim()||String(text.price||'').trim())){const c=canvas();if(drawText(c.getContext('2d'),w,h,text,kit,await font(kit)))words=c;}
  return {width:w,height:h,picture,logo,words};
 }
 function flatten(l){const c=document.createElement('canvas');c.width=l.width;c.height=l.height;const x=c.getContext('2d');for(const k of ['picture','words','logo'])if(l[k])x.drawImage(l[k],0,0);return c;}
 async function pngOf(canvas){const out=await new Promise(r=>canvas.toBlob(r,'image/png'));return new Uint8Array(await out.arrayBuffer());}
 const rgba=canvas=>canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
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
 // Print size: pHYs (pixels per metre) right after IHDR, replacing any there.
 function pngDpi(bytes,dpi){
  if(!isPNG(bytes))return bytes;const ppm=Math.round(dpi/0.0254),enc=new TextEncoder(),data=new Uint8Array(9),v=new DataView(data.buffer);v.setUint32(0,ppm);v.setUint32(4,ppm);data[8]=1;
  const type=enc.encode('pHYs'),chunk=new Uint8Array(21),cv=new DataView(chunk.buffer);cv.setUint32(0,9);chunk.set(type,4);chunk.set(data,8);const body=new Uint8Array(13);body.set(type,0);body.set(data,4);cv.setUint32(17,crc(body));
  const parts=[bytes.subarray(0,8)];let i=8,placed=false;
  while(i<bytes.length){const len=new DataView(bytes.buffer,bytes.byteOffset+i,4).getUint32(0),t=String.fromCharCode(...bytes.subarray(i+4,i+8)),whole=bytes.subarray(i,i+12+len);
   if(t!=='pHYs')parts.push(whole);if(t==='IHDR'&&!placed){parts.push(chunk);placed=true;}i+=12+len;}
  const out=new Uint8Array(parts.reduce((s,p)=>s+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;
 }
 function readDpi(bytes){if(!isPNG(bytes))return null;for(let i=8;i<bytes.length-8;){const d=new DataView(bytes.buffer,bytes.byteOffset+i),len=d.getUint32(0),t=String.fromCharCode(...bytes.subarray(i+4,i+8));if(t==='pHYs')return Math.round(d.getUint32(8)*0.0254);if(t==='IDAT')return null;i+=12+len;}return null;}
 function readText(bytes){
  const out={};if(!isPNG(bytes))return out;const dec=new TextDecoder();
  for(let i=8;i<bytes.length-8;){const len=new DataView(bytes.buffer,bytes.byteOffset+i,4).getUint32(0),t=String.fromCharCode(...bytes.subarray(i+4,i+8));
   if(t==='iTXt'){const d=bytes.subarray(i+8,i+8+len),z=d.indexOf(0);out[dec.decode(d.subarray(0,z))]=dec.decode(d.subarray(z+5));}
   if(t==='IEND')break;i+=12+len;}
  return out;
 }
 const api={POSITIONS,SIZES:Object.keys(SIZES),FONTS:Object.keys(FONTS),TEXT_PLACES,FONT_LIMIT,font,drawText,wrap,layers,flatten,pngOf,rgba,pngDpi,readDpi,kits,active,save,use,remove,prompt,negative,box,place,layer,pngText,readText,clean};
 if(typeof module==='object'&&module.exports)module.exports=api;
 root.EccoImageBrand=api;
})(typeof window!=='undefined'?window:globalThis);
