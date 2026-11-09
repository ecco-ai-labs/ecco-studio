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
 const releaseData={releaseVersion:1,productionUrl:'https://ecco-ai-labs.github.io/ecco-studio/',devUrl:'https://ecco-ai-labs.github.io/ecco-studio/',previewUrl:'https://ecco-ai-labs.github.io/ecco-studio/previews/'+releaseSha+'/',previewEnabled:true,blockers:releaseParams.has('releaseSetup')?['Connect production hosting.']:[],head:releaseSha,checks:{state:releaseParams.get('releaseChecks')||'success',label:releaseParams.has('releaseChecks')?'Failed':'Passed',id:42,url:'https://github.com/ecco-ai-labs/ecco-studio/actions/runs/42'},changes:[{sha:releaseSha,title:'Improve library navigation',author:'QA Developer',url:'https://github.com/ecco-ai-labs/ecco-studio/commit/'+releaseSha}],current:published,history:[published],releases:[],active:null};
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
    const campaignDate=plan=>{
     if(!plan.startDate||!plan.endDate)return new Date('2026-11-30T17:00:00Z').toISOString();
     const start=new Date(plan.startDate+'T00:00:00Z'),end=new Date(plan.endDate+'T23:59:59Z');
     const cursor=new Date(Math.max(start.getTime(),Date.now()-86400000));cursor.setUTCHours(0,0,0,0);
     for(let i=0;i<740&&cursor<=end;i++,cursor.setUTCDate(cursor.getUTCDate()+1)){
      const d=cursor.getUTCDate(),m=cursor.getUTCMonth(),y=cursor.getUTCFullYear(),last=new Date(Date.UTC(y,m+1,0)).getUTCDate();
      const thanksgiving=new Date(Date.UTC(y,10,1));thanksgiving.setUTCDate(1+(4-thanksgiving.getUTCDay()+7)%7+21);
      const holiday=new Date(thanksgiving);holiday.setUTCDate(holiday.getUTCDate()+(plan.kind==='cyber_monday'?4:1));
      const match=plan.kind==='daily'||plan.kind==='once'&&+cursor===+start||plan.kind==='weekly'&&cursor.getUTCDay()===start.getUTCDay()||plan.kind==='monthly'&&d===Math.min(start.getUTCDate(),last)||plan.kind==='yearly'&&m===start.getUTCMonth()&&d===Math.min(start.getUTCDate(),last)||['cyber_monday','black_friday'].includes(plan.kind)&&+cursor===+holiday||plan.kind==='new_year'&&m===0&&d===1;
      const [hour,minute]=plan.time.split(':').map(Number),target=Date.UTC(y,m,d,hour,minute);let candidate=new Date(target);
      for(let pass=0;pass<2;pass++){const parts=new Intl.DateTimeFormat('en-GB',{timeZone:plan.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(candidate);const get=t=>Number(parts.find(p=>p.type===t).value);candidate=new Date(+candidate+target-Date.UTC(get('year'),get('month')-1,get('day'),get('hour'),get('minute')));}
      const localDate=v=>new Intl.DateTimeFormat('en-CA',{timeZone:plan.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(v);
      if(match&&(candidate>Date.now()||localDate(candidate)===localDate(new Date())))return candidate.toISOString();
     }
     return null;
    };
    if(p.op==='previewCampaign'){
     if(p.schedule.endDate<p.schedule.startDate)return new Response(JSON.stringify({error:'End must be on or after Start.'}),{status:400});
     return new Response(JSON.stringify({campaignVersion:1,campaignYearVersion:1,campaignCalendarVersion:1,upcomingCampaignVersion:1,notificationPresentationVersion:1,nextRunAt:campaignDate(p.schedule)}));
    }
    if(['createCampaign','updateCampaign','setCampaignActive'].includes(p.op)){
     if(role!=='admin')return new Response(JSON.stringify({error:'Admin required'}),{status:403});
     let c=fixtureCampaigns.find(x=>x.id===p.id);
     if(p.op==='createCampaign'){c={...p,version:1,enabled:true,nextRunAt:campaignDate(p.schedule),lastStatus:null,lastRunAt:null,runCount:0};fixtureCampaigns.push(c)}
     else if(!c||c.version!==p.version)return new Response(JSON.stringify({error:'Campaign changed'}),{status:409});
     else Object.assign(c,p,{version:c.version+1,...(p.schedule?{nextRunAt:campaignDate(p.schedule)}:{})});
     localStorage.setItem('ecco-desk-qa-campaigns',JSON.stringify(fixtureCampaigns));return new Response(JSON.stringify({campaignVersion:1,campaignYearVersion:1,campaignCalendarVersion:1,upcomingCampaignVersion:1,notificationPresentationVersion:1,campaign:c}));
    }
    if(p.op==='createAgent'){if(!me.canManageAgents)return new Response(JSON.stringify({error:'Admin required'}),{status:403});const existing=data.agents.find(a=>a.id===p.id);const agent=existing||{id:p.id,name:p.name,description:p.description,steps:p.steps};if(!existing)data.agents.push(agent);localStorage.setItem('ecco-desk-qa-agents',JSON.stringify(data.agents));return new Response(JSON.stringify({agentWorkflowVersion:1,agent}));}
    if(p.op==='createNotification'&&!customer){notices.unshift({...p,id:p.requestId,createdAt:new Date().toISOString(),expiresAt:p.durationDays?new Date(Date.now()+p.durationDays*86400000).toISOString():null,status:'active',readCount:0});return new Response(JSON.stringify({...notificationData(),id:p.requestId}));}
    if(p.op!=='createTicket')return new Response(JSON.stringify({error:'Fixture operation not supported'}),{status:400});
    const ticket={...p,id:data.tickets.length+1,status:'open',reporterId:me.userId,reporterName:me.name,reporterEmail:me.email,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),version:1};data.tickets.push(ticket);return new Response(JSON.stringify({ticket}));
   }
   if(url.searchParams.has('releases'))return new Response(JSON.stringify(role==='admin'?releaseData:{error:'Admin required'}),{status:role==='admin'?200:403});
   if(url.searchParams.has('manageNotifications'))return new Response(JSON.stringify({...notificationData(),campaignVersion:1}));
   if(url.searchParams.has('campaigns'))return new Response(JSON.stringify({campaignVersion:1,campaignYearVersion:1,campaignCalendarVersion:1,upcomingCampaignVersion:1,notificationPresentationVersion:1,campaigns:fixtureCampaigns}));
   const id=url.searchParams.get('ticket');return new Response(JSON.stringify(id?{ticket:data.tickets.find(t=>t.id===Number(id)),comments:[],events:[]}:data));
  }
  return new Response(JSON.stringify({error:'External services disabled in QA'}),{status:503});
 };
})();
