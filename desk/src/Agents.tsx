import {useEffect,useRef,useState} from 'react';
import {Bot,Plus} from 'lucide-react';
import type {Actor,Member,Ticket} from './types';
import type {AgentDefinition} from './agent-workflows';
import AgentBuilder from './AgentBuilder';
import TesterAgent from './TesterAgent';
type Props={me:Actor;members:Member[];api:(payload?:any,path?:string)=>Promise<any>;openTicket:(t:Ticket)=>void;refresh:()=>Promise<any>;agents?:AgentDefinition[];agentWorkflowVersion?:number};
export default function Agents(props:Props){
 const {me,agents=[],agentWorkflowVersion=0}=props;
 const [chosen,setChosen]=useState<string|null>(null),[creating,setCreating]=useState(false),[saved,setSaved]=useState<AgentDefinition[]>([]),[notice,setNotice]=useState('');
 const createButton=useRef<HTMLButtonElement>(null),pool=useRef<HTMLElement>(null),restoreCreate=useRef(false),restorePool=useRef(false);
 useEffect(()=>{if(!creating&&restoreCreate.current){restoreCreate.current=false;createButton.current?.focus();}},[creating]);
 useEffect(()=>{if(!chosen&&restorePool.current){restorePool.current=false;pool.current?.querySelector<HTMLButtonElement>('.agent-card')?.focus();}},[chosen]);
 const admin=me.role==='admin'||me.canManageAgents===true;
 const custom=[...agents,...saved.filter(a=>!agents.some(x=>x.id===a.id))];
 const close=()=>{restoreCreate.current=true;setCreating(false);};
 const definition=custom.find(a=>a.id===chosen);
 if(chosen)return <TesterAgent key={chosen} {...props} definition={definition} onBack={()=>{restorePool.current=true;setChosen(null);}}/>;
 return <section className="agent-pool" aria-label="Agent pool" ref={pool}>
  <div className="agent-pool-toolbar"><p className="subtle">{1+custom.length} agent{custom.length?'s':''} in your pool</p>{admin&&<button ref={createButton} className="primary" disabled={creating} onClick={()=>{setNotice('');setCreating(true);}}><Plus size={17}/>Create New Agents</button>}</div>
  {notice&&<p className="notification-success" role="status">{notice}</p>}
  {creating&&(agentWorkflowVersion===1?<AgentBuilder api={props.api} onCancel={close} onSaved={agent=>{setSaved(current=>[...current.filter(a=>a.id!==agent.id),agent]);setNotice(`${agent.name} created. Select it below to run its workflow.`);close();void props.refresh();}}/>:<section className="ticket-section agent-builder" role="status"><h2>Agent creation is being updated</h2><p>The shared workflow service is not available yet. Refresh the workspace after the update completes.</p><button className="secondary-button" data-page-back onClick={close}>Back</button></section>)}
  {!creating&&<div className="agent-pool-grid"><button className="agent-card ticket-section" onClick={()=>{setChosen('tester');setNotice('');}}><span className="agent-symbol"><Bot size={28}/></span><span><strong>Tester Agent</strong><span>Check UX consistency, run workflows and turn findings into tickets.</span><small>Ready · Browser checks + automated regression reports</small></span><span className="agent-open">Open →</span></button>
  {custom.map(agent=><button key={agent.id} className="agent-card ticket-section" onClick={()=>{setChosen(agent.id);setNotice('');}}><span className="agent-symbol"><Bot size={28}/></span><span><strong>{agent.name}</strong><span>{agent.description||'A saved agent workflow.'}</span><small>{agent.steps.length} workflow step{agent.steps.length===1?'':'s'} · Ready</small></span><span className="agent-open">Open →</span></button>)}</div>}
 </section>;
}
