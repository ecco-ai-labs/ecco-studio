const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {JSDOM}=require('jsdom');
const script=readFileSync(join(__dirname,'../storage-client.js'),'utf8');
const original='io8sphjo10kbuy',newer='p7lc6fqjuosti3',a100='1muqctw9bxvguu';
function setup(saved={}){
 const dom=new JSDOM('<main><header></header></main><div id="picker"></div>',{runScripts:'outside-only',url:'https://studio.example/'}),w=dom.window;
 w.sessionStorage.setItem('ecco-storage-access','test-storage-access');
 for(const [k,v] of Object.entries(saved))w.localStorage.setItem(k,v);
 const gpus=[original,newer,a100].map(id=>({id,ready:true,config:{source:id}})),requests=[];
 let failed=false;
 w.AbortSignal=AbortSignal;w.api=async()=>{};w.gpuConnected=()=>false;w.state={records:[],config:{}};
 w.refresh=async()=>{w.state=await w.api('state');};
 w.fetch=async(url,options)=>{
  const path=url.split('/api/')[1];
  if(failed&&path==='gpu/status')throw Error('Status request failed');
  let data;
  if(path==='gpu/status')data={gpus};
  else if(path==='state')data={records:[],config:{gpu_relay:{gpus}}};
  else if(path==='gpu/request'){const payload=JSON.parse(options.body);requests.push(payload);data={id:payload.request_id,gpu:payload.gpu};}
  else if(path.startsWith('gpu/requests/'))data={status:'done',result:{id:'job-'+requests.length}};
  else throw Error('Unexpected request '+path);
  return {ok:true,json:async()=>structuredClone(data)};
 };
 w.eval(script);
 return {dom,w,gpus,requests,setFailed:value=>failed=value};
}
test('connections accumulate, persist and route requests to either connected instance',async t=>{
 const c=setup();t.after(()=>c.dom.window.close());const gpu=c.w.EccoGPUConnection;
 await gpu.checkAll(c.gpus);assert.equal(gpu.ready,false);
 await gpu.select({id:original});await gpu.select({id:a100});
 assert.deepEqual([...gpu.connectedIds],[original,a100]);assert.equal(gpu.isConnected(original),true);
 assert.deepEqual(JSON.parse(c.w.localStorage.getItem('ecco-connected-gpus')),[original,a100]);
 await c.w.api('images',{gpu:original,prompt:'first'});await c.w.api('images',{gpu:a100,prompt:'second'});
 assert.deepEqual(c.requests.map(x=>x.gpu),[original,a100]);assert.notEqual(c.requests[0].request_id,c.requests[1].request_id);
 await assert.rejects(c.w.api('images',{gpu:newer,prompt:'not connected'}),/Connect the selected/);
 assert.equal(c.requests.length,2);
 await gpu.select({id:newer});assert.equal(gpu.connectedIds.length,3);
});
test('one unavailable instance does not disconnect the others; status errors invalidate readiness',async t=>{
 const c=setup();t.after(()=>c.dom.window.close());const gpu=c.w.EccoGPUConnection;
 await gpu.select({id:original});await gpu.select({id:a100});c.gpus.find(x=>x.id===original).ready=false;
 await gpu.checkAll(c.gpus);assert.equal(gpu.isConnected(original),false);assert.equal(gpu.isConnected(a100),true);assert.equal(gpu.ready,true);
 await assert.rejects(gpu.select({id:original}),/No relay heartbeat/);assert.equal(gpu.isConnected(a100),true);
 c.setFailed(true);await assert.rejects(gpu.checkAll(c.gpus),/Status request failed/);assert.equal(gpu.ready,false);
 c.setFailed(false);await gpu.checkAll(c.gpus);assert.equal(gpu.isConnected(a100),true);
});
test('legacy selection migrates and saved multiple connections require fresh health',async t=>{
 const c=setup({'ecco-selected-gpu':original});t.after(()=>c.dom.window.close());
 assert.equal(c.w.EccoGPUConnection.ready,false);await c.w.EccoGPUConnection.checkAll(c.gpus);assert.equal(c.w.EccoGPUConnection.isConnected(original),true);
 const d=setup({'ecco-selected-gpu':a100,'ecco-connected-gpus':JSON.stringify([original,a100])});t.after(()=>d.dom.window.close());
 assert.equal(d.w.EccoGPUConnection.ready,false);await d.w.EccoGPUConnection.checkAll(d.gpus);
 assert.deepEqual([...d.w.EccoGPUConnection.connectedIds],[original,a100]);
});

test('selected instance button immediately follows shared connection and availability changes',async t=>{
 const c=setup();t.after(()=>c.dom.window.close());const w=c.w,gpu=w.EccoGPUConnection;
 w.eval(readFileSync(join(__dirname,'../gpu-picker.js'),'utf8'));
 w.EccoGPUPicker.mount(w.document.querySelector('#picker'),item=>gpu.select(item));
 await new Promise(resolve=>setImmediate(resolve));
 const select=w.document.querySelector('#gpu-instance-A100'),button=w.document.querySelector('#gpu-status-A100');
 select.value=a100;select.dispatchEvent(new w.Event('change'));assert.equal(button.textContent,'Connect');assert.equal(button.disabled,false);
 await gpu.select({id:a100});assert.equal(button.textContent,'Connected');assert.equal(button.disabled,true);
 c.gpus.find(x=>x.id===a100).ready=false;await gpu.checkAll(c.gpus);assert.equal(button.textContent,'No heartbeat');assert.equal(button.disabled,true);
 c.gpus.find(x=>x.id===a100).ready=true;await gpu.checkAll(c.gpus);assert.equal(button.textContent,'Connected');
 c.setFailed(true);await assert.rejects(gpu.checkAll(c.gpus));assert.equal(button.textContent,'Reconnecting');
});
