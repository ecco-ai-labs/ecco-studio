const {test}=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom'),{readFileSync}=require('node:fs');
const css=readFileSync('popup-controls.css','utf8'),script=readFileSync('popup-close.js','utf8');
test('all modal controls share geometry and palette; nested close and minimize preserve parent work',async()=>{
 const dom=new JSDOM('<style>'+readFileSync('ai-assistant.css','utf8')+css+'</style><dialog id="connection-dialog" open><h2>Parent</h2><input value="Keep my work"><button>Cancel</button></dialog>',{runScripts:'outside-only'}),w=dom.window;
 const observers=[],Observer=w.MutationObserver;w.MutationObserver=class extends Observer{constructor(fn){super(fn);observers.push(this);}};
 w.navigate=()=>{};w.HTMLDialogElement.prototype.show=function(){this.open=true;};w.HTMLDialogElement.prototype.showModal=w.HTMLDialogElement.prototype.show;w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 try{
 w.eval(script);const parent=w.document.querySelector('dialog');
 const child=w.document.createElement('dialog');child.innerHTML='<h2>Child</h2>';w.document.body.append(child);child.showModal();await new Promise(r=>setImmediate(r));
 for(const dialog of [parent,child]){
 const close=dialog.querySelector('.ecco-popup-close'),min=dialog.querySelector('.ecco-popup-minimize');
 for(const prop of ['width','height','minWidth','maxWidth','padding','borderRadius','backgroundColor','color','boxShadow','fontSize'])assert.equal(w.getComputedStyle(close)[prop],w.getComputedStyle(min)[prop],prop);
 assert.equal(w.getComputedStyle(close).width,'26px');assert.equal(w.getComputedStyle(close).padding,'0px');assert.equal(w.getComputedStyle(close).height,'26px');assert.equal(w.getComputedStyle(close).justifyContent,'center');assert.equal(w.getComputedStyle(close).alignItems,'center');assert.equal(w.getComputedStyle(close.querySelector('svg')).width,'14px');
 }
 child.querySelector('.ecco-popup-minimize').click();assert.equal(parent.dataset.eccoMinimized,'true');assert.equal(child.dataset.eccoMinimized,'true');
 w.document.querySelector('#ecco-popup-resume button').click();child.querySelector('.ecco-popup-close').click();assert.equal(child.open,false);assert.equal(parent.open,true);assert.equal(parent.querySelector('input').value,'Keep my work');
 }finally{await new Promise(r=>setImmediate(r));observers.forEach(o=>o.disconnect());dom.window.close();}
});
