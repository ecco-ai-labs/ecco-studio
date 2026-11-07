const {test}=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom'),{readFileSync}=require('node:fs');
const tick=()=>new Promise(r=>setImmediate(r));
const source=readFileSync('library-browser.js','utf8');
function setup(kind){const id={image:'library-gallery',audio:'audio-library-gallery',video:'video-library-gallery',story:'story-library-list',workflow:'workflow-library-list'}[kind];const dom=new JSDOM('<div id="page"><div class="section-head"><h2>Library</h2><div class="row"><select aria-label="View"><option>List</option></select></div></div><div id="'+id+'" class="library-list"></div></div>',{runScripts:'outside-only',url:'https://studio.example/'}),w=dom.window,obs=[];const O=w.MutationObserver;w.MutationObserver=class extends O{constructor(f){super(f);obs.push(this);}};w.EccoAuth={user:{id:'one'}};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};w.HTMLMediaElement.prototype.pause=function(){};w.state={records:[{id:'a',title:'Zebra',created:1700000000,media:kind,kind:'asset',stage:'dev',settings:{model:'Test Model'},duration:65,size_bytes:2048},{id:'b',title:'Alpha',created:1800000000,media:kind,kind:'asset',stage:'prod',size_bytes:4096},{id:'c',title:'Missing metadata',media:kind,kind:'asset'}]};const gallery=w.document.getElementById(id);for(const r of w.state.records){const c=w.document.createElement('article');c.className='card';c.dataset.libraryId=r.id;c.innerHTML='<'+(kind==='audio'?'audio':'video')+' controls data-asset="'+r.id+'"></'+(kind==='audio'?'audio':'video')+'><div class="card-body"><p>'+r.title+'</p><input type="checkbox" checked><button>Action</button></div>';gallery.append(c);}w.eval(source);return {w,gallery,close:()=>{obs.forEach(o=>o.disconnect());dom.window.close();}};}
for(const kind of ['image','audio','video','story','workflow'])test(kind+' library: sort/filter, metadata, preserved selection and node identity',async()=>{
 const x=setup(kind),{w,gallery}=x;try{await tick();const a=gallery.querySelector('[data-library-id=a]'),player=a.querySelector('audio,video');assert.deepEqual([...gallery.querySelectorAll('.card')].map(c=>c.dataset.libraryId),['b','a','c']);assert.match(a.querySelector('.library-metadata').textContent,/Created.*Size|Created.*Model/);if(['image','audio','video'].includes(kind))assert.match(a.textContent,/2.0 KB/);
 const sort=gallery.querySelector('[data-sort=title] button');sort.click();await tick();assert.equal(gallery.querySelector('.card').dataset.libraryId,'b');
 const search=w.document.querySelector('input[type=search]');search.value='zebra';search.dispatchEvent(new w.Event('input'));await tick();assert.equal(a.hidden,false);assert.equal(gallery.querySelector('[data-library-id=b]').hidden,true);assert.equal(a.querySelector('input').checked,true);assert.equal(a.querySelector('audio,video'),player);
 search.value='no match';search.dispatchEvent(new w.Event('input'));await tick();assert.equal(gallery.querySelector('.library-filter-empty').hidden,false);
 search.value='';search.dispatchEvent(new w.Event('input'));await tick();assert.equal(gallery.querySelector('.library-filter-empty').hidden,true);
 w.EccoMediaMetadata.set('c',{size:8192});w.dispatchEvent(new w.Event('ecco:media-metadata'));await tick();if(['image','audio','video'].includes(kind)){assert.match(gallery.querySelector('[data-library-id=c]').textContent,/8.0 KB/);}
 }finally{x.close();}
});

test('headers sort all four columns, keep unknown dates last, and preserve focus',async()=>{
 const x=setup('audio'),{w,gallery}=x;try{await tick();
 assert.deepEqual([...gallery.querySelectorAll('[role=columnheader]')].map(c=>c.textContent.replace(/[↑↓]/g,'').trim()),['File Name','Type','Date Created','Date Last Accessed']);
 for(const key of ['title','type','created','accessed'])for(let i=0;i<2;i++){const button=gallery.querySelector('[data-sort='+key+'] button');button.focus();button.click();await tick();assert.equal(w.document.activeElement,button);if(['created','accessed'].includes(key))assert.equal([...gallery.querySelectorAll(':scope > .card')].at(-1).dataset.libraryId,'c');}
 }finally{x.close();}
});
test('preview preserves existing media/actions and records only explicit access, scoped per user/workspace',async()=>{
 const x=setup('audio'),{w,gallery}=x;try{await tick();const a=gallery.querySelector('[data-library-id=a]'),button=a.querySelector('.library-file-open'),player=a.querySelector('audio'),action=a.querySelector('.card-body button');let clicks=0;action.onclick=()=>clicks++;
 assert.equal(a.querySelector('.library-file-accessed').textContent,'—');button.focus();button.click();await tick();const dialog=w.document.querySelector('.library-file-preview');assert.equal(dialog.open,true);assert.equal(dialog.querySelector('audio'),player);action.click();assert.equal(clicks,1);assert.notEqual(a.querySelector('.library-file-accessed').textContent,'—');
 dialog.close();await tick();assert.equal(w.document.activeElement,button);assert.equal(a.querySelector('audio'),player);assert.equal(a.querySelector('input').checked,true);
 assert.ok(Object.keys(w.localStorage).some(k=>k.startsWith('ecco-library-accessed:')));
 w.EccoAuth.user={id:'two'};w.document.dispatchEvent(new w.Event('ecco:auth-change'));await tick();assert.equal(a.querySelector('.library-file-accessed').textContent,'—');
 w.EccoAuth.user={id:'one'};w.document.dispatchEvent(new w.Event('ecco:auth-change'));await tick();assert.notEqual(a.querySelector('.library-file-accessed').textContent,'—');
 w.state.config={storage:{volume:'second'}};w.dispatchEvent(new w.Event('ecco:media-metadata'));await tick();assert.equal(a.querySelector('.library-file-accessed').textContent,'—');
 }finally{x.close();}
});
