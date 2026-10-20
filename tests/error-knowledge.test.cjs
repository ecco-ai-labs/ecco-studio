const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const c={window:{}};vm.createContext(c);vm.runInContext(fs.readFileSync('error-knowledge.js','utf8'),c);
const lookup=c.window.EccoErrorKnowledge.lookup;
assert.equal(lookup({code:'ECCO_MODEL_WORKER_UNAVAILABLE',message:'Test'}).id,'model-worker-unavailable');
assert.equal(lookup('LongCat-Video-Avatar 1.5 is not ready on B200. Choose another connected GPU or model.').id,'model-worker-unavailable');
assert.equal(lookup('BlockingIOError: [Errno 11] Resource temporarily unavailable').id,'worker-lock');
assert.equal(lookup('CUDA out of memory').id,'out-of-memory');
assert.equal(lookup('New unknown failure'),null);
console.log('PASS: known issue explanations; unknown errors receive no invented cause.');
