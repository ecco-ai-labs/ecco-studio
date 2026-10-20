const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {JSDOM}=require('jsdom');
const script=readFileSync(join(__dirname,'../gpu-picker.js'),'utf8');
const original='io8sphjo10kbuy', newer='p7lc6fqjuosti3', a100='1muqctw9bxvguu';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(storage=true){
 const dom=new JSDOM('<div id="picker"></div>',{runScripts:'outside-only',url:'https://studio.example/'}),w=dom.window;
 const calls=[],health=new Map([[original,true],[newer,false],[a100,true]]);
 let error=false,checks=0;
 w.EccoStorage={ready:storage};
 w.EccoGPUConnection={selectedId:'',ready:false,async checkAll(gpus){checks++;if(error)throw Error('Service temporarily unreachable');return gpus.map(g=>health.get(g.id)?{kind:'ready',title:'Available'}:{kind:'unknown',title:'Unavailable',detail:'The GPU generation service is not responding.'});}};
 w.eval(script);
 w.EccoGPUPicker.mount(w.document.querySelector('#picker'),async gpu=>{calls.push(gpu.id);if(w.EccoStorage.ready){w.EccoGPUConnection.selectedId=gpu.id;w.EccoGPUConnection.ready=true;}});
 return {dom,w,calls,health,setError:value=>error=value,get checks(){return checks;},select:w.document.querySelector('select'),button:w.document.querySelector('.gpu-open'),refresh:w.document.querySelector('#gpu-refresh')};
}
function choose(ctx,id){ctx.select.value=id;ctx.select.dispatchEvent(new ctx.w.Event('change'));}
test('all pods remain visible; choosing never switches until Connect is clicked',async t=>{
 const c=setup();t.after(()=>c.dom.window.close());await tick();
 assert.equal(c.select.value,'');assert.equal(c.button.disabled,true);assert.equal(c.checks,1);
 assert.deepEqual([...c.select.options].map(o=>o.textContent),['Choose a GPU','B200 (Original) · Available','B200 (New) · Unavailable','A100 · Available']);
 choose(c,original);assert.equal(c.calls.length,0);assert.equal(c.button.disabled,false);
 await c.button.onclick();assert.deepEqual(c.calls,[original]);assert.equal(c.button.textContent,'Connected');assert.equal(c.button.disabled,true);
 choose(c,newer);assert.equal(c.button.disabled,true);c.button.click();assert.deepEqual(c.calls,[original]);assert.equal(c.w.EccoGPUConnection.selectedId,original);
 choose(c,a100);assert.equal(c.button.textContent,'Switch connection');assert.equal(c.w.EccoGPUConnection.selectedId,original);
 await c.refresh.onclick();assert.equal(c.select.value,a100);assert.equal(c.w.EccoGPUConnection.selectedId,original);
 await c.button.onclick();assert.deepEqual(c.calls,[original,a100]);assert.equal(c.w.EccoGPUConnection.selectedId,a100);
});
test('status errors disable connection, then recover without losing the choice',async t=>{
 const c=setup();t.after(()=>c.dom.window.close());await tick();choose(c,original);
 c.setError(true);await c.refresh.onclick();assert.equal(c.button.disabled,true);assert.match(c.select.selectedOptions[0].textContent,/Status unavailable/);
 assert.match(c.w.document.querySelector('[role="status"]').textContent,/Service temporarily unreachable/);
 c.setError(false);await c.refresh.onclick();assert.equal(c.select.value,original);assert.equal(c.button.disabled,false);assert.equal(c.calls.length,0);
});
test('storage is required before reporting hardware availability',async t=>{
 const c=setup(false);t.after(()=>c.dom.window.close());await tick();
 assert.equal(c.checks,0);assert.match(c.select.options[1].textContent,/Not checked/);
 choose(c,original);assert.equal(c.button.textContent,'Connect storage');assert.equal(c.button.disabled,false);
 await c.button.onclick();assert.equal(c.w.EccoGPUConnection.selectedId,'');assert.equal(c.w.EccoGPUConnection.ready,false);
});
