import React from 'react';
import {createRoot} from 'react-dom/client';
import Desk from './Desk';
import css from './desk.css';
import popupControls from '../../popup-controls.css';

export function mount(host:HTMLElement,options:{embedded?:boolean;portalOnly?:boolean;onSignIn?:()=>void}={}){
 const shadow=host.attachShadow({mode:'open'});
 const style=document.createElement('style');style.textContent=css+popupControls;shadow.append(style);
 const node=document.createElement('div');shadow.append(node);
 const root=createRoot(node);
 const studio=new URL('../',import.meta.url);
 const signIn=options.onSignIn||(()=>{studio.searchParams.set('desk','team');location.assign(studio.href)});
 const signOut=async()=>{
  const token=sessionStorage.getItem('ecco-user-session');
  try{await fetch('https://vowmjru85f2gzo-8888.proxy.runpod.net/api/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)})}catch{}
  sessionStorage.removeItem('ecco-user-session');sessionStorage.removeItem('ecco-storage-access');location.assign(studio.href);
 };
 root.render(<Desk {...options} onSignIn={signIn} onSignOut={signOut}/>);
 return ()=>root.unmount();
}
const standalone=document.querySelector<HTMLElement>('#ecco-desk-root');
if(standalone)mount(standalone);
