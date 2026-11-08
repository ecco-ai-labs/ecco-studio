import React from 'react';
import '../../popup-close.js';
import {createRoot} from 'react-dom/client';
import Desk from './Desk';
import css from './desk.css';
import popupControls from '../../popup-controls.css';
import {signOutStaff} from './staff-auth';

export function mount(host:HTMLElement,options:{embedded?:boolean;portalOnly?:boolean;onSignIn?:()=>void}={}){
 const shadow=host.attachShadow({mode:'open'});
 const style=document.createElement('style');style.textContent=css+popupControls;shadow.append(style);
 const node=document.createElement('div');shadow.append(node);
 const root=createRoot(node);
 const signOut=signOutStaff;
 root.render(<Desk {...options} onSignOut={signOut}/>);
 return ()=>root.unmount();
}
const standalone=document.querySelector<HTMLElement>('#ecco-desk-root');
if(standalone)mount(standalone);
