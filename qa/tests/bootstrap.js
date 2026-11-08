/* Synthetic identity and network responses, loaded only by the local QA host. */
(() => {
  // The managed preview is HTTP; localhost CI already provides this API.
  if(!crypto.randomUUID)crypto.randomUUID=()=>"10000000-1000-4000-8000-100000000000".replace(/[018]/g,c=>(c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
  for(const key of Object.keys(localStorage))if(!key.startsWith('ecco-desk-')&&!key.startsWith('ecco-tester-')&&!key.startsWith('ecco-agent-')&&!key.startsWith('ecco-qa-campaign-reads')&&!key.startsWith('ecco-qa-look'))localStorage.removeItem(key);sessionStorage.clear();
  localStorage.setItem('ecco-user-session','qa-synthetic-session');
  localStorage.setItem('ecco-theme-preset-v1',new URLSearchParams(location.search).get('theme')||'default');
  const originalFetch=window.fetch.bind(window);
  window.__qaNetwork=[];
  const notices=new URLSearchParams(location.search).has('notices')?[1,2].map(n=>({id:'notice-'+n,title:'New notice '+n,body:'Unread message '+n,severity:'informational',expiresAt:new Date(Date.now()+3600000).toISOString()})):[];
  const billingNotices=new URLSearchParams(location.search).has('promotions')?[
    {id:'promo-outreach',kind:'special_offer',title:'Diwali bonus',body:'Buy 100 credits and get 50 free.',severity:'informational',badge:'Dhamaka',expiresAt:'2099-11-30T17:00:00Z',offer:{credits:100,bonusCredits:50,cents:1000}},
    {id:'promo-campaign',kind:'marketing_campaign',title:'Cyber Monday',body:'Our annual campaign is open.',severity:'informational',badge:'NEW',expiresAt:'2099-12-01T17:00:00Z'}]:[];
  const upcomingCampaigns=new URLSearchParams(location.search).has('upcoming')?[{id:'upcoming:qa-campaign',campaignId:'qa-campaign',status:'upcoming',kind:'marketing_campaign',title:'Festival preview',body:'Our offer begins soon.',severity:'informational',badge:'Dhamaka',startsAt:'2099-11-07T05:00:00Z',expiresAt:'2099-12-07T05:00:00Z',timezone:'America/Los_Angeles'}]:[];
  const campaignReads=JSON.parse(localStorage.getItem('ecco-qa-campaign-reads')||'{}');
  for(const n of [...billingNotices,...upcomingCampaigns])if(n.kind==='marketing_campaign')n.readAt=campaignReads[n.id]||null;
  window.__qaUpcoming=upcomingCampaigns;window.__qaBillingNotices=billingNotices;
  let readNotices=new URLSearchParams(location.search).has('notices')?[1,2,3].map(n=>({id:'old-'+n,title:'Read notice '+n,body:'Read message '+n,severity:'informational',expiresAt:new Date(Date.now()+3600000).toISOString()})):[];
  window.fetch=async(input,options={})=>{
    const url=new URL(typeof input==='string'?input:input.url,location.href);
    if(url.origin===location.origin)return originalFetch(input,options);
    window.__qaNetwork.push({path:url.pathname,method:options.method||'GET',mocked:true});
    const json=(value,status=200)=>Promise.resolve(new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}}));
    if(url.pathname==='/api/look-and-feel'){
      // Shared published roster, kept across reloads like the real service. ?lookAndFeelAdmin grants publishing.
      const store=JSON.parse(localStorage.getItem('ecco-qa-look')||'{"version":0,"roster":null,"history":[]}');
      const admin=new URLSearchParams(location.search).has('lookAndFeelAdmin'),signedIn=Boolean(options.headers?.Authorization);
      const view=()=>({lookAndFeelVersion:1,version:store.version,roster:store.roster,updatedAt:store.updatedAt||null,updatedBy:store.updatedBy||null,...(signedIn?{canPublish:admin}:{}),...(signedIn&&admin?{history:store.history}:{})});
      if(options.method==='POST'){
        if(!admin)return json({error:'Only administrators can apply Look and Feel changes.'},403);
        const p=JSON.parse(options.body);if(p.baseVersion!==store.version)return json({error:'Someone else applied a newer Look and Feel. Reload to see it before applying yours.'},409);
        store.version++;store.roster=p.op==='reset'?null:p.roster;store.updatedAt=new Date().toISOString();store.updatedBy='QA Test User';store.history.unshift({version:store.version,updatedAt:store.updatedAt,updatedBy:store.updatedBy,default:!store.roster});
        localStorage.setItem('ecco-qa-look',JSON.stringify(store));
      }
      return json(view());
    }
    if(url.pathname.endsWith('/auth/me'))return json({user:{id:'qa-user',name:'QA Test User',email:'qa@example.invalid'}});
    if(url.pathname.endsWith('/auth/logout'))return json({ok:true});
    if(url.pathname==='/api/desk/support'&&(url.searchParams.has('userNotifications')||options.method==='POST')){
      if(options.method==='POST'){
        const p=JSON.parse(options.body);if(!['readNotification','readCampaign'].includes(p.op))return json({error:'Unsupported fixture action'},400);
        const upcoming=p.op==='readCampaign'?upcomingCampaigns.find(n=>n.campaignId===p.campaignId&&n.startsAt===p.startsAt):null;
        const billingIndex=billingNotices.findIndex(n=>n.id===p.id),campaign=upcoming||(billingIndex>=0&&billingNotices[billingIndex].kind==='marketing_campaign'?billingNotices[billingIndex]:null);
        if(campaign){campaign.readAt=new Date().toISOString();campaignReads[campaign.id]=campaign.readAt;localStorage.setItem('ecco-qa-campaign-reads',JSON.stringify(campaignReads));}
        else if(billingIndex>=0)billingNotices.splice(billingIndex,1);
        const index=notices.findIndex(n=>n.id===p.id);if(index>=0)readNotices=[notices.splice(index,1)[0],...readNotices].slice(0,3);
      }
      return json({notificationVersion:1,notificationPresentationVersion:1,campaignReadVersion:1,billingNotifications:billingNotices,upcomingCampaignVersion:1,upcomingCampaigns,notificationHistoryVersion:1,notifications:notices,readNotifications:readNotices});
    }
    if(url.pathname.includes('notification'))return json({notifications:[],unread_count:0});
    if(url.pathname.includes('credit'))return json({balance:100,used:0});
    return json({error:'External service is isolated in the QA fixture'},503);
  };
})();
