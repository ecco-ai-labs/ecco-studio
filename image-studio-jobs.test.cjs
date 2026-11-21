'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),zlib=require('node:zlib');
const J=require('./image-studio-jobs.js');

test('IMGJ-01 variations get different seeds, at most four',()=>{
 assert.deepEqual(J.seeds(42,3),[42,43,44]);
 assert.equal(J.seeds(7,9).length,4);
 assert.deepEqual(J.seeds('x',1),[0]);
});
test('IMGJ-02 a set has one page per line, numbering removed, at most 24',()=>{
 assert.deepEqual(J.pages('1. A fox wakes up\n\n2) The fox finds a key\nPage 3 - Home again'),['A fox wakes up','The fox finds a key','Home again']);
 assert.equal(J.pages(Array.from({length:30},(_,i)=>'p'+i).join('\n')).length,24);
});
test('IMGJ-03 shapes keep the model sizes and add server sizes with plain names',()=>{
 const s=J.shapes(['1664x928','1328x1328','928x1664'],['1472x1104','1664x928','bad']);
 assert.deepEqual(s.map(x=>x.size),['1664x928','1328x1328','928x1664','1472x1104']);
 assert.equal(s[3].name,'Landscape 4:3');assert.equal(s[0].name,'Wide 16:9');
});
test('IMGJ-04 stage says what a job is doing, in order',()=>{
 const now=Date.parse('2026-11-21T10:00:00Z'),t=now/1000;
 assert.equal(J.stage(null,now).state,'sending');
 const w=J.stage({status:'queued',created:t-20},now,{place:3,wait_seconds:120},60);
 assert.equal(w.state,'waiting');assert.match(w.text,/place 3/);assert.match(w.left,/min left/);
 assert.equal(J.stage({status:'queued',created:t-5},now,{place:1},60).text,'Next in line');
 assert.equal(J.stage({status:'running',created:t-10,started:t-8},now,null,60).text,'Starting a GPU worker');
 assert.equal(J.stage({status:'running',created:t-10,started:t-8,worker_log:['loading']},now,null,60).state,'loading');
 const d=J.stage({status:'running',created:t-40,started:t-30,progress:'25/50'},now,null,60);
 assert.equal(d.state,'drawing');assert.equal(d.pct,50);assert.match(d.text,/step 25 of 50/);assert.match(d.left,/30 s left/);
 const fromLog=J.stage({status:'running',created:t-40,started:t-30,worker_log:['x',' 10/50 [00:05<00:20]']},now,null,60);
 assert.equal(fromLog.pct,20);
 assert.equal(J.stage({status:'done',created:t-70,seconds:65},now).text,'Finished');
 assert.match(J.stage({status:'failed',error:'GPU busy',created:t},now).text,/Failed: GPU busy/);
 assert.equal(J.stage({status:'cancelled',created:t},now).state,'cancelled');
});
test('IMGJ-05 typical seconds come from the last finished jobs of the same kind',()=>{
 const jobs=[{status:'done',seconds:60,label:'Generate Qwen-Image-2512 image',created:3},{status:'done',seconds:70,label:'Generate Qwen-Image-2512 image',created:2},{status:'done',seconds:150,label:'Instruction edit / compose scene',created:1},{status:'failed',seconds:5,created:4}];
 assert.equal(J.typical(jobs,'image',99),70);
 assert.equal(J.typical(jobs,'edit',99),99);
});
test('IMGJ-06 zip holds every file byte for byte with correct CRC',()=>{
 const a=new Uint8Array([1,2,3,4,5]),b=new TextEncoder().encode('hello set');
 const z=Buffer.from(J.zip([{name:'01-page.png',bytes:a},{name:'02-page.png',bytes:b}]));
 assert.equal(z.readUInt32LE(0),0x04034b50);
 assert.equal(J.crc32(new TextEncoder().encode('123456789')),0xCBF43926);
 // End of central directory: two entries.
 const end=z.length-22;assert.equal(z.readUInt32LE(end),0x06054b50);assert.equal(z.readUInt16LE(end+10),2);
 // First file data starts after its 30-byte header and name.
 const nameLen=z.readUInt16LE(26);assert.deepEqual([...z.subarray(30+nameLen,30+nameLen+5)],[1,2,3,4,5]);
 assert.ok(zlib);
});
test('IMGJ-07 safe file names',()=>{assert.equal(J.safeName('The Fox / Book #1'),'The-Fox-Book-1');assert.equal(J.safeName(''),'picture');});
