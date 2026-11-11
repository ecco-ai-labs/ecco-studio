const test=require('node:test'),assert=require('node:assert/strict'),M=require('./image-workspace-model.js');
const styles=['Cartoon','Photographic'];

test('each kind of image gets its own controls',()=>{
 const keys=type=>M.groups(type,styles).map(g=>g.key);
 assert.ok(keys('person').includes('skin_tone')&&keys('person').includes('hair_color'));
 assert.ok(keys('animal').includes('fur_color')&&!keys('animal').includes('skin_tone'));
 assert.ok(keys('scenery').includes('weather')&&!keys('scenery').includes('hair_color'));
 for(const type of M.TYPE_IDS)assert.equal(keys(type).at(-1),'style');
 assert.throws(()=>M.sections('robot',styles));
});

test('choices toggle; multi-select controls keep several values',()=>{
 const hair=M.groups('person').find(g=>g.key==='hair_color'),add=M.groups('scenery').find(g=>g.key==='add');
 let c=M.toggle({},hair,'Auburn');assert.deepEqual(c,{hair_color:'Auburn'});
 c=M.toggle(c,hair,'Black');assert.equal(c.hair_color,'Black');
 c=M.toggle(c,hair,'Black');assert.deepEqual(c,{});
 let s=M.toggle({},add,'Birds');s=M.toggle(s,add,'Boats');assert.deepEqual(s.add,['Birds','Boats']);
 s=M.toggle(s,add,'Birds');assert.deepEqual(s.add,['Boats']);s=M.toggle(s,add,'Boats');assert.deepEqual(s,{});
});

test('choices go to generation without a prompt, and with one',()=>{
 const choices={hair_color:'Auburn',age:'Younger',style:'Cartoon',made_up:'x'};
 assert.equal(M.canGenerate('','person',{},styles),false);
 assert.equal(M.canGenerate('','person',choices,styles),true);
 assert.equal(M.canGenerate('Make her smile','person',{},styles),true);
 const alone=M.compose({number:2,type:'person',prompt:'',choices,styles});
 assert.equal(alone.prompt,'Change Image 2: Hair color: Auburn; Age: Younger.');assert.equal(alone.style,'Cartoon');
 const both=M.compose({number:2,type:'person',prompt:'Put her in Image 1.',choices,styles});
 assert.equal(both.prompt,'Put her in Image 1.\nChange Image 2: Hair color: Auburn; Age: Younger.');
 assert.deepEqual(M.chosen('person',choices,styles).map(c=>c.key),['hair_color','age','style']);
});

test('prompts can bring other selected images along',()=>{
 assert.deepEqual(M.referenced('Use Image 1 as background and image 3 signing; image 9 is ignored',3),[1,3]);
 assert.deepEqual(M.referenced('',3),[]);
});

test('AI analysis keeps only the type and choices the catalog offers',()=>{
 const cat=M.catalog(styles);assert.deepEqual(Object.keys(cat),M.TYPE_IDS);assert.deepEqual(cat.person.style,styles);
 const a=M.parseAnalysis(JSON.stringify({type:'animal',suggestions:[{key:'fur_color',value:'Silver'},{key:'fur_color',value:'Red'},{key:'accessories',value:'Scarf'},{key:'accessories',value:'Collar'},{key:'hair_color',value:'Auburn'},{key:'mood',value:'Grumpy'}]}),styles);
 assert.deepEqual(a,{type:'animal',suggestions:{fur_color:'Silver',accessories:['Scarf','Collar']}});
 assert.equal(M.isSuggested(a,'accessories','Collar'),true);assert.equal(M.isSuggested(a,'fur_color','Red'),false);
 assert.throws(()=>M.parseAnalysis('{"type":"robot"}',styles));assert.throws(()=>M.parseAnalysis('nope',styles));
});
