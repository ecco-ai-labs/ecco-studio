const {test}=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom'),{readFileSync}=require('node:fs');
const source=readFileSync('activity-files.js','utf8');
function setup(saved){
 const dom=new JSDOM('<details data-category="Activity" open><summary>Settings</summary><div class="workspace-menu-items"></div></details>',{runScripts:'outside-only',url:'https://studio.test/'}),w=dom.window;
 w.state={config:{storage:{volume:'test-volume'}},records:[{id:'a',kind:'asset',media:'image',title:'Zebra',path:'images/zebra.png',created:1793664000},{id:'b',kind:'asset',media:'video',title:'Alpha',path:'videos/alpha.mp4',created:1793491200},{id:'c',kind:'asset',media:'audio',title:'beta',path:'audio/beta.wav'},{id:'d',kind:'asset',media:'image',title:'Trash file',deleted:true,created:1793750400},{id:'e',kind:'asset',media:'image',title:'Purged file',purged:true,created:1793750400}]};
 w.EccoAuth={user:{id:'alice'}};w.media=()=>'';w.hydrateMedia=()=>{};w.api=()=>{throw Error('Unexpected remote mutation');};w.HTMLMediaElement.prototype.pause=()=>{};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){if(this.open){this.open=false;this.dispatchEvent(new w.Event('close'));}};
 w.MutationObserver=class{observe(){}disconnect(){}};w.setInterval=()=>{};
 if(saved)for(const [key,value] of Object.entries(saved))w.localStorage.setItem(key,value);
 w.eval(source);const q=s=>w.document.querySelector(s);q('#activity-files-menu').click();
 return {w,q,ids:()=>[...q('#activity-files-list').querySelectorAll('tr[data-asset-id]')].map(r=>r.dataset.assetId),sort:key=>q('th[data-sort="'+key+'"] button').click(),close:()=>dom.window.close()};
}
test('all four file columns toggle sorting; unknown dates stay last and filters combine',()=>{
 const x=setup();try{
  assert.deepEqual(x.ids(),['a','b','c']);
  assert.equal(x.q('#activity-files-search').placeholder,'Search');assert.ok(x.q('.activity-files-filters').contains(x.q('#activity-files-search')));
  x.sort('name');assert.deepEqual(x.ids(),['b','c','a']);x.sort('name');assert.deepEqual(x.ids(),['a','c','b']);
  x.sort('kind');assert.deepEqual(x.ids(),['c','a','b']);x.sort('kind');assert.deepEqual(x.ids(),['b','a','c']);
  x.sort('created');assert.deepEqual(x.ids(),['b','a','c']);x.sort('created');assert.deepEqual(x.ids(),['a','b','c']);
  assert.equal(x.q('th[data-sort=created]').getAttribute('aria-sort'),'descending');
  assert.equal(x.q('tr[data-asset-id=c]').lastElementChild.textContent,'—');
  const search=x.q('#activity-files-search');search.focus();search.value='.MP4';search.dispatchEvent(new x.w.Event('input'));assert.deepEqual(x.ids(),['b']);assert.equal(x.w.document.activeElement,search);
  const type=x.q('#activity-files-type');type.value='image';type.dispatchEvent(new x.w.Event('change'));assert.deepEqual(x.ids(),[]);assert.match(x.q('#activity-files-list').textContent,/No files match/);
  search.value='';search.dispatchEvent(new x.w.Event('input'));assert.deepEqual(x.ids(),['a']);
  const location=x.q('#activity-files-location');location.value='trash';location.dispatchEvent(new x.w.Event('change'));assert.deepEqual(x.ids(),['d']);
 }finally{x.close();}
});
test('preview records last opened, sorting is chronological, close returns focus and history is user scoped',()=>{
 const x=setup();try{
  assert.equal(x.q('tr[data-asset-id=a]').children[2].textContent,'—');
  let now=1794000000000;x.w.Date.now=()=>now;
  x.q('[data-open-file=b]').click();assert.equal(x.q('#activity-file-preview').open,true);x.q('#activity-file-preview [aria-label="Close file preview"]').click();assert.equal(x.w.document.activeElement.dataset.openFile,'b');
  now+=60000;x.q('[data-open-file=a]').click();x.q('#activity-file-preview [aria-label="Close file preview"]').click();
  x.sort('opened');assert.deepEqual(x.ids(),['b','a','c']);x.sort('opened');assert.deepEqual(x.ids(),['a','b','c']);
  const saved=Object.fromEntries(Object.keys(x.w.localStorage).map(k=>[k,x.w.localStorage.getItem(k)]));const reloaded=setup(saved);try{assert.ok(reloaded.q('tr[data-asset-id=a]').children[2].querySelector('time'));}finally{reloaded.close();}
  x.w.EccoAuth.user={id:'bob'};x.w.document.dispatchEvent(new x.w.Event('ecco:auth-change'));assert.equal(x.q('#activity-files').open,false);x.q('#activity-files-menu').click();assert.equal(x.q('tr[data-asset-id=a]').children[2].textContent,'—');
 }finally{x.close();}
});
