'use strict';
/* Professional picture files for Image Studio (Image Level 4, 21 Nov 2026, branch image-l5-native).
   - psd(): a layered Photoshop file (8-bit RGB, uncompressed). Layers are given bottom first, each as RGBA pixels of the
     full picture size; the merged picture is written too, so any viewer shows it. Print resolution in resource 1005.
   - tiff(): a flat RGB TIFF (uncompressed) with print resolution and a description holding how the picture was made.
   Both take plain pixel arrays, so they run in the browser and in Node tests alike. */
(function(root){
 class Out{
  constructor(){this.parts=[];this.size=0;}
  bytes(b){this.parts.push(b);this.size+=b.length;}
  u8(v){this.bytes(Uint8Array.of(v&255));}
  u16(v){const b=new Uint8Array(2);new DataView(b.buffer).setUint16(0,v);this.bytes(b);}
  i16(v){const b=new Uint8Array(2);new DataView(b.buffer).setInt16(0,v);this.bytes(b);}
  u32(v){const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,v);this.bytes(b);}
  ascii(s){this.bytes(Uint8Array.from(s,c=>c.charCodeAt(0)&255));}
  done(){const out=new Uint8Array(this.size);let at=0;for(const p of this.parts){out.set(p,at);at+=p.length;}return out;}
 }
 // One channel of RGBA pixels as a plane.
 function plane(px,channel,n){const out=new Uint8Array(n);for(let i=0,j=channel;i<n;i++,j+=4)out[i]=px[j];return out;}
 // Pascal string padded so that (1 + length + padding) is a multiple of `multiple`.
 function pascal(o,name,multiple){const s=String(name).replace(/[^\x20-\x7e]/g,'').slice(0,255);o.u8(s.length);o.ascii(s);let used=1+s.length;while(used%multiple){o.u8(0);used++;}}
 function psd({width,height,layers,merged,dpi=300}){
  const n=width*height;if(!(width>0&&height>0&&width<=30000&&height<=30000))throw Error('Picture size is out of range for a PSD file.');
  const o=new Out();
  o.ascii('8BPS');o.u16(1);o.bytes(new Uint8Array(6));o.u16(3);o.u32(height);o.u32(width);o.u16(8);o.u16(3);
  o.u32(0);// colour mode data
  // Image resources: 1005 ResolutionInfo (16.16 fixed pixels per inch, shown in inches).
  const res=new Out();res.ascii('8BIM');res.u16(1005);res.u16(0);res.u32(16);res.u32(dpi*65536);res.u16(1);res.u16(1);res.u32(dpi*65536);res.u16(1);res.u16(1);
  const r=res.done();o.u32(r.length);o.bytes(r);
  // Layer and mask information.
  const info=new Out();info.i16(layers.length);
  const chanLen=2+n;
  for(const l of layers){
   info.u32(0);info.u32(0);info.u32(height);info.u32(width);info.u16(4);
   for(const id of [-1,0,1,2]){info.i16(id);info.u32(chanLen);}
   info.ascii('8BIM');info.ascii('norm');info.u8(255);info.u8(0);info.u8(l.hidden?2:0);info.u8(0);
   const extra=new Out();extra.u32(0);extra.u32(0);pascal(extra,l.name||'Layer',4);const e=extra.done();info.u32(e.length);info.bytes(e);
  }
  for(const l of layers){for(const c of [3,0,1,2]){info.u16(0);info.bytes(plane(l.pixels,c,n));}}
  let li=info.done();if(li.length%2){const t=new Uint8Array(li.length+1);t.set(li);li=t;}
  o.u32(li.length+4+4);o.u32(li.length);o.bytes(li);o.u32(0);
  // Merged picture (what viewers that ignore layers show).
  o.u16(0);for(const c of [0,1,2])o.bytes(plane(merged,c,n));
  return o.done();
 }
 // Little-endian TIFF writer.
 function tiff({width,height,pixels,dpi=300,description='',software='Ecco Studio'}){
  const n=width*height,rgb=new Uint8Array(n*3);for(let i=0,j=0;i<n;i++,j+=4){rgb[i*3]=pixels[j];rgb[i*3+1]=pixels[j+1];rgb[i*3+2]=pixels[j+2];}
  const enc=s=>{const b=new TextEncoder().encode(String(s));const z=new Uint8Array(b.length+1);z.set(b);return z;};
  const desc=enc(software?(description?description+'\n':'')+'Software: '+software:description),tags=[];
  // Extra data after the IFD: bits per sample, two rationals, strings, then the pixels.
  const entries=13,ifdAt=8,ifdSize=2+entries*12+4;let at=ifdAt+ifdSize;const blobs=[];
  const put=b=>{const off=at;blobs.push(b);at+=b.length;if(at%2){blobs.push(new Uint8Array(1));at++;}return off;};
  const le16=v=>Uint8Array.of(v&255,v>>8&255),le32=v=>Uint8Array.of(v&255,v>>>8&255,v>>>16&255,v>>>24&255);
  const bps=put(new Uint8Array([...le16(8),...le16(8),...le16(8)])),xres=put(new Uint8Array([...le32(dpi),...le32(1)])),yres=put(new Uint8Array([...le32(dpi),...le32(1)]));
  const d=put(desc),strip=put(rgb);
  tags.push([256,4,1,width],[257,4,1,height],[258,3,3,bps],[259,3,1,1],[262,3,1,2],[270,2,desc.length,d],[273,4,1,strip],[277,3,1,3],[278,4,1,height],[279,4,1,rgb.length],[282,5,1,xres],[283,5,1,yres],[296,3,1,2]);
  // The software name goes in the description (13 entries keep the writer small).
  const out=new Uint8Array(at),v=new DataView(out.buffer);
  out.set([0x49,0x49,42,0]);v.setUint32(4,ifdAt,true);v.setUint16(ifdAt,entries,true);
  tags.forEach(([tag,type,count,value],i)=>{const p=ifdAt+2+i*12;v.setUint16(p,tag,true);v.setUint16(p+2,type,true);v.setUint32(p+4,count,true);if(type===3&&count===1)v.setUint16(p+8,value,true);else v.setUint32(p+8,value,true);});
  v.setUint32(ifdAt+2+entries*12,0,true);
  let p=ifdAt+ifdSize;for(const b of blobs){out.set(b,p);p+=b.length;}
  return out;
 }
 // Read back what tests need: size, dpi and the description of a TIFF; size, dpi and layer names of a PSD.
 function readTiff(b){
  const v=new DataView(b.buffer,b.byteOffset,b.byteLength),ifd=v.getUint32(4,true),count=v.getUint16(ifd,true),out={};
  for(let i=0;i<count;i++){const p=ifd+2+i*12,tag=v.getUint16(p,true),type=v.getUint16(p+2,true),n=v.getUint32(p+4,true),val=type===3&&n===1?v.getUint16(p+8,true):v.getUint32(p+8,true);
   if(tag===256)out.width=val;if(tag===257)out.height=val;if(tag===282)out.dpi=v.getUint32(val,true)/v.getUint32(val+4,true);if(tag===270)out.description=new TextDecoder().decode(b.subarray(val,val+n-1));if(tag===273)out.strip=val;}
  return out;
 }
 function readPsd(b){
  const v=new DataView(b.buffer,b.byteOffset,b.byteLength);if(String.fromCharCode(...b.subarray(0,4))!=='8BPS')return null;
  const out={height:v.getUint32(14),width:v.getUint32(18),layers:[]};let p=26;p+=4+v.getUint32(p);
  const resLen=v.getUint32(p);let q=p+4;while(q<p+4+resLen){const id=v.getUint16(q+4),nl=b[q+6],pad=(1+nl)%2?1:0,size=v.getUint32(q+7+nl+pad);if(id===1005)out.dpi=v.getUint32(q+11+nl+pad)/65536;q+=11+nl+pad+size+(size%2);}
  p+=4+resLen;const lm=p+4;const count=v.getInt16(lm+4);let r=lm+6;
  for(let i=0;i<Math.abs(count);i++){const ch=v.getUint16(r+16);r+=18+ch*6+12;const extra=v.getUint32(r);const nameAt=r+4+4+4,len=b[nameAt];out.layers.push(new TextDecoder().decode(b.subarray(nameAt+1,nameAt+1+len)));r+=4+extra;}
  return out;
 }
 const api={psd,tiff,readTiff,readPsd};
 if(typeof module==='object'&&module.exports)module.exports=api;
 root.EccoImageExport=api;
})(typeof window!=='undefined'?window:globalThis);
