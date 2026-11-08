import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {AlertCircle,ArrowUpRight,CheckCircle2,GitBranch,LoaderCircle,PackageCheck,RefreshCw,Rocket,RotateCcw} from 'lucide-react';

type Release={id:string;title:string;sha:string;baseSha:string;kind:string;state:string;createdAt:string;createdName:string;error?:string;runUrl?:string};
type Published={id:string;title:string;sha:string;kind:string;actor:string;publishedAt:string;url:string};
type Snapshot={releaseVersion:number;productionUrl:string;devUrl:string;previewUrl:string;previewEnabled:boolean;blockers:string[];head:string;checks:{state:string;label:string;id:number|null;url:string|null};changes:{sha:string;title:string;author:string;url:string}[];current:Published|null;releases:Release[];history:Published[];active:string|null};
const stamp=(value:string)=>new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
const short=(sha:string)=>sha.slice(0,8);
const stateLabel=(state:string)=>({prepared:'Ready for review',queued:'Queued',dispatching:'Submitting',in_progress:'Publishing',deployed:'Published',failed:'Failed',unknown:'Checking receipt'}[state]||state);
export default function Releases({api}:{api:(payload?:any,path?:string)=>Promise<any>}){
 const [data,setData]=useState<Snapshot|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[title,setTitle]=useState('');
 const alive=useRef(true),sequence=useRef(0),sending=useRef(false),preparedFocus=useRef<HTMLHeadingElement>(null),intent=useRef<{key:string;id:string}|null>(null);
 const refresh=useCallback(async()=>{const n=++sequence.current;try{const d=await api(undefined,'?releases=1');if(d.releaseVersion!==1)throw new Error('The Releases service needs to be installed before releases can be managed.');if(alive.current&&n===sequence.current){setData(d);setError('')}}catch(e){if(alive.current&&n===sequence.current){setError((e as Error).message);setData(null)}}finally{if(alive.current&&n===sequence.current)setLoading(false)}},[api]);
 useEffect(()=>{alive.current=true;refresh();const timer=setInterval(()=>{if(!document.hidden&&!sending.current)refresh()},15000);return()=>{alive.current=false;sequence.current++;clearInterval(timer)}},[refresh]);
 async function action(op:string,sha?:string,id?:string){
  if(sending.current||!data)return;
  const releaseTitle=op==='prepareRollback'?'Rollback to '+short(sha||''):title.trim();
  const key=op+':'+sha+':'+releaseTitle;
  if(!id&&intent.current?.key!==key)intent.current={key,id:crypto.randomUUID().replace(/-/g,'')};
  sending.current=true;sequence.current++;setBusy(true);setError('');setNotice('');
  try{
   const result=await api({op,id:id||intent.current!.id,...(sha?{sha,title:releaseTitle}:{})});
   if(result.releaseVersion!==1||!result.release)throw new Error('The service did not confirm the release. Refresh status before trying again.');
   if(!alive.current)return;
   if(op==='publishRelease')setNotice(result.release.state==='unknown'?'Publication receipt is pending. Refresh status before taking another action.':'Publication requested. Production updates only after deployment succeeds.');
   else {setNotice('Release prepared. Review the exact version below before publishing.');setTitle('');intent.current=null;}
   await refresh();if(op!=='publishRelease')requestAnimationFrame(()=>preparedFocus.current?.focus());
  }catch(e){if(alive.current)setError((e as Error).message)}finally{sending.current=false;if(alive.current)setBusy(false)}
 }
 const submit=(e:FormEvent)=>{e.preventDefault();action('prepareRelease',data?.head)};
 return <div className="release-manager" aria-busy={busy}>
  <div className="release-toolbar"><span><GitBranch size={16}/>GitHub Dev / Test</span><ArrowUpRight size={16}/><span><Rocket size={16}/>Website Production</span><button type="button" className="secondary-button" disabled={busy} onClick={refresh}><RefreshCw size={15}/>Refresh status</button></div>
  {error&&<div className="alert error" role="alert"><AlertCircle size={17}/>{error}</div>}
  {notice&&<p role="status" className="notification-success">{notice}</p>}
  {loading&&!data&&<p className="detail-loading" role="status"><LoaderCircle className="spin" size={17}/>Loading releases…</p>}
  {data&&<>
   {!!data.blockers.length&&<section className="release-setup" aria-label="Production setup"><strong>Production setup required</strong><ul>{data.blockers.map(b=><li key={b}>{b}</li>)}</ul></section>}
   <section className="ticket-section" aria-label="Current production"><div className="section-heading"><div><Rocket size={18}/><h2>Current production</h2></div><a className="text-button" href={data.productionUrl} target="_blank" rel="noreferrer">Open website <ArrowUpRight size={14}/></a></div><div className="release-summary">{data.current?<><strong>{data.current.title}</strong><code>{short(data.current.sha)}</code><span>{stamp(data.current.publishedAt)} · {data.current.actor}</span></>:<span>No production release has been published.</span>}</div></section>
   <section className="ticket-section" aria-label="Pending changes"><div className="section-heading"><div><GitBranch size={18}/><h2>Pending changes</h2><span className="count">{data.changes.length}</span></div><a className="text-button" href={data.devUrl} target="_blank" rel="noreferrer">Open Dev / Test <ArrowUpRight size={14}/></a></div>
    <div className="release-summary"><code>{short(data.head)}</code><span className={data.checks.state==='success'?'release-passed':''}>{data.checks.state==='success'&&<CheckCircle2 size={15}/>}Tests: {data.checks.label}</span>{data.checks.url&&<a className="text-button" href={data.checks.url} target="_blank" rel="noreferrer">View test results</a>}</div>
    <div className="table-wrap"><table><thead><tr><th>Change</th><th>Author</th><th>Version</th></tr></thead><tbody>{data.changes.map(c=><tr key={c.sha}><td>{c.title}</td><td>{c.author}</td><td><a href={c.url} target="_blank" rel="noreferrer"><code>{short(c.sha)}</code></a></td></tr>)}</tbody></table></div>
    {!data.changes.length&&<p className="release-empty">Production includes all current development changes.</p>}
    <form className="release-prepare" onSubmit={submit}><label>Release name<input value={title} onChange={e=>setTitle(e.target.value)} maxLength={120} required placeholder="For example: Library and navigation improvements" disabled={busy}/></label><button className="primary" type="submit" disabled={busy||!title.trim()||!data.changes.length||data.checks.state!=='success'}><PackageCheck size={16}/>Prepare release</button></form>
   </section>
   <section className="ticket-section" aria-label="Prepared releases"><div className="section-heading"><div><PackageCheck size={18}/><h2 ref={preparedFocus} tabIndex={-1}>Prepared releases</h2></div></div>
    <p className="release-note">Each release contains the complete tested version. New development changes are excluded after preparation.</p>
    {data.releases.length?<div className="table-wrap"><table><thead><tr><th>Release</th><th>Version</th><th>Status</th><th>Actions</th></tr></thead><tbody>{data.releases.map(r=><tr key={r.id}><td><strong>{r.title}</strong><small>{stamp(r.createdAt)} · {r.createdName}</small>{r.error&&<small role="status">{r.error}</small>}</td><td><code>{short(r.sha)}</code>{r.kind==='rollback'&&<small>Rollback</small>}</td><td>{stateLabel(r.state)}</td><td><div className="release-row-actions">{data.previewEnabled?<a className="text-button" href={data.devUrl+'previews/'+r.sha+'/'} target="_blank" rel="noreferrer" aria-label={'Preview '+r.title}>Preview <ArrowUpRight size={14}/></a>:<span>GitHub preview setup required</span>}{r.runUrl&&<a className="text-button" href={r.runUrl} target="_blank" rel="noreferrer">Deployment details</a>}{r.state==='prepared'&&<button type="button" className="primary" disabled={busy||!!data.blockers.length||!!data.active||r.baseSha!==(data.current?.sha||'')} onClick={()=>action('publishRelease',undefined,r.id)} aria-label={'Publish '+r.title+' to Production'}><Rocket size={15}/>Publish to Production</button>}</div>{r.state==='prepared'&&r.baseSha!==(data.current?.sha||'')&&<small>Production changed. Prepare a new release.</small>}</td></tr>)}</tbody></table></div>:<p className="release-empty">Prepare a release after its tests pass.</p>}
   </section>
   <section className="ticket-section" aria-label="Release history"><div className="section-heading"><div><RotateCcw size={18}/><h2>Release history</h2></div></div>{data.history.length?<div className="table-wrap"><table><thead><tr><th>Release</th><th>Published</th><th>By</th><th>Version</th><th>Actions</th></tr></thead><tbody>{data.history.map(r=><tr key={r.id}><td><a href={r.url} target="_blank" rel="noreferrer">{r.title}</a></td><td>{stamp(r.publishedAt)}</td><td>{r.actor}</td><td><code>{short(r.sha)}</code></td><td>{r.sha!==data.current?.sha&&<button type="button" className="text-button" disabled={busy||!!data.active} onClick={()=>action('prepareRollback',r.sha)}>Prepare rollback</button>}</td></tr>)}</tbody></table></div>:<p className="release-empty">Successful production releases will appear here.</p>}</section>
  </>}
 </div>;
}
