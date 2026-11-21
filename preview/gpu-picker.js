'use strict';
// Public endpoint addresses only. Authentication stays on the selected RunPod origin.
window.EccoGPUPicker = (() => {
  const gpus = [
    {id:'io8sphjo10kbuy',name:'B200',label:'ecco-b200-benchmark'},
    {id:'p7lc6fqjuosti3',name:'B200',label:'severe_crimson_kingfisher'},
    {id:'1muqctw9bxvguu',name:'A100',label:'ecco-demo-a100'},
    {id:'sup07jsgh2evnf',name:'A100',label:'ecco-demo-a100-migration'},
    // Always-on bridge to RunPod Serverless; no pod to start. It connects automatically while healthy.
    {id:'serverless',name:'Serverless',label:'RunPod Serverless'}
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
    const connecting=new Set(),classes=['B200','A100','Serverless'];
    container.innerHTML=`<section class="gpu-picker panel" aria-label="Accelerator classes">
      <div class="section-head"><h2>Class of Accelerators</h2><button type="button" class="secondary" id="gpu-refresh">Refresh status</button></div>
      <div class="gpu-grid">${classes.map(name=>`<article class="gpu-card" data-gpu-class="${name}" aria-labelledby="gpu-class-${name}">
        <div class="gpu-card-head"><h3 id="gpu-class-${name}">${name}</h3><span class="gpu-pod-tag" hidden></span></div>
        <label for="gpu-instance-${name}">RunPod instance<select id="gpu-instance-${name}" aria-label="${name} RunPod instance" aria-describedby="gpu-status-${name}">
          <option value="">Choose an instance</option>${gpus.filter(g=>g.name===name).map(g=>`<option value="${g.id}">${g.label} · ${g.id}</option>`).join('')}
        </select></label>
        <ol class="gpu-pod-steps" hidden><li data-step="accepted">RunPod accepted the start · GPU assigned</li><li data-step="booting">Pod booting · generation service starting</li><li data-step="ready">Ready → connects automatically</li></ol>
        <div class="gpu-pod-alert" role="alert" hidden><strong>RunPod says:</strong><span class="gpu-pod-message"></span><span>Nothing was started and nothing was charged.</span></div>
        <button type="button" class="gpu-pod-start" hidden>Start pod</button>
        <button type="button" class="gpu-open secondary" id="gpu-status-${name}" aria-live="polite" disabled>Connect</button>
        <div class="gpu-pod-actions" hidden><button type="button" class="gpu-pod-cancel secondary">Cancel start</button><button type="button" class="gpu-pod-serverless secondary">Use Serverless instead</button></div>
        <button type="button" class="gpu-pod-stop secondary" hidden>Stop pod</button>
        <div class="gpu-pod-confirm" role="group" aria-label="Confirm stopping the pod" hidden><strong class="gpu-pod-confirm-title"></strong><p class="help gpu-pod-confirm-text"></p><div class="gpu-pod-confirm-actions"><button type="button" class="gpu-pod-keep secondary">Keep running</button><button type="button" class="gpu-pod-stop-confirm">Stop pod</button></div></div>
        <p class="help gpu-health-detail" aria-live="polite"></p>
      </article>`).join('')}</div>
      <section class="gpu-pod-console" aria-label="Studio console" hidden><p class="eyebrow">Studio console</p><ol aria-live="polite"></ol></section>
      <p class="help" id="gpu-checked">Checking availability…</p>
    </section>`;
    const refresh=container.querySelector('#gpu-refresh');
    const cards=classes.map(name=>{
      const root=container.querySelector(`[data-gpu-class="${name}"]`);
      const q=sel=>root.querySelector(sel);
      return {name,root,select:q('select'),button:q('.gpu-open'),tag:q('.gpu-pod-tag'),steps:q('.gpu-pod-steps'),alert:q('.gpu-pod-alert'),
        start:q('.gpu-pod-start'),actions:q('.gpu-pod-actions'),cancel:q('.gpu-pod-cancel'),serverless:q('.gpu-pod-serverless'),
        stop:q('.gpu-pod-stop'),confirm:q('.gpu-pod-confirm'),keep:q('.gpu-pod-keep'),stopConfirm:q('.gpu-pod-stop-confirm')};
    });
    const isConnected=id=>Boolean(window.EccoGPUConnection?.isConnected(id));
    const statusFor=gpu=>gpu&&(window.EccoGPUConnection?.status?.(gpu)||statuses.get(gpu.id));
    function statusLabel(gpu){
      const status=statusFor(gpu);
      return disconnectMode?(window.EccoGPUConnection?.isRemembered(gpu.id)?'Connected':'Not connected'):isConnected(gpu.id)?'Connected':status?.kind==='ready'?'Available':status?.title||'Checking…';
    }
    // RunPod power state (Start/Stop pod). Serverless has no pod; disconnect mode shows none of this.
    let podInfo=new Map(),podsError='',confirmFor='',ticks=0;
    const local=new Map(),lines=[],consoleBox=container.querySelector('.gpu-pod-console');
    const isPodClass=name=>name!=='Serverless'&&!disconnectMode;
    const rate=p=>p&&typeof p.rate_per_hour==='number'?'$'+p.rate_per_hour.toFixed(2)+'/hr':'its hourly rate';
    const clock=ms=>{const s=Math.max(0,Math.floor(ms/1000));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
    function log(text,error){
      lines.push({at:new Date(),text,error:!!error});if(lines.length>8)lines.shift();
      consoleBox.hidden=false;const list=consoleBox.querySelector('ol');list.replaceChildren(...lines.map(line=>{
        const li=document.createElement('li');li.textContent=line.at.toLocaleTimeString()+' · '+line.text;if(line.error)li.dataset.error='true';return li;}));
    }
    function phase(gpu){
      const mine=local.get(gpu.id),pod=podInfo.get(gpu.id),ready=statusFor(gpu)?.kind==='ready';
      if(mine?.phase==='error')return 'error';
      if(mine?.phase==='starting')return ready&&pod?.state==='running'?'running':'starting';
      if(pod?.state==='starting')return 'starting';
      if(pod?.state==='running')return 'running';
      if(pod?.state==='stopped')return 'stopped';
      return '';
    }
    async function refreshPods(){
      if(disconnectMode||!window.EccoGPUConnection?.pods||!window.EccoStorage?.ready)return;
      try{podInfo=new Map((await window.EccoGPUConnection.pods()).map(p=>[p.id,p]));podsError='';}
      catch(error){
        // 404: this storage server predates Start/Stop pod; keep the box as it was, without noise.
        if(error.status===404){podInfo=new Map();return;}
        if(podsError!==error.message){podsError=error.message;log('Could not read pod status from RunPod: '+error.message,true);}}
    }
    async function finishStarting(){
      for(const [id,mine] of local){
        const gpu=gpus.find(g=>g.id===id);
        if(mine.phase!=='starting'||!gpu||statusFor(gpu)?.kind!=='ready'||podInfo.get(id)?.state!=='running')continue;
        local.delete(id);log(gpu.label+' is ready on RunPod ('+clock(Date.now()-mine.since)+').');
        if(!isConnected(id)){connecting.add(id);draw();try{await open(gpu);log('Connected to '+gpu.label+'.');}catch(error){log('Could not connect to '+gpu.label+': '+error.message,true);}finally{connecting.delete(id);}}
      }
    }
    function drawPod(card,gpu){
      const pod=gpu&&podInfo.get(gpu.id),mine=gpu&&local.get(gpu.id);
      const ph=card.name==='Serverless'?'always-on':gpu&&isPodClass(card.name)?phase(gpu):'';
      const show=(el,on)=>{el.hidden=!on;};
      card.tag.dataset.kind=ph;
      card.tag.textContent={'always-on':'Always on',stopped:'Stopped',starting:'Starting',error:'Could not start',
        running:pod?.uptime_seconds?'Running · '+Math.max(1,Math.round(pod.uptime_seconds/60))+' min':'Running'}[ph]||'';
      show(card.tag,!!card.tag.textContent);
      show(card.start,['stopped','error','starting'].includes(ph));
      card.start.disabled=ph==='starting'||connecting.has(gpu?.id);
      card.start.setAttribute('aria-busy',String(ph==='starting'));
      card.start.textContent=ph==='starting'?'Starting… '+clock(Date.now()-(mine?.since||Date.now())):ph==='error'?'Try again':'Start pod';
      if(['stopped','error','starting'].includes(ph))card.button.hidden=true;else card.button.hidden=false;
      show(card.steps,ph==='starting');
      if(ph==='starting'){
        const accepted=mine?.accepted||pod?.state==='starting'||pod?.state==='running';
        card.steps.querySelector('[data-step="accepted"]').dataset.state=accepted?'done':'active';
        card.steps.querySelector('[data-step="booting"]').dataset.state=accepted?'active':'pending';
        card.steps.querySelector('[data-step="ready"]').dataset.state='pending';
      }
      show(card.alert,ph==='error');
      if(ph==='error')card.alert.querySelector('.gpu-pod-message').textContent='“'+(mine?.message||'RunPod did not start the pod.')+'”';
      show(card.actions,ph==='starting'||ph==='error');
      show(card.cancel,ph==='starting');
      show(card.serverless,ph==='error');
      const confirming=ph==='running'&&confirmFor===gpu?.id;
      show(card.stop,ph==='running'&&!confirming);
      show(card.confirm,confirming);
      if(confirming){
        const n=pod?.active_jobs||0;
        card.confirm.querySelector('.gpu-pod-confirm-title').textContent='Stop '+gpu.label+'?';
        card.confirm.querySelector('.gpu-pod-confirm-text').textContent=(n?n+(n===1?' job is':' jobs are')+' still running on this pod and would be interrupted. ':'')+'Billing stops once the pod is stopped. Its files stay; you can start it again later.';
      }
      if(ph==='stopped')return 'Starts the pod on RunPod, usually in 1–3 minutes. Billed at '+rate(pod)+' while running.';
      if(ph==='starting')return 'Usually 1–3 minutes. You can close this window; the pod keeps starting on RunPod.';
      if(ph==='error')return '';
      if(ph==='running'&&statusFor(gpu)?.kind==='ready')return 'Billed at '+rate(pod)+' while running. Stop keeps its files; nothing is deleted.';
      return null;
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
        const podDetail=drawPod(card,gpu),ph=card.tag.dataset.kind;
        if(ph==='error'||ph==='starting')card.root.dataset.status=ph;
        card.root.querySelector('.gpu-health-detail').textContent=disconnectMode?'Disconnecting does not stop the pod or cancel accepted jobs.':podDetail!=null?podDetail:gpu?status?.detail||'Checking generation service…':'';
        card.button.title=gpu&&!connected&&status?.kind!=='ready'?status?.detail||'This instance is unavailable.':'';
      }
    }
    // Open on the instance that is already connected (or the only one, e.g. Serverless), so the card shows its state.
    for(const card of cards){
      const own=gpus.filter(g=>g.name===card.name);
      const pick=own.find(g=>disconnectMode?window.EccoGPUConnection?.isRemembered(g.id):isConnected(g.id))||(own.length===1?own[0]:null);
      if(pick&&!card.select.value)card.select.value=pick.id;
    }
    for(const card of cards){
      const chosen=()=>gpus.find(g=>g.id===card.select.value);
      card.start.onclick=async()=>{
        const gpu=chosen();if(!gpu||card.start.disabled)return;
        local.set(gpu.id,{phase:'starting',since:Date.now()});confirmFor='';log('Starting '+gpu.label+' on RunPod…');draw();
        try{
          const reply=await window.EccoGPUConnection.startPod(gpu.id),mine=local.get(gpu.id);if(mine)mine.accepted=true;
          log(reply.already?gpu.label+' is already running on RunPod.':'RunPod: pod is starting'+(reply.pod?.gpu?' ('+reply.pod.gpu+' x'+(reply.pod.gpu_count||1)+')':'')+'.');
        }catch(error){local.set(gpu.id,{phase:'error',message:error.message});log('RunPod refused to start '+gpu.label+': '+error.message,true);}
        draw();update();
      };
      card.cancel.onclick=async()=>{
        const gpu=chosen();if(!gpu)return;card.cancel.disabled=true;
        try{await window.EccoGPUConnection.stopPod(gpu.id);local.delete(gpu.id);log('Start cancelled; '+gpu.label+' stopped on RunPod.');}
        catch(error){log('Could not cancel the start of '+gpu.label+': '+error.message,true);}
        finally{card.cancel.disabled=false;draw();update();}
      };
      card.serverless.onclick=async()=>{
        const gpu=chosen();if(gpu)local.delete(gpu.id);
        const target=cards.find(c=>c.name==='Serverless'),serverless=gpus.find(g=>g.id==='serverless');
        if(target&&serverless){target.select.value='serverless';if(!isConnected('serverless')){connecting.add('serverless');draw();try{await open(serverless);}finally{connecting.delete('serverless');}}target.root.scrollIntoView?.({block:'nearest'});}
        draw();update();
      };
      card.stop.onclick=()=>{const gpu=chosen();if(!gpu)return;confirmFor=gpu.id;draw();card.keep.focus();};
      card.keep.onclick=()=>{confirmFor='';draw();card.stop.focus();};
      card.stopConfirm.onclick=async()=>{
        const gpu=chosen();if(!gpu)return;card.stopConfirm.disabled=true;
        try{await window.EccoGPUConnection.stopPod(gpu.id);log(gpu.label+' stopped on RunPod. Billing stops; its files are kept.');confirmFor='';}
        catch(error){log('RunPod refused to stop '+gpu.label+': '+error.message,true);}
        finally{card.stopConfirm.disabled=false;draw();update();}
      };
    }
    for(const card of cards){
      card.select.onchange=()=>{confirmFor='';draw();};
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
      try{[results]=await Promise.all([window.EccoStorage?.ready&&window.EccoGPUConnection?.checkAll?window.EccoGPUConnection.checkAll(gpus):Promise.all(gpus.map(gpu=>check(gpu))),refreshPods()]);}
      catch(error){results=gpus.map(()=>({kind:'unknown',title:'Status unavailable',detail:error.message||'Could not check GPU availability.'}));}
      if(!active||!container.querySelector('.gpu-picker')){busy=false;return;}
      statuses=new Map(gpus.map((gpu,i)=>[gpu.id,results[i]]));busy=false;draw();await finishStarting();draw();
      container.querySelector('#gpu-checked').textContent='Last checked '+new Date().toLocaleTimeString()+'. Refreshes every 20 seconds.';
      refresh.disabled=false;refresh.textContent='Refresh status';
    }
    refresh.onclick=update;
    const connectionChanged=()=>{if(active)draw();};
    document.addEventListener('ecco:gpu-connection-change',connectionChanged);
    const timer=setInterval(()=>{if(document.visibilityState!=='hidden')update();},20000);
    // While a pod is starting: tick the timer every second and recheck every 5 seconds.
    const ticker=setInterval(()=>{if(![...local.values()].some(m=>m.phase==='starting'))return;draw();if(++ticks%5===0)update();},1000);
    dispose=()=>{active=false;clearInterval(timer);clearInterval(ticker);document.removeEventListener('ecco:gpu-connection-change',connectionChanged);};
    update();
  }
  return {mount,check,gpus};
})();
