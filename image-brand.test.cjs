'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const store={};globalThis.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=String(v);}};
const B=require('./image-brand.js');

test('BRAND-01 kits are cleaned, saved, switched on and removed',()=>{
 const k=B.save({name:'Acme',colors:['#ff0000','bad','#00AA00'],use:'clean, modern',avoid:'clutter',position:'Nowhere',size:'Huge'});
 assert.deepEqual(k.colors,['#ff0000','#00AA00']);assert.equal(k.position,'Bottom right');assert.equal(k.size,'Medium');
 assert.equal(B.active(),null);B.use(k.id);assert.equal(B.active().name,'Acme');
 B.save({...k,name:'Acme Co'});assert.equal(B.kits().length,1);assert.equal(B.active().name,'Acme Co');
 B.remove(k.id);assert.equal(B.active(),null);assert.equal(B.kits().length,0);
});
test('BRAND-02 a kit adds colours and words to the prompt and avoid words to the negative',()=>{
 const k=B.clean({colors:['#112233'],use:'friendly',avoid:'red, clutter'});
 assert.equal(B.prompt('A shop front',k),'A shop front\nBrand colours: #112233; use them as the main colours. Brand look: friendly.');
 assert.equal(B.prompt('A shop front',null),'A shop front');
 assert.equal(B.negative('blurry',k),'blurry, red, clutter');assert.equal(B.negative('',k),'red, clutter');
});
test('BRAND-03 logo box sits in the chosen corner at the chosen share of the width',()=>{
 assert.deepEqual(B.box(1000,500,200,100,'Bottom right','Medium'),{x:805,y:395,width:180,height:90});
 assert.deepEqual(B.box(1000,500,200,100,'Top left','Small'),{x:15,y:15,width:120,height:60});
});
test('BRAND-04 PNG text chunks are written before IEND and read back',()=>{
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==','base64');
 const out=B.pngText(new Uint8Array(png),{Prompt:'Un renard 🦊 reading',Model:'Qwen-Image-2512',Seed:42,Empty:''});
 assert.equal(out.length>png.length,true);
 assert.deepEqual(B.readText(out),{Prompt:'Un renard 🦊 reading',Model:'Qwen-Image-2512',Seed:'42'});
 assert.equal(Buffer.from(out.subarray(out.length-8,out.length-4)).toString(),'IEND');
 const jpg=new Uint8Array([0xff,0xd8,0xff]);assert.equal(B.pngText(jpg,{a:'b'}),jpg);
});
