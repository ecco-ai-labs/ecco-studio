const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('./story-workspace-model.js');
const first=(...a)=>M.voiceModelRank(...a)[0];

test('acted stories get voices that act: VoxCPM2, Chatterbox for Hindi',()=>{
 assert.equal(first('podcast','Science & Technology','English'),'voxcpm2');
 assert.equal(first('audio-drama','Horror','German'),'voxcpm2');
 assert.equal(first('interview','Business','Hindi'),'chatterbox');
});
test('narration gets Kokoro where it speaks the language, else VoxCPM2; Hindi narration gets IndicF5',()=>{
 assert.equal(first('news','Business','English'),'kokoro');
 assert.equal(first('documentary','History','Korean'),'voxcpm2');
 assert.equal(first('teaching','Nature','Hindi'),'indicf5');
});
test('Other follows the genre mood',()=>{
 assert.equal(first('custom','Thriller','French'),'voxcpm2');
 assert.equal(first('custom','Sports','French'),'kokoro');
});
test('Indian languages get IndicF5 then Indic-MIO; Urdu only Indic-MIO',()=>{
 assert.deepEqual(M.voiceModelRank('podcast','Comedy','Tamil').slice(0,2),['indicf5','indic-mio']);
 assert.equal(first('storybook','Fantasy','Urdu'),'indic-mio');
});
