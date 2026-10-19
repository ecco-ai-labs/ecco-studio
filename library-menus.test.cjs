const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const source=fs.readFileSync(__dirname+'/library-menus.js','utf8');
function setup(ready=true){
 const dom=new JSDOM('<body><aside><details id="workspace-library-group" open><summary><span class="library-symbol"></span><span>Library</span></summary><div><details open><summary><span class="library-symbol"></span><span>Image Library</span></summary><div class="tree-branch-row" data-rename-id="a"><button class="tree-folder">People</button></div></details></div></details></aside></body>',{url:'https://example.test',runScripts:'outside-only'});
 const w=dom.window;w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))};
 w.state={records:[{id:'a',kind:'image_folder',name:'People'}],config:{storage:{rename_available:ready}}};
 w.page='library';w.navigate=()=>{};w.refresh=async()=>{};w.calls=[];w.api=async(path,body)=>{w.calls.push({path,body});};
 w.eval(source);return dom;
}
const tick=()=>new Promise(r=>setTimeout(r,0));
test('every header and saved label has a menu; menu click does not collapse the tree',()=>{
 const d=setup(),w=d.window;assert.equal(w.document.querySelectorAll('.library-more').length,3);
 const button=w.document.querySelector('details > .library-more');button.click();
 assert.equal(w.document.querySelector('#workspace-library-group').open,true);
 assert.equal(w.document.querySelector('[role=menuitem]').textContent,'Rename');
});
test('rename calls storage with stable id and expected old name; repeated submit is blocked',async()=>{
 const d=setup(),w=d.window;w.document.querySelector('[data-rename-id] .library-more').click();w.document.querySelector('[role=menuitem]').click();
 w.document.querySelector('input').value='Characters';const form=w.document.querySelector('form');form.dispatchEvent(new w.Event('submit',{cancelable:true}));form.dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();
 assert.equal(w.calls.length,1);assert.deepEqual(JSON.parse(JSON.stringify(w.calls[0])),{path:'library/rename',body:{id:'a',name:'Characters',expected_name:'People'}});
});
test('backend not deployed: no fake success and existing name retained',async()=>{
 const d=setup(false),w=d.window;w.document.querySelector('[data-rename-id] .library-more').click();w.document.querySelector('[role=menuitem]').click();
 w.document.querySelector('input').value='Characters';w.document.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();
 assert.equal(w.calls.length,0);assert.match(w.document.querySelector('[role=alert]').textContent,/storage service update/);assert.equal(w.state.records[0].name,'People');
});
test('heading rename persists and Escape closes menu',async()=>{
 const d=setup(),w=d.window;w.document.querySelector('details > .library-more').click();w.document.querySelector('[role=menuitem]').click();w.document.querySelector('input').value='My Library';w.document.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();
 assert.equal(JSON.parse(w.localStorage.getItem('ecco-library-heading-names')).Library,'My Library');
 w.document.querySelector('details > .library-more').click();w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(w.document.querySelector('[role=menu]'),null);
});
