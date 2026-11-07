import {useEffect, useRef} from 'react';

// Only presence is sent: drafts never leave the composer before Send.
export function useTyping(id:number, enabled:boolean, send:(id:number,typing:boolean)=>Promise<unknown>){
 const activity=useRef<(value:string)=>void>(()=>{});
 const stop=useRef<()=>void>(()=>{});
 useEffect(()=>{
  if(!enabled){activity.current=()=>{};stop.current=()=>{};return}
  let active=false,desired=false,published=false,inFlight=false;
  let idle:ReturnType<typeof setTimeout>|undefined;
  // Serialize changes so a delayed true cannot arrive after a stop.
  const publish=(value:boolean)=>{
   desired=value;if(inFlight)return;
   inFlight=true;published=value;
   void send(id,value).catch(()=>{}).finally(()=>{
    inFlight=false;if(desired!==value)publish(desired);
   });
  };
  const end=()=>{
   active=false;clearTimeout(idle);
   if(desired||published||inFlight)publish(false);
  };
  activity.current=value=>{
   if(!value.trim()||document.visibilityState==='hidden'){end();return}
   clearTimeout(idle);
   if(!active){active=true;publish(true)}
   idle=setTimeout(end,4000);
  };
  stop.current=end;
  const pulse=setInterval(()=>{if(active)publish(true)},2000);
  const hidden=()=>{if(document.visibilityState==='hidden')end()};
  document.addEventListener('visibilitychange',hidden);
  window.addEventListener('blur',end);window.addEventListener('pagehide',end);
  return()=>{
   clearInterval(pulse);end();activity.current=()=>{};stop.current=()=>{};
   document.removeEventListener('visibilitychange',hidden);
   window.removeEventListener('blur',end);window.removeEventListener('pagehide',end);
  };
 },[id,enabled,send]);
 return {activity:(value:string)=>activity.current(value),stop:()=>stop.current()};
}
