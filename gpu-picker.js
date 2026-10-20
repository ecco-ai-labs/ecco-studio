'use strict';
// Public endpoint addresses only. Authentication stays on the selected RunPod origin.
window.EccoGPUPicker = (() => {
  const gpus = [
    {id:'p7lc6fqjuosti3',name:'B200',label:'ecco-b200'},
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
    if(window.EccoGPUConnection){try{return await window.EccoGPUConnection.check(gpu);}catch{return {kind:"unknown",title:"Unavailable",detail:window.EccoStorage?.ready?"Checking connection. Try again shortly.":"Connect your workspace in Account → Storage first."};}}
    const [studio, gateway] = await Promise.all([
      probe(gpu.url+'logo.png'), probe(gpu.origin+'/static/favicons/favicon.ico')
    ]);
    if(studio) return {kind:'ready',title:'Running · Studio available',detail:'Studio is responding. Open this workspace to continue.'};
    if(gateway) return {kind:'running',title:'Running · gateway available',detail:'The GPU workspace is responding. Studio may be starting or require sign-in.'};
    return {kind:'unknown',title:'Unavailable from this browser',detail:'May be stopped, starting, or blocked by sign-in/network settings. Refresh to check again.'};
  }
  function mount(container, open) {
    dispose();
    let active=true, busy=false, selecting=false;
    container.innerHTML = `<style>.gpu-picker .gpu-open:disabled{background:#525866;color:#d1d5db;opacity:.55;cursor:not-allowed;box-shadow:none;filter:grayscale(1)}.gpu-picker .gpu-open[data-connected="true"]:disabled{background:var(--accent,#ffdc24);color:#211b33;opacity:1;filter:none;cursor:default}</style><section class="gpu-picker panel" aria-labelledby="gpu-picker-title">
      <div class="section-head"><div><span class="eyebrow">YOUR GPU WORKSPACES</span><h2 id="gpu-picker-title">Choose where to create</h2></div><button class="secondary" id="gpu-refresh">Refresh status</button></div>
      <p>Select the GPU you want to use. Connection stays within Studio.</p>
      <div class="gpu-grid">${gpus.map(gpu=>`<article class="gpu-card" data-gpu="${gpu.id}">
        <h3>${gpu.name}</h3><p class="help">${gpu.label}</p>
        <p class="gpu-status" role="status" aria-live="polite">Checking availability…</p>
        
        <button class="gpu-open" disabled>Checking ${gpu.name}…</button>
      </article>`).join('')}</div>
      <p class="help" id="gpu-checked">Checking both GPUs…</p>
      
    </section>`;
    const refresh = container.querySelector('#gpu-refresh');
    for(const gpu of gpus) {
      const button=container.querySelector(`[data-gpu="${gpu.id}"] .gpu-open`);
      button.onclick=async()=>{
        if(button.disabled||selecting||busy)return;
        selecting=true;
        container.querySelectorAll('.gpu-open').forEach(b=>{b.disabled=true;});
        button.textContent='Connecting…';button.setAttribute('aria-busy','true');
        try{await open(gpu);}finally{selecting=false;button.removeAttribute('aria-busy');await update();}
      };
    }
    async function update() {
      if(busy || selecting || !active) return;
      busy=true; refresh.disabled=true; refresh.textContent='Checking…';
      const statuses=await Promise.all(gpus.map(gpu=>check(gpu)));
      if(!active || !container.querySelector('.gpu-picker')){busy=false;return;}
      const connection=window.EccoGPUConnection;
      const connectedId=connection?.ready?connection.selectedId:'';
      gpus.forEach((gpu,i)=>{
        const status=statuses[i],connected=status.kind==='ready'&&gpu.id===connectedId;
        const unavailable=status.kind==='unknown';
        const card=container.querySelector(`[data-gpu="${gpu.id}"]`);
        card.dataset.status=connected?'connected':status.kind;
        card.querySelector('.gpu-status').textContent=connected?'Connected':status.kind==='ready'?'Available':status.title;
        const button=card.querySelector('.gpu-open');
        button.disabled=unavailable||connected;
        button.dataset.connected=String(connected);
        button.setAttribute('aria-pressed',String(connected));
        button.textContent=connected?'Connected':unavailable?'Unavailable':connectedId?`Switch to ${gpu.name}`:`Connect to ${gpu.name}`;
        button.classList.toggle('secondary',!connected);
      });
      if(active && container.querySelector('.gpu-picker')) {
        container.querySelector('#gpu-checked').textContent='Last checked '+new Date().toLocaleTimeString()+'. Refreshes every 20 seconds.';
        refresh.disabled=false; refresh.textContent='Refresh status';
      }
      busy=false;
    }
    refresh.onclick=update;
    const timer=setInterval(()=>{if(document.visibilityState!=='hidden')update();},20000);
    dispose=()=>{active=false;clearInterval(timer);};
    update();
  }
  return {mount,check,gpus};
})();
