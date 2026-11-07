/* Synthetic identity and network responses, loaded only by the local QA host. */
(() => {
  // The managed preview is HTTP; localhost CI already provides this API.
  if(!crypto.randomUUID)crypto.randomUUID=()=>"10000000-1000-4000-8000-100000000000".replace(/[018]/g,c=>(c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
  localStorage.clear();sessionStorage.clear();
  localStorage.setItem('ecco-user-session','qa-synthetic-session');
  localStorage.setItem('ecco-theme-preset-v1',new URLSearchParams(location.search).get('theme')||'default');
  const originalFetch=window.fetch.bind(window);
  window.__qaNetwork=[];
  window.fetch=async(input,options={})=>{
    const url=new URL(typeof input==='string'?input:input.url,location.href);
    if(url.origin===location.origin)return originalFetch(input,options);
    window.__qaNetwork.push({path:url.pathname,method:options.method||'GET',mocked:true});
    const json=(value,status=200)=>Promise.resolve(new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}}));
    if(url.pathname.endsWith('/auth/me'))return json({user:{id:'qa-user',name:'QA Test User',email:'qa@example.invalid'}});
    if(url.pathname.endsWith('/auth/logout'))return json({ok:true});
    if(url.pathname.includes('notification'))return json({notifications:[],unread_count:0});
    if(url.pathname.includes('credit'))return json({balance:100,used:0});
    return json({error:'External service is isolated in the QA fixture'},503);
  };
})();
