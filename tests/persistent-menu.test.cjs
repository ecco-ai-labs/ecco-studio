const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs');
const {JSDOM}=require('jsdom');
test('Disconnect menu has service choices, keeps parent open, disconnects only selected GPU',async()=>{
 const dom=new JSDOM('<body><main><header><div class="header-right"><span id="connected-accelerator"></span><button id="settings"></button></div></header></main><dialog id="connection-dialog"><h2></h2><div id="connections"></div></dialog></body>',{url:'https://example.test',runScripts:'outside-only'}),w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 const saved=new Set(['p7lc6fqjuosti3','1muqctw9bxvguu']);let storage=true,identity=true;const calls=[];
 w.eval('var state={config:{}},page="empty";var api=async()=>({});var notice=()=>{};');
 w.EccoErrors={show:e=>{throw e;}};w.EccoStorage={get ready(){return storage;},disconnect:()=>{storage=false;}};
 w.EccoAuth={get connected(){return identity;},signOut:async()=>{identity=false;}};
 w.EccoGPUConnection={get savedIds(){return [...saved];},isRemembered:id=>saved.has(id),isConnected:()=>false,status:()=>({kind:'unknown'}),disconnect:id=>{calls.push(id);saved.delete(id);w.document.dispatchEvent(new w.Event('ecco:gpu-connection-change'));}};
 try{
  w.eval(fs.readFileSync('gpu-picker.js','utf8'));w.eval(fs.readFileSync('ai-assistant.js','utf8'));
  w.document.querySelector('#disconnect-connections').click();
  const parent=w.document.querySelector('#disconnect-connections-dialog');assert.equal(parent.open,true);
  assert.deepEqual([...parent.querySelectorAll('h3')].map(x=>x.textContent),['Sign-in','Storage','AI','GPU','YouTube','TikTok','Instagram','WhatsApp','Meta','X']);
  [...parent.querySelectorAll('.connection')].find(x=>x.querySelector('h3').textContent==='GPU').querySelector('button').click();
  const child=w.document.querySelector('#gpu-disconnect-dialog');assert.equal(child.open,true);
  const select=child.querySelector('#gpu-instance-B200');select.value='p7lc6fqjuosti3';select.dispatchEvent(new w.Event('change'));
  child.querySelector('#gpu-status-B200').click();await new Promise(r=>setTimeout(r,10));
  assert.deepEqual(calls,['p7lc6fqjuosti3']);assert.ok(saved.has('1muqctw9bxvguu'));assert.equal(identity,true);assert.equal(storage,true);
  child.querySelector('.section-head button').click();assert.equal(child.open,false);assert.equal(parent.open,true);
 }finally{w.close();}
});
