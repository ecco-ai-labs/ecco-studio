const {test}=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom'),fs=require('node:fs');
function fixture(saved){
 const w=new JSDOM('<form id="video-form"><section data-section="model"><div class="generation-section-heading"></div><select id="job-model"><option value="longcat-avatar-1.5">LongCat</option><option value="wan-5b">Wan</option></select></section><section data-section="references"></section><section data-section="prompt"></section><section data-section="controls"></section><div class="generation-footer"><button id="generate-video">Generate</button><p id="video-status"></p></div></form>',{url:'https://example.test',runScripts:'outside-only'}).window;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.onclose?.();};
 const records=[{id:'i',kind:'asset',media:'image',title:'Avatar'},{id:'v',kind:'asset',media:'video',title:'Style reference'},{id:'a',kind:'asset',media:'audio',title:'Speech',seconds:6,story_id:'s',settings:{lines:[{text:'Original words'}]}}];
 const ctx={data:{reference_ids:['i'],video_reference_ids:['v'],audio_reference_ids:['a']}},calls=[];
 Object.assign(w,{state:{records},activeStory:'s',renderPage:()=>{},boards:()=>[],media:()=>'',hydrateMedia:()=>{},gpuConnected:()=>true,modelAvailable:()=>true,modelSettings:()=>({resolution:'832x480'}),setGenerationBusy:()=>{},refresh:async()=>{},notice:()=>{},currentStory:()=>({title:'Test'}),modelPayload:()=>({})});
 w.EccoGeneration={context:()=>ctx,trackJob:()=>{}};
 w.api=async(path,body)=>{calls.push({path,body});return path==='ai/enhance'?{revisions:body.fields.map(f=>({id:f.id,text:'Directed shot: '+f.text})),questions:[]}:{id:'job'};};
 if(saved)w.localStorage.setItem('ecco-video-flow:s',JSON.stringify(saved));
 ctx.data={};records.push({id:'board',kind:'board',story_id:'s',created:1,scenes:[{title:'Beach',image_id:'i',motion:'Walk on the beach',seconds:3}]});
 w.eval(fs.readFileSync(__dirname+'/video-flow.js','utf8'));return {w,calls,ctx,q:s=>w.document.querySelector(s)};
}

test('new video carries story audio, original script, storyboard image and action',()=>{
 const {w,q}=fixture();const data=JSON.parse(w.localStorage.getItem('ecco-video-flow:s'));
 assert.deepEqual(data.audio_ids,['a']);assert.deepEqual(data.image_ids,['i']);assert.equal(data.shots[0].video_prompt,'Walk on the beach');assert.equal(q('[data-transcript]').value,'Original words');assert.equal(data.shots[0].seconds,6);w.close();
});
test('saved video selection and edited shot survive reopening',()=>{
 const saved={image_ids:['i'],audio_ids:[],video_ids:[],shots:[{title:'Edited',image_id:'i',seconds:9,selected:true,camera_move:'Orbit'}],directions:[],brief:'',analyzed:''};
 const {w}=fixture(saved);const data=JSON.parse(w.localStorage.getItem('ecco-video-flow:s'));assert.deepEqual(data.audio_ids,[]);assert.equal(data.shots[0].seconds,9);assert.equal(data.shots[0].camera_move,'Orbit');w.close();
});
