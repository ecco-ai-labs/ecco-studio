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
 const notificationData=()=>({notificationVersion:1,notificationPresentationVersion:1,specialOfferVersion:1,notifications:notices,users:[]});
 const releaseSha='a'.repeat(40),oldSha='b'.repeat(40),releaseParams=new URLSearchParams(location.search);
 const published={id:'prior-release',title:'Previous Studio release',sha:oldSha,kind:'release',actor:'QA Admin',publishedAt:'2026-11-06T18:00:00Z',url:'https://github.com/ecco-ai-labs/ecco-studio/releases/tag/fixture'};
 const releaseData={releaseVersion:1,productionUrl:'https://eccoailabs.com/',devUrl:'https://ecco-ai-labs.github.io/ecco-studio/',previewUrl:'https://ecco-ai-labs.github.io/ecco-studio/previews/'+releaseSha+'/',previewEnabled:true,blockers:releaseParams.has('releaseSetup')?['Connect production hosting.']:[],head:releaseSha,checks:{state:releaseParams.get('releaseChecks')||'success',label:releaseParams.has('releaseChecks')?'Failed':'Passed',id:42,url:'https://github.com/ecco-ai-labs/ecco-studio/actions/runs/42'},changes:[{sha:releaseSha,title:'Improve library navigation',author:'QA Developer',url:'https://github.com/ecco-ai-labs/ecco-studio/commit/'+releaseSha}],current:published,history:[published],releases:[],active:null};
 window.__releaseData=releaseData;
 const original=window.fetch.bind(window);
 window.fetch=async(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input.url,location.href);
  if(url.origin===location.origin)return original(input,options);
  if(url.pathname==='/api/desk'){
   if(options.method==='POST'){
    const p=JSON.parse(options.body||'{}');window.__deskPosts.push(p);
    if(['prepareRelease','prepareRollback','publishRelease'].includes(p.op)){
     if(role!=='admin')return new Response(JSON.stringify({error:'Admin required'}),{status:403});
     let release=releaseData.releases.find(r=>r.id===p.id);
     if(p.op==='publishRelease'){release.state='queued';releaseData.active=release.id;}
     else if(!release){release={id:p.id,title:p.title,sha:p.sha,baseSha:releaseData.current?.sha||'',kind:p.op==='prepareRollback'?'rollback':'release',state:'prepared',createdAt:new Date().toISOString(),createdName:'QA Admin'};releaseData.releases.unshift(release);}
     return new Response(JSON.stringify({releaseVersion:1,release}));
    }
    const campaignDate=plan=>{const year=plan.year||2026;return new Date(Date.UTC(year,plan.kind==='yearly'?plan.month-1:10,plan.kind==='yearly'?plan.day:30,17)).toISOString();};
    if(p.op==='previewCampaign'){
     const nextRunAt=campaignDate(p.schedule);
     if(p.schedule.year&&Date.parse(nextRunAt)<=Date.now())return new Response(JSON.stringify({error:'The selected date or time in '+p.schedule.year+' has already passed. Choose a later date/time or select '+(p.schedule.year+1)+'.'}),{status:400});
     return new Response(JSON.stringify({campaignVersion:1,campaignYearVersion:1,notificationPresentationVersion:1,nextRunAt}));
    }
    if(['createCampaign','updateCampaign','setCampaignActive'].includes(p.op)){
     if(role!=='admin')return new Response(JSON.stringify({error:'Admin required'}),{status:403});
     let c=fixtureCampaigns.find(x=>x.id===p.id);
     if(p.op==='createCampaign'){c={...p,version:1,enabled:true,nextRunAt:campaignDate(p.schedule),lastStatus:null,lastRunAt:null,runCount:0};fixtureCampaigns.push(c)}
     else if(!c||c.version!==p.version)return new Response(JSON.stringify({error:'Campaign changed'}),{status:409});
     else Object.assign(c,p,{version:c.version+1,...(p.schedule?{nextRunAt:campaignDate(p.schedule)}:{})});
     localStorage.setItem('ecco-desk-qa-campaigns',JSON.stringify(fixtureCampaigns));return new Response(JSON.stringify({campaignVersion:1,campaignYearVersion:1,notificationPresentationVersion:1,campaign:c}));
    }
    if(p.op==='createAgent'){if(!me.canManageAgents)return new Response(JSON.stringify({error:'Admin required'}),{status:403});const existing=data.agents.find(a=>a.id===p.id);const agent=existing||{id:p.id,name:p.name,description:p.description,steps:p.steps};if(!existing)data.agents.push(agent);localStorage.setItem('ecco-desk-qa-agents',JSON.stringify(data.agents));return new Response(JSON.stringify({agentWorkflowVersion:1,agent}));}
    if(p.op==='createNotification'&&!customer){notices.unshift({...p,id:p.requestId,createdAt:new Date().toISOString(),expiresAt:p.durationDays?new Date(Date.now()+p.durationDays*86400000).toISOString():null,status:'active',readCount:0});return new Response(JSON.stringify({...notificationData(),id:p.requestId}));}
    if(p.op!=='createTicket')return new Response(JSON.stringify({error:'Fixture operation not supported'}),{status:400});
    const ticket={...p,id:data.tickets.length+1,status:'open',reporterId:me.userId,reporterName:me.name,reporterEmail:me.email,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),version:1};data.tickets.push(ticket);return new Response(JSON.stringify({ticket}));
   }
   if(url.searchParams.has('releases'))return new Response(JSON.stringify(role==='admin'?releaseData:{error:'Admin required'}),{status:role==='admin'?200:403});
   if(url.searchParams.has('manageNotifications'))return new Response(JSON.stringify({...notificationData(),campaignVersion:1}));
   if(url.searchParams.has('campaigns'))return new Response(JSON.stringify({campaignVersion:1,campaignYearVersion:1,notificationPresentationVersion:1,campaigns:fixtureCampaigns}));
   const id=url.searchParams.get('ticket');return new Response(JSON.stringify(id?{ticket:data.tickets.find(t=>t.id===Number(id)),comments:[],events:[]}:data));
  }
  return new Response(JSON.stringify({error:'External services disabled in QA'}),{status:503});
 };
})();
