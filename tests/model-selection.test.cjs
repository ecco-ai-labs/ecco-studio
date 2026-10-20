const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const checked=[];
const c={document:{addEventListener(){}},localStorage:{getItem:()=>JSON.stringify({selected:{video:'longcat-avatar-1.5'}})},location:{hash:''},window:{EccoCompute:{requireReady(gpu,id){checked.push({gpu,id});if(id==='longcat-avatar-1.5')throw Error('LongCat unavailable');return {model_settings_version:1};}}}};
vm.createContext(c);vm.runInContext(fs.readFileSync('models.js','utf8'),c);
for(const model of ['wan-a14b','wan-5b','preview']){
 const result=c.modelPayload('video','b200',model);
 assert.equal(result.model,model);assert.equal(result.gpu,'b200');
 assert.equal(checked.at(-1).id,model);
}
assert.throws(()=>c.modelPayload('video','b200','longcat-avatar-1.5'),/LongCat unavailable/);
console.log('PASS: visible model overrides stale LongCat profile for validation and submission.');
