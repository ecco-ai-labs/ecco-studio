import {useEffect,useRef,useState} from 'react';
import {ShieldCheck,RefreshCw,ExternalLink,LoaderCircle} from 'lucide-react';
import type {Actor} from './types';
const endpoint='https://vowmjru85f2gzo-8888.proxy.runpod.net/api/desk/notification-group/connect';
export default function NotificationAccess({me,refresh}:{me:Actor;refresh:()=>Promise<any>}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[url,setUrl]=useState('');
 const active=useRef(true),pending=useRef<AbortController|null>(null);
 useEffect(()=>()=>{active.current=false;pending.current?.abort();},[]);
 async function connect(){
  if(busy)return;setError('');setUrl('');
  const key=localStorage.getItem('ecco-storage-access')||sessionStorage.getItem('ecco-storage-access');
  if(!key){setError('Open Studio and connect the existing workspace Storage first, then return here and click Connect Google. This setup requires the workspace owner.');return;}
  const popup=window.open('about:blank','_blank','popup,width=620,height=780');
  if(popup)popup.opener=null;
  setBusy(true);const controller=new AbortController();pending.current=controller;const timeout=setTimeout(()=>controller.abort(),20000);
  try{
   const response=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:'{}',signal:controller.signal});
   const result=await response.json();if(!response.ok)throw Error(result.error||'Could not start the Google connection.');
   const target=new URL(result.url);if(target.origin!=='https://accounts.google.com')throw Error('The service returned an invalid Google connection link.');
   if(!active.current){popup?.close();return;}
   setUrl(target.href);if(popup)popup.location.href=target.href;
  }catch(e){popup?.close();if(active.current)setError(controller.signal.aborted?'The connection request timed out. Please try again.':(e as Error).message);}
  finally{clearTimeout(timeout);if(active.current)setBusy(false);}
 }
 const unconnected=me.notificationAdminGroup&&me.notificationGroupStatus==='not_connected';
 return <section className="ticket-section notification-access"><ShieldCheck size={28}/><h2>{unconnected?'Connect your administrator group':'Administrator access required'}</h2>
  <p>{unconnected?'The group has been configured, but Google authorization is still incomplete. The workspace owner can finish the connection here.':me.notificationGroupStatus==='unavailable'?'Google membership verification is temporarily unavailable. Refresh access to try again.':me.notificationAdminGroup?'An active membership in this administrator group is required.':'Sign in with your Desk administrator account to create notifications.'}</p>
  {me.notificationAdminGroup&&<strong>{me.notificationAdminGroup}</strong>}<p>Signed in as {me.email}.</p>
  {unconnected&&<><p>Google will request read-only access to group membership. Notification creation becomes available after the connection and your membership are verified.</p><button className="primary" disabled={busy} onClick={connect}>{busy?<LoaderCircle size={15} className="spin"/>:<ExternalLink size={15}/>} {busy?'Opening Google…':'Connect Google'}</button></>}
  <button className="secondary-button" disabled={busy} onClick={()=>refresh()}><RefreshCw size={15}/>Refresh access</button>
  {url&&<p role="status">Complete the Google approval, then refresh access. <a href={url} target="_blank" rel="noopener noreferrer">Continue with Google ↗</a></p>}
  {error&&<p role="alert" className="inline-error">{error}</p>}
  {error&&!url&&<a href="../" target="_blank" rel="noopener noreferrer">Open Studio ↗</a>}
 </section>;
}
