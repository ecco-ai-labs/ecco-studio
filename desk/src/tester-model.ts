import type {Ticket} from './types';
export type Severity='critical'|'high'|'medium'|'low';
export type Check={id:string;title:string;status:'passed'|'failed'|'blocked';severity:Severity;expected:string;actual:string;steps:string[];selector?:string};
export type Finding=Check&{ticketId?:number;ticketType?:'internal'|'support';uncertain?:boolean;ticketError?:string};
export type Run={version:1;id:string;startedAt:string;finishedAt?:string;status:'running'|'completed'|'cancelled';source:string;scope:string;checks:Check[];findings:Finding[]};
export const severities:Severity[]=['critical','high','medium','low'];
export const counts=(run:Run)=>({passed:run.checks.filter(c=>c.status==='passed').length,failed:run.findings.length,blocked:run.checks.filter(c=>c.status==='blocked').length});
export const marker=(run:Run,f:Finding)=>`[Tester Agent: ${run.id} / ${f.id}]`;
export const priorityFor=(severity:Severity)=>({critical:'urgent',high:'high',medium:'normal',low:'low'}[severity]);
export function ticketPayload(run:Run,f:Finding,assigneeId:string,kind:'internal'|'support'='internal'){
 return {op:'createTicket',type:kind,requestType:'Bug',category:'Ecco Studio',priority:priorityFor(f.severity),assigneeId:kind==='internal'?assigneeId||null:null,
  title:`[Tester] ${f.title}`.slice(0,160),description:[marker(run,f),`Severity: ${f.severity}`,`Run: ${run.startedAt}`,`Scope: ${run.scope}`,`Source: ${run.source}`,'', 'Steps to reproduce:',...f.steps.map((s,i)=>`${i+1}. ${s}`),'',`Expected: ${f.expected}`,`Observed: ${f.actual}`,f.selector?`Element: ${f.selector}`:''].join('\n').slice(0,12000)};
}
// Reconcile before each batch. An ambiguous write is never blindly submitted again.
// Web Locks in the UI serialize ticket batches across tabs for this Desk identity.
export async function createFindingTickets(run:Run,ids:string[],assignee:string,api:(p?:unknown)=>Promise<any>,save:()=>void,signal:AbortSignal,kind:'internal'|'support'='internal'){
 const current=await api();signal.throwIfAborted();
 const tickets:Ticket[]=current.tickets||[];
 for(const f of run.findings){const old=tickets.find(t=>t.description?.includes(marker(run,f)));if(old){f.ticketId=old.id;f.ticketType=old.type;f.uncertain=false;f.ticketError=undefined;}}
 save();
 for(const f of run.findings.filter(f=>ids.includes(f.id)&&!f.ticketId&&!f.uncertain)){
  signal.throwIfAborted();
  // Persist the intent first, including when a tab closes during the request.
  f.uncertain=true;f.ticketError=undefined;save();
  try{const result=await api(ticketPayload(run,f,assignee,kind));if(!result.ticket?.id)throw Error('No ticket receipt received.');f.ticketId=result.ticket.id;f.ticketType=result.ticket.type||kind;f.uncertain=false;save();}
  catch(e){
   if(signal.aborted){f.ticketError='Account or page changed while creating this ticket. Refresh ticket status to confirm its receipt.';save();break;}
   const status=(e as {status?:number}).status;
   if(status&&status>=400&&status<500){f.uncertain=false;f.ticketError=(e as Error).message;save();break;}
   try{const latest=await api();const saved=(latest.tickets||[]).find((t:Ticket)=>t.description?.includes(marker(run,f)));if(saved){f.ticketId=saved.id;f.ticketType=saved.type||kind;f.uncertain=false;f.ticketError=undefined;save();continue;}}catch{}
   f.ticketError='Receipt unavailable. Refresh ticket status before taking further action; this finding will not be submitted twice.';save();break;
  }
 }
}
function hash(s:string){let h=2166136261;for(const c of s)h=Math.imul(h^c.charCodeAt(0),16777619);return (h>>>0).toString(16);}
// Import our CI report without executing code, trusting HTML, or importing ticket IDs.
export function importReport(value:unknown):Run{
 const p=value as any;if(!p||!Array.isArray(p.tests)||p.tests.length>1000||typeof p.generated_at!=='string'||!Number.isFinite(Date.parse(p.generated_at)))throw Error('Choose qa-summary.json from a Tester Agent CI run.');
 const checks:Check[]=p.tests.map((t:any,i:number)=>{
  if(typeof t.id!=='string'||!['passed','failed','timedOut','skipped','interrupted'].includes(t.status))throw Error('The report contains an invalid check.');
  const title=t.id.split(' / ').at(-1).slice(0,200),severity:Severity=/AUTH/.test(title)?'critical':/search|LAYOUT|STORY/.test(title)?'high':'medium';
  return {id:`ci-${i}-${hash(t.id)}`,title,status:t.status==='passed'?'passed':['skipped','interrupted'].includes(t.status)?'blocked':'failed',severity,expected:title,actual:String(t.error||t.status).slice(0,6000),steps:['Open the tested revision in the QA fixture environment.',`Run check: ${title}`,...(Array.isArray(t.evidence)?t.evidence.slice(0,4).map((e:any)=>`Artifact evidence: ${String(e.path||'').slice(0,300)}`):[])]};
 });
 return {version:1,id:'ci-'+hash(String(p.commit||'')+p.generated_at),startedAt:p.generated_at,finishedAt:p.generated_at,status:'completed',source:`CI · ${String(p.commit||'unknown revision').slice(0,40)} · synthetic service data`,scope:'Registered browser workflows; live services excluded',checks,findings:checks.filter(c=>c.status==='failed').map(c=>({...c}))};
}
