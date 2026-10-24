const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
function fixture(t){
 const dom=new JSDOM('<button id="opener">Upload</button>',{runScripts:'outside-only',url:'https://example.test'}),w=dom.window;t.after(()=>w.close());
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};w.HTMLCanvasElement.prototype.getContext=()=>({});
 w.IntersectionObserver=class{constructor(fn){this.fn=fn;}observe(target){this.fn([{target,isIntersecting:true}]);}disconnect(){}};
 let destroyed=0;
 const pages=['Excluded first page.','Use only page two.'];
 const doc={numPages:2,getMetadata:async()=>({info:{Title:'Fixture title'}}),getPage:async n=>({getViewport:({scale})=>({width:600*scale,height:800*scale}),render:()=>({promise:Promise.resolve()}),getTextContent:async()=>({items:[{str:pages[n-1]}]})})};
 w.pdfFixture={GlobalWorkerOptions:{},getDocument:()=>({destroy:async()=>{destroyed++;},promise:Promise.resolve(doc)}),TextLayer:class{constructor({container,textContentSource}){this.container=container;this.text=textContentSource.items[0].str;}async render(){const span=w.document.createElement('span');span.textContent=this.text;this.container.append(span);}}};
 w.eval(fs.readFileSync(__dirname+'/source-chapters.js','utf8'));
 w.eval(fs.readFileSync(__dirname+'/source-picker.js','utf8').replace("import('https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.min.mjs')",'Promise.resolve(window.pdfFixture)'));
 const applied=[],picker=w.EccoSourcePicker.create({onApply:value=>applied.push(value),maxSelection:20000}),q=s=>w.document.querySelector(s);
 return {w,picker,q,applied,destroyed:()=>destroyed};
}
test('PDF preview supports later pages and commits only highlighted text with filename and title',async t=>{
 const x=fixture(t);await x.picker.load({name:'paper.pdf',size:100,arrayBuffer:async()=>new ArrayBuffer(0)},x.q('#opener'));await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(x.q('dialog').open,true);assert.equal(x.q('[data-extract]').disabled,true);assert.equal(x.q('.pdf-page-scroll').children.length,2);assert.equal(x.applied.length,0);
 const text=x.q('[data-page="2"] .textLayer span').firstChild,range=x.w.document.createRange();range.selectNodeContents(text);x.w.getSelection().removeAllRanges();x.w.getSelection().addRange(range);x.q('.pdf-page-scroll').dispatchEvent(new x.w.MouseEvent('mouseup'));
 assert.equal(x.q('[data-selected]').value,'Use only page two.');x.q('[data-extract]').click();assert.deepEqual(JSON.parse(JSON.stringify(x.applied)),[{text:'Use only page two.',name:'paper.pdf',title:'Fixture title',scope:'selected'}]);assert.equal(x.w.document.activeElement,x.q('#opener'));assert.equal(x.q('dialog').open,false);
 x.picker.destroy();assert.equal(x.destroyed(),1);assert.equal(x.q('dialog'),null);
});
test('Oversize selections cannot apply and cancelled late document reads cannot revive the picker',async t=>{
 const x=fixture(t);await x.picker.load({name:'text.md',size:22000,text:async()=>'a'.repeat(21000)},x.q('#opener'));
 x.q('[data-selected]').value='a'.repeat(20001);x.q('[data-selected]').dispatchEvent(new x.w.Event('input'));assert.equal(x.q('[data-extract]').disabled,true);assert.match(x.q('[role=status]').textContent,/20,000/);assert.equal(x.applied.length,0);
 let finish;const pending=x.picker.load({name:'late.txt',size:10,text:()=>new Promise(resolve=>finish=resolve)},x.q('#opener'));x.picker.destroy();finish('Late words');await pending;assert.equal(x.q('dialog'),null);assert.equal(x.picker.ready,false);assert.equal(x.applied.length,0);
});
test('PDF page range selection extracts only those pages and invalid ranges never reuse the previous selection',async t=>{
 const x=fixture(t);await x.picker.load({name:'book.pdf',size:100,arrayBuffer:async()=>new ArrayBuffer(0)},x.q('#opener'));
 x.q('[data-pages]').value='2';x.q('[data-select-pages]').click();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(x.q('[data-selected]').value,'Use only page two.');assert.equal(x.q('[data-extract]').disabled,false);
 x.q('[data-extract]').click();assert.equal(x.applied[0].text,'Use only page two.');assert.deepEqual(Array.from(x.applied[0].pages),[2]);x.picker.open();x.q('[data-pages]').value='9-12';x.q('[data-select-pages]').click();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(x.q('[data-selected]').value,'');assert.equal(x.q('[data-extract]').disabled,true);assert.match(x.q('[role=status]').textContent,/between 1 and 2/);
});
test('Chapter lookup shows missing-input and connection errors beside its button',async t=>{
 const x=fixture(t);await x.picker.load({name:'book.pdf',size:100,arrayBuffer:async()=>new ArrayBuffer(0)},x.q('#opener'));
 x.q('[data-find-chapter]').click();await new Promise(r=>setTimeout(r,0));assert.match(x.q('[data-selection-feedback]').textContent,/Enter a chapter/);assert.equal(x.q('[data-find-chapter]').disabled,false);
 x.q('[data-chapter]').value='Chapter 1';x.q('[data-find-chapter]').click();await new Promise(r=>setTimeout(r,0));assert.match(x.q('[data-selection-feedback]').textContent,/Connect AI and workspace storage/);assert.equal(x.q('[data-extract]').disabled,true);
});
test('Chapter search stays visibly busy through verification and applies only bounded text',async t=>{
 const x=fixture(t);await x.picker.load({name:'book.pdf',size:100,arrayBuffer:async()=>new ArrayBuffer(0)},x.q('#opener'));x.w.EccoStorage={ready:true};x.w.EccoAI={enabled:true};let verify;
 x.w.api=async(path,body)=>body.fields[0].id==='chapter_location'?{revisions:[{id:'chapter_location',text:JSON.stringify({chapter_title:'Chapter 2',start:{page:2,line:1,text:'Use only page two.'},end:null,ends_at_document_end:true})}]}:new Promise(resolve=>verify=resolve);
 x.q('[data-chapter]').value='Chapter 2';x.q('[data-find-chapter]').click();await new Promise(r=>setTimeout(r,0));assert.equal(x.q('[data-find-chapter]').getAttribute('aria-busy'),'true');assert.ok(x.q('[data-find-chapter] .generation-spinner'));assert.match(x.q('[data-selection-feedback]').textContent,/Finding and verifying/);assert.equal(x.q('[data-extract]').disabled,true);
 verify({revisions:[{id:'chapter_verification',text:'{"valid":true,"reason":"Verified"}'}]});await new Promise(r=>setTimeout(r,0));assert.equal(x.q('[data-selected]').value,'Use only page two.');x.q('[data-extract]').click();assert.equal(x.applied[0].text,'Use only page two.');assert.deepEqual(Array.from(x.applied[0].pages),[2]);
});
