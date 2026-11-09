'use strict';
/* Shared immediate hover labels for the ribbon control panels. */
(()=>{
 const style=document.createElement('style');
 const tooltipTargets=':is(#connection-indicators>[data-icon-tooltip],#workspace-community-controls [data-icon-tooltip],#workspace-settings-controls [data-icon-tooltip])';
 const observed=new WeakSet();
 style.textContent='#connection-indicators::after{display:none!important}'+tooltipTargets+'{position:relative}'+tooltipTargets+':hover::after,'+tooltipTargets+':focus-visible::after,#connection-indicators>#studio-publishing-control:focus-within::after{content:attr(data-icon-tooltip);position:absolute;top:calc(100% + 9px);left:0;z-index:10000;white-space:nowrap;pointer-events:none;padding:4px 6px;border-radius:5px;background:var(--connection-tooltip-bg,var(--ecco-theme-surface,#24204a));color:var(--connection-tooltip-fg,var(--ecco-theme-text,#e7ebe9));border:1px solid var(--connection-tooltip-border,var(--ecco-theme-border,var(--border,#454065)));font-family:Inter,ui-sans-serif,system-ui,sans-serif;font-size:calc(11px - 2pt);line-height:1.4;font-weight:500;box-shadow:0 3px 12px #0004;transition:none;animation:none}'
  // Every tooltip uses the theme's panel color. Connection tooltips (AI, Storage, GPU) show their status as a dot:
  // the theme's connected color, or its not-connected color.
  +'#connection-indicators>[data-tooltip-connected]:is(:hover,:focus-visible)::after{padding-left:18px}'
  +'#connection-indicators>[data-tooltip-connected]:is(:hover,:focus-visible)::before{content:"";position:absolute;top:calc(100% + 9px + 9px);left:7px;width:7px;height:7px;border-radius:50%;z-index:10001;pointer-events:none;background:var(--ecco-theme-disconnected,#b1acc9)}'
  +'#connection-indicators>[data-tooltip-connected="true"]:is(:hover,:focus-visible)::before{background:var(--ecco-theme-connected,#ffdc24)}';
 document.head.append(style);
 function refreshCommunity(){
  const panel=document.querySelector('#workspace-community-controls');if(!panel)return;
  for(const [id,label] of [['workspace-discord','Discord'],['workspace-github','GitHub'],['workspace-support',null],['notification-bell',null]]){
   const element=panel.querySelector('#'+id);if(!element)continue;
   const text=label||element.getAttribute('aria-label')||element.getAttribute('title');
   if(text&&element.dataset.iconTooltip!==text)element.dataset.iconTooltip=text;
   if(element.hasAttribute('title'))element.removeAttribute('title');
  }
  if(!observed.has(panel)){observed.add(panel);new MutationObserver(refreshCommunity).observe(panel,{childList:true,subtree:true,attributes:true,attributeFilter:['title','aria-label']});}
 }
 function refresh(){
  refreshCommunity();
  const panel=document.querySelector('#connection-indicators');
  if(!panel)return;
  panel.removeAttribute('title');delete panel.dataset.connectionTooltip;
  const ai=panel.querySelector('#studio-ai-button'),storage=panel.querySelector('#studio-storage-indicator'),gpu=panel.querySelector('#connected-accelerator');
  const aiReady=ai?.dataset.connected==='true',storageReady=storage?.dataset.connected==='true';
  const ids=window.EccoGPUConnection?.connectedIds||[];
  const names=ids.map(id=>window.EccoGPUPicker?.gpus?.find(item=>item.id===id)?.name||'GPU');
  const items=[[ai,aiReady,aiReady?'Connected to AI':'AI: Not connected'],[storage,storageReady,storageReady?'Connected to Storage':'Storage: Not connected'],[gpu,ids.length>0,ids.length?'Connected to GPU: '+names.join(', '):'GPU: Not connected']];
  for(const [element,connected,text] of items){
   if(!element)continue;
   element.removeAttribute('title');
   if(element.dataset.iconTooltip!==text)element.dataset.iconTooltip=text;
   if(element.dataset.tooltipConnected!==String(connected))element.dataset.tooltipConnected=String(connected);
  }
 }
 document.addEventListener('mouseover',event=>{if(event.target.closest?.('#connection-indicators,#workspace-community-controls'))refresh();});
 document.addEventListener('focusin',event=>{if(event.target.closest?.('#connection-indicators,#workspace-community-controls'))refresh();});
 document.addEventListener('ecco:gpu-connection-change',refresh);
 setInterval(refresh,1000);refresh();
})();
