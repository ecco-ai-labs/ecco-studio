'use strict';
// Public endpoint addresses only. Authentication stays on the selected RunPod origin.
window.EccoGPUPicker = (() => {
  const gpus = [
    {id:'io8sphjo10kbuy',name:'B200',label:'ecco-b200-benchmark'},
    {id:'p7lc6fqjuosti3',name:'B200',label:'severe_crimson_kingfisher'},
    {id:'1muqctw9bxvguu',name:'A100',label:'ecco-demo-a100'},
    {id:'sup07jsgh2evnf',name:'A100',label:'ecco-demo-a100-migration'}
  ].map(gpu => ({...gpu, origin:`https://${gpu.id}-8888.proxy.runpod.net`,
    url:`https://${gpu.id}-8888.proxy.runpod.net/proxy/8765/`}));
  let dispose = () => {};
  function probe(url, timeout=7000) {
    return new Promise(resolve => {
      const image = new Image();
      let settled = false;
      const finish = result => {
        if(settled) return;
        settled = true; clearTimeout(timer);
        image.onload = image.onerror = null;
        resolve(result);
      };
      const timer = setTimeout(() => finish(false), timeout);
      image.onload = () => finish(image.naturalWidth > 0);
      image.onerror = () => finish(false);
      image.referrerPolicy = 'no-referrer';
      image.src = `${url}?ecco_health=${Date.now()}-${Math.random()}`;
    });
  }
  async function check(gpu) {
    if(window.EccoGPUConnection&&!window.EccoStorage?.ready)return {kind:'unchecked',title:'Not checked',detail:'Connect workspace storage to check GPU availability.'};
    if(window.EccoGPUConnection){try{return await window.EccoGPUConnection.check(gpu);}catch{return {kind:"unknown",title:"Unavailable",detail:window.EccoStorage?.ready?"Checking connection. Try again shortly.":"Connect your workspace in Account → Storage first."};}}
    const [studio, gateway] = await Promise.all([
      probe(gpu.url+'logo-transparent.png'), probe(gpu.origin+'/static/favicons/favicon.ico')
    ]);
    if(studio) return {kind:'ready',title:'Running · Studio available',detail:'Studio is responding. Open this workspace to continue.'};
    if(gateway) return {kind:'running',title:'Running · gateway available',detail:'The GPU workspace is responding. Studio may be starting or require sign-in.'};
    return {kind:'unknown',title:'Unavailable from this browser',detail:'May be stopped, starting, or blocked by sign-in/network settings. Refresh to check again.'};
  }
  function mount(container, open, options={}) {
    const disconnectMode=!!options.disconnect;
    dispose();
    let active=true,busy=false,statuses=new Map();
    const connecting=new Set(),classes=['B200','A100'];
    container.innerHTML=`<section class="gpu-picker panel" aria-label="Accelerator classes">
      <div class="section-head"><h2>Class of Accelerators</h2><button type="button" class="secondary" id="gpu-refresh">Refresh status</button></div>
      <div class="gpu-grid">${classes.map(name=>`<article class="gpu-card" data-gpu-class="${name}" aria-labelledby="gpu-class-${name}">
        <h3 id="gpu-class-${name}">${name}</h3>
        <label for="gpu-instance-${name}">RunPod instance<select id="gpu-instance-${name}" aria-label="${name} RunPod instance" aria-describedby="gpu-status-${name}">
          <option value="">Choose an instance</option>${gpus.filter(g=>g.name===name).map(g=>`<option value="${g.id}">${g.label} · ${g.id}</option>`).join('')}
        </select></label>
        <button type="button" class="gpu-open secondary" id="gpu-status-${name}" aria-live="polite" disabled>Connect</button>
        <p class="help gpu-health-detail" aria-live="polite"></p>
      </article>`).join('')}</div>
      <p class="help" id="gpu-checked">Checking availability…</p>
    </section>`;
    const refresh=container.querySelector('#gpu-refresh');
    const cards=classes.map(name=>{
      const root=container.querySelector(`[data-gpu-class="${name}"]`);
      return {name,root,select:root.querySelector('select'),button:root.querySelector('.gpu-open')};
    });
    const isConnected=id=>Boolean(window.EccoGPUConnection?.isConnected(id));
    const statusFor=gpu=>gpu&&(window.EccoGPUConnection?.status?.(gpu)||statuses.get(gpu.id));
    function statusLabel(gpu){
      const status=statusFor(gpu);
      return disconnectMode?(window.EccoGPUConnection?.isRemembered(gpu.id)?'Connected':'Not connected'):isConnected(gpu.id)?'Connected':status?.kind==='ready'?'Available':status?.title||'Checking…';
    }
    function draw(){
      for(const card of cards){
        for(const gpu of gpus.filter(g=>g.name===card.name)){
          card.select.querySelector(`option[value="${gpu.id}"]`).textContent=gpu.label+' · '+gpu.id+' · '+statusLabel(gpu);
        }
        const gpu=gpus.find(g=>g.id===card.select.value),status=statusFor(gpu);
        const pending=gpu&&connecting.has(gpu.id),connected=!!gpu&&isConnected(gpu.id);
        card.root.dataset.status=connected?'connected':status?.kind||'';
        card.select.disabled=Boolean(pending);
        card.button.disabled=disconnectMode?(!gpu||!window.EccoGPUConnection?.isRemembered(gpu.id)||Boolean(pending)):Boolean(pending)||busy||!gpu||status?.kind!=='ready'||connected;
        card.button.dataset.connected=String(connected);
        card.button.setAttribute('aria-busy',String(Boolean(pending)));
        card.button.textContent=disconnectMode?(pending?'Disconnecting…':gpu&&!window.EccoGPUConnection?.isRemembered(gpu.id)?'Not connected':'Disconnect'):pending?'Connecting…':connected?'Connected':!gpu?'Connect':!status?'Checking…':status.kind==='ready'?'Connect':status.title||'Unavailable';
        card.root.querySelector('.gpu-health-detail').textContent=disconnectMode?'Disconnecting does not stop the pod or cancel accepted jobs.':gpu?status?.detail||'Checking generation service…':'';
        card.button.title=gpu&&!connected&&status?.kind!=='ready'?status?.detail||'This instance is unavailable.':'';
      }
    }
    for(const card of cards){
      card.select.onchange=draw;
      card.button.onclick=async()=>{
        const gpu=gpus.find(g=>g.id===card.select.value);
        if(card.button.disabled||!gpu)return;
        connecting.add(gpu.id);draw();
        try{await open(gpu);}finally{connecting.delete(gpu.id);draw();await update();}
      };
    }
    async function update(){
      if(busy||!active)return;
      if(disconnectMode){refresh.hidden=true;container.querySelector('#gpu-checked').hidden=true;draw();return;}
      busy=true;refresh.disabled=true;refresh.textContent='Checking…';draw();
      let results;
      try{results=window.EccoStorage?.ready&&window.EccoGPUConnection?.checkAll?await window.EccoGPUConnection.checkAll(gpus):await Promise.all(gpus.map(gpu=>check(gpu)));}
      catch(error){results=gpus.map(()=>({kind:'unknown',title:'Status unavailable',detail:error.message||'Could not check GPU availability.'}));}
      if(!active||!container.querySelector('.gpu-picker')){busy=false;return;}
      statuses=new Map(gpus.map((gpu,i)=>[gpu.id,results[i]]));busy=false;draw();
      container.querySelector('#gpu-checked').textContent='Last checked '+new Date().toLocaleTimeString()+'. Refreshes every 20 seconds.';
      refresh.disabled=false;refresh.textContent='Refresh status';
    }
    refresh.onclick=update;
    const connectionChanged=()=>{if(active)draw();};
    document.addEventListener('ecco:gpu-connection-change',connectionChanged);
    const timer=setInterval(()=>{if(document.visibilityState!=='hidden')update();},20000);
    dispose=()=>{active=false;clearInterval(timer);document.removeEventListener('ecco:gpu-connection-change',connectionChanged);};
    update();
  }
  return {mount,check,gpus};
})();
