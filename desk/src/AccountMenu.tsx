import {useEffect,useId,useRef,useState} from 'react';
import {ArrowLeft,LogOut} from 'lucide-react';
import {type Actor} from './types';

export default function AccountMenu({me,onSignOut}:{me:Actor;onSignOut:()=>void}){
 const [open,setOpen]=useState(false),id=useId();
 const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),signOut=useRef<HTMLButtonElement>(null);
 useEffect(()=>{
  if(!open)return;
  signOut.current?.focus();
  const outside=(e:PointerEvent)=>{if(!e.composedPath().includes(root.current!))setOpen(false)};
  document.addEventListener('pointerdown',outside,true);
  return()=>document.removeEventListener('pointerdown',outside,true);
 },[open]);
 const initials=me.name.split(/[ @.]+/).slice(0,2).map(p=>p[0]).join('').toUpperCase();
 return <div className="account-control" ref={root} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setOpen(false)}} onKeyDown={e=>{
  if(e.key==='Escape'&&open){e.preventDefault();e.stopPropagation();setOpen(false);trigger.current?.focus()}
  else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();setOpen(true);signOut.current?.focus()}
 }}>
  <button ref={trigger} className="avatar small account-trigger" aria-label={`Account menu for ${me.name}`} title="Account" aria-haspopup="menu" aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>setOpen(v=>!v)}>{initials}</button>
  {open&&<div className="account-dropdown" id={id} role="menu" aria-label="Account"><button type="button" role="menuitem" onClick={()=>{setOpen(false);trigger.current?.focus()}}><ArrowLeft size={16} aria-hidden="true"/>Back</button><div className="account-identity" role="presentation"><strong>{me.name}</strong><span>{me.email}</span><small>{me.role==='admin'?'Administrator':me.role==='staff'?'Team member':me.canManageNotifications?'Notification administrator':'Customer'}</small></div><button ref={signOut} type="button" role="menuitem" onClick={()=>{setOpen(false);onSignOut()}}><LogOut size={16} aria-hidden="true"/>Sign out</button></div>}
 </div>;
}
