'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const X=require('./image-export.js'),B=require('./image-brand.js');
const solid=(w,h,[r,g,b,a])=>{const p=new Uint8ClampedArray(w*h*4);for(let i=0;i<w*h;i++)p.set([r,g,b,a],i*4);return p;};

test('EXPORT-01 PSD has the size, 300 dpi, named layers bottom first, and the merged picture last',()=>{
 const w=5,h=3,bytes=X.psd({width:w,height:h,dpi:300,layers:[{name:'Picture',pixels:solid(w,h,[10,20,30,255])},{name:'Logo',pixels:solid(w,h,[0,0,0,0])},{name:'Words',pixels:solid(w,h,[255,255,255,128])}],merged:solid(w,h,[1,2,3,255])});
 const r=X.readPsd(bytes);assert.deepEqual({w:r.width,h:r.height,dpi:r.dpi,layers:r.layers},{w,h,dpi:300,layers:['Picture','Logo','Words']});
 // Merged data: compression 0 then R, G, B planes at the end of the file.
 const tail=bytes.subarray(bytes.length-w*h*3);assert.equal(tail[0],1);assert.equal(tail[w*h],2);assert.equal(tail[w*h*2],3);
 assert.equal(bytes[bytes.length-w*h*3-1],0);
});
test('EXPORT-02 TIFF is RGB with 300 dpi, the description and the pixels',()=>{
 const w=4,h=2,bytes=X.tiff({width:w,height:h,pixels:solid(w,h,[9,8,7,255]),dpi:300,description:'Prompt: a fox'});
 const r=X.readTiff(bytes);assert.equal(r.width,w);assert.equal(r.height,h);assert.equal(r.dpi,300);assert.equal(r.description,'Prompt: a fox\nSoftware: Ecco Studio');
 assert.deepEqual([...bytes.subarray(r.strip,r.strip+3)],[9,8,7]);assert.equal(String.fromCharCode(bytes[0],bytes[1]),'II');
});
test('EXPORT-03 PNG print size: pHYs goes right after IHDR and replaces an old one',()=>{
 const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==','base64'));
 const once=B.pngDpi(png,300);assert.equal(B.readDpi(once),300);assert.equal(Buffer.from(once.subarray(37,41)).toString(),'pHYs');
 const twice=B.pngDpi(once,150);assert.equal(B.readDpi(twice),150);assert.equal(twice.length,once.length);
});
test('EXPORT-04 brand kits keep a font choice, an uploaded font, text colour and the band',()=>{
 assert.equal(B.clean({font:'Classic serif'}).font,'Classic serif');assert.equal(B.clean({font:'Nope'}).font,'Clean sans');
 assert.equal(B.clean({font:'Uploaded'}).font,'Clean sans');assert.equal(B.clean({font:'Uploaded',fontData:'AAAA',fontName:'Brand.ttf'}).font,'Uploaded');
 assert.equal(B.clean({textColor:'#112233'}).textColor,'#112233');assert.equal(B.clean({}).textColor,'#ffffff');assert.equal(B.clean({band:false}).band,false);
});
