const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup,tick}=require('../audio-ui-test-helpers.cjs');

test('Settings panel keeps model navigation, theme persistence and Drive actions working',async()=>{
 const x=await setup();try{
  const panel=x.q('#workspace-settings-controls'),preferences=panel.querySelector('details'),menu=preferences.querySelector('.workspace-menu-items');
  assert.deepEqual([...panel.children].map(el=>(el.matches('details')?el.querySelector('summary'):el).getAttribute('aria-label')),['Model Garden','User Preferences','Workspace Drive']);
  assert.deepEqual([...menu.querySelectorAll(':scope > button')].map(el=>el.textContent),['Themes']);
  panel.querySelector('[aria-label="Model Garden"]').click();await tick();assert.equal(x.q('#heading').textContent,'Model Garden');assert.ok(x.q('#models-form'));
  preferences.open=true;x.q('#theme-colors-open').click();assert.equal(x.q('#workspace-theme-drawer').hidden,false);
  const ocean=x.q('#workspace-theme-drawer input[value="ocean"]');ocean.checked=true;ocean.dispatchEvent(new x.w.Event('change',{bubbles:true}));
  assert.equal(x.w.document.documentElement.dataset.eccoTheme,'ocean');assert.equal(x.w.localStorage.getItem('ecco-theme-preset-v1'),'ocean');
  ocean.dispatchEvent(new x.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(x.q('#workspace-theme-drawer').hidden,true);assert.equal(x.w.document.activeElement,x.q('#theme-colors-open'));
  x.q('#theme-colors-open').dispatchEvent(new x.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(preferences.open,false);assert.equal(x.w.document.activeElement,preferences.querySelector('summary'));
  panel.querySelector('[aria-label="Workspace Drive"]').click();assert.equal(x.q('#activity-files').open,true);assert.equal(x.w.document.activeElement,x.q('#activity-files-search'));x.q('#activity-files [data-close]').click();
  await x.go('library');assert.equal(x.w.document.querySelectorAll('#workspace-settings-controls').length,1);assert.equal(panel.children.length,3);
  assert.deepEqual(x.errors,[]);
 }finally{x.close();}
});
