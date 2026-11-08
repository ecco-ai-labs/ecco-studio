import {runTester,type Mode} from './tester-runner';
import {agentTestPlan,selectedTests} from './tester-catalog';
import type {Run,Check} from './tester-model';
export type AgentStep={mode:Mode;workflow:string};
export type AgentDefinition={id:string;name:string;description:string;steps:AgentStep[];createdAt?:string};
export async function runAgentWorkflow(frame:HTMLIFrameElement,agent:AgentDefinition,signal:AbortSignal,update:(run:Run,message:string)=>void,execute=runTester,selection?:string[]){
 const run:Run={version:1,id:crypto.randomUUID(),startedAt:new Date().toISOString(),status:'running',source:'Saved agent workflow · current Studio browser checks',scope:agent.name,checks:[],findings:[]};
 let completed:Check[]=[];
 try{
  const groups=agentTestPlan(agent.steps),chosen=selectedTests(groups,selection);
  run.selection={ids:chosen,available:groups.flatMap(g=>g.tests).length};
  if(!chosen.length)throw Error('Choose at least one test before running.');
  for(let i=0;i<agent.steps.length;i++){
   signal.throwIfAborted();const step=agent.steps[i],prefix=`step-${i+1}/`,stepTests=chosen.filter(id=>id.startsWith(prefix)).map(id=>id.slice(prefix.length));
   if(!stepTests.length)continue;
   const part=await execute(frame,step.mode,step.workflow,signal,(next,message)=>{
    run.checks=[...completed,...next.checks.map(c=>({...c,id:`step-${i+1}/${c.id}`,title:`Step ${i+1}: ${c.title}`,steps:[`Run ${agent.name}, step ${i+1} of ${agent.steps.length}`,...c.steps]}))];
    run.findings=run.checks.filter(c=>c.status==='failed').map(c=>({...c}));
    update({...run},`Step ${i+1} of ${agent.steps.length} · ${message}`);
   },selection===undefined?undefined:stepTests);
   completed=[...run.checks];
   if(part.status==='cancelled'||signal.aborted){run.status='cancelled';break;}
  }
 }catch(e){if(signal.aborted)run.status='cancelled';else{run.checks.push({id:'workflow-error',title:'Complete saved workflow',status:'blocked',severity:'high',expected:'All configured steps finish.',actual:(e as Error).message.slice(0,300),steps:[]});}}
 finally{
  if(run.status==='running')run.status='completed';
  run.finishedAt=new Date().toISOString();update({...run},run.status==='cancelled'?'Stopped · remaining steps were not run':'Workflow complete');
 }
 return run;
}
