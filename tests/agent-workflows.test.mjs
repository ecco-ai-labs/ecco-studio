import assert from 'node:assert/strict';
import {build} from '../desk/node_modules/esbuild/lib/main.js';
const built=await build({entryPoints:['desk/src/agent-workflows.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {runAgentWorkflow}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const definition={id:'fixture',name:'Release review',description:'Two checks',steps:[{mode:'workflow',workflow:'video'},{mode:'workflow',workflow:'story'}]};
let calls=[],updates=[];
const execute=async(_frame,mode,workflow,_signal,update)=>{
 calls.push(workflow);const check={id:'same-check',title:workflow,status:workflow==='video'?'failed':'passed',severity:'high',expected:'Works',actual:'Evidence',steps:['Open library']};
 const result={checks:[check],findings:check.status==='failed'?[check]:[],status:'completed'};update(result,'Done');return result;
};
const report=await runAgentWorkflow({},definition,new AbortController().signal,r=>updates.push(structuredClone(r)),execute);
assert.deepEqual(calls,['video','story']);assert.deepEqual(report.checks.map(c=>c.id),['step-1/same-check','step-2/same-check']);assert.equal(report.findings.length,1);assert.equal(report.scope,'Release review');assert.equal(report.status,'completed');assert(updates.slice(0,-1).every(r=>r.status==='running'));
calls=[];const controller=new AbortController();
const stopped=await runAgentWorkflow({},definition,controller.signal,()=>{},async(...args)=>{const result=await execute(...args);controller.abort();return result;});
assert.deepEqual(calls,['video']);assert.equal(stopped.status,'cancelled');assert.equal(stopped.findings.length,1);
calls=[];const before=new AbortController();before.abort();assert.equal((await runAgentWorkflow({},definition,before.signal,()=>{},execute)).status,'cancelled');assert.deepEqual(calls,[]);
const blocked=await runAgentWorkflow({},definition,new AbortController().signal,()=>{},async()=>{throw Error('Unavailable');});assert.equal(blocked.checks[0].status,'blocked');assert.equal(blocked.findings.length,0);
console.log('Agent workflow: ordered execution, combined unique findings, cancellation and explicit blocking passed.');

let selectedCalls=[];
const scoped=async(_frame,_mode,workflow,_signal,update,ids)=>{selectedCalls.push({workflow,ids});const result={checks:[],findings:[],status:'completed'};update(result,'Done');return result;};
const subset=await runAgentWorkflow({},definition,new AbortController().signal,()=>{},scoped,['step-2/story-choices']);
assert.deepEqual(selectedCalls,[{workflow:'story',ids:['story-choices']}]);assert.deepEqual(subset.selection.ids,['step-2/story-choices']);
selectedCalls=[];await runAgentWorkflow({},definition,new AbortController().signal,()=>{},scoped,[]);assert.deepEqual(selectedCalls,[]);
await runAgentWorkflow({},definition,new AbortController().signal,()=>{},scoped,['step-99/video-small']);assert.deepEqual(selectedCalls,[]);
console.log('Selected workflows: unselected steps never execute; empty and invalid selections never run.');
