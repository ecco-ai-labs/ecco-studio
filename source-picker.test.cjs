const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
function fixture(t,options={}){
 const dom=new JSDOM('<button id="opener">Upload</button>',{runScripts:'outside-only',url:'https://example.test'}),w=dom.window;t.after(()=>w.close());
 w.TextEncoder=TextEncoder;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};w.HTMLCanvasElement.prototype.getContext=()=>({});
 w.IntersectionObserver=class{constructor(fn){this.fn=fn;}observe(target){this.fn([{target,isIntersecting:true}]);}disconnect(){}};
 let destroyed=0;
 const pages=options.pages||['Excluded first page.','Use only page two.'];
 const doc={numPages:pages.length,getOutline:async()=>options.outline||[],getMetadata:async()=>({info:{Title:'Fixture title'}}),getPage:async n=>({getViewport:({scale})=>({width:600*scale,height:800*scale}),render:()=>({promise:Promise.resolve()}),getTextContent:async()=>({items:(Array.isArray(pages[n-1])?pages[n-1]:[pages[n-1]]).map(str=>({str,hasEOL:true}))})})};
 w.pdfFixture={GlobalWorkerOptions:{},getDocument:()=>({destroy:async()=>{destroyed++;},promise:Promise.resolve(doc)}),TextLayer:class{constructor({container,textContentSource}){this.container=container;this.text=textContentSource.items[0].str;}async render(){const span=w.document.createElement('span');span.textContent=this.text;span.style.left="8%";span.style.top="7%";this.container.append(span,w.document.createElement("br"));}}};
 w.eval(fs.readFileSync(__dirname+'/source-chapters.js','utf8'));
 w.eval(fs.readFileSync(__dirname+'/ai-text-refinement.js','utf8'));
 w.eval(fs.readFileSync(__dirname+'/source-picker.js','utf8').replace("import('https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.min.mjs')",'Promise.resolve(window.pdfFixture)'));
 const applied=[],picker=w.EccoSourcePicker.create({onApply:value=>applied.push(value),maxSelection:20000,...options}),q=s=>w.document.querySelector(s);
 return {w,picker,q,applied,destroyed:()=>destroyed};
}
test('document chapters use PDF bookmarks without AI and stop before the next heading on the same page',async t=>{
 const x=fixture(t,{pages:[['Book title','Chapter One','Original opening.'],['Original ending.','Chapter Two','Do not include this.']],outline:[{title:'Chapter One',dest:[0]},{title:'Chapter Two',dest:[1]}]});
 await x.picker.load({name:'chapters.pdf',size:100,arrayBuffer:async()=>new ArrayBuffer(0)},x.q('#opener'));
 assert.equal(x.q('[data-chapter-list-label]').hidden,false);assert.equal(x.q('[data-chapter-list]').options.length,3);assert.equal(x.q('[data-selected]').value,'');
 x.q('[data-chapter-list]').value='0';x.q('[data-find-chapter]').click();await new Promise(r=>setTimeout(r,0));
 assert.equal(x.q('[data-selected]').value,'Chapter One\nOriginal opening.\n\nOriginal ending.');assert.equal(x.q('[data-chapter-menu]').open,false);assert.equal(x.q('[data-extract]').disabled,false);
 x.q('[data-selected]').value=x.q('[data-selected]').value.replace('Chapter One\n','');x.q('[data-selected]').dispatchEvent(new x.w.Event('input'));x.q('[data-extract]').click();assert.equal(x.applied[0].text,'Original opening.\n\nOriginal ending.');
});
test('a complete 30,000-character chapter fills the middle pane without truncation',async t=>{
 const words='Original chapter text. '.repeat(1400),x=fixture(t,{maxSelection:100000,pages:[['Chapter One',words],['Chapter Two','Excluded.']],outline:[{title:'Chapter One',dest:[0]},{title:'Chapter Two',dest:[1]}]});
 await x.picker.load({name:'long.pdf',size:100,arrayBuffer:async()=>new ArrayBuffer(0)},x.q('#opener'));x.q('[data-chapter-list]').value='0';x.q('[data-find-chapter]').click();await new Promise(r=>setTimeout(r,0));
 assert.equal(x.q('[data-selected]').value,'Chapter One\n'+words.trim());assert.ok(x.q('[data-selected]').value.length>30000);assert.equal(x.q('[data-extract]').disabled,false);
 x.q('[data-clear-selection]').click();x.q('[data-pages]').value='1';x.q('[data-select-pages]').click();await new Promise(r=>setTimeout(r,0));assert.equal(x.q('[data-selected]').value,'Chapter One\n'+words.trim());
});
test('Enter in PDF Pages selects the requested original page',async t=>{
 const x=fixture(t);await x.picker.load({name:'pages.pdf',size:100,arrayBuffer:async()=>new ArrayBuffer(0)},x.q('#opener'));x.q('[data-pages-menu] summary').click();x.q('[data-pages]').value='2';const enter=new x.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});x.q('[data-pages]').dispatchEvent(enter);await new Promise(r=>setTimeout(r,0));assert.equal(enter.defaultPrevented,true);assert.equal(x.q('[data-selected]').value,'Use only page two.');assert.equal(x.q('[data-pages-menu]').open,false);
});
test('PDF preview supports later pages and commits only highlighted text with filename and title',async t=>{
 const x=fixture(t);await x.picker.load({name:'paper.pdf',size:100,arrayBuffer:async()=>new ArrayBuffer(0)},x.q('#opener'));await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(x.q('dialog').open,true);assert.equal(x.q('[data-extract]').disabled,true);assert.equal(x.q('.pdf-page-scroll').children.length,2);assert.equal(x.applied.length,0);
 const text=x.q('[data-page="2"] .textLayer span').firstChild,range=x.w.document.createRange();range.selectNodeContents(text);x.w.getSelection().removeAllRanges();x.w.getSelection().addRange(range);x.q('.pdf-page-scroll').dispatchEvent(new x.w.MouseEvent('mouseup'));
 assert.equal(x.q('[data-selected]').value,'Use only page two.');x.q('[data-extract]').click();assert.deepEqual(JSON.parse(JSON.stringify(x.applied)),[{text:'Use only page two.',name:'paper.pdf',title:'Fixture title',scope:'selected'}]);assert.equal(x.w.document.activeElement,x.q('#opener'));assert.equal(x.q('dialog').open,false);
 x.picker.destroy();assert.equal(x.destroyed(),1);assert.equal(x.q('dialog'),null);
});
test('PDF end-of-line markers stay on their own row instead of native BR hit boxes',async t=>{
 const x=fixture(t);await x.picker.load({name:'lines.pdf',size:100,arrayBuffer:async()=>new ArrayBuffer(0)},x.q('#opener'));await new Promise(r=>setTimeout(r,0));
 const layer=x.q('.textLayer'),line=layer.querySelector('span'),end=layer.querySelector('[data-pdf-line-break]');
 assert.equal(layer.querySelector('br'),null);assert.equal(end.textContent,'\n');assert.equal(end.style.top,line.style.top);assert.match(end.style.left,/8%/);assert.equal(end.style.whiteSpace,'pre');
 assert.equal(x.q('[data-selected]').value,'');
});
test('three panes keep the whole document separate, start blank, and give AI its own pane with document actions in the bottom ribbon',async t=>{
 const x=fixture(t);await x.picker.load({name:'full.txt',size:80,text:async()=>'Unselected document text.'},x.q('#opener'));
 const panes=[...x.q('.pdf-selection-layout').children];assert.equal(panes.length,3);assert.ok(panes[0].contains(x.q('.pdf-page-scroll')));assert.ok(panes[1].contains(x.q('[data-selected]')));
 for(const selector of ['[data-ai-prompt]','[data-ai-suggestion]','[data-improve-selection]','[data-apply-improvement]'])assert.ok(panes[2].contains(x.q(selector)),selector);
 for(const selector of ['[data-pages]','[data-find-chapter]','[data-clear-selection]','[data-find-text]','[data-replace]','[data-extract]'])assert.ok(x.q('.pdf-selection-ribbon').contains(x.q(selector)),selector);
 assert.equal(x.q('[data-ai-review]').hidden,false);assert.equal(x.q('[data-ai-suggestion]').value,'');assert.equal(x.q('[data-ai-suggestion]').readOnly,true);
 assert.equal(x.q('[data-selected]').value,'');assert.equal(x.q('[data-improve-selection]').disabled,true);assert.equal(x.q('[data-extract]').disabled,true);assert.match(panes[0].textContent,/Unselected document/);assert.equal(x.applied.length,0);
 x.q('[data-selected]').value='Old excerpt';x.q('[data-selected]').dispatchEvent(new x.w.Event('input'));x.q('[data-pages]').value='2';x.q('[data-find-text]').value='old';
 await x.picker.load({name:'new.md',size:50,text:async()=>'A new full document.'},x.q('#opener'));assert.equal(x.q('[data-selected]').value,'');assert.equal(x.q('[data-pages]').value,'');assert.equal(x.q('[data-find-text]').value,'');assert.match(x.q('.source-text-preview').textContent,/new full document/);
});
test('PDF pages fit the left pane with their canvas and selectable text scaled together',async t=>{
 const x=fixture(t);Object.defineProperty(x.q('.pdf-page-scroll'),'clientWidth',{value:360});x.q('.pdf-page-scroll').style.padding='12px';
 await x.picker.load({name:'book.pdf',size:100,arrayBuffer:async()=>new ArrayBuffer(0)},x.q('#opener'));await new Promise(r=>setTimeout(r,0));
 const shell=x.q('.pdf-story-page');assert.equal(parseFloat(shell.style.width),336);assert.ok(shell.querySelector('.pdf-page-content canvas'));assert.ok(shell.querySelector('.pdf-page-content .textLayer'));assert.match(shell.querySelector('.pdf-page-content').style.transform,/scale\(0\./);assert.equal(x.q('[data-selected]').value,'');
});
test('Inline AI prompt sends only the exact passage and reviews before applying to Selected Text',async t=>{
 const x=fixture(t);await x.picker.load({name:'full.txt',size:80,text:async()=>'PRIVATE_UNSELECTED text.'},x.q('#opener'));x.w.EccoStorage={ready:true};x.w.EccoAI={enabled:true};const calls=[];
 x.w.api=async(path,body)=>{calls.push({path,body});return {revisions:[{id:'source_excerpt',text:'great'}]};};const selected=x.q('[data-selected]');selected.value='A good story.\nKeep this ending.';selected.dispatchEvent(new x.w.Event('input'));selected.setSelectionRange(2,6);
 const section=x.q('.pdf-ai-pane');assert.ok(section.contains(x.q('[data-ai-prompt]')));assert.equal(x.q('[data-improve-selection]').disabled,true);assert.equal(calls.length,0);
 x.q('[data-ai-prompt]').value='Use a stronger word.';x.q('[data-ai-prompt]').dispatchEvent(new x.w.Event('input'));x.q('[data-improve-selection]').click();await new Promise(r=>setTimeout(r,0));
 assert.equal(x.w.document.querySelectorAll('dialog[open]').length,1);assert.equal(calls.length,1);assert.equal(calls[0].body.fields[0].text,'good');assert.equal(calls[0].body.story_id,null);assert.match(calls[0].body.context.instructions,/Use a stronger word/);assert.doesNotMatch(JSON.stringify(calls),/PRIVATE_UNSELECTED|Keep this ending/);assert.equal(selected.value,'A good story.\nKeep this ending.');assert.equal(x.applied.length,0);assert.equal(x.q('[data-ai-suggestion]').value,'great');
 x.q('[data-apply-improvement]').click();assert.equal(selected.value,'A great story.\nKeep this ending.');assert.equal(x.q('.pdf-story-dialog').open,true);assert.equal(x.w.document.activeElement,selected);assert.equal(x.applied.length,0);assert.equal(x.q('.source-text-preview').textContent,'PRIVATE_UNSELECTED text.');
 x.q('[data-extract]').click();assert.equal(x.applied[0].text,'A great story.\nKeep this ending.');
});
test('AI connection error popups, stale replies and close preserve source selection',async t=>{
 const x=fixture(t);await x.picker.load({name:'source.txt',size:40,text:async()=>'Original words.'},x.q('#opener'));const selected=x.q('[data-selected]');selected.value='Original words.';selected.dispatchEvent(new x.w.Event('input'));selected.setSelectionRange(0,0);
 x.q('[data-ai-prompt]').value='Make it clearer.';x.q('[data-ai-prompt]').dispatchEvent(new x.w.Event('input'));x.q('[data-improve-selection]').click();await new Promise(r=>setTimeout(r,0));assert.match(x.q('[data-ai-message]').textContent,/Connect AI and workspace storage/);assert.equal(x.q('[data-ai-status]').textContent,'');x.q('[data-dismiss]').click();assert.equal(selected.value,'Original words.');
 x.w.EccoStorage={ready:true};x.w.EccoAI={enabled:true};let finish;x.w.api=()=>new Promise(resolve=>finish=resolve);x.q('[data-improve-selection]').click();assert.equal(x.q('[data-improve-selection]').getAttribute('aria-busy'),'true');selected.value='My newer edit.';selected.dispatchEvent(new x.w.Event('input'));finish({revisions:[{id:'source_excerpt',text:'Late suggestion.'}]});await new Promise(r=>setTimeout(r,0));assert.match(x.q('[data-ai-status]').textContent,/Selected Text changed/);assert.equal(selected.value,'My newer edit.');assert.equal(x.q('[data-apply-improvement]').disabled,true);
 x.q('[data-improve-selection]').click();x.q('[data-close]').click();finish({revisions:[{id:'source_excerpt',text:'Late after closing.'}]});await new Promise(r=>setTimeout(r,0));assert.equal(x.w.document.activeElement,x.q('#opener'));x.picker.open();assert.equal(selected.value,'My newer edit.');assert.equal(x.q('[data-ai-review]').hidden,false);assert.equal(x.q('[data-ai-suggestion]').value,'');assert.equal(x.q('[data-ai-suggestion]').readOnly,true);
 await x.picker.load({name:'new.txt',size:20,text:async()=>'New source'},x.q('#opener'));assert.equal(x.q('[data-ai-prompt]').value,'');assert.equal(x.q('[data-selected]').value,'');assert.equal(x.applied.length,0);
});
test('Inline suggestions support refine, discard and invalidate on clear without touching the document',async t=>{
 const x=fixture(t);await x.picker.load({name:'source.txt',size:40,text:async()=>'Source untouched.'},x.q('#opener'));const selected=x.q('[data-selected]');selected.value='Chosen text.';selected.dispatchEvent(new x.w.Event('input'));selected.setSelectionRange(0,0);x.w.EccoStorage={ready:true};x.w.EccoAI={enabled:true};const calls=[];x.w.api=async(path,body)=>{calls.push(body);return {revisions:[{id:'source_excerpt',text:body.fields[0].text+' Better.'}]};};x.q('[data-ai-prompt]').value='Improve';x.q('[data-ai-prompt]').dispatchEvent(new x.w.Event('input'));
 x.q('[data-improve-selection]').click();await new Promise(r=>setTimeout(r,0));x.q('[data-improve-selection]').click();await new Promise(r=>setTimeout(r,0));assert.equal(calls[1].fields[0].text,'Chosen text. Better.');assert.equal(selected.value,'Chosen text.');x.q('[data-discard-improvement]').click();assert.equal(selected.value,'Chosen text.');assert.equal(x.q('[data-ai-review]').hidden,false);assert.equal(x.q('[data-ai-suggestion]').value,'');assert.equal(x.q('[data-ai-suggestion]').readOnly,true);
 x.q('[data-improve-selection]').click();await new Promise(r=>setTimeout(r,0));x.q('[data-clear-selection]').click();assert.equal(selected.value,'');assert.equal(x.q('[data-ai-review]').hidden,false);assert.equal(x.q('[data-ai-suggestion]').value,'');assert.equal(x.q('[data-ai-suggestion]').readOnly,true);assert.equal(x.q('[data-apply-improvement]').disabled,true);assert.equal(x.q('.source-text-preview').textContent,'Source untouched.');assert.equal((await x.picker.snapshot()).aiPrompt,'Improve');
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

test('Bottom ribbon menus isolate focus, Escape and selection without closing the source',async t=>{
 const x=fixture(t);await x.picker.load({name:'book.pdf',size:100,arrayBuffer:async()=>new ArrayBuffer(0)},x.q('#opener'));
 x.q('[data-pages-menu] summary').click();assert.equal(x.q('[data-pages-menu]').open,true);assert.equal(x.w.document.activeElement,x.q('[data-pages]'));
 x.q('[data-chapter-menu] summary').click();assert.equal(x.q('[data-pages-menu]').open,false);assert.equal(x.q('[data-chapter-menu]').open,true);
 const escape=new x.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true});x.q('[data-chapter]').dispatchEvent(escape);assert.equal(escape.defaultPrevented,true);assert.equal(x.q('[data-chapter-menu]').open,false);assert.equal(x.w.document.activeElement,x.q('[data-chapter-menu] summary'));assert.equal(x.q('dialog').open,true);
 x.q('[data-pages-menu] summary').click();x.q('[data-pages]').value='2';x.q('[data-select-pages]').click();await new Promise(r=>setTimeout(r,0));assert.equal(x.q('[data-selected]').value,'Use only page two.');assert.equal(x.q('[data-pages-menu]').open,false);assert.equal(x.w.document.activeElement,x.q('[data-selected]'));
 x.q('.pdf-find-replace summary').click();x.q('.pdf-find-replace [data-tool-back]').click();assert.equal(x.q('.pdf-find-replace').open,false);assert.equal(x.w.document.activeElement,x.q('.pdf-find-replace summary'));assert.equal(x.q('dialog').open,true);
});

test('Saved drafts retain both the AI prompt and uncommitted output for review',async t=>{
 const x=fixture(t);x.w.File.prototype.arrayBuffer=async()=>new ArrayBuffer(0);await x.picker.load({name:'book.pdf',size:100,arrayBuffer:async()=>new ArrayBuffer(0)},x.q('#opener'));x.w.EccoStorage={ready:true};x.w.EccoAI={enabled:true};x.w.api=async()=>({revisions:[{id:'source_excerpt',text:'A clearer sentence.'}]});
 x.q('[data-selected]').value='A sentence.';x.q('[data-selected]').dispatchEvent(new x.w.Event('input'));x.q('[data-ai-prompt]').value='Make it clearer.';x.q('[data-ai-prompt]').dispatchEvent(new x.w.Event('input'));x.q('[data-improve-selection]').click();await new Promise(r=>setTimeout(r,0));const saved=await x.picker.snapshot();x.picker.clear();await x.picker.restore(saved);x.picker.open();
 assert.equal(x.q('[data-selected]').value,'A sentence.');assert.equal(x.q('[data-ai-prompt]').value,'Make it clearer.');assert.equal(x.q('[data-ai-suggestion]').value,'A clearer sentence.');assert.equal(x.q('[data-apply-improvement]').disabled,false);x.q('[data-apply-improvement]').click();assert.equal(x.q('[data-selected]').value,'A clearer sentence.');
});

test('AI ribbon settings guide the request and invalidate output when changed locally or externally',async t=>{
 const values={story_type:'podcast',genre:'Comedy',age_group:'All ages',language:'English'},options={aiSettings:{fields:[{name:'language',label:'Language',options:['English','Hindi']},{name:'genre',label:'Genre',options:['Comedy','Sports']}],getValues:()=>values,onChange:patch=>Object.assign(values,patch)}};
 const x=fixture(t,options);x.w.File.prototype.text=function(){return new Promise(resolve=>{const reader=new x.w.FileReader();reader.onload=()=>resolve(reader.result);reader.readAsText(this);});};await x.picker.load({name:'source.txt',size:60,text:async()=>'PRIVATE_UNSELECTED document.'},x.q('#opener'));x.w.EccoStorage={ready:true};x.w.EccoAI={enabled:true};
 const selected=x.q('[data-selected]');selected.value='Chosen passage.';selected.dispatchEvent(new x.w.Event('input'));x.q('[data-ai-prompt]').value='Make it simpler.';x.q('[data-ai-prompt]').dispatchEvent(new x.w.Event('input'));
 assert.equal(x.q('[data-ai-setting=language]').value,'English');assert.equal(x.q('[data-improve-selection]').getAttribute('aria-label'),'Improve with AI');assert.equal(x.q('[data-improve-selection]').textContent,'✦');assert.doesNotMatch(x.q('.pdf-ai-pane').textContent,/Uses only Selected Text|Prompt/);
 const change=(name,value)=>{const field=x.q('[data-ai-setting='+name+']');field.value=value;field.dispatchEvent(new x.w.Event('change'));};change('language','Hindi');assert.equal(values.language,'Hindi');
 let finish;const calls=[];x.w.api=(path,body)=>{calls.push(body);return new Promise(resolve=>finish=resolve);};x.q('[data-improve-selection]').click();assert.equal(calls[0].context.language,'Hindi');assert.equal(JSON.parse(calls[0].context.summary).age_group,'All ages');assert.doesNotMatch(JSON.stringify(calls),/PRIVATE_UNSELECTED/);
 change('genre','Sports');finish({revisions:[{id:'source_excerpt',text:'Stale reply.'}]});await new Promise(r=>setTimeout(r,0));assert.equal(x.q('[data-ai-suggestion]').value,'');assert.equal(x.q('[data-apply-improvement]').disabled,true);assert.equal(selected.value,'Chosen passage.');
 x.q('[data-improve-selection]').click();finish({revisions:[{id:'source_excerpt',text:'Current reply.'}]});await new Promise(r=>setTimeout(r,0));const saved=await x.picker.snapshot();assert.equal(x.q('[data-ai-suggestion]').value,'Current reply.');
 values.language='English';x.q('[data-apply-improvement]').click();assert.equal(selected.value,'Chosen passage.');assert.match(x.q('[data-ai-message]').textContent,/story settings changed/);x.q('[data-dismiss]').click();await x.picker.restore(saved);x.picker.open();assert.equal(x.q('[data-ai-setting=language]').value,'English');assert.equal(x.q('[data-ai-suggestion]').value,'');assert.equal(x.q('[data-ai-prompt]').value,'Make it simpler.');
});

test('AI clarification is a nested popup, never output, and returns to the prompt without applying text',async t=>{
 const x=fixture(t);await x.picker.load({name:'jars.txt',size:50,text:async()=>'Original document.'},x.q('#opener'));x.w.EccoStorage={ready:true};x.w.EccoAI={enabled:true};x.w.api=async()=>({questions:['Should there be forty jars in total?'],notes:[],revisions:[{id:'source_excerpt',text:'Thirty-nine jars stood ready.'}]});
 x.q('[data-selected]').value='Thirty-nine jars.';x.q('[data-selected]').dispatchEvent(new x.w.Event('input'));x.q('[data-ai-prompt]').value='Improve the narration.';x.q('[data-ai-prompt]').dispatchEvent(new x.w.Event('input'));x.q('[data-improve-selection]').click();await new Promise(r=>setTimeout(r,0));
 assert.equal(x.q('.pdf-ai-notice').getAttribute('aria-label'),'AI Needs Clarification');assert.match(x.q('[data-ai-message]').textContent,/forty jars/);assert.equal(x.q('[data-ai-status]').textContent,'');assert.equal(x.q('[data-ai-suggestion]').value,'');assert.equal(x.q('[data-selected]').value,'Thirty-nine jars.');assert.equal(x.applied.length,0);x.q('[data-dismiss]').click();assert.equal(x.q('.pdf-ai-notice'),null);assert.equal(x.w.document.activeElement,x.q('[data-ai-prompt]'));assert.equal(x.q('.pdf-story-dialog').open,true);
 assert.equal(x.q('[data-clear-selection]').textContent,'Clear Text');assert.equal(x.q('[data-clear-selection]').nextElementSibling,x.q('[data-extract]'));assert.equal(x.q('[data-extract]').textContent,'Apply Text');
});

for(const answer of ['Set burial count to 38','Store oil separately'])test('Choosing '+answer+' resumes selected-only improvement without another blocking question',async t=>{
 const x=fixture(t);await x.picker.load({name:'jars.txt',size:60,text:async()=>'PRIVATE_UNSELECTED document.'},x.q('#opener'));x.w.EccoStorage={ready:true};x.w.EccoAI={enabled:true};const calls=[];
 const notes=['Recommendation: Keep the jar total and change the burial count to 38.','Recommended choice: Set burial count to 38','Choice: Store oil separately'];
 x.w.api=async(path,body)=>{calls.push(body);return {questions:['Should the burial count be 38, or should the oil be stored separately?'],notes,revisions:[{id:'source_excerpt',text:calls.length===1?'Thirty-nine jars.':answer==='Set burial count to 38'?'Thirty-eight robbers were buried.':'The oil was stored separately.'}]};};
 const selected=x.q('[data-selected]');selected.value='Thirty-nine jars.\nKeep this ending.';selected.dispatchEvent(new x.w.Event('input'));selected.setSelectionRange(0,'Thirty-nine jars.'.length);x.q('[data-ai-prompt]').value='Improve narration';x.q('[data-ai-prompt]').dispatchEvent(new x.w.Event('input'));x.q('[data-improve-selection]').click();await new Promise(r=>setTimeout(r,0));
 const choices=[...x.w.document.querySelectorAll('[data-ai-choice]')];assert.equal(choices.length,2);assert.match(choices[0].textContent,/Recommended/);assert.match(x.q('[data-ai-recommendation]').textContent,/change the burial count/);choices.find(button=>button.dataset.aiChoice===answer).click();await new Promise(r=>setTimeout(r,0));
 assert.equal(calls.length,2);assert.ok(calls[1].context.instructions.includes('User selected this answer to the clarification: '+answer));assert.equal(calls[1].fields[0].text,'Thirty-nine jars.');assert.doesNotMatch(JSON.stringify(calls),/PRIVATE_UNSELECTED|Keep this ending/);assert.equal(x.q('.pdf-ai-notice'),null);assert.equal(selected.value,'Thirty-nine jars.\nKeep this ending.');assert.equal(x.applied.length,0);
 const output=x.q('[data-ai-suggestion]').value;assert.ok(output);x.q('[data-apply-improvement]').click();assert.equal(selected.value,output+'\nKeep this ending.');assert.equal(x.applied.length,0);
});
test('Continue Anyway reviews the available draft without retrying or applying it, and stale decisions cannot apply',async t=>{
 let settings={language:'English'};const x=fixture(t,{aiSettings:{fields:[],getValues:()=>settings}});await x.picker.load({name:'jars.txt',size:30,text:async()=>'Thirty-nine jars.'},x.q('#opener'));x.w.EccoStorage={ready:true};x.w.EccoAI={enabled:true};let calls=0;x.w.api=async()=>{calls++;return {questions:['Which count?'],notes:[],revisions:[{id:'source_excerpt',text:'Thirty-nine jars stood ready.'}]};};
 x.q('[data-selected]').value='Thirty-nine jars.';x.q('[data-selected]').dispatchEvent(new x.w.Event('input'));x.q('[data-ai-prompt]').value='Improve';x.q('[data-ai-prompt]').dispatchEvent(new x.w.Event('input'));x.q('[data-improve-selection]').click();await new Promise(r=>setTimeout(r,0));assert.match(x.q('[data-ai-recommendation]').textContent,/Preserve/);x.q('[data-continue]').click();assert.equal(calls,1);assert.equal(x.q('[data-ai-suggestion]').value,'Thirty-nine jars stood ready.');assert.equal(x.q('[data-selected]').value,'Thirty-nine jars.');assert.equal(x.applied.length,0);
 x.q('[data-improve-selection]').click();await new Promise(r=>setTimeout(r,0));settings={language:'Hindi'};x.q('[data-continue]').click();assert.equal(x.q('.pdf-ai-notice').getAttribute('aria-label'),'Unable to Improve Text');assert.match(x.q('[data-ai-message]').textContent,/changed/);assert.equal(x.q('[data-continue]').textContent,'Continue Without AI');x.q('[data-continue]').click();assert.equal(x.w.document.activeElement,x.q('[data-extract]'));assert.equal(x.q('[data-selected]').value,'Thirty-nine jars.');assert.equal(x.applied.length,0);
});
