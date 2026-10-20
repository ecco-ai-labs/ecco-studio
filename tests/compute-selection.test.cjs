const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const connected=new Set(['a','b']);
const configs={a:{models_ready:{sdxl:true}},b:{models_ready:{'wan-a14b':true}}};
const listeners={};
class Select{
 constructor(){this.dataset={};this.value='';}
 replaceChildren(...options){this.options=options;}
}
const select=new Select(),form={isConnected:true,querySelector:()=>({after(){}}),dispatchEvent(){}};
const context={window:{EccoGPUPicker:{gpus:[{id:'a',name:'A100',label:'A'},{id:'b',name:'B200',label:'B'},{id:'old',name:'B200',label:'old'}]},EccoGPUConnection:{selectedId:'a',isConnected:id=>connected.has(id),config:id=>configs[id],checkAll:async()=>{}}},
 state:{config:{longcat:{workers:[{pod:'b',ready:true}]}}},MODEL_CATALOG:{sdxl:{name:'SDXL'}},
 localStorage:{getItem:()=>null,setItem(){}},Option:function(label,value){this.label=label;this.value=value;},Event:function(){},
 document:{createElement:()=>({dataset:{},querySelector:()=>select}),addEventListener:(name,fn)=>listeners[name]=fn,removeEventListener(){}}};
vm.createContext(context);vm.runInContext(fs.readFileSync('compute-selection.js','utf8'),context);
const compute=context.window.EccoCompute;
assert.deepEqual(Array.from(compute.choices(),x=>x.id),['a','b']);
assert.equal(compute.ready('a','sdxl'),true);
assert.equal(compute.ready('b','sdxl'),false);
assert.equal(compute.ready('a','longcat-avatar-1.5'),false);
assert.equal(compute.ready('b','longcat-avatar-1.5'),true);
assert.throws(()=>compute.requireReady('b','sdxl'),/not ready on B200/);
compute.mount(form,'video');
assert.equal(select.value,'a');
select.value='b';select.onchange();
connected.delete('b');listeners['ecco:gpu-connection-change']();
assert.equal(select.value,''); // Never silently route to A100.
assert.throws(()=>compute.requireReady('b','wan-a14b'),/Select a connected GPU/);
connected.clear();listeners['ecco:gpu-connection-change']();
assert.equal(select.disabled,true);
console.log('PASS: per-GPU models, LongCat worker affinity, connected-only options, disconnect without fallback.');
