import assert from 'node:assert/strict';
import {build} from '../desk/node_modules/esbuild/lib/main.js';
async function module(path){const b=await build({entryPoints:[path],bundle:true,platform:'node',format:'esm',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {testPlan,agentTestPlan,selectedTests}=await module('desk/src/tester-catalog.ts');
for(const [mode,workflow] of [['ux','libraries'],['sweep','libraries'],...['libraries','video','image','audio','story','drive'].map(w=>['workflow',w])]){
 const groups=testPlan(mode,workflow),ids=groups.flatMap(g=>g.tests.map(t=>t.id));assert.equal(new Set(ids).size,ids.length);assert.deepEqual(selectedTests(groups,[]),[]);assert.deepEqual(selectedTests(groups),ids);
}
assert.deepEqual(selectedTests(testPlan('workflow','video'),['video-small','video-small']),['video-small']);
assert.throws(()=>selectedTests(testPlan('workflow','video'),['image-small']));
const custom=agentTestPlan([{mode:'workflow',workflow:'video'},{mode:'workflow',workflow:'video'}]);assert.equal(new Set(custom.flatMap(g=>g.tests.map(t=>t.id))).size,18);
const {runTester}=await module('desk/src/tester-runner.ts');let navigations=0;const frame={set src(_){navigations++}};
const empty=await runTester(frame,'workflow','video',new AbortController().signal,()=>{},[]);assert.equal(navigations,0);assert.equal(empty.checks[0].status,'blocked');
const bad=await runTester(frame,'workflow','video',new AbortController().signal,()=>{},['unknown']);assert.equal(navigations,0);assert.equal(bad.checks[0].status,'blocked');
console.log('Test selection: stable unique catalog, strict scope, duplicate normalization and empty/invalid run guards passed.');
