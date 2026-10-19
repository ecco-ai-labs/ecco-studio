'use strict';
(() => {
 const q=(s,r=document)=>r.querySelector(s);
 const topics=['General','Finance','Business','Technology & AI','Sports','Entertainment','Politics','Science','Health','Local'];
 const read=key=>{try{return JSON.parse(localStorage.getItem(key)||'{}');}catch{return {};}};
 function metadata(){
  const setup=read(activeStory?'ecco-story-description:'+activeStory:'ecco-new-story-draft');
  return {...draft.news,...setup};
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
  d.innerHTML='<div class="form"><div class="section-head"><h2>Research the Web</h2><div style="display:flex;gap:6px;align-items:center"><button type="button" class="secondary" data-stop aria-label="Stop AI" title="Stop AI" disabled><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="3" width="10" height="10" fill="currentColor"/></svg></button><button type="button" class="secondary" data-close aria-label="Close research">×</button></div></div><label><span style="color:var(--accent)">Research Prompt</span><textarea data-prompt rows="4"></textarea></label><div class="row"><label><span style="color:var(--accent)">Items</span><input data-count type="number" min="1" max="60" step="1" value="10"></label><label><span style="color:var(--accent)">Date Range</span><select data-range><option>Past 24 Hours</option><option>Past 7 Days</option><option>Past 30 Days</option></select></label></div><button type="button" class="secondary" data-research>Research</button><p role="status" data-status></p><div data-results></div><button type="button" data-create hidden>Create Storyboard</button></div>';
  document.body.append(d);
  const prompt=q('[data-prompt]',d),count=q('[data-count]',d),range=q('[data-range]',d),status=q('[data-status]',d),run=q('[data-research]',d),create=q('[data-create]',d);
  const script=q('#story-text')?.value.trim()||draft.story?.trim()||'';
  const defaultPrompt=()=>script||`Find the top ${count.value} ${initial.news_topic||'General'} news stories from around the world within the ${range.value.toLowerCase()}. Include reliable source links and publication dates. Do not repeat the same event.`;
  let defaultText=defaultPrompt(),result=null,busy=false,operation=null;
  prompt.value=defaultText;
  const reset=()=>{result=null;create.hidden=true;q('[data-results]',d).replaceChildren();status.textContent='';};
  [count,range].forEach(el=>el.onchange=()=>{if(prompt.value===defaultText){defaultText=defaultPrompt();prompt.value=defaultText;}reset();});prompt.oninput=reset;
  const valid=()=>{if(!d.open||!origin.isConnected||activeStory!==target)throw Error('The selected story changed. Reopen research for the current story.');if(!window.EccoStorage?.ready||!window.EccoAI?.enabled)throw Error('Connect storage and enable AI in Connections.');};
  const setBusy=(value,button=run)=>{busy=value;[run,create,prompt,count,range,...d.querySelectorAll('[data-item]')].forEach(el=>el.disabled=value);setGenerationBusy(run,value&&button===run,'Research','Research');setGenerationBusy(create,value&&button===create,'Create Storyboard','Create Storyboard');run.disabled=create.disabled=value;q('[data-stop]',d).disabled=!value;};
  const stop=()=>{if(!operation)return;const previous=operation;operation=null;previous.abort();setBusy(false);status.textContent='Stopped.';};
  const finish=token=>{if(operation!==token)return;operation=null;setBusy(false);};
  q('[data-stop]',d).onclick=stop;
  const error=e=>{status.textContent='';notice(e.message,true);};
  q('[data-close]',d).onclick=()=>d.close();d.addEventListener('close',()=>{stop();d.remove();},{once:true});
  run.onclick=async()=>{
   if(busy)return;
   const token=new AbortController();operation=token;
   try{
    valid();const n=Number(count.value);if(!Number.isInteger(n)||n<1||n>60)throw Error('Choose 1–60 news items.');if(!prompt.value.trim())throw Error('Enter research instructions.');
    reset();setBusy(true);
    const capability=await api('ai/status',undefined,{signal:token.signal});if(operation!==token)return;valid();if(!capability.news_research)throw Error('Web research requires an update to the CPU workspace API. Your story is unchanged.');
    const response=await api('ai/news/research',{prompt:prompt.value.trim(),count:n,date_range:range.value},{signal:token.signal});if(operation!==token)return;valid();result=response;
    if(!Array.isArray(result.research?.items)||result.research.items.length!==n||!result.signature)throw Error('Research returned an incomplete result.');
    const box=q('[data-results]',d);result.research.items.forEach((item,i)=>{
     const card=document.createElement('section');card.className='panel';
     const label=document.createElement('label');label.style.cssText='display:flex;flex-direction:row;align-items:center;gap:8px';
     const check=document.createElement('input');check.type='checkbox';check.checked=true;check.dataset.item=String(i);check.style.width='auto';label.append(check,document.createTextNode(item.title));
     const summary=document.createElement('p');summary.textContent=item.summary;card.append(label,summary);
     for(const source of item.sources||[]){if(!/^https?:\/\//i.test(source.url))continue;const p=document.createElement('p'),link=document.createElement('a');link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=source.title||source.url;p.append(link,document.createTextNode(' · '+(source.published_at||'Publication date unavailable')));card.append(p);}
     box.append(card);
    });create.hidden=false;status.textContent=n+' news items found. Select items to create shots.';
   }catch(e){if(operation===token&&!token.signal.aborted){result=null;create.hidden=true;error(e);}}finally{finish(token);}
  };
  create.onclick=async()=>{
   if(busy||!result)return;
   const token=new AbortController();operation=token;
   try{
    valid();const selected=[...d.querySelectorAll('[data-item]:checked')].map(el=>Number(el.dataset.item));if(!selected.length)throw Error('Select at least one news item.');
    const snapshot=JSON.stringify(draft);setBusy(true,create);status.textContent='';
    const planned=await api('ai/news/storyboard',{...result,selected,seconds:Number(draft.defaultSeconds)||3},{signal:token.signal});if(operation!==token)return;valid();
    if(JSON.stringify(draft)!==snapshot)throw Error('Your draft changed during generation. Your edits were preserved.');
    if(!Array.isArray(planned.scenes)||planned.scenes.length!==selected.length)throw Error('AI did not return one shot per selected item.');
    const next={...draft,scenes:planned.scenes,story:planned.scenes.map(s=>s.narration).join('\n\n'),news:{...initial,researched_at:planned.researched_at}};
    localStorage.setItem(activeStory?'ecco-board-draft:'+activeStory:'ecco-board-new-draft',JSON.stringify(next));draft=next;savedBoard=null;
    q('#story-text').value=draft.story;renderScenes();d.close();
   }catch(e){if(operation===token&&!token.signal.aborted)error(e);}finally{finish(token);}
  };
  d.showModal();
 }
 function mount(){
  mountTopic();const toolbar=q('#storyboard-ai-toolbar');if(!toolbar||q('[data-web-research]',toolbar))return;
  const b=document.createElement('button');b.type='button';b.className='secondary';b.dataset.webResearch='';b.textContent='Research the Web';b.onclick=()=>{toolbar.open=false;openResearch();};q('.storyboard-ai-actions',toolbar).append(b);
 }
 new MutationObserver(mount).observe(q('#page'),{childList:true,subtree:true});mount();
})();

