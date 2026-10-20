'use strict';
// Public endpoint addresses only. Authentication stays on the selected RunPod origin.
window.EccoGPUPicker = (() => {
  const gpus = [
    {id:'io8sphjo10kbuy',name:'B200 (Original)',label:'ecco-b200-benchmark'},
    {id:'p7lc6fqjuosti3',name:'B200 (New)',label:'severe_crimson_kingfisher'},
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
      probe(gpu.url+'logo.png'), probe(gpu.origin+'/static/favicons/favicon.ico')
    ]);
    if(studio) return {kind:'ready',title:'Running · Studio available',detail:'Studio is responding. Open this workspace to continue.'};
    if(gateway) return {kind:'running',title:'Running · gateway available',detail:'The GPU workspace is responding. Studio may be starting or require sign-in.'};
    return {kind:'unknown',title:'Unavailable from this browser',detail:'May be stopped, starting, or blocked by sign-in/network settings. Refresh to check again.'};
  }
  function mount(container, open) {
    dispose();
    let active=true, busy=false, selecting=false, statuses=new Map();
    container.innerHTML = `<section class="gpu-picker panel form" aria-label="GPU workspaces">
      <label for="gpu-workspace">GPU workspace<select id="gpu-workspace" aria-describedby="gpu-selection-status">
        <option value="">Choose a GPU</option>${gpus.map(gpu=>`<option value="${gpu.id}">${gpu.name} · Checking…</option>`).join('')}
      </select></label>
      <p class="help" id="gpu-selection-status" role="status" aria-live="polite"></p>
      <div class="row"><button type="button" class="gpu-open secondary" disabled>Connect</button><button type="button" class="secondary" id="gpu-refresh">Refresh status</button></div>
      <p class="help" id="gpu-checked">Checking ${gpus.length} GPU workspaces…</p>
    </section>`;
    const refresh=container.querySelector('#gpu-refresh'),select=container.querySelector('#gpu-workspace'),button=container.querySelector('.gpu-open'),note=container.querySelector('#gpu-selection-status');
    const savedId=window.EccoGPUConnection?.selectedId;
    if(gpus.some(gpu=>gpu.id===savedId))select.value=savedId;
    function draw(){
      const connection=window.EccoGPUConnection,connectedId=connection?.ready?connection.selectedId:'';
      for(const gpu of gpus){
        const status=statuses.get(gpu.id),connected=status?.kind==='ready'&&gpu.id===connectedId;
        const label=connected?'Connected':status?.kind==='ready'?'Available':status?.kind==='running'?'Starting':status?.title||'Checking…';
        select.querySelector(`option[value="${gpu.id}"]`).textContent=gpu.name+' · '+label;
      }
      const gpu=gpus.find(gpu=>gpu.id===select.value),status=statuses.get(select.value),connected=status?.kind==='ready'&&select.value===connectedId;
      select.disabled=selecting;
      button.disabled=selecting||busy||!gpu||!status||status.kind==='unknown'||connected;
      button.dataset.connected=String(connected);button.setAttribute('aria-pressed',String(connected));
      button.textContent=selecting?'Connecting…':connected?'Connected':status?.kind==='unchecked'?'Connect storage':connectedId?'Switch connection':'Connect';
      note.textContent=selecting?'Connecting to '+gpu.name+'…':!gpu?'':connected?gpu.name+' connected.':status?.kind==='unknown'||status?.kind==='unchecked'?status.detail:gpu.label+' · '+gpu.id;
      note.hidden=!note.textContent;
    }
    select.onchange=draw;
    button.onclick=async()=>{
      const gpu=gpus.find(gpu=>gpu.id===select.value);
      if(button.disabled||selecting||busy||!gpu)return;
      selecting=true;button.setAttribute('aria-busy','true');draw();
      try{await open(gpu);}finally{selecting=false;button.removeAttribute('aria-busy');await update();}
    };
    async function update() {
      if(busy || selecting || !active) return;
      busy=true; refresh.disabled=true; refresh.textContent='Checking…';draw();
      let results;
      try{results=window.EccoStorage?.ready&&window.EccoGPUConnection?.checkAll?await window.EccoGPUConnection.checkAll(gpus):await Promise.all(gpus.map(gpu=>check(gpu)));}
      catch(error){results=gpus.map(()=>({kind:'unknown',title:'Status unavailable',detail:error.message||'Could not check GPU availability.'}));}
      if(!active || !container.querySelector('.gpu-picker')){busy=false;return;}
      statuses=new Map(gpus.map((gpu,i)=>[gpu.id,results[i]]));busy=false;draw();
      if(active && container.querySelector('.gpu-picker')) {
        container.querySelector('#gpu-checked').textContent='Last checked '+new Date().toLocaleTimeString()+'. Refreshes every 20 seconds.';
        refresh.disabled=false; refresh.textContent='Refresh status';
      }
    }
    refresh.onclick=update;
    const timer=setInterval(()=>{if(document.visibilityState!=='hidden')update();},20000);
    dispose=()=>{active=false;clearInterval(timer);};
    update();
  }
  return {mount,check,gpus};
})();
