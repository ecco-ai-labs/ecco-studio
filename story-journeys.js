'use strict';
/* Intent selection uses the existing story storage and production editors. */
(()=>{
 const specs=[
 ['audiobook','Audio','Audiobook','audio','Book title','Chapter text','Chapter','Narrator direction'],
 ['podcast','Audio','Podcast','audio','Podcast title','Episode brief','Episode title','Hosts and discussion style'],
 ['audio-drama','Audio','Audio Drama','audio','Drama title','Scene and dialogue','Episode or scene','Cast and voice direction'],
 ['news','Video','News Channel','video','Channel name','Coverage brief','Topics and date range','Sources to consult'],
 ['documentary','Video','Documentary','video','Documentary title','Subject and narrative','Audience','Sources and key questions'],
 ['animation','Video','Original Animation','video','Animation title','Story and dialogue','Characters','Visual style'],
 ['marketing','Video','Marketing Video','video','Campaign title','Product and message','Audience','Call to action'],
 ['social','Video','Social Video','video','Video title','Video idea','Platform','Opening hook'],
 ['book-adaptation','Series','Book Adaptation','video','Series title','Chapter text','Chapter','Recurring characters and visual style'],
 ['teaching','Series','Teaching Series','video','Course title','Lesson outline','Audience and level','Learning objectives'],
 ['training','Series','Training Series','video','Series title','Procedure or lesson','Audience','Steps to demonstrate'],
 ['presentation','More','Presentation','video','Presentation title','Presentation outline','Audience','Key takeaway'],
 ['ambient','More','Music or Ambient Video','video','Project title','Music and visual direction','Mood','Visual progression'],
 ['dubbing','More','Localization or Dubbing','video','Project title','Source transcript','Target language','Speaker and translation direction'],
 ['repurpose','More','Repurpose Content','video','Project title','Source content or transcript','Target format','Excerpts to include'],
 ['custom','More','Custom Production','video','Project title','Production brief','Audience','Creative direction']
 ].map(([id,group,label,format,title,summary,first,second])=>({id,group,label,format,title,summary,first,second}));
 const read=k=>{try{return JSON.parse(localStorage.getItem(k)||'{}');}catch{return {};}};
 const get=id=>specs.find(s=>s.id===id);
 function current(){if(sessionStorage.getItem('ecco-guided-mode')==='off')return null;return get(read(typeof activeStory!=='undefined'&&activeStory?'ecco-story-description:'+activeStory:'ecco-new-story-draft').workflow_id);}
 function setup(form,saved){const spec=get(saved.workflow_id);if(!spec)return;
  document.querySelector('#heading').textContent=spec.label;
  form.dataset.intent=spec.id;form.dataset.intentFormatChoice=String(['podcast','custom','dubbing','repurpose'].includes(spec.id));
  const hidden=document.createElement('input');hidden.type='hidden';hidden.name='workflow_id';hidden.value=spec.id;form.append(hidden);
  const format=form.elements.story_format;format.value=saved.story_format||spec.format;format.closest('label').hidden=true;
  const relabel=(name,text)=>{const input=form.elements[name];const label=input.closest('label');for(const n of [...label.childNodes])if(n.nodeType===3)n.remove();label.prepend(document.createTextNode(text));input.placeholder='';};
  relabel('title',spec.title);relabel('summary',spec.summary);form.elements.genre.closest('label').hidden=true;form.elements.genre.value=saved.genre||({news:'News',documentary:'Documentary',teaching:'Educational',training:'Educational',animation:'Animation','book-adaptation':'Animation'}[spec.id]||'Other');
  for(const [name,labelText]of [['journey_first',spec.first],['journey_second',spec.second]]){const label=document.createElement('label');label.textContent=labelText;const input=document.createElement('input');input.name=name;input.maxLength=1000;input.value=saved[name]||'';label.append(input);form.elements.summary.closest('label').after(label);}
  if(['podcast','custom','dubbing','repurpose'].includes(spec.id)){format.closest('label').hidden=false;relabel('story_format','Output');}
  form.querySelector('[type=submit]').textContent=['dubbing','repurpose','ambient'].includes(spec.id)?'Save & Continue to Source Media':spec.format==='audio'?'Save & Continue to Script':'Save & Continue to Storyboard';
 }
 function brief(data){const s=get(data.workflow_id);if(!s)return data.summary||'';return [data.summary,data.journey_first&&s.first+': '+data.journey_first,data.journey_second&&s.second+': '+data.journey_second].filter(Boolean).join('\n\n');}
 function steps(fallback){const s=current();if(!s)return fallback;const format=document.querySelector('#story-setup-form [name=story_format]')?.value||read(typeof activeStory!=='undefined'&&activeStory?'ecco-story-description:'+activeStory:'ecco-new-story-draft').story_format||s.format;
 const board=s.id==='audiobook'?'Chapter Script':s.id==='podcast'?'Episode Script':s.id==='teaching'||s.id==='training'?'Lesson Storyboard':s.id==='news'?'News Storyboard':format==='audio'?'Script':'Storyboard';
 return [['story-setup',s.label,''],...(['dubbing','repurpose','ambient'].includes(s.id)?[['journey-sources','Source Media','']]:[]),['board',board,''],['audio',format==='audio'?'Voices & Audio':'Narration & Audio',''],...(format==='audio'?[['journey-results','Review & Export','']]:[['images',s.id==='animation'||s.id==='book-adaptation'?'Characters & Images':'Images & References',''],['render','Generate Video',''],['journey-results','Review & Publish','']])];}
 function mount(actions,{start,rows,open,studio}){actions.replaceChildren();for(const existing of [false,true]){
  const wrap=document.createElement('div');wrap.className='intent-menu-wrap';const trigger=document.createElement('button');trigger.type='button';trigger.className='intent-trigger';trigger.textContent=(existing?'Existing Story':'New Story')+' ▾';trigger.setAttribute('aria-expanded','false');const menu=document.createElement('div');menu.className='intent-menu';menu.hidden=true;wrap.append(trigger,menu);actions.append(wrap);
  const close=()=>{menu.hidden=true;trigger.setAttribute('aria-expanded','false');};
  const build=()=>{menu.replaceChildren();const items=existing?rows():specs.map(s=>({...s,title:s.label}));const groups=new Map();for(const item of items){const spec=get(item.workflow_id);const group=existing?(spec?.label||'Other Stories'):item.group;if(!groups.has(group))groups.set(group,[]);groups.get(group).push(item);}
   if(!items.length){const empty=document.createElement('p');empty.textContent=typeof state!=='undefined'&&state.storage_pending?'Connect storage in Studio to load saved stories.':'No saved stories available.';menu.append(empty);}
   for(const [name,entries]of groups){const row=document.createElement('div');row.className='intent-menu-row';const b=document.createElement('button');b.type='button';b.textContent=name+' ›';b.setAttribute('aria-expanded','false');const sub=document.createElement('div');sub.className='intent-submenu';sub.hidden=true;row.append(b,sub);menu.append(row);
    const expand=()=>{menu.querySelectorAll('.intent-submenu').forEach(el=>{el.hidden=el!==sub;el.previousElementSibling.setAttribute('aria-expanded',String(el===sub));});};row.onmouseenter=expand;b.onclick=expand;b.onkeydown=e=>{if(e.key==='ArrowRight'){e.preventDefault();expand();sub.querySelector('button')?.focus();}};
    for(const item of entries){const choice=document.createElement('button');choice.type='button';choice.textContent=item.title||'Untitled story';choice.onclick=()=>{close();document.body.classList.remove('story-choice-mode');sessionStorage.setItem('ecco-guided-mode','on');existing?open(item):start(item);};sub.append(choice);}
    sub.onkeydown=e=>{if(e.key==='ArrowLeft'){e.preventDefault();sub.hidden=true;b.setAttribute('aria-expanded','false');b.focus();}};
   }
  };
  trigger.onclick=()=>{if(!menu.hidden){close();return;}actions.querySelectorAll('.intent-menu').forEach(m=>{m.hidden=true;m.previousElementSibling.setAttribute('aria-expanded','false');});build();menu.hidden=false;trigger.setAttribute('aria-expanded','true');};
  trigger.onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();if(menu.hidden)trigger.click();menu.querySelector('button')?.focus();}};
  wrap.onkeydown=e=>{if(e.key==='Escape'){close();trigger.focus();}if(['ArrowDown','ArrowUp'].includes(e.key)&&e.target!==trigger){const siblings=[...e.target.parentElement.children].flatMap(el=>el.matches('button')?[el]:el.classList.contains('intent-menu-row')?[el.firstElementChild]:[]);const i=siblings.indexOf(e.target);if(i>=0){e.preventDefault();siblings[(i+(e.key==='ArrowDown'?1:-1)+siblings.length)%siblings.length].focus();}}};
  wrap.addEventListener('focusout',()=>setTimeout(()=>{if(!wrap.contains(document.activeElement))close();},0));
 }
 const direct=document.createElement('button');direct.type='button';direct.textContent='Go to Studio';direct.className='intent-trigger';direct.onclick=()=>{sessionStorage.setItem('ecco-guided-mode','off');studio();};actions.append(direct);
 }
 document.addEventListener('click',e=>{if(!e.target.closest('.intent-menu-wrap'))document.querySelectorAll('.intent-menu').forEach(m=>{m.hidden=true;m.previousElementSibling.setAttribute('aria-expanded','false');});});
 window.EccoStoryJourneys={specs,get,current,setup,steps,mount,brief};
})();
