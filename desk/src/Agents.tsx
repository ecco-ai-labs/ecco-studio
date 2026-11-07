import {useEffect,useRef,useState} from 'react';
import {Bot,Play,Square,Ticket as TicketIcon,Upload,Download,ChevronLeft,CheckCircle2,AlertCircle,LoaderCircle} from 'lucide-react';
import type {Actor,Member,Ticket} from './types';
import {ticketKey,isStaff} from './types';
import {counts,createFindingTickets,importReport,severities,type Run,type Severity} from './tester-model';
import {runTester,workflows,type Mode} from './tester-runner';
type Props={me:Actor;members:Member[];api:(payload?:any,path?:string)=>Promise<any>;openTicket:(t:Ticket)=>void;refresh:()=>Promise<any>};
export default function Agents({me,members,api,openTicket,refresh}:Props){
 const staff=isStaff(me);
 const key='ecco-tester-runs:v1:'+me.userId;
 const read=():Run[]=>{try{const data=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(data)?data.filter(r=>r.version===1&&typeof r.id==='string'&&Array.isArray(r.checks)&&Array.isArray(r.findings)).slice(0,10):[]}catch{return []}};
 const [chosen,setChosen]=useState(false),[history,setHistory]=useState<Run[]>(read),[run,setRun]=useState<Run|null>(()=>read()[0]||null);
 const [mode,setMode]=useState<Mode>('ux'),[workflow,setWorkflow]=useState('libraries'),[running,setRunning]=useState(false),[busy,setBusy]=useState(false),[step,setStep]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [selected,setSelected]=useState<string[]>([]),[severity,setSeverity]=useState('all'),[assignee,setAssignee]=useState('');
 const frame=useRef<HTMLIFrameElement>(null),controller=useRef<AbortController|null>(null),alive=useRef(true),runningRef=useRef(false),busyRef=useRef(false);
 useEffect(()=>()=>{alive.current=false;controller.current?.abort();},[]);
 const persist=(next:Run)=>{const saved=[next,...read().filter(r=>r.id!==next.id)].slice(0,10);try{localStorage.setItem(key,JSON.stringify(saved));if(alive.current)setHistory(saved);return true;}catch{if(alive.current)setError('Browser history is full. Download this report before leaving.');return false;}};
 const update=(next:Run)=>{if(alive.current)setRun({...next,findings:next.findings.map(f=>({...f}))});return persist(next);};
 async function start(){
  if(!frame.current||runningRef.current||busyRef.current)return;
  runningRef.current=true;setRunning(true);setError('');setNotice('');setSelected([]);setSeverity('all');const abort=new AbortController();controller.current=abort;
  try{await runTester(frame.current,mode,workflow,abort.signal,(next,message)=>{if(alive.current){setRun(next);setStep(message);}if(next.status!=='running')persist(next);});}
  finally{runningRef.current=false;if(alive.current)setRunning(false);if(frame.current)frame.current.src='about:blank';}
 }
 async function create(ids:string[]){
  if(!run||busyRef.current||runningRef.current)return;
  busyRef.current=true;setBusy(true);setError('');setNotice('');const abort=new AbortController();controller.current=abort;
  try{
   if(!navigator.locks)throw Error('Ticket creation requires a browser supporting Web Locks. Open Ecco Desk in a current Chrome, Edge, Firefox or Safari.');
   await navigator.locks.request('ecco-tester-tickets:'+me.userId,{signal:abort.signal},async()=>{
    abort.signal.throwIfAborted();const working=structuredClone(run),saved=read().find(r=>r.id===working.id);
    for(const f of working.findings){const old=saved?.findings.find(x=>x.id===f.id);if(old){f.ticketId=old.ticketId;f.ticketType=old.ticketType;f.uncertain=old.uncertain;}}
    await createFindingTickets(working,ids,assignee,api,()=>{if(!update(working))throw Error('Could not save ticket progress. Free browser storage before creating tickets.');},abort.signal,staff?'internal':'support');
    const n=working.findings.filter(f=>ids.includes(f.id)&&f.ticketId).length;
    if(alive.current){setSelected(current=>current.filter(id=>!working.findings.find(f=>f.id===id)?.ticketId));setNotice(`${n} of ${ids.length} selected findings have separate tickets.${working.findings.some(f=>f.uncertain)?' A ticket receipt is pending; refresh its status.':''}`);}
   });
   await refresh();
  }catch(e){if(alive.current&&!abort.signal.aborted)setError((e as Error).message);}
  finally{busyRef.current=false;if(alive.current)setBusy(false);}
 }
 async function importFile(file:File|undefined){if(!file)return;setError('');try{if(file.size>2_000_000)throw Error('Report must be smaller than 2 MB.');const next=importReport(JSON.parse(await file.text())),old=read().find(r=>r.id===next.id);if(old)for(const f of next.findings){const saved=old.findings.find(x=>x.id===f.id);if(saved)Object.assign(f,{ticketId:saved.ticketId,ticketType:saved.ticketType,uncertain:saved.uncertain,ticketError:saved.ticketError});}update(next);setSelected([]);setNotice('CI report imported. Review findings before creating tickets.');}catch(e){setError((e as Error).message);}}
 function download(){if(!run)return;const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(run,null,2)],{type:'application/json'}));a.href=url;a.download=`tester-agent-${run.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 const list=run?.findings.filter(f=>severity==='all'||f.severity===severity)||[],total=run?counts(run):null;
 const available=list.filter(f=>!f.ticketId&&!f.uncertain),critical=run?.findings.filter(f=>f.severity==='critical'&&!f.ticketId&&!f.uncertain)||[];
 if(!chosen)return <section className="agent-pool" aria-label="Agent pool"><button className="agent-card ticket-section" onClick={()=>setChosen(true)}><span className="agent-symbol"><Bot size={28}/></span><span><strong>Tester Agent</strong><span>Check UX consistency, run workflows and turn findings into tickets.</span><small>Ready · Browser checks + automated regression reports</small></span><span className="agent-open">Open →</span></button><p className="subtle">1 agent in your pool</p></section>;
 return <div className="tester-agent">
  <button className="agent-back" onClick={()=>setChosen(false)} disabled={running||busy}><ChevronLeft size={15}/>Agent pool</button>
  <section className="ticket-section agent-config" aria-label="Tester Agent controls">
   <div className="agent-heading"><Bot size={24}/><div><h2>Tester Agent</h2><p>Choose a check. Review findings. Create separate tickets.</p></div></div>
   <div className="agent-options"><label>Action<select aria-label="Action" value={mode} disabled={running||busy} onChange={e=>setMode(e.target.value as Mode)}><option value="ux">Check UX consistency</option><option value="workflow">Perform a workflow</option><option value="sweep">Run available workflow sweep</option></select></label>{mode==='workflow'&&<label>Workflow<select aria-label="Workflow" value={workflow} disabled={running||busy} onChange={e=>setWorkflow(e.target.value)}>{workflows.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>}<button className="primary" onClick={start} disabled={running||busy}><Play size={16}/>Run checks</button>{running&&<button className="secondary" onClick={()=>controller.current?.abort()}><Square size={14}/>Stop</button>}</div>
   <p className="agent-scope">Uses your Studio sign-in and connected libraries. Keep this page open. Up to 20 files per library, in Small and Large views. Creating content, generation, purchases and publishing require a separate test environment.</p>
   <div className="agent-tools"><label className="agent-import"><Upload size={14}/>Import CI report<input type="file" accept="application/json,.json" aria-label="Import CI report" disabled={running||busy} onChange={e=>{importFile(e.target.files?.[0]);e.target.value='';}}/></label><a href="https://github.com/ecco-ai-labs/ecco-studio/actions/workflows/ux-qa-agent.yml" target="_blank" rel="noreferrer">Automatic checks ↗</a><span>History stays in this browser for your Desk account.</span></div>
  </section>
  {error&&<div className="alert error" role="alert"><AlertCircle size={16}/>{error}</div>}
  {notice&&<p className="notification-success" role="status">{notice}</p>}
  {running&&<div className="agent-progress" role="status"><LoaderCircle size={16} className="spin"/>{step}<span>{run?.checks.length||0} checks completed</span></div>}
  {run&&total&&<section className="ticket-section agent-results" aria-label="Tester Agent results" aria-busy={running||busy}>
   <div className="agent-result-head"><div><h2>{running?'Checking…':run.status==='cancelled'?'Stopped · partial results':'Results'}</h2><p>{run.scope} · {new Date(run.startedAt).toLocaleString()}</p><small>{run.source}</small></div><button className="secondary" onClick={download} disabled={running}><Download size={14}/>Download report</button></div>
   <div className="agent-counts"><span><strong>{total.failed}</strong> issues</span><span><strong>{run.findings.filter(f=>f.severity==='critical').length}</strong> critical</span><span><strong>{total.passed}</strong> passed</span><span><strong>{total.blocked}</strong> blocked / untested</span><span><strong>{run.findings.filter(f=>f.ticketId).length}</strong> ticketed</span></div>
   <div className="agent-filters"><label>Severity<select aria-label="Filter findings by severity" value={severity} onChange={e=>setSeverity(e.target.value)}><option value="all">All severities</option>{severities.map(s=><option key={s} value={s}>{s[0].toUpperCase()+s.slice(1)}</option>)}</select></label><button className="secondary" disabled={running||busy||!critical.length} onClick={()=>setSelected(critical.map(f=>f.id))}>Select critical ({critical.length})</button><button className="secondary" disabled={running||busy||!available.length} onClick={()=>setSelected(available.map(f=>f.id))}>Select visible ({available.length})</button><button className="secondary" disabled={!selected.length||busy} onClick={()=>setSelected([])}>Clear selection</button></div>
   <div className="agent-ticket-actions">{staff?<label>Assign to<select aria-label="Assign findings to" value={assignee} disabled={busy} onChange={e=>setAssignee(e.target.value)}><option value="">Unassigned</option>{members.filter(m=>m.active).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>:<p className="agent-scope">Each selected finding creates a Bug ticket for the support team.</p>}<button className="primary" disabled={running||busy||!selected.length} onClick={()=>create(selected)}><TicketIcon size={16}/>{busy?'Creating tickets…':`Create ${selected.length} separate ticket${selected.length===1?'':'s'}`}</button><button className="secondary" disabled={busy||running} onClick={()=>create(run.findings.filter(f=>f.uncertain).map(f=>f.id))}>Refresh ticket status</button></div>
   {!list.length&&<div className="agent-empty"><CheckCircle2 size={22}/><p>{running?'Findings will appear as checks finish.':total.failed?'No findings match this filter.':total.blocked?'No issues found in completed checks. Review blocked checks below.':'No issues found in the completed checks.'}</p></div>}
   <div className="agent-findings">{list.map(f=><article className="agent-finding" key={f.id}><div className="agent-finding-title"><input type="checkbox" aria-label={`Select ${f.title}`} disabled={running||busy||!!f.ticketId||f.uncertain} checked={selected.includes(f.id)} onChange={e=>setSelected(ids=>e.target.checked?[...new Set([...ids,f.id])]:ids.filter(id=>id!==f.id))}/><details><summary>{f.title}</summary><dl><dt>Expected</dt><dd>{f.expected}</dd><dt>Observed</dt><dd>{f.actual}</dd><dt>Steps to reproduce</dt><dd><ol>{f.steps.map((s,i)=><li key={i}>{s}</li>)}</ol></dd>{f.selector&&<><dt>Element</dt><dd><code>{f.selector}</code></dd></>}</dl></details></div><div className="agent-finding-actions"><select aria-label={`Severity for ${f.title}`} value={f.severity} className={'agent-severity '+f.severity} disabled={running||busy||!!f.ticketId} onChange={e=>{f.severity=e.target.value as Severity;update(run);}}>{severities.map(s=><option key={s} value={s}>{s}</option>)}</select>{f.ticketId?<button className="agent-ticket-link" onClick={async()=>{try{const result=await api(undefined,`?ticket=${f.ticketId}`);openTicket(result.ticket);}catch(e){setError((e as Error).message);}}}>{ticketKey({id:f.ticketId,type:f.ticketType||'internal'} as Ticket)} ↗</button>:<button className="secondary" disabled={running||busy||f.uncertain} onClick={()=>create([f.id])}>{f.uncertain?'Receipt pending':'Create ticket'}</button>}</div>{f.ticketError&&<p className="agent-ticket-error" role="status">{f.ticketError}</p>}</article>)}</div>
   <details className="agent-check-log"><summary>All checks ({run.checks.length}), including blocked checks</summary><ul>{run.checks.map(c=><li key={c.id}><strong className={'check-'+c.status}>{c.status}</strong><span>{c.title}{c.status==='blocked'&&<small>{c.actual}</small>}</span></li>)}</ul></details>
  </section>}
  {history.length>0&&<label className="agent-history">Previous runs<select aria-label="Previous runs" value={run?.id||''} disabled={running||busy} onChange={e=>{setRun(history.find(r=>r.id===e.target.value)||null);setSelected([]);}}>{history.map(r=><option key={r.id} value={r.id}>{new Date(r.startedAt).toLocaleString()} · {r.scope} · {r.findings.length} issues</option>)}</select></label>}
  <div className={'agent-browser '+(running?'is-running':'')} inert aria-hidden="true"><iframe ref={frame} title="Tester Agent Studio check" tabIndex={-1} src="about:blank"/></div>
 </div>;
}
