// Model per use case (owner-approved 17 Nov 2026).
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const c={document:{addEventListener(){}},localStorage:{getItem:()=>null},location:{hash:''},window:{}};
vm.createContext(c);vm.runInContext(fs.readFileSync('models.js','utf8')+';this.profiles=modelProfiles;',c);
assert.equal(c.profiles.selected.video,'wan-a14b','video defaults to Wan 2.2 14B, not the no-motion preview');
assert.equal(c.useCaseModel('image'),'qwen-image-2512');
assert.equal(c.useCaseModel('image',{references:1,current:'qwen-image-2512'}),'qwen-image-edit-2511');
assert.equal(c.useCaseModel('image',{current:'qwen-image-edit-2511'}),'qwen-image-2512');
assert.equal(c.useCaseModel('image',{current:'flux-klein-4b'}),'flux-klein-4b','a chosen image model is kept');
assert.equal(c.useCaseModel('video',{speech:true,current:'wan-a14b'}),'longcat-avatar-1.5');
assert.equal(c.useCaseModel('video',{current:'longcat-avatar-1.5'}),'wan-a14b');
assert.equal(c.useCaseModel('video',{current:'wan-5b'}),'wan-5b','Wan 5B stays for a quick draft');
assert.equal(c.useCaseModel('video',{current:'preview'}),'preview','a chosen preview is kept');
console.log('PASS: each use case picks its model.');
