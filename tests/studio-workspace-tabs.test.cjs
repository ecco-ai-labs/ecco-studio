const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup,tick}=require('../audio-ui-test-helpers.cjs');
for(const [kind,page] of [['image','images'],['video','render'],['audio','audio']])test(kind+' uses workspace tabs with keyboard navigation and preserves review nodes',async()=>{
 const x=await setup({'ecco-active-story':'video-story'});try{
 await x.go('welcome');await x.go(page);await tick();const nav=x.q('.studio-workspace-tabs');assert.ok(nav,kind);const tabs=[...nav.querySelectorAll('[role=tab]')];assert.deepEqual(tabs.map(t=>t.textContent),['Final Script','Progress','Review']);assert.equal(tabs[0].getAttribute('aria-selected'),'true');
 tabs[0].dispatchEvent(new x.w.KeyboardEvent('keydown',{key:'End',bubbles:true}));assert.equal(tabs[2].getAttribute('aria-selected'),'true');assert.equal(x.w.document.activeElement,tabs[2]);assert.equal(x.q('#'+tabs[2].getAttribute('aria-controls')).hidden,false);
 tabs[2].dispatchEvent(new x.w.KeyboardEvent('keydown',{key:'Home',bubbles:true}));assert.equal(tabs[0].getAttribute('aria-selected'),'true');
 if(kind!=='audio'){
 const gallery=x.q('#'+kind+'-gallery'),node=x.w.document.createElement('span');node.textContent='Existing result';gallery.append(node);tabs[2].click();tabs[1].click();await tick();assert.equal(node.parentElement,gallery);assert.equal(tabs[1].getAttribute('aria-selected'),'true');
 const status=x.q('#'+kind+'-status');assert.equal(status.closest('form'),x.q('#'+kind+'-form'));status.textContent='Generating: step 7/20';await tick();assert.match(x.q('#'+kind+'-progress-panel').textContent,/step 7\/20/);
 if(kind==='image'){const editor=x.q('[data-final-image-prompt]');editor.value='A new scene';editor.dispatchEvent(new x.w.Event('input',{bubbles:true}));assert.equal(x.w.EccoGeneration.context(x.q('#image-form')).data.prompt,'A new scene');}
 }
 }finally{await tick();x.close();}
});
test('video Final Script reflects selected shots and opens existing shot editor',async()=>{
 const x=await setup({'ecco-active-story':'video-story','ecco-video-flow:video-story':JSON.stringify({image_ids:[],video_ids:[],audio_ids:[],shots:[{title:'Beach',selected:true,seconds:3,video_prompt:'A dog runs',camera_move:'Pan left'},{title:'Unused',selected:false,seconds:3,video_prompt:'Hidden'}],directions:[],brief:'',analyzed:''})});try{
 await x.go('render');await tick();assert.match(x.q('#video-final-script-panel').textContent,/A dog runs/);assert.ok(!x.q('#video-final-script-panel').textContent.includes('Hidden'));x.q('[data-final-shots] button').click();await tick();assert.ok(x.q('#video-shot-controls[open]'));
 }finally{await tick();x.close();}
});
