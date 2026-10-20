const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {JSDOM}=require('jsdom');
const script=readFileSync(join(__dirname,'../gpu-picker.js'),'utf8');
const original='io8sphjo10kbuy',newer='p7lc6fqjuosti3',a100='1muqctw9bxvguu';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(storage=true){
 const dom=new JSDOM('<div id="picker"></div>',{runScripts:'outside-only',url:'https://studio.example/'}),w=dom.window;
 const calls=[],health=new Map([[original,true],[newer,false],[a100,true]]),connected=new Set();
 let error=false,checks=0;
 w.EccoStorage={ready:storage};
 w.EccoGPUConnection={isConnected:id=>connected.has(id)&&health.get(id),async checkAll(gpus){checks++;if(error)throw Error('Service temporarily unreachable');return gpus.map(g=>health.get(g.id)?{kind:'ready',title:'Available'}:{kind:'unknown',title:'Unavailable'});}};
 w.eval(script);
 w.EccoGPUPicker.mount(w.document.querySelector('#picker'),async gpu=>{calls.push(gpu.id);if(w.EccoStorage.ready)connected.add(gpu.id);});
 const card=name=>{const root=w.document.querySelector('[data-gpu-class="'+name+'"]');return {root,select:root.querySelector('select'),button:root.querySelector('button')};};
 return {dom,w,calls,health,connected,card,setError:value=>error=value,get checks(){return checks;},refresh:w.document.querySelector('#gpu-refresh')};
}
function choose(c,name,id){const card=c.card(name);card.select.value=id;card.select.dispatchEvent(new c.w.Event('change'));return card;}
test('two class cards contain their RunPod instances; both classes can stay connected',async t=>{
 const c=setup();t.after(()=>c.dom.window.close());await tick();
 assert.deepEqual([...c.w.document.querySelectorAll('h3')].map(x=>x.textContent),['B200','A100']);
 assert.equal(c.card('B200').select.options.length,3);assert.equal(c.card('A100').select.options.length,2);
 assert.equal(c.card('B200').select.value,'');assert.equal(c.card('A100').select.value,'');assert.equal(c.checks,1);
 const b=choose(c,'B200',original);assert.equal(b.button.textContent,'Connect');assert.equal(c.calls.length,0);
 await b.button.onclick();assert.equal(b.button.textContent,'Connected');
 const a=choose(c,'A100',a100);assert.equal(a.button.textContent,'Connect');await a.button.onclick();
 assert.deepEqual(c.calls,[original,a100]);assert.equal(b.button.textContent,'Connected');assert.equal(a.button.textContent,'Connected');
 assert.deepEqual([...c.connected],[original,a100]);assert.equal(b.button.disabled,true);assert.equal(a.button.disabled,true);
});
test('multiple B200 instances stay connected and retain separate status',async t=>{
 const c=setup();t.after(()=>c.dom.window.close());await tick();
 let b=choose(c,'B200',original);await b.button.onclick();
 b=choose(c,'B200',newer);assert.equal(b.button.textContent,'Unavailable');assert.equal(b.button.disabled,true);
 c.health.set(newer,true);await c.refresh.onclick();assert.equal(b.select.value,newer);await b.button.onclick();
 assert.equal(c.connected.has(original),true);assert.equal(c.connected.has(newer),true);
 b=choose(c,'B200',original);assert.equal(b.button.textContent,'Connected');assert.match(b.select.options[2].textContent,/Connected$/);
 c.health.set(newer,false);await c.refresh.onclick();assert.equal(b.button.textContent,'Connected');assert.match(b.select.options[2].textContent,/Unavailable$/);
});
test('status errors fail closed, preserve choices, and recover without connecting',async t=>{
 const c=setup();t.after(()=>c.dom.window.close());await tick();const b=choose(c,'B200',original);
 c.setError(true);await c.refresh.onclick();assert.equal(b.button.disabled,true);assert.equal(b.button.textContent,'Unavailable');
 c.setError(false);await c.refresh.onclick();assert.equal(b.select.value,original);assert.equal(b.button.disabled,false);assert.equal(c.calls.length,0);
});
test('unchecked instances are unavailable and cannot claim a GPU connection',async t=>{
 const c=setup(false);t.after(()=>c.dom.window.close());await tick();
 const b=choose(c,'B200',original);assert.equal(c.checks,0);assert.equal(b.button.textContent,'Unavailable');assert.equal(b.button.disabled,true);
 await b.button.onclick();assert.equal(c.connected.size,0);assert.equal(c.calls.length,0);
});

test('selecting an already connected A100 shows Connected on the button without separate status text',async t=>{
 const c=setup();t.after(()=>c.dom.window.close());await tick();c.connected.add(a100);
 const a=choose(c,'A100',a100);assert.equal(a.button.textContent,'Connected');assert.equal(a.button.disabled,true);
 assert.equal(a.root.querySelector('.gpu-status'),null);assert.equal(c.calls.length,0);
 const b=choose(c,'B200',original);assert.equal(b.button.textContent,'Connect');assert.equal(b.button.disabled,false);
});
