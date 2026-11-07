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
 w.eval(fs.readFileSync(__dirname+'/ai-text-refinement.js','utf8'));
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
test('three panes keep the whole document separate, start blank, and place every editing action on the right',async t=>{
 const x=fixture(t);await x.picker.load({name:'full.txt',size:80,text:async()=>'Unselected document text.'},x.q('#opener'));
 const panes=[...x.q('.pdf-selection-layout').children];assert.equal(panes.length,3);assert.ok(panes[0].contains(x.q('.pdf-page-scroll')));assert.ok(panes[1].contains(x.q('[data-selected]')));
 for(const selector of ['[data-pages]','[data-find-chapter]','[data-improve-selection]','[data-clear-selection]','[data-find-text]','[data-replace]','[data-extract]'])assert.ok(panes[2].contains(x.q(selector)),selector);
 assert.equal(x.q('[data-selected]').value,'');assert.equal(x.q('[data-improve-selection]').disabled,true);assert.equal(x.q('[data-extract]').disabled,true);assert.match(panes[0].textContent,/Unselected document/);assert.equal(x.applied.length,0);
 x.q('[data-selected]').value='Old excerpt';x.q('[data-selected]').dispatchEvent(new x.w.Event('input'));x.q('[data-pages]').value='2';x.q('[data-find-text]').value='old';
 await x.picker.load({name:'new.md',size:50,text:async()=>'A new full document.'},x.q('#opener'));assert.equal(x.q('[data-selected]').value,'');assert.equal(x.q('[data-pages]').value,'');assert.equal(x.q('[data-find-text]').value,'');assert.match(x.q('.source-text-preview').textContent,/new full document/);
});
test('PDF pages fit the left pane with their canvas and selectable text scaled together',async t=>{
 const x=fixture(t);Object.defineProperty(x.q('.pdf-page-scroll'),'clientWidth',{value:360});x.q('.pdf-page-scroll').style.padding='12px';
 await x.picker.load({name:'book.pdf',size:100,arrayBuffer:async()=>new ArrayBuffer(0)},x.q('#opener'));await new Promise(r=>setTimeout(r,0));
 const shell=x.q('.pdf-story-page');assert.equal(parseFloat(shell.style.width),336);assert.ok(shell.querySelector('.pdf-page-content canvas'));assert.ok(shell.querySelector('.pdf-page-content .textLayer'));assert.match(shell.querySelector('.pdf-page-content').style.transform,/scale\(0\./);assert.equal(x.q('[data-selected]').value,'');
});
test('Improve with AI sends only the exact selected passage and requires review before replacing it',async t=>{
 const x=fixture(t);await x.picker.load({name:'full.txt',size:80,text:async()=>'PRIVATE_UNSELECTED text.'},x.q('#opener'));x.w.EccoStorage={ready:true};x.w.EccoAI={enabled:true};const calls=[];
 x.w.api=async(path,body)=>{calls.push({path,body});return {revisions:[{id:'source_excerpt',text:'great'}]};};const selected=x.q('[data-selected]');selected.value='A good story.\nKeep this ending.';selected.dispatchEvent(new x.w.Event('input'));selected.setSelectionRange(2,6);
 x.q('[data-improve-selection]').click();const ai=x.q('#source-selection-ai');assert.ok(ai.open);assert.equal(x.w.document.activeElement,ai.querySelector('[data-instructions]'));assert.equal(ai.querySelector('[data-selected-text]').value,'good');assert.equal(calls.length,0);
 ai.querySelector('[data-instructions]').value='Use a stronger word.';ai.querySelector('form').requestSubmit();await new Promise(r=>setTimeout(r,0));
 assert.equal(calls.length,1);assert.equal(calls[0].body.fields[0].text,'good');assert.equal(calls[0].body.story_id,null);assert.doesNotMatch(JSON.stringify(calls),/PRIVATE_UNSELECTED|Keep this ending/);assert.equal(selected.value,'A good story.\nKeep this ending.');assert.equal(x.applied.length,0);
 ai.querySelector('[data-apply]').click();assert.equal(selected.value,'A great story.\nKeep this ending.');assert.equal(x.q('.pdf-story-dialog').open,true);assert.equal(x.w.document.activeElement,x.q('[data-improve-selection]'));assert.equal(x.applied.length,0);assert.equal(x.q('.source-text-preview').textContent,'PRIVATE_UNSELECTED text.');
 x.q('[data-extract]').click();assert.equal(x.applied[0].text,'A great story.\nKeep this ending.');
});
test('AI errors, stale replies and closing its nested dialog preserve the source selection',async t=>{
 const x=fixture(t);await x.picker.load({name:'source.txt',size:40,text:async()=>'Original words.'},x.q('#opener'));const selected=x.q('[data-selected]');selected.value='Original words.';selected.dispatchEvent(new x.w.Event('input'));selected.setSelectionRange(0,0);
 x.q('[data-improve-selection]').click();let ai=x.q('#source-selection-ai');ai.querySelector('[data-instructions]').value='Make it clearer.';ai.querySelector('form').requestSubmit();await new Promise(r=>setTimeout(r,0));assert.match(ai.querySelector('[role=status]').textContent,/Connect AI and workspace storage/);assert.equal(selected.value,'Original words.');ai.querySelector('[data-close]').click();assert.ok(x.q('.pdf-story-dialog').open);assert.equal(x.w.document.activeElement,x.q('[data-improve-selection]'));
 x.w.EccoStorage={ready:true};x.w.EccoAI={enabled:true};let finish;x.w.api=()=>new Promise(resolve=>finish=resolve);x.q('[data-improve-selection]').click();ai=x.q('#source-selection-ai');ai.querySelector('[data-instructions]').value='Make it clearer.';ai.querySelector('form').requestSubmit();selected.value='My newer edit.';selected.dispatchEvent(new x.w.Event('input'));finish({revisions:[{id:'source_excerpt',text:'Late suggestion.'}]});await new Promise(r=>setTimeout(r,0));assert.match(ai.querySelector('[role=status]').textContent,/source or selection changed/);assert.equal(selected.value,'My newer edit.');assert.equal(ai.querySelector('[data-apply]').disabled,true);
 x.picker.clear();assert.equal(x.q('#source-selection-ai'),null);assert.equal(x.q('[data-selected]').value,'');assert.equal(x.applied.length,0);
});
test('Clear Selected Text preserves the document and lets the same excerpt be selected again',async t=>{
 const x=fixture(t);await x.picker.load({name:'source.txt',size:40,text:async()=>'Keep the source intact.'},x.q('#opener'));const capture=()=>{const range=x.w.document.createRange();range.selectNodeContents(x.q('.source-text-preview'));x.w.getSelection().removeAllRanges();x.w.getSelection().addRange(range);x.q('.pdf-page-scroll').dispatchEvent(new x.w.MouseEvent('mouseup'));};capture();assert.equal(x.q('[data-selected]').value,'Keep the source intact.');
 x.q('[data-clear-selection]').click();assert.equal(x.q('[data-selected]').value,'');assert.equal(x.q('[data-extract]').disabled,true);assert.equal(x.q('.source-text-preview').textContent,'Keep the source intact.');capture();assert.equal(x.q('[data-selected]').value,'Keep the source intact.');
});
test('Oversize selections cannot apply and cancelled late document reads cannot revive the picker',async t=>{
 const x=fixture(t);await x.picker.load({name:'text.md',size:22000,text:async()=>'a'.repeat(21000)},x.q('#opener'));
 x.q('[data-selected]').value='a'.repeat(20001);x.q('[data-selected]').dispatchEvent(new x.w.Event('input'));assert.equal(x.q('[data-extract]').disabled,true);assert.match(x.q('[role=status]').textContent,/20,000/);assert.equal(x.applied.length,0);
 let finish;const pending=x.picker.load({name:'late.txt',size:10,text:()=>new Promise(resolve=>finish=resolve)},x.q('#opener'));x.picker.destroy();finish('Late words');await pending;assert.equal(x.q('dialog'),null);assert.equal(x.picker.ready,false);assert.equal(x.applied.length,0);
});
test('PDF page selections append and invalid ranges preserve the earlier excerpts with a visible error',async t=>{
 const x=fixture(t);await x.picker.load({name:'book.pdf',size:100,arrayBuffer:async()=>new ArrayBuffer(0)},x.q('#opener'));
 x.q('[data-pages]').value='2';x.q('[data-select-pages]').click();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(x.q('[data-selected]').value,'Use only page two.');assert.equal(x.q('[data-extract]').disabled,false);
 x.q('[data-extract]').click();assert.equal(x.applied[0].text,'Use only page two.');assert.deepEqual(Array.from(x.applied[0].pages),[2]);x.picker.open();x.q('[data-pages]').value='9-12';x.q('[data-select-pages]').click();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(x.q('[data-selected]').value,'Use only page two.');assert.equal(x.q('[data-extract]').disabled,false);assert.match(x.q('[role=status]').textContent,/between 1 and 2/);
 x.q('[data-pages]').value='1';x.q('[data-select-pages]').click();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(x.q('[data-selected]').value,'Use only page two.\n\nExcluded first page.');x.q('[data-extract]').click();assert.deepEqual(Array.from(x.applied[1].pages),[1,2]);assert.equal(x.applied[1].selection_label,'Selected excerpts');
});
test('Separate highlights accumulate once each and survive reopening the same source',async t=>{
 const x=fixture(t);await x.picker.load({name:'excerpts.txt',size:100,text:async()=>'First excerpt. Omit this gap. Last excerpt.'},x.q('#opener'));
 const node=x.q('.source-text-preview').firstChild,highlight=(start,end,event='mouseup')=>{const range=x.w.document.createRange();range.setStart(node,start);range.setEnd(node,end);x.w.getSelection().removeAllRanges();x.w.getSelection().addRange(range);x.q('.pdf-page-scroll').dispatchEvent(new x.w.MouseEvent(event));};
 highlight(0,14);x.q('.pdf-page-scroll').dispatchEvent(new x.w.KeyboardEvent('keyup',{key:'Shift'}));assert.equal(x.q('[data-selected]').value,'First excerpt.');
 highlight(node.textContent.indexOf('Last excerpt.'),node.textContent.length);assert.equal(x.q('[data-selected]').value,'First excerpt.\n\nLast excerpt.');assert.doesNotMatch(x.q('[data-selected]').value,/Omit/);
 x.q('[data-extract]').click();x.picker.open();assert.equal(x.q('[data-selected]').value,x.applied[0].text);
});
test('An oversized appended selection leaves prior text untouched and reports the limit',async t=>{
 const x=fixture(t);await x.picker.load({name:'excerpts.txt',size:100,text:async()=>'Another excerpt.'},x.q('#opener'));
 x.q('[data-selected]').value='a'.repeat(19995);x.q('[data-selected]').dispatchEvent(new x.w.Event('input'));
 const range=x.w.document.createRange();range.selectNodeContents(x.q('.source-text-preview'));x.w.getSelection().removeAllRanges();x.w.getSelection().addRange(range);x.q('.pdf-page-scroll').dispatchEvent(new x.w.MouseEvent('mouseup'));
 assert.equal(x.q('[data-selected]').value,'a'.repeat(19995));assert.match(x.q('[data-selection-feedback]').textContent,/Existing text preserved/);assert.equal(x.q('[data-extract]').disabled,false);
});
test('Find and Replace targets the caret line or all selected text using literal matches',async t=>{
 const x=fixture(t);await x.picker.load({name:'excerpts.txt',size:100,text:async()=>'Merchant met Jinn.\nMerchant smiled.\nMerchant left.'},x.q('#opener'));
 const selected=x.q('[data-selected]');selected.value='Merchant met Jinn.\nMerchant smiled.\nMerchant left.';selected.dispatchEvent(new x.w.Event('input'));selected.setSelectionRange(20,20);selected.dispatchEvent(new x.w.MouseEvent('click'));
 x.q('[data-find-text]').value='Merchant';x.q('[data-find-text]').dispatchEvent(new x.w.Event('input'));x.q('[data-replace-text]').value='Trader';assert.match(x.q('[data-replace-scope] option').textContent,/2/);x.q('[data-replace]').click();
 assert.equal(selected.value,'Merchant met Jinn.\nTrader smiled.\nMerchant left.');assert.match(x.q('[data-replace-feedback]').textContent,/1 match in line 2/);
 x.q('[data-replace-scope]').value='all';x.q('[data-replace-text]').value='Traveller';x.q('[data-replace]').click();assert.equal(selected.value,'Traveller met Jinn.\nTrader smiled.\nTraveller left.');assert.match(x.q('[data-replace-feedback]').textContent,/2 matches throughout/);
 x.q('[data-find-text]').value='.';x.q('[data-replace-text]').value='!';x.q('[data-replace]').click();assert.equal(selected.value,'Traveller met Jinn!\nTrader smiled!\nTraveller left!');
 x.q('[data-find-text]').value='missing';x.q('[data-replace]').click();assert.match(x.q('[data-replace-feedback]').textContent,/No exact matches/);x.q('[data-extract]').click();assert.equal(x.applied[0].text,selected.value);
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
