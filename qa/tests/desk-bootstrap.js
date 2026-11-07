// Isolated preview/CI only. The production HTML never references this file.
(()=>{
 if(!crypto.randomUUID)crypto.randomUUID=()=>[1,1,1,1].map(()=>Math.random().toString(16).slice(2)).join('-');
 const role=new URLSearchParams(location.search).get('role')||'admin',customer=role==='customer'||role==='group';
 const me={userId:'qa-desk-user',name:'QA Tester',email:'qa@example.invalid',role:customer?'customer':role,canManageAgents:role==='admin'||role==='group',memberId:customer?null:'qa-member',...(customer?{notificationAdminGroup:'admins@example.invalid',notificationGroupStatus:'not_connected'}:{})};
 const fixtureAgents=JSON.parse(localStorage.getItem('ecco-desk-qa-agents')||'[]');
 const data={me,agentWorkflowVersion:1,agents:fixtureAgents,tickets:[],members:[{id:'qa-member',name:'QA Team',email:'qa@example.invalid',active:1,role:'staff',userId:me.userId}],users:[],activity:[],needsSetup:false};
 localStorage.setItem('ecco-desk-staff-session','synthetic-desk-session');
 window.__deskPosts=[];
 const original=window.fetch.bind(window);
 window.fetch=async(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input.url,location.href);
  if(url.origin===location.origin)return original(input,options);
  if(url.pathname==='/api/desk'){
   if(options.method==='POST'){
    const p=JSON.parse(options.body||'{}');window.__deskPosts.push(p);
    if(p.op==='createAgent'){if(!me.canManageAgents)return new Response(JSON.stringify({error:'Admin required'}),{status:403});const existing=data.agents.find(a=>a.id===p.id);const agent=existing||{id:p.id,name:p.name,description:p.description,steps:p.steps};if(!existing)data.agents.push(agent);localStorage.setItem('ecco-desk-qa-agents',JSON.stringify(data.agents));return new Response(JSON.stringify({agentWorkflowVersion:1,agent}));}
    if(p.op!=='createTicket')return new Response(JSON.stringify({error:'Fixture operation not supported'}),{status:400});
    const ticket={...p,id:data.tickets.length+1,status:'open',reporterId:me.userId,reporterName:me.name,reporterEmail:me.email,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),version:1};data.tickets.push(ticket);return new Response(JSON.stringify({ticket}));
   }
   const id=url.searchParams.get('ticket');return new Response(JSON.stringify(id?{ticket:data.tickets.find(t=>t.id===Number(id)),comments:[],events:[]}:data));
  }
  return new Response(JSON.stringify({error:'External services disabled in QA'}),{status:503});
 };
})();
