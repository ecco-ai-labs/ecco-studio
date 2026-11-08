// Isolated preview/CI only. The production HTML never references this file.
(()=>{
 if(!crypto.randomUUID)crypto.randomUUID=()=>[1,1,1,1].map(()=>Math.random().toString(16).slice(2)).join('-');
 const role=new URLSearchParams(location.search).get('role')||'admin',customer=role==='customer'||role==='group';
 const me={userId:'qa-desk-user',name:'QA Tester',email:'qa@example.invalid',role:customer?'customer':role,canManageAgents:role==='admin'||role==='group',memberId:customer?null:'qa-member',...(customer?{notificationAdminGroup:'admins@example.invalid',notificationGroupStatus:'not_connected'}:{})};
 const fixtureCampaigns=JSON.parse(localStorage.getItem('ecco-desk-qa-campaigns')||'[]');
 const fixtureAgents=JSON.parse(localStorage.getItem('ecco-desk-qa-agents')||'[]');
 const data={me,agentWorkflowVersion:1,agents:fixtureAgents,tickets:[],members:[{id:'qa-member',name:'QA Team',email:'qa@example.invalid',active:1,role:'staff',userId:me.userId}],users:[],activity:[],needsSetup:false};
 if(new URLSearchParams(location.search).has('signedOut'))localStorage.removeItem('ecco-desk-staff-session');else localStorage.setItem('ecco-desk-staff-session','synthetic-desk-session');

 window.__deskPosts=[];
 const notices=[];
 const notificationData=()=>({notificationVersion:1,specialOfferVersion:1,notifications:notices,users:[]});
 const original=window.fetch.bind(window);
 window.fetch=async(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input.url,location.href);
  if(url.origin===location.origin)return original(input,options);
  if(url.pathname==='/api/desk'){
   if(options.method==='POST'){
    const p=JSON.parse(options.body||'{}');window.__deskPosts.push(p);
    if(p.op==='previewCampaign')return new Response(JSON.stringify({campaignVersion:1,nextRunAt:'2026-11-30T17:00:00.000000+00:00'}));
    if(['createCampaign','updateCampaign','setCampaignActive'].includes(p.op)){
     if(role!=='admin')return new Response(JSON.stringify({error:'Admin required'}),{status:403});
     let c=fixtureCampaigns.find(x=>x.id===p.id);
     if(p.op==='createCampaign'){c={...p,version:1,enabled:true,nextRunAt:'2026-11-30T17:00:00.000000+00:00',lastStatus:null,lastRunAt:null,runCount:0};fixtureCampaigns.push(c)}
     else if(!c||c.version!==p.version)return new Response(JSON.stringify({error:'Campaign changed'}),{status:409});
     else Object.assign(c,p,{version:c.version+1});
     localStorage.setItem('ecco-desk-qa-campaigns',JSON.stringify(fixtureCampaigns));return new Response(JSON.stringify({campaignVersion:1,campaign:c}));
    }
    if(p.op==='createAgent'){if(!me.canManageAgents)return new Response(JSON.stringify({error:'Admin required'}),{status:403});const existing=data.agents.find(a=>a.id===p.id);const agent=existing||{id:p.id,name:p.name,description:p.description,steps:p.steps};if(!existing)data.agents.push(agent);localStorage.setItem('ecco-desk-qa-agents',JSON.stringify(data.agents));return new Response(JSON.stringify({agentWorkflowVersion:1,agent}));}
    if(p.op==='createNotification'&&!customer){notices.unshift({...p,id:p.requestId,createdAt:new Date().toISOString(),expiresAt:p.durationDays?new Date(Date.now()+p.durationDays*86400000).toISOString():null,status:'active',readCount:0});return new Response(JSON.stringify({...notificationData(),id:p.requestId}));}
    if(p.op!=='createTicket')return new Response(JSON.stringify({error:'Fixture operation not supported'}),{status:400});
    const ticket={...p,id:data.tickets.length+1,status:'open',reporterId:me.userId,reporterName:me.name,reporterEmail:me.email,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),version:1};data.tickets.push(ticket);return new Response(JSON.stringify({ticket}));
   }
   if(url.searchParams.has('manageNotifications'))return new Response(JSON.stringify({...notificationData(),campaignVersion:1}));
   if(url.searchParams.has('campaigns'))return new Response(JSON.stringify({campaignVersion:1,campaigns:fixtureCampaigns}));
   const id=url.searchParams.get('ticket');return new Response(JSON.stringify(id?{ticket:data.tickets.find(t=>t.id===Number(id)),comments:[],events:[]}:data));
  }
  return new Response(JSON.stringify({error:'External services disabled in QA'}),{status:503});
 };
})();
