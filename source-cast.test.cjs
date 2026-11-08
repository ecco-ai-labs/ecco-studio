const {test}=require('node:test'),assert=require('node:assert/strict');
global.EccoStoryWorkspaceModel=require('./story-workspace-model.js');
const C=require('./source-cast.js');
const details={title:'Cave story',type:'storybook',output:'audio',language:'English',audience:'Families',source:{name:'chapter.pdf'}},model={voices:[{id:'en_male'},{id:'en_female'}]};
const cast=[{id:'n',name:'Narrator',role:'Narration'},{id:'a',name:'Ali Baba',role:'Woodcutter',voice:'en_male'},{id:'m',name:'Morgiana',role:'Helper',voice:'en_female'}];
const reply=(characters,assignments)=>({revisions:[{id:'story_workspace',text:JSON.stringify({characters,assignments})}]});
test('narrator-only response is automatically retried and source dialogue keeps its own characters',async()=>{
 const source='Ali Baba reached the cave. “Open sesame!” said Ali Baba. Morgiana replied, “I will help.”';let count=0;
 const result=await C.analyze({source,details,model,request:async(_,body)=>{const {source_units}=JSON.parse(body.context.summary);count++;return reply(count===1?[cast[0]]:cast,source_units.map(u=>({unit_id:u.id,character_id:count===1?'n':u.dialogue?(u.text.includes('sesame')?'a':'m'):'n'})));}});
 assert.equal(count,2);assert.deepEqual(result.cast.map(c=>c.name),['Narrator','Ali Baba','Morgiana']);assert.equal(result.plan.segments.map(p=>p.text).join(''),source);assert.equal(result.plan.segments.find(p=>p.text.includes('Open sesame')).character_id,'a');
});
test('speaker labels work with one newline, and a one-narrator answer cannot erase them',async()=>{
 const source='Narrator: At the cave.\nAli Baba: Open sesame!\nMorgiana: I will help.';let count=0;
 const result=await C.analyze({source,details,model,request:async(_,body)=>{count++;const units=JSON.parse(body.context.summary).source_units;return reply(count===1?[cast[0]]:cast,units.map(u=>({unit_id:u.id,character_id:count===1?'n':cast.find(c=>c.name===u.label).id})));}});
 assert.equal(count,2);assert.deepEqual(result.plan.segments.map(p=>p.character_id),['n','a','m']);assert.equal(result.plan.segments[2].text,'I will help.');
});
test('every section is analyzed, including a character appearing after 100,000 characters',async()=>{
 const source='The road led through the forest. '.repeat(3500)+'Morgiana: I will help.';let seen='',count=0;
 const result=await C.analyze({source,details,model,request:async(_,body)=>{const c=JSON.parse(body.context.summary);seen+=c.source_units.map(u=>u.text).join('');count++;assert.ok(c.source_units.reduce((n,u)=>n+u.text.length,0)<=8000);return reply(c.source_units.some(u=>u.text.includes('Morgiana'))?cast:[cast[0]],c.source_units.map(u=>({unit_id:u.id,character_id:u.text.includes('Morgiana')?'m':'n'})));}});
 assert.ok(count>10);assert.equal(seen,source);assert.equal(result.plan.segments.map(p=>p.text).join(''),source);assert.equal(result.cast.at(-1).name,'Morgiana');
});
test('missing assignments never silently drop the end of the chapter; retry stays bounded',async()=>{
 let calls=0;await assert.rejects(()=>C.analyze({source:'Morgiana: Hello.\nAli Baba: Welcome.',details,model,request:async()=>{calls++;return reply(cast,[]);}}),/Every source unit/);assert.equal(calls,2);
});
test('explicit single voice remains supported and stale requests cannot apply',async()=>{
 const source='“Open sesame!” said Ali Baba.';const args={source,details:{...details,brief:'Use a single narrator'},model,request:async(_,b)=>reply([cast[0]],JSON.parse(b.context.summary).source_units.map(u=>({unit_id:u.id,character_id:'n'})))};
 assert.equal((await C.analyze(args)).cast.length,1);let checks=0;await assert.rejects(()=>C.analyze({...args,assertCurrent:()=>{if(++checks>1)throw Error('Story changed');}}),/Story changed/);
});
test('a narration-only section of a longer ensemble is allowed without inventing speakers',async()=>{
 let calls=0;const source='Narrator: A quiet journey through the forest.';
 const result=await C.analyze({source,details,model,request:async(_,b)=>{calls++;return reply([cast[0]],JSON.parse(b.context.summary).source_units.map(u=>({unit_id:u.id,character_id:'n'})));}});
 assert.equal(calls,1);assert.equal(result.cast.length,1);assert.equal(result.plan.segments[0].text,'A quiet journey through the forest.');
});
