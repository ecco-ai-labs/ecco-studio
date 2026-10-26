const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const tick=()=>new Promise(r=>setTimeout(r,30));
const source=fs.readFileSync(__dirname+'/character-studio.js','utf8');
const cid='c'.repeat(32),sid='s'.repeat(32),gpu='p7lc6fqjuosti3';
const character=()=>({id:cid,kind:'character',pipeline_version:1,revision:1,source_story_id:sid,name:'Munnu',description:'Realistic stocky man',image_ids:[],sheet_ids:[],views:{},performances:[]});
async function setup(t,{items=[],available=true,handler}={}){
 const dom=new JSDOM('<button id="origin">Generate with AI</button><form id="image-form"><textarea name="prompt">Munnu</textarea></form>',{url:'https://ecco-ai-labs.github.io/ecco-studio/',runScripts:'outside-only'}),w=dom.window;
 t.after(()=>w.close());const calls=[],errors=[];let records=structuredClone(items);
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 w.activeStory=sid;w.LEGACY_STORY='legacy';w.esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const capabilities={available,workers:[{id:gpu,ready:true,capabilities:{model:true,rig:true,performance:true,import:true}}]};
 w.state={records,config:{character_studio:capabilities}};
 w.EccoStorage={ready:true,mediaURL:async()=> 'data:image/png;base64,'};w.EccoErrors={record:e=>errors.push(e.message)};
 w.EccoCompute={choices:()=>[{id:gpu,name:'B200',label:'Test'}],validate:async()=>true};w.EccoGPUConnection={isConnected:g=>g===gpu};
 w.EccoGeneration={context:()=>({compute:{value:gpu},model:{value:'sdxl'},data:{reference_ids:[]}})};w.modelPayload=()=>({model:'sdxl',resolution:'1024x1024'});
 w.api=async(path,body)=>{calls.push({path,body:body?structuredClone(body):null});if(path==='state')return {records:structuredClone(records),config:{character_studio:capabilities}};
  if(handler)return handler(path,body,{records,setRecords:r=>records=r});
  if(path==='character-studio/save'){const c={...character(),id:body.character_id||body.request_id,name:body.name,description:body.description};records.push(c);return c;}
  if(path==='character-studio/approve'){const c=records.find(r=>r.id===body.character_id);c.revision++;c.approved_image_id=body.asset_id;return structuredClone(c);}
  if(path==='character-studio/generate'){const j={id:body.request_id,kind:'character_job',character_id:body.character_id,story_id:sid,status:'queued',created:Date.now(),stage:body.stage,progress:'Queued'};records.push(j);return j;}
  if(path==='generation/stop'){const j=records.find(r=>r.id===body.job_id);j.status='cancelling';return structuredClone(j);}
  throw Error(path);
 };
 if(items.some(r=>r.id===cid))w.localStorage.setItem('ecco-character-studio:'+sid,JSON.stringify({character_id:cid}));
 w.eval(source);w.document.querySelector('#origin').focus();await w.EccoCharacterStudio.open(w.document.querySelector('form'));await tick();
 return {w,calls,errors,q:s=>w.document.querySelector(s),async click(s){w.document.querySelector(s).click();await tick();},setRecords:r=>{records=r;}};
}

test('Character service unavailable does not expose working generation controls',async t=>{
 const x=await setup(t,{available:false});assert.match(x.q('[data-character-body]').textContent,/not running/);assert.equal(x.q('[data-action=appearance]').disabled,true);assert.equal(x.calls.filter(c=>c.body).length,0);
});
test('Save and generate creates one real job; Stop targets that character job',async t=>{
 const x=await setup(t);x.q('[name=name]').value='Munnu';x.q('[name=description]').value='Realistic stocky man';await x.click('[data-action=appearance]');
 const save=x.calls.find(c=>c.path==='character-studio/save'),generate=x.calls.find(c=>c.path==='character-studio/generate');assert.ok(save.body.request_id);assert.equal(generate.body.character_id,save.body.request_id);assert.equal(generate.body.gpu,gpu);assert.equal(generate.body.stage,'appearance');
 assert.equal(x.q('[data-action=appearance]').disabled,true);await x.click('[data-action=stop]');assert.equal(x.calls.find(c=>c.path==='generation/stop').body.job_id,generate.body.request_id);
});
test('Appearance approval is explicit and advances to eight-view character set',async t=>{
 const c=character(),aid='a'.repeat(32);c.image_ids=[aid];const x=await setup(t,{items:[c,{id:aid,kind:'asset',media:'image',story_id:sid,path:'test.png'}]});
 assert.equal(x.calls.filter(c=>c.path.endsWith('/approve')).length,0);x.q('[name=appearance]').checked=true;x.q('[name=appearance]').dispatchEvent(new x.w.Event('change',{bubbles:true}));await x.click('[data-action=approve-appearance]');
 assert.equal(x.calls.find(c=>c.path.endsWith('/approve')).body.asset_id,aid);assert.equal(x.q('[data-step="1"]').getAttribute('aria-current'),'step');assert.equal(x.w.document.querySelectorAll('[data-action^="view:"]').length,8);
});
test('Saved job recovers after opening and closing never cancels it',async t=>{
 const j={id:'j'.repeat(32),kind:'job',source_kind:'character_job',character_id:cid,created:2,status:'running',progress:'Predicting skeleton'};
 const x=await setup(t,{items:[character(),j]});assert.match(x.q('[data-job-status]').textContent,/Predicting skeleton/);assert.equal(x.q('[data-action=stop]').disabled,false);await x.click('[data-close]');assert.equal(x.calls.filter(c=>c.path==='generation/stop').length,0);assert.equal(x.w.document.activeElement.id,'origin');
});
test('Story switching blocks generation and preserves the draft',async t=>{
 const x=await setup(t);x.q('[name=name]').value='Munnu';x.q('[name=description]').value='Stocky actor';x.w.activeStory='another-story';await x.click('[data-action=save]');assert.match(x.q('[data-status]').textContent,/original story/);assert.equal(x.calls.filter(c=>c.body).length,0);assert.equal(x.q('[name=name]').value,'Munnu');
});
test('An uncertain generation retries only the original request ID',async t=>{
 let generation=0;const x=await setup(t,{items:[character()],handler:async(path,body)=>{if(path==='character-studio/generate'){generation++;if(generation===1)throw Error('Network lost');return {id:body.request_id,kind:'character_job',character_id:cid,created:1,status:'queued'};}throw Error(path);}});
 await x.click('[data-action=appearance]');assert.equal(x.q('[data-action=appearance]').disabled,true);assert.equal(x.q('[data-reconcile]').hidden,false);await x.click('[data-action=reconcile]');const jobs=x.calls.filter(c=>c.path==='character-studio/generate');assert.equal(jobs.length,2);assert.deepEqual(jobs[0].body,jobs[1].body);
});
test('Fear stays unavailable on a body-only rig',async t=>{
 const c=character();c.approved_rig_id='r'.repeat(32);c.rig_report={actions:['stand','run'],expressions:['neutral']};const x=await setup(t,{items:[c]});await x.click('[data-step="4"]');assert.equal(x.q('[name=expression] option[value=fear]').disabled,true);assert.equal(x.q('[name=action] option[value=run]').disabled,false);
});
test('Name edits survive a failed save',async t=>{
 const x=await setup(t,{items:[character()],handler:()=>{throw Error('Storage offline');}});x.q('[name=name]').value='Munnu revised';await x.click('[data-action=save]');assert.equal(x.q('[name=name]').value,'Munnu revised');assert.match(x.q('[data-status]').textContent,/offline/);
});
