import {useEffect,useRef,useState} from 'react';
import {mountStaffSignIn} from './staff-auth';

export default function StaffSignIn(){
 const host=useRef<HTMLDivElement>(null);
 const [message,setMessage]=useState('Loading Google sign-in…'),[failed,setFailed]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>mountStaffSignIn(host.current!,(text,error=false)=>{setMessage(text);setFailed(error)}),[attempt]);
 return <div className="staff-signin"><div ref={host} className="google-signin-button"/><p role={failed?'alert':'status'}>{message}</p>{failed&&<button className="secondary-button" onClick={()=>setAttempt(n=>n+1)}>Try again</button>}</div>;
}
