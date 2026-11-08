/* Opt-in live-service acceptance check. Run on the existing storage CPU only. */
const {spawnSync}=require('node:child_process'),assert=require('node:assert/strict');
global.EccoStoryWorkspaceModel=require('../story-workspace-model.js');
const C=require('../source-cast.js');
const scene='Ali Baba was a woodcutter. He heard the captain of the thieves command, “Open sesame!” The rock opened. Ali Baba returned home and said to his wife, “Look what I found.” His brother Cassim demanded, “Tell me where you got this gold.” Later Morgiana examined the jars and whispered, “There are thieves inside.” The captain called, “Are you ready?” Morgiana answered, “Not yet.”';
const source=Array.from({length:32},(_,i)=>'Scene '+(i+1)+'. '+scene).join('\n\n');
let requests=0;
(async()=>{
 const result=await C.analyze({source,details:{title:'Live cast acceptance',type:'storybook',output:'audio',language:'English',genre:'Adventure',audience:'Families'},model:{voices:[{id:'en_male'},{id:'en_female'}]},request:async(path,body)=>{
  requests++;const code="import sys,json;sys.path[:0]=['/workspace/ecco-storage-app/backend','/workspace/ecco-audio'];import openai_assistant;print(json.dumps(openai_assistant.enhance(json.load(sys.stdin),{'records':lambda *args:[]})))";
  const child=spawnSync('python3',['-c',code],{input:JSON.stringify(body),encoding:'utf8',maxBuffer:4*1024*1024,timeout:150000});if(child.status!==0)throw Error('Live AI request failed; review the service separately.');return JSON.parse(child.stdout);
 },progress:message=>console.log(message)});
 const names=result.cast.map(c=>c.name).join(', ');for(const name of ['Ali Baba','Cassim','Morgiana'])assert.ok(names.toLowerCase().includes(name.toLowerCase()),'Missing '+name);assert.match(names,/captain|chief/i);
 assert.equal(result.plan.segments.map(p=>p.text).join('').replace(/\s+/g,' ').trim(),source.replace(/\s+/g,' ').trim());assert.ok(new Set(result.plan.segments.map(p=>p.character_id)).size>=5);
 console.log(JSON.stringify({check:'real-ai-full-cast',passed:true,sourceCharacters:source.length,requests,characters:result.cast.map(c=>({name:c.name,role:c.role,voice:c.voice})),assignedUnits:result.plan.segments.length}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
