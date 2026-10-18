const {JSDOM}=require('jsdom');
const fs=require('fs');const assert=require('node:assert/strict');
(async()=>{
const dom=new JSDOM('<section id="page"><form id="story-setup-form" data-draft-key="setup"><label>Genre<select name="genre"><option selected>News</option><option>Drama</option></select></label></form><details id="storyboard-ai-toolbar"><div class="storyboard-ai-actions"></div></details><textarea id="story-text"></textarea></section>',{url:'https://example.com',runScripts:'outside-only'});
const w=dom.window;w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))};
const errors=[];let replace=false, mutate=false;
Object.assign(w,{draft:{title:'Weekly News',story:'',scenes:[],defaultSeconds:5},activeStory:'news-1',persistDraft(){},renderScenes(){},savedBoard:null,EccoStorage:{ready:true},EccoAI:{enabled:true},confirm:()=>replace,notice:m=>errors.push(m)});
w.api=async(path,body)=>{if(path==='ai/status')return {news_research:true};if(path.endsWith('/research'))return {signature:'signed',research:{items:Array.from({length:body.count},(_,i)=>({title:'Item '+i,summary:'Summary',sources:[{title:'Source',url:'https://example.com',published_at:null}]}))}};if(mutate)w.draft.title='Edited';return {scenes:body.selected.map(i=>({narration:'Item '+i,motion:'Presenter',sources:[],seconds:5})),researched_at:'now'};};
w.eval(fs.readFileSync(require('path').join(__dirname,'news-research.js'),'utf8'));
const q=s=>w.document.querySelector(s);
assert.ok(q('[data-news-topic]'));assert.equal(q('[data-news-topic]').hidden,false);
q('[name=genre]').value='Drama';q('[name=genre]').dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(q('[data-news-topic]').hidden,true);
q('[data-web-research]').click();assert.ok(q('[data-prompt]').value.includes('top 10'));
await q('[data-research]').onclick();assert.equal(w.document.querySelectorAll('[data-item]').length,10);
q('[data-item="2"]').checked=false;await q('[data-create]').onclick();assert.equal(w.draft.scenes.length,9);assert.ok(!q('#news-research-dialog'));
q('[data-web-research]').click();await q('[data-research]').onclick();let before=JSON.stringify(w.draft);await q('[data-create]').onclick();assert.equal(JSON.stringify(w.draft),before);
replace=true;mutate=true;await q('[data-create]').onclick();assert.equal(w.draft.title,'Edited');assert.ok(errors.some(e=>e.includes('draft changed')));
dom.window.close();console.log('PASS: topic visibility, research review, selection count, replacement cancellation and concurrent-edit protection');
})().catch(e=>{console.error(e);process.exit(1)});
