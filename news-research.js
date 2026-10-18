'use strict';
(() => {
 const q=(s,r=document)=>r.querySelector(s);
 const topics=['General','Finance','Business','Technology & AI','Sports','Entertainment','Politics','Science','Health','Local'];
 const read=key=>{try{return JSON.parse(localStorage.getItem(key)||'{}');}catch{return {};}};
 function metadata(){
  const setup=read('ecco-story-description:'+activeStory);
  return {...setup,...draft.news};
 }
 function mountTopic(){
  const form=q('#story-setup-form');if(!form||q('[data-news-topic]',form))return;
  const genre=form.elements.genre;if(!genre)return;
  const saved=read(form.dataset.draftKey),label=document.createElement('label');label.dataset.newsTopic='';label.textContent='Topic';
  const input=document.createElement('input');input.type='hidden';input.name='news_topic';input.value=saved.news_topic||'General';
  const menu=document.createElement('details');menu.className='story-type-dropdown';
  menu.innerHTML='<summary></summary><div class="story-type-options"><div data-choices></div><div data-entry hidden><input aria-label="Custom news topic" maxlength="80" placeholder="Enter a topic"><div class="row"><button type="button" class="secondary" data-once>Use Once</button><button type="button" class="secondary" data-save>Add to Dropdown</button></div></div></div>';
  label.append(input,menu);genre.closest('label').after(label);
  let custom=read('ecco-news-topics');if(!Array.isArray(custom))custom=[];
  const choose=value=>{input.value=value;q('summary',menu).textContent=value;menu.open=false;input.dispatchEvent(new Event('change',{bubbles:true}));};
  const draw=()=>{const box=q('[data-choices]',menu);box.replaceChildren();for(const name of [...new Set([...topics,...custom,input.value,'Other'])]){const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=name;b.onclick=()=>{if(name==='Other'){q('[data-entry]',menu).hidden=false;q('[data-entry] input',menu).focus();}else choose(name);};box.append(b);}};
  for(const [selector,remember] of [['[data-once]',false],['[data-save]',true]])q(selector,menu).onclick=()=>{const value=q('[data-entry] input',menu).value.trim();if(!value)return;if(remember){custom=[...new Set([...custom,value])];localStorage.setItem('ecco-news-topics',JSON.stringify(custom));}choose(value);draw();};
  const sync=()=>{label.hidden=!/^news$/i.test(genre.value);label.style.setProperty('display',label.hidden?'none':'flex','important');draft.news={genre:genre.value,news_topic:input.value};persistDraft();};
  form.addEventListener('change',sync);q('summary',menu).textContent=input.value;draw();sync();
 }
 function openResearch(){
  q('#news-research-dialog')?.remove();
  const target=activeStory,origin=q('#storyboard-ai-toolbar'),initial=metadata();
  const d=document.createElement('dialog');d.id='news-research-dialog';d.className='generation-dialog';
  d.innerHTML='<div class="form"><div class="section-head"><h2>Research the Web</h2><button type="button" class="secondary" data-close aria-label="Close research">×</button></div><label>Research Prompt<textarea data-prompt rows="4"></textarea></label><div class="row"><label>Items<input data-count type="number" min="1" max="60" step="1" value="10"></label><label>Date Range<select data-range><option>Past 24 Hours</option><option>Past 7 Days</option><option>Past 30 Days</option></select></label></div><button type="button" class="secondary" data-research>Research</button><p role="status" data-status></p><div data-results></div><button type="button" data-create hidden>Create Storyboard</button></div>';
  document.body.append(d);
  const prompt=q('[data-prompt]',d),count=q('[data-count]',d),range=q('[data-range]',d),status=q('[data-status]',d),run=q('[data-research]',d),create=q('[data-create]',d);
  const defaultPrompt=()=>`Find the top ${count.value} ${initial.news_topic||'General'} news stories from around the world within the ${range.value.toLowerCase()}. Include reliable source links and publication dates. Do not repeat the same event.`;
  let defaultText=defaultPrompt(),result=null,busy=false;
  prompt.value=defaultText;
  const reset=()=>{result=null;create.hidden=true;q('[data-results]',d).replaceChildren();status.textContent='';};
  [count,range].forEach(el=>el.onchange=()=>{if(prompt.value===defaultText){defaultText=defaultPrompt();prompt.value=defaultText;}reset();});prompt.oninput=reset;
  const valid=()=>{if(!d.open||!origin.isConnected||activeStory!==target)throw Error('The selected story changed. Reopen research for the current story.');if(!window.EccoStorage?.ready||!window.EccoAI?.enabled)throw Error('Connect storage and enable AI in Connections.');};
  const setBusy=value=>{busy=value;[run,create,prompt,count,range,...d.querySelectorAll('[data-item]')].forEach(el=>el.disabled=value);};
  const error=e=>{status.textContent='';notice(e.message,true);};
  q('[data-close]',d).onclick=()=>d.close();d.addEventListener('close',()=>d.remove(),{once:true});
  run.onclick=async()=>{
   if(busy)return;
   try{
    valid();const n=Number(count.value);if(!Number.isInteger(n)||n<1||n>60)throw Error('Choose 1–60 news items.');if(!prompt.value.trim())throw Error('Enter research instructions.');
    reset();setBusy(true);status.textContent='Connecting to research…';
    const capability=await api('ai/status');valid();if(!capability.news_research)throw Error('Web research requires an update to the CPU workspace API. Your story is unchanged.');
    status.textContent='Researching the web…';
    result=await api('ai/news/research',{prompt:prompt.value.trim(),count:n,date_range:range.value});valid();
    if(!Array.isArray(result.research?.items)||result.research.items.length!==n||!result.signature)throw Error('Research returned an incomplete result.');
    const box=q('[data-results]',d);result.research.items.forEach((item,i)=>{
     const card=document.createElement('section');card.className='panel';
     const label=document.createElement('label');label.style.cssText='display:flex;flex-direction:row;align-items:center;gap:8px';
     const check=document.createElement('input');check.type='checkbox';check.checked=true;check.dataset.item=String(i);check.style.width='auto';label.append(check,document.createTextNode(item.title));
     const summary=document.createElement('p');summary.textContent=item.summary;card.append(label,summary);
     for(const source of item.sources||[]){if(!/^https?:\/\//i.test(source.url))continue;const p=document.createElement('p'),link=document.createElement('a');link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=source.title||source.url;p.append(link,document.createTextNode(' · '+(source.published_at||'Publication date unavailable')));card.append(p);}
     box.append(card);
    });create.hidden=false;status.textContent=n+' news items found. Select items to create shots.';
   }catch(e){result=null;create.hidden=true;error(e);}finally{setBusy(false);}
  };
  create.onclick=async()=>{
   if(busy||!result)return;
   try{
    valid();const selected=[...d.querySelectorAll('[data-item]:checked')].map(el=>Number(el.dataset.item));if(!selected.length)throw Error('Select at least one news item.');
    if((draft.story?.trim()||draft.scenes?.some(s=>s.narration||s.image_id||s.motion))&&!confirm('Replace the current narration and scene draft with the selected news items?'))return;
    const snapshot=JSON.stringify(draft);setBusy(true);status.textContent='Creating one shot per selected news item…';
    const planned=await api('ai/news/storyboard',{...result,selected,seconds:Number(draft.defaultSeconds)||3});valid();
    if(JSON.stringify(draft)!==snapshot)throw Error('Your draft changed during generation. Your edits were preserved.');
    if(!Array.isArray(planned.scenes)||planned.scenes.length!==selected.length)throw Error('AI did not return one shot per selected item.');
    const next={...draft,scenes:planned.scenes,story:planned.scenes.map(s=>s.narration).join('\n\n'),news:{...initial,researched_at:planned.researched_at}};
    localStorage.setItem(activeStory?'ecco-board-draft:'+activeStory:'ecco-board-new-draft',JSON.stringify(next));draft=next;savedBoard=null;
    q('#story-text').value=draft.story;renderScenes();d.close();
   }catch(e){error(e);}finally{setBusy(false);}
  };
  d.showModal();
 }
 function mount(){
  mountTopic();const toolbar=q('#storyboard-ai-toolbar');if(!toolbar||q('[data-web-research]',toolbar))return;
  const b=document.createElement('button');b.type='button';b.className='secondary';b.dataset.webResearch='';b.textContent='Research the Web';b.onclick=()=>{toolbar.open=false;openResearch();};q('.storyboard-ai-actions',toolbar).append(b);
 }
 new MutationObserver(mount).observe(q('#page'),{childList:true,subtree:true});mount();
})();
