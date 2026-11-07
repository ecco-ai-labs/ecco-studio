const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup,tick,input}=require('../audio-ui-test-helpers.cjs');

test('Back restores the actual library view and search, then the unfinished story',async()=>{
 const x=await setup();try{
  x.w.scrollTo=()=>{};x.w.EccoWorkspaceUI.startNewStory({id:'',format:''});await tick();
  input(x,'[name=title]','Keep this story');
  await x.go('library');const search=x.q('.library-browser-tools input');search.value='Zebra';search.dispatchEvent(new x.w.Event('input'));await tick();
  const view=x.q('.library-view-label select');view.value='large';view.dispatchEvent(new x.w.Event('change'));await tick();
  x.q('[aria-label="Model Garden"]').click();await tick();assert.equal(x.q('#heading').textContent,'Model Garden');
  x.q('#workspace-back').click();await tick();assert.equal(x.q('.library-view-label select').value,'large');assert.equal(x.q('.library-browser-tools input').value,'Zebra');
  x.q('#workspace-back').click();await tick();assert.equal(x.q('[name=title]').value,'Keep this story');assert.equal(x.q('#story-simple-tab-0').getAttribute('aria-selected'),'true');
  assert.deepEqual(x.errors,[]);
 }finally{x.close();}
});
test('Support Back returns to its origin and exhausted history never opens welcome',async()=>{
 const x=await setup();try{
  x.w.scrollTo=()=>{};await x.go('models');x.w.EccoNavigation.reset();await tick();
  x.q('#workspace-support').click();await tick();assert.equal(x.q('#heading').textContent,'Ecco Desk · Support');assert.equal(x.q('[data-screen-back]').textContent,'← Back');
  x.q('#workspace-back').click();await tick();assert.equal(x.q('#heading').textContent,'Model Garden');assert.ok(x.q('#models-form'));
  assert.equal(x.q('#workspace-back').disabled,true);assert.equal(x.w.EccoNavigation.back(),false);assert.equal(x.w.document.body.classList.contains('workspace-entry-mode'),false);
  x.w.document.dispatchEvent(new x.w.Event('ecco:auth-change'));assert.equal(x.w.EccoNavigation.depth,0);await tick();
 }finally{x.close();}
});
test('Only the page has Back; menus and popups retain their own dismissal',async()=>{
 const x=await setup();try{
  await x.go('models');const depth=x.w.EccoNavigation.depth,menu=x.q('#workspace-settings-controls details');menu.open=true;
 assert.equal(menu.querySelector('.ecco-back'),null);menu.querySelector('summary').dispatchEvent(new x.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(menu.open,false);assert.equal(x.w.document.activeElement,menu.querySelector('summary'));
  x.q('#activity-files-menu').click();await tick();assert.equal(x.q('#activity-files .ecco-back'),null);x.q('#activity-files [data-close]').click();await tick();assert.equal(x.q('#activity-files').open,false);assert.equal(x.w.EccoNavigation.depth,depth);assert.ok(x.q('#models-form'));assert.equal(x.w.document.querySelectorAll('.ecco-back').length,1);assert.ok(x.q('#workspace-back'));
 }finally{x.close();}
});
