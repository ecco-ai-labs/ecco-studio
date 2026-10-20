'use strict';
// Public endpoint addresses only. Authentication stays on the selected RunPod origin.
window.EccoGPUPicker = (() => {
  const gpus = [
    {id:'io8sphjo10kbuy',name:'B200',label:'ecco-b200-benchmark'},
    {id:'p7lc6fqjuosti3',name:'B200',label:'severe_crimson_kingfisher'},
    {id:'1muqctw9bxvguu',name:'A100',label:'ecco-demo-a100'}
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
  function mount(container, open) {
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
        <p class="gpu-status" id="gpu-status-${name}" role="status" aria-live="polite"></p>
        <button type="button" class="gpu-open secondary" disabled>Connect</button>
      </article>`).join('')}</div>
      <p class="help" id="gpu-checked">Checking availability…</p>
    </section>`;
    const refresh=container.querySelector('#gpu-refresh');
    const cards=classes.map(name=>{
      const root=container.querySelector(`[data-gpu-class="${name}"]`);
      return {name,root,select:root.querySelector('select'),button:root.querySelector('.gpu-open'),status:root.querySelector('.gpu-status')};
    });
    const isConnected=id=>Boolean(window.EccoGPUConnection?.isConnected(id));
    function statusLabel(gpu){
      const status=statuses.get(gpu.id);
      return status?.kind==='ready'&&isConnected(gpu.id)?'Connected':status?.kind==='ready'?'Available':status?.title||'Checking…';
    }
    function draw(){
      for(const card of cards){
        for(const gpu of gpus.filter(g=>g.name===card.name)){
          card.select.querySelector(`option[value="${gpu.id}"]`).textContent=gpu.label+' · '+gpu.id+' · '+statusLabel(gpu);
        }
        const gpu=gpus.find(g=>g.id===card.select.value),status=statuses.get(card.select.value);
        const pending=gpu&&connecting.has(gpu.id),connected=status?.kind==='ready'&&isConnected(card.select.value);
        card.root.dataset.status=connected?'connected':status?.kind||'';
        card.select.disabled=Boolean(pending);
        card.button.disabled=Boolean(pending)||busy||!gpu||!status||status.kind==='unknown'||connected;
        card.button.dataset.connected=String(connected);
        card.button.setAttribute('aria-busy',String(Boolean(pending)));
        card.button.textContent=pending?'Connecting…':connected?'Connected':status?.kind==='unchecked'?'Connect storage':'Connect';
        card.status.textContent=!gpu?'':pending?'Connecting…':statusLabel(gpu)+(status?.kind==='unchecked'?'. '+status.detail:'');
        card.status.hidden=!card.status.textContent;
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
    const timer=setInterval(()=>{if(document.visibilityState!=='hidden')update();},20000);
    dispose=()=>{active=false;clearInterval(timer);};
    update();
  }
  return {mount,check,gpus};
})();
