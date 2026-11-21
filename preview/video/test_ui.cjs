const fs=require('fs'),vm=require('vm'),assert=require('assert');
const c={modelAvailable:()=>false,modelStatus:()=>'',card:()=>'',renderPage:()=>{},api:async()=>({records:[{kind:'longcat_job',id:'j',status:'running'}]}),localStorage:{getItem:()=> 'selected'},state:{config:{longcat:{workers:[]}}}};
vm.createContext(c);vm.runInContext(fs.readFileSync(__dirname+'/../longcat-video.js','utf8'),c);
assert.equal(c.modelAvailable('longcat-avatar-1.5'),false);
c.state.config.longcat.workers=[{pod:'other',ready:true}];assert.equal(c.modelAvailable('longcat-avatar-1.5'),false);
c.state.config.longcat.workers=[{pod:'selected',ready:true}];assert.equal(c.modelAvailable('longcat-avatar-1.5'),true);
c.api('state').then(r=>{assert.equal(r.records[0].kind,'job');assert.equal(r.records[0].source_kind,'longcat_job');console.log('Readiness and Activity checks passed');});
