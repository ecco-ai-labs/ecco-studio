const test=require('node:test'),assert=require('node:assert/strict'),M=require('./clip-frame-model.js');
test('nonconsecutive cherry-picks preserve IDs and unselected frames',()=>{
 const doc=M.create(750),ids=M.parse('128, 132, 137-140',750),next=M.change(doc,'remove',ids);
 assert.deepEqual(ids,[128,132,137,138,139,140]);assert.equal(M.keep(next).length,744);assert.ok(M.keep(next).includes(129));assert.equal(doc.removed.length,0);
 assert.deepEqual(M.change(next,'restore',[132]).removed,[128,137,138,139,140]);
});
test('repair context reads 118–150 while replacing only 128–140',()=>{
 const request=M.repair(M.create(750),M.parse('128-140',750),'Keep tree rooted');
 assert.deepEqual(request.windows,[{from:118,to:150,replace:Array.from({length:13},(_,i)=>128+i)}]);assert.equal(request.status,'prepared');
});
test('context clipping and disjoint selections never target good context',()=>{
 const w=M.context([1,5,100,750],750);assert.equal(w[0].from,1);assert.deepEqual(w[0].replace,[1,5]);assert.equal(w.at(-1).to,750);assert.equal(w.length,3);
});
test('3 and 4 second clips cover every original frame exactly once',()=>{
 for(const s of [3,4]){const d=M.create(750,s),c=M.clips(d);assert.equal(c[0].start,1);assert.equal(c.at(-1).end,750);assert.equal(c.reduce((n,c)=>n+c.count,0),750);assert.ok(c.every(c=>c.count<=s*25));}
});
test('reject invalid IDs, empty exports and changed source drafts',()=>{
 for(const text of ['0','3-1','751','NaN','1.5','1; alert(1)'])assert.throws(()=>M.parse(text,750));
 assert.throws(()=>M.change(M.create(1),'remove',[1]));assert.throws(()=>M.validate(M.create(750),749));
 assert.throws(()=>M.validate({...M.create(750),ends:[100,99,750]},750));
});

test('playback scope keeps scattered picks exact and entire clip independent',()=>{
 const doc=M.create(200);doc.removed=[4];const clip=M.clips(doc)[0];
 assert.deepEqual(M.playback(doc,[8,2,5],clip,'selected'),[2,5,8]);
 assert.equal(M.playback(doc,[8],clip,'entire').length,74);
 assert.equal(M.playback(doc,[],clip,'entire',false).length,75);
 assert.deepEqual(M.playback(doc,[4],clip,'selected'),[4]);
});
test('repair acceptance is exact, timing-preserving and rejects stale edits',()=>{
 const doc=M.create(200);doc.removed=[8,9];const draft={request_id:'job',asset_id:'film',revision:M.revision(doc),original_frame_ids:[8,12]};
 const candidate={id:'job',asset_id:'film',fps:25,total:200,frames:{8:'data:image/jpeg;base64,/9j/',12:'data:image/jpeg;base64,/9j/'}};
 const next=M.acceptRepair(doc,draft,candidate);assert.deepEqual(next.removed,[9]);assert.deepEqual(Object.keys(next.replacements),['8','12']);assert.deepEqual(doc.removed,[8,9]);assert.equal(next.total,200);
 assert.throws(()=>M.acceptRepair(M.change(doc,'remove',[10]),draft,candidate),/edit changed/);
 assert.throws(()=>M.acceptRepair(doc,draft,{...candidate,frames:{...candidate.frames,13:candidate.frames[12]}}),/do not match/);
});
