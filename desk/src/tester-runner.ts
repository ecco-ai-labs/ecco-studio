import type {Check,Run,Severity} from './tester-model';
import {workflows,testPlan,selectedTests,type Mode} from './tester-catalog';
export {workflows,type Mode} from './tester-catalog';
const libraries:Record<string,string>={story:'.project > details > summary',image:'#image-library-nav > details > summary',audio:'#workspace-audio-library > summary',video:'#workspace-video-library > summary',workflow:'#workflow-library > summary'};
export function visible(el:Element|null):boolean{if(!el)return false;const s=el.ownerDocument.defaultView!.getComputedStyle(el);const r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&r.width>0&&r.height>0;}
export function decoded(icon:Element){const el=icon.querySelector('img') as HTMLImageElement|null;return !!el&&visible(el)&&el.complete&&el.naturalWidth>0;}
export async function runTester(frame:HTMLIFrameElement,mode:Mode,workflow:string,signal:AbortSignal,update:(run:Run,step:string)=>void,selection?:string[]):Promise<Run>{
 const run:Run={version:1,id:crypto.randomUUID(),startedAt:new Date().toISOString(),status:'running',source:'Current Studio · live browser checks',scope:mode==='workflow'?(workflows.find(w=>w[0]===workflow)?.[1]||workflow):mode==='ux'?'Library UX consistency':'Available workflow sweep',checks:[],findings:[]};
 const pause=(ms:number)=>new Promise<void>((resolve,reject)=>{signal.throwIfAborted();const done=()=>{signal.removeEventListener('abort',cancel);resolve()},t=setTimeout(done,ms),cancel=()=>{clearTimeout(t);reject(new DOMException('Stopped','AbortError'))};signal.addEventListener('abort',cancel,{once:true});});
 const wait=async(fn:()=>boolean,ms=5000)=>{const until=Date.now()+ms;while(!fn()&&Date.now()<until)await pause(100);return fn();};
 const record=(id:string,title:string,status:Check['status'],expected:string,actual:string,steps:string[],selector='',severity:Severity='medium')=>{const c:Check={id,title,status,expected,actual,steps,selector,severity};run.checks.push(c);if(status==='failed')run.findings.push({...c});update({...run,checks:[...run.checks],findings:[...run.findings]},title);};
 const assert=(id:string,title:string,ok:boolean,expected:string,actual:string,steps:string[],selector='',severity:Severity='medium')=>record(id,title,ok?'passed':'failed',expected,actual,steps,selector,severity);
 const blocked=(id:string,title:string,reason:string)=>record(id,title,'blocked','Required connection and test data are available.',reason,[]);
 try{
  const groups=testPlan(mode,workflow),chosen=new Set(selectedTests(groups,selection)),wants=(id:string)=>chosen.has(id);
  run.selection={ids:[...chosen],available:groups.flatMap(g=>g.tests).length};
  if(!chosen.size){blocked('selection','Choose tests','Choose at least one test before running.');return run;}
  signal.throwIfAborted();
  update(run,'Opening Studio');frame.style.width='1440px';
  const url=new URL('../index.html',import.meta.url);url.searchParams.set('tester','1');
  // A subsequent workflow can still see the preceding document until navigation
  // commits. Wait for this navigation, not the old document's complete state.
  await new Promise<void>((resolve,reject)=>{
   const cleanup=()=>{clearTimeout(timer);frame.removeEventListener('load',loaded);signal.removeEventListener('abort',cancel);};
   const loaded=()=>{cleanup();resolve();},cancel=()=>{cleanup();reject(new DOMException('Stopped','AbortError'));};
   const timer=setTimeout(()=>{cleanup();reject(new Error('Studio did not finish loading within 25 seconds.'));},25000);
   frame.addEventListener('load',loaded,{once:true});signal.addEventListener('abort',cancel,{once:true});frame.src=url.href;
  });
  if(!await wait(()=>{try{return frame.contentDocument?.readyState==='complete'&&!!frame.contentDocument?.querySelector('#entry-tell-story,#workspace-library-group');}catch{return false;}},25000)){blocked('load','Open Studio','Studio did not load within 25 seconds. Check connectivity and retry.');return run;}
  const w=frame.contentWindow!,d=frame.contentDocument!;
  const q=(s:string)=>d.querySelector(s) as HTMLElement|null;
  const click=async(s:string)=>{const el=q(s);if(!el||!visible(el))return false;el.click();await pause(250);return true;};
  const set=(el:HTMLInputElement|HTMLSelectElement,value:string)=>{el.value=value;el.dispatchEvent(new (w as any).Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));};
  const entry=q('#entry-tell-story') as HTMLButtonElement|null;
  if(entry&&visible(entry)){
   if(!await wait(()=>!entry.disabled,15000)){blocked('auth','Studio sign-in','Sign in to Studio in this browser, then run again. Your Desk account is separate.');return run;}
   entry.click();await pause(350);
  }
  const storyCheck=async()=>{
   const choices=[...d.querySelectorAll('#story-choice-screen button')].filter(visible).map(b=>b.textContent?.trim());
   assert('story-choices','Story entry choices',choices.includes('New Story')&&choices.includes('Existing Story')&&choices.includes('Go to Studio'),'New Story, Existing Story and Go to Studio are available.',choices.join(', ')||'No story choices visible.',['Open Studio','Click Tell Your Story'],'#story-choice-screen','high');
   if(selection===undefined)blocked('story-generation','Generate and publish a story','This run checks entry/navigation. Creating stories, paid generation and publishing need an isolated test workspace.');
  };
  if(wants('story-choices'))await storyCheck();
  if([...chosen].every(id=>id==='story-choices'))return run;
  // Go to Studio is navigation only. Never activate New Story, Generate, delete or publish.
  const go=[...d.querySelectorAll('#story-choice-screen button')].find(b=>b.textContent?.trim()==='Go to Studio') as HTMLElement|undefined;go?.click();await pause(350);
  const kinds=groups.filter(g=>Object.hasOwn(libraries,g.id)&&g.tests.some(t=>wants(t.id))).map(g=>g.id);
  if(kinds.length){
   const group=q('#workspace-library-group') as HTMLDetailsElement|null;
   if(!group){blocked('navigation','Open selected libraries','Studio library navigation is unavailable.');return run;}
   if(!group.open){q('#workspace-library-group > summary')?.click();await pause(200);}
  }
  for(const kind of kinds){
   update({...run},`Checking ${kind} Library`);
   const steps=['Open Studio','Open Library',`Choose ${kind} Library`];
   const opened=await click(libraries[kind]);
   if(wants(`${kind}-nav`))assert(`${kind}-nav`,`${kind} Library navigation`,opened,'The library navigation control is visible.','Navigation control '+(opened?'is visible.':'is missing or hidden.'),steps,libraries[kind],'high');
   if(!opened){if(!wants(`${kind}-nav`))blocked(`${kind}-navigation`,`${kind} selected tests`,'The library could not be opened, so selected checks could not run.');continue;}
   const remaining=[...chosen].filter(id=>id.startsWith(kind+'-')&&id!==`${kind}-nav`);
   if(!remaining.length)continue;
   if(!await wait(()=>!!q('#page .library-files'),8000)){blocked(`${kind}-data`,`${kind} selected tests`,'No file table is available. Connect Storage and load sample items, then retry.');continue;}
   const table=q('#page .library-files')!,view=q('#page .library-view-label select') as HTMLSelectElement|null;
   if(wants(`${kind}-tabs`))assert(`${kind}-tabs`,`${kind} Library hides story tabs`,!visible(q('#story-workspace-header')),'Story tabs are hidden.','Story tabs '+(visible(q('#story-workspace-header'))?'remain visible.':'are hidden.'),steps,'#story-workspace-header','high');
   if(wants(`${kind}-views`))assert(`${kind}-views`,`${kind} Library view consistency`,!!view&&view.value==='list'&&[...view.options].map(o=>o.textContent).join('|')==='List|Small icons|Large icons','List is default, followed by Small icons and Large icons.',view?[...view.options].map(o=>o.textContent).join(', ')+`; selected: ${view.value}`:'View selector missing.',steps,'#page .library-view-label select');
   if(wants(`${kind}-columns`))assert(`${kind}-columns`,`${kind} Library columns`,table.querySelectorAll('[role=columnheader]').length===4,'Four columns: File Name, Type, Date Created, Date Last Accessed.',[...table.querySelectorAll('[role=columnheader]')].map(x=>x.textContent).join(' | '),steps,'#page [role=columnheader]');
   const rows=()=>[...table.querySelectorAll(':scope > .card')];
   if(wants(`${kind}-search`)){
    const search=q(`#page input[aria-label="Filter ${kind} library"]`) as HTMLInputElement|null;
    if(!rows().length)blocked(`${kind}-search`,`${kind} Library search`,'No sample files are loaded to verify filtering.');
    else if(search){
     const original=search.value;set(search,'ecco-no-match-'+crypto.randomUUID());await pause(250);
     const shown=rows().filter(visible).length;
     assert(`${kind}-search`,`${kind} Library search hides nonmatching files`,shown===0,'Zero rows are visible for a query that matches no file.',`${shown} rows remain visibly displayed.`,[...steps,'Search for a unique nonexistent file name'],'#page .library-files > .card','high');
     set(search,original);await pause(200);
    }else assert(`${kind}-search-control`,`${kind} Library search`,false,'A search input is available.','Search control missing.',steps);
   }
   for(const direction of ['ascending','descending'])if(wants(`${kind}-sort-${direction}`)){
    const sort=table.querySelector('[data-sort=title] button') as HTMLElement|null;
    if(!rows().length){blocked(`${kind}-sort-${direction}`,`${kind} Library sorts ${direction}`,'No sample files are loaded to verify sorting.');continue;}
    if(!sort){assert(`${kind}-sort-${direction}`,`${kind} Library sorts ${direction}`,false,'File Name is sortable.','Sort control missing.',steps);continue;}
    // Each direction works on its own; descending does not depend on selecting ascending.
    for(let attempt=0;attempt<2;attempt++){
     if(sort.closest('[aria-sort]')?.getAttribute('aria-sort')===direction)break;
     sort.click();await pause(150);
    }
    const names=rows().filter(visible).map(r=>r.querySelector('.library-file-open')?.getAttribute('aria-label')?.replace(/^Open /,'')||'');
    const expected=[...names].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'})*(direction==='ascending'?1:-1));
    assert(`${kind}-sort-${direction}`,`${kind} Library sorts ${direction}`,names.every((n,i)=>n===expected[i]),`File names sort ${direction}.`,names.slice(0,8).join(', '),[...steps,'Sort by File Name '+direction],'#page [data-sort=title]');
   }
   for(const size of ['small','large'])if(wants(`${kind}-${size}`)){
    if(!view){assert(`${kind}-${size}-view`,`${kind} ${size} previews`,false,'The icon view can be selected.','View selector missing.',steps);continue;}
    if(!rows().length){blocked(`${kind}-${size}-items`,`${kind} ${size} previews`,'No sample files are loaded to inspect previews.');continue;}
    set(view,size);await pause(300);
    const samples=rows().slice(0,20);
    for(let i=0;i<samples.length;i++){
     const row=samples[i],icon=row.querySelector('.library-file-icon'),name=row.querySelector('.library-file-open')?.getAttribute('aria-label')||`Item ${i+1}`;
     row.scrollIntoView({block:'center'});await pause(100);
     if(['image','video'].includes(kind)){
      const ok=!!icon&&await wait(()=>decoded(icon),13000);
      assert(`${kind}-${size}-thumb-${i}`,`${kind} ${size} thumbnail: ${name.replace(/^Open /,'')}`,ok,'A decoded media preview is visible, rather than only a generic symbol.',ok?'Decoded preview is visible.':'No decoded media preview after 13 seconds; inspect asset loading or thumbnail rendering.',[...steps,`Select ${size} icons`,`Scroll to ${name}`],'.library-file-icon img');
     }else assert(`${kind}-${size}-icon-${i}`,`${kind} ${size} icon: ${name.replace(/^Open /,'')}`,visible(icon),'An icon is visible.',visible(icon)?'Visible.':'Missing or hidden.',[...steps,`Select ${size} icons`],'.library-file-icon');
    }
    if(rows().length>20)blocked(`${kind}-${size}-remaining`,`${kind} additional ${size} icons`,`${rows().length-20} additional items were not inspected. Live runs inspect up to 20 items per library per view.`);
   }
   if(view&&(wants(`${kind}-small`)||wants(`${kind}-large`)))set(view,'list');
   for(const width of [1440,1024,768])if(wants(`${kind}-width-${width}`)){
    frame.style.width=width+'px';await pause(150);
    assert(`${kind}-width-${width}`,`${kind} Library fits ${width}px`,d.documentElement.scrollWidth<=width+1,'Page fits the viewport; file tables may scroll internally.',`Page width ${d.documentElement.scrollWidth}px; viewport ${width}px.`,[...steps,`Set viewport to ${width}px`],'html','high');
   }
   frame.style.width='1440px';
  }
  if(wants('drive-search')||wants('drive-sort')){
   const settings=q('[data-category=Activity]') as HTMLDetailsElement|null;if(settings&&!settings.open)settings.querySelector<HTMLElement>('summary')?.click();await pause(150);
   if(await click('#activity-files-menu')&&await wait(()=>visible(q('#activity-files')))){
    if(wants('drive-search'))assert('drive-search','Workspace Drive search',visible(q('#activity-files-search')),'Search is visible.','Search '+(visible(q('#activity-files-search'))?'is visible.':'is missing.'),['Open Settings','Open Workspace Drive'],'#activity-files-search');
    if(wants('drive-sort'))assert('drive-sort','Workspace Drive sortable columns',d.querySelectorAll('#activity-files-table th button').length===4,'Four sortable columns.',`${d.querySelectorAll('#activity-files-table th button').length} sortable columns.`,['Open Settings','Open Workspace Drive'],'#activity-files-table th button');
    (q('#activity-files') as HTMLDialogElement)?.close();
   }else blocked('drive-load','Workspace Drive','Workspace Drive could not be opened.');
  }
  if(mode==='sweep'&&selection===undefined)blocked('live-services','Generation, billing and publishing','Live write workflows require isolated accounts, test workers, a payment sandbox and test publishing destination.');
 }catch(e){if(signal.aborted)run.status='cancelled';else blocked('runner','Complete this run',(e as Error).message.slice(0,300));}
 finally{if(run.status==='running')run.status='completed';run.finishedAt=new Date().toISOString();update({...run,checks:[...run.checks],findings:[...run.findings]},run.status==='cancelled'?'Stopped':'Run complete');}
 return run;
}
