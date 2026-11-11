const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function load(){const window={};vm.runInNewContext(fs.readFileSync('story-generation.js','utf8'),{window,document:{},localStorage:{},sessionStorage:{},setInterval,clearInterval,setTimeout,console});return window.EccoStoryGeneration;}

test('pronunciations change only whole words, everywhere or in one passage',()=>{
 const G=load();
 const list=[{word:'Lahore',sayAs:'la-HOR',line:null},{word:'Saddar',sayAs:'SUD-dar',line:2}];
 assert.equal(G.applyPronunciations('Lahore, then lahore again; not Lahorean.',list,0),'la-HOR, then la-HOR again; not Lahorean.');
 assert.equal(G.applyPronunciations('Posters in Saddar.',list,1),'Posters in Saddar.');
 assert.equal(G.applyPronunciations('Posters in Saddar.',list,2),'Posters in SUD-dar.');
 assert.equal(G.applyPronunciations('No list.',undefined,0),'No list.');
 assert.equal(G.applyPronunciations('Price (USD) rose; USDT did not.',[{word:'USD',sayAs:'U S D',line:null}],0),'Price (U S D) rose; USDT did not.');
});
test('error advice names a cause and next steps for common failures',()=>{
 const G=load();
 const memory=G.advice('CUDA out of memory: tried to allocate 3 GiB','video');assert.equal(memory.action,'settings');assert.match(memory.cause,/memory/);assert.ok(memory.steps.length>=1);
 assert.equal(G.advice('Select a connected GPU in Compute.','image').action,'settings');
 assert.equal(G.advice('Video references must be approved images from the selected story.','video').action,'images');
 assert.equal(G.advice('Failed to fetch','audio').action,'retry');
 const other=G.advice('Something unexpected','audio');assert.equal(other.action,'retry');assert.equal(other.label,'Try again');
});
test('selected frames are described as ranges',()=>{
 const G=load();
 assert.equal(G.ranges([4,5,6,9,12,13]),'4–6, 9, 12–13');assert.equal(G.ranges([7]),'7');assert.equal(G.ranges([]),'');
});
