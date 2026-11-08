import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Plus,ArrowUp,ArrowDown,Trash2,Save} from 'lucide-react';
import {workflows,type Mode} from './tester-runner';
import type {AgentDefinition,AgentStep} from './agent-workflows';
export default function AgentBuilder({api,onSaved,onCancel}:{api:(payload:any)=>Promise<any>;onSaved:(agent:AgentDefinition)=>void;onCancel:()=>void}){
 const [name,setName]=useState(''),[description,setDescription]=useState(''),[steps,setSteps]=useState<AgentStep[]>([{mode:'workflow',workflow:'video'}]);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');const id=useRef(crypto.randomUUID()),active=useRef(true),pending=useRef(false),input=useRef<HTMLInputElement>(null);
 useEffect(()=>{input.current?.focus();return()=>{active.current=false;}},[]);
 const change=(i:number,p:Partial<AgentStep>)=>setSteps(current=>current.map((s,j)=>j===i?{...s,...p}:s));
 const move=(i:number,by:number)=>setSteps(current=>{const next=[...current];[next[i],next[i+by]]=[next[i+by],next[i]];return next;});
 async function save(e:FormEvent){e.preventDefault();if(pending.current)return;pending.current=true;setBusy(true);setError('');
  try{const result=await api({op:'createAgent',id:id.current,name:name.trim(),description:description.trim(),steps});if(result.agentWorkflowVersion!==1||!result.agent?.id)throw Error('No saved agent receipt was returned. Retry to confirm this request.');if(active.current)onSaved(result.agent);}
  catch(e){if(active.current)setError((e as Error).message);}finally{pending.current=false;if(active.current)setBusy(false);}
 }
 return <form className="ticket-section agent-builder" aria-label="Create new agent" aria-busy={busy} onSubmit={save}>
  <h2>Create New Agent</h2><p>Name the agent and choose the steps it will run, in order.</p>
  <fieldset disabled={busy}><div className="agent-builder-fields"><label>Agent Name<input ref={input} value={name} maxLength={80} required onChange={e=>setName(e.target.value)}/></label><label>Purpose<textarea value={description} maxLength={500} rows={2} onChange={e=>setDescription(e.target.value)} placeholder="What should this agent check?"/></label></div>
  <h3>Workflow Steps</h3><ol className="agent-builder-steps">{steps.map((step,i)=><li key={i}><strong>Step {i+1}</strong><label>Action<select aria-label={`Step ${i+1} action`} value={step.mode} onChange={e=>change(i,{mode:e.target.value as Mode,workflow:'libraries'})}><option value="ux">Check UX consistency</option><option value="workflow">Perform a workflow</option><option value="sweep">Run available workflow sweep</option></select></label>{step.mode==='workflow'&&<label>Workflow<select aria-label={`Step ${i+1} workflow`} value={step.workflow} onChange={e=>change(i,{workflow:e.target.value})}>{workflows.map(([id,label])=><option value={id} key={id}>{label}</option>)}</select></label>}<div className="agent-step-controls"><button type="button" className="icon-button" aria-label={`Move step ${i+1} up`} disabled={i===0} onClick={()=>move(i,-1)}><ArrowUp size={16}/></button><button type="button" className="icon-button" aria-label={`Move step ${i+1} down`} disabled={i===steps.length-1} onClick={()=>move(i,1)}><ArrowDown size={16}/></button><button type="button" className="icon-button" aria-label={`Remove step ${i+1}`} disabled={steps.length===1} onClick={()=>setSteps(current=>current.filter((_,j)=>i!==j))}><Trash2 size={16}/></button></div></li>)}</ol>
  <button type="button" className="secondary-button" disabled={steps.length>=12} onClick={()=>setSteps(current=>[...current,{mode:'workflow',workflow:'libraries'}])}><Plus size={15}/>Add Step</button>
  <p className="agent-scope">These agents run the available browsing and UX checks. Findings appear in one report, ready to turn into separate tickets. Saved agents are shared with signed-in Desk users.</p>
  <div className="agent-builder-actions"><button type="submit" className="primary" disabled={!name.trim()}><Save size={16}/>{busy?'Saving…':'Create Agent'}</button><button type="button" className="secondary-button" onClick={onCancel}>Cancel</button></div></fieldset>
  {error&&<p className="alert error" role="alert">{error}</p>}
 </form>;
}
