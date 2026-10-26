const {test}=require('node:test');
const assert=require('node:assert/strict');
const {setup}=require('./audio-ui-test-helpers.cjs');

test('character frame populates the real image and video forms without submitting generation',async t=>{
 const x=await setup({'ecco-active-story':'video-story'});t.after(()=>x.close());
 // The shared fixture starts signed out at welcome; first navigation clears
 // its one-time welcome flag. This is a DOM fixture, not a live auth bypass.
 await x.go('images');await x.go('images');
 const imageForm=x.q('#image-form'),c=x.w.EccoGeneration.context(imageForm);
 assert.ok(c,'Image form mounted');
 const aid='image-1';x.w.testUI.addRecords([{id:aid,kind:'asset',media:'image',story_id:c.story,stage:'prod',title:'Character fixture',path:'fixture.png'}]);
 x.w.EccoGeneration.useCharacterFrame(imageForm,aid,'Munnu running in fear',c.story,3);
 assert.deepEqual(Array.from(c.data.reference_ids),[aid]);
 assert.equal(imageForm.elements.prompt.value,'Munnu running in fear');
 await x.go('render');
 const videoForm=x.q('#video-form'),v=x.w.EccoGeneration.context(videoForm);
 assert.ok(v,'Video form mounted');
 x.w.EccoGeneration.useCharacterFrame(videoForm,aid,'Munnu running in fear',v.story,3);
 assert.deepEqual(Array.from(v.data.reference_ids),[aid]);assert.equal(v.data.seconds,3);
 assert.equal(videoForm.elements.prompt.value,'Munnu running in fear');
 assert.equal(x.w.testCalls.filter(c=>['images','image-edits','videos','boards'].includes(c.path)).length,0);
 assert.throws(()=>x.w.EccoGeneration.useCharacterFrame(videoForm,aid,'Changed','another-story',3),/original story/);
});
