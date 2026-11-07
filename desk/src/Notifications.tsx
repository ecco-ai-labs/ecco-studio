import {useCallback, useEffect, useRef, useState, type FormEvent} from 'react';
import Campaigns from './Campaigns';
import {AlertCircle, Bell, LoaderCircle, RefreshCw, Send} from 'lucide-react';

type Notice={kind?:string;offer?:{credits:number;bonusCredits:number;cents:number};id:string;title:string;body:string;severity:string;audience:string;recipientId?:string|null;durationDays?:number|null;recipientName:string|null;recipientEmail:string|null;createdAt:string;expiresAt:string|null;status:string;readCount:number};
type User={id:string;name:string;email:string};
type Api=(payload?:unknown,path?:string)=>Promise<any>;
const severityLabel=(value:string)=>({informational:'Informational',warning:'Warning',error:'Error'}[value]||value);
const newRequestId=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
const stamp=(value:string|null)=>value?new Date(value).toLocaleString():'Until read';

export default function Notifications({api}:{api:Api}){
 const [notices,setNotices]=useState<Notice[]>([]),[users,setUsers]=useState<User[]>([]);
 const [audience,setAudience]=useState('all'),[lifetime,setLifetime]=useState('duration'),[kind,setKind]=useState('notification'),[offersReady,setOffersReady]=useState(false),[campaignsReady,setCampaignsReady]=useState(false);
 const [loading,setLoading]=useState(true),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');
 const [reissue,setReissue]=useState<{notice:Notice;key:string}|null>(null);
 const formRef=useRef<HTMLFormElement>(null);
 const requestId=useRef(newRequestId()),generation=useRef(0),mounted=useRef(true),submitting=useRef(false);
 const refresh=useCallback(async()=>{const seq=++generation.current;try{
  const result=await api(undefined,'?manageNotifications=1');if(!mounted.current||seq!==generation.current)return;
  if(result.notificationVersion!==1||!Array.isArray(result.notifications))throw new Error('User notifications are not available on the service yet.');
  setCampaignsReady(result.campaignVersion===1);setOffersReady(result.specialOfferVersion===1);setNotices(result.notifications);setUsers(result.users);setReady(true);
 }catch(e){if(mounted.current&&seq===generation.current){setReady(false);setError((e as Error).message)}}finally{if(mounted.current&&seq===generation.current)setLoading(false)}},[api]);
 useEffect(()=>{mounted.current=true;refresh();const timer=setInterval(()=>{if(!document.hidden)refresh()},10000);return()=>{mounted.current=false;generation.current++;clearInterval(timer)}},[refresh]);
 useEffect(()=>{if(reissue){const title=formRef.current?.elements.namedItem('title') as HTMLInputElement|null;title?.focus();title?.scrollIntoView?.({block:'center'});}},[reissue]);
 function editAndReissue(notice:Notice){
  if(submitting.current||!ready)return;
  const key=newRequestId();requestId.current=key;setError('');setSuccess('');
  setAudience(notice.audience);setLifetime(notice.durationDays==null?'read':'duration');setKind(notice.kind==='special_offer'?'special_offer':'notification');setReissue({notice,key});
 }
 async function publish(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(submitting.current||!ready||kind==='special_offer'&&!offersReady)return;const form=e.currentTarget;
  const fields=Object.fromEntries(new FormData(form));
  submitting.current=true;setBusy(true);setError('');setSuccess('');
  try{const result=await api({op:'createNotification',requestId:requestId.current,title:fields.title,body:fields.body,
   kind,offer:kind==='special_offer'?{credits:Number(fields.credits),bonusCredits:Number(fields.bonusCredits),cents:Math.round(Number(fields.price)*100)}:null,
   severity:kind==='special_offer'?'informational':fields.severity,audience,recipientId:audience==='user'?fields.recipientId:null,durationDays:lifetime==='duration'?Number(fields.durationDays):null});
   if(!mounted.current)return;
   if(result.notificationVersion!==1||kind==='special_offer'&&result.specialOfferVersion!==1)throw new Error('The service did not confirm this notification. Please refresh.');
   form.reset();setSuccess(reissue?'Notification re-issued.':'Notification published.');await refresh();
  }catch(e){if(mounted.current)setError((e as Error).message)}finally{submitting.current=false;if(mounted.current)setBusy(false)}
 }
 async function withdraw(id:string){
  if(submitting.current)return;submitting.current=true;setBusy(true);setError('');setSuccess('');
  try{await api({op:'withdrawNotification',id});if(mounted.current){setSuccess('Notification withdrawn.');await refresh()}}
  catch(e){if(mounted.current)setError((e as Error).message)}finally{submitting.current=false;if(mounted.current)setBusy(false)}
 }
 return <div className="user-notifications">
  {error&&<div className="alert error" role="alert"><AlertCircle size={17}/>{error}<button type="button" className="text-button" onClick={()=>{setError('');refresh()}}>Retry</button></div>}
  {success&&<p className="notification-success" role="status">{success}</p>}
  <section className="ticket-section"><div className="section-heading"><div><Bell size={18}/><h2>{kind==='marketing_campaign'?'Campaigns':reissue?'Re-issue Notification':'New Notification'}</h2></div></div>
   <div className="notification-type"><label>Type<select name="kind" value={kind} disabled={busy} onChange={e=>setKind(e.target.value)}><option value="notification">Notification</option><option value="special_offer" disabled={!offersReady}>Special offer</option><option value="marketing_campaign">Marketing Campaign</option></select></label></div>
   {kind==='marketing_campaign'?<Campaigns api={api} users={users} ready={campaignsReady}/>:<form ref={formRef} key={reissue?.key||'new'} className="notification-composer" onSubmit={publish} onReset={()=>{setReissue(null);requestId.current=newRequestId();setAudience('all');setLifetime('duration');setKind('notification')}} aria-busy={busy}>
    <fieldset disabled={busy||!ready}>
     {reissue&&<p className="form-info">Edit the details below, then publish a fresh copy with a new lifetime.</p>}

     <div className="form-grid"><label>Recipients<select name="audience" value={audience} onChange={e=>setAudience(e.target.value)}><option value="all">All users</option><option value="user">Specific user</option></select></label>
      <label>Severity<select name="severity" key={kind} defaultValue={reissue?.notice.severity||'informational'} disabled={kind==='special_offer'}><option value="informational">Informational</option><option value="warning">Warning</option><option value="error">Error</option></select></label>
      {audience==='user'&&<label className="notification-full">User<select name="recipientId" required defaultValue={reissue?.notice.recipientId||''}><option value="">Choose a signed-in Studio user</option>{users.map(u=><option key={u.id} value={u.id}>{u.name} · {u.email} · {u.id.slice(-6)}</option>)}</select></label>}
     </div>
     <label>Title<input name="title" defaultValue={reissue?.notice.title||''} required maxLength={160} placeholder="A short notification title"/></label>
     <label>Message<textarea name="body" aria-label="Message" defaultValue={reissue?.notice.body||''} required maxLength={4000} rows={3} placeholder="What should the user know?"/></label>
     {kind==='special_offer'&&<><div className="form-grid">
      <label>Purchase credits<input name="credits" defaultValue={reissue?.notice.offer?.credits} type="number" min={1} max={1000000} step={1} required/></label>
      <label>Free bonus credits<input name="bonusCredits" type="number" min={0} max={1000000} step={1} defaultValue={reissue?.notice.offer?.bonusCredits??0} required/></label>
      <label>Price (USD)<input name="price" defaultValue={reissue?.notice.offer? (reissue.notice.offer.cents/100).toFixed(2):''} type="number" min={0.01} max={1000000} step={0.01} required/></label>
     </div><p className="form-info">Appears in the notification bell and the Special offer box. The newest active offer is featured. Reading or expiry removes it for that user.</p></>}
     <div className="form-grid"><label>Active until<select name="lifetime" value={lifetime} onChange={e=>setLifetime(e.target.value)}><option value="duration">Read or duration ends</option><option value="read">Until read</option></select></label>
      {lifetime==='duration'&&<label>Duration (days)<input name="durationDays" type="number" min={1} max={365} step={1} defaultValue={reissue?.notice.durationDays??3} required/></label>}
     </div>
     <p className="form-info">Reading moves the notification to Old Notfication for that user. The last 3 read notices remain until expiry; unread notices also expire automatically.</p>
     <div className="notification-actions"><button type="reset" className="secondary-button">Clear form</button><button className="primary" type="submit">{busy?<LoaderCircle className="spin" size={16}/>:<Send size={16}/>} {busy?'Saving…':reissue?'Re-issue notification':'Publish notification'}</button></div>
    </fieldset>
   </form>}
  </section>
  <section className="ticket-section" aria-label="Notification history"><div className="section-heading"><div><h2>Notification history</h2><span className="count">{notices.length}</span></div><button className="icon-button" type="button" aria-label="Refresh notifications" onClick={()=>{setError('');refresh()}}><RefreshCw size={17}/></button></div>
   {loading?<p className="detail-loading" role="status"><LoaderCircle className="spin" size={17}/>Loading notifications…</p>:notices.length?<div className="table-wrap"><table className="notification-history"><thead><tr><th>Notification</th><th>Recipients</th><th>Severity</th><th>Status</th><th>Created</th><th>Expires</th><th>Read</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{notices.map(n=><tr key={n.id}>
    <td><details><summary>{n.title}</summary><p>{n.body}</p>{n.offer&&<p>Special offer · {n.offer.credits} credits + {n.offer.bonusCredits} free · ${(n.offer.cents/100).toFixed(2)}</p>}</details></td><td>{n.audience==='all'?'All users':<><span>{n.recipientName}</span><small>{n.recipientEmail}</small></>}</td><td><span className={`notification-severity ${n.severity}`}>{severityLabel(n.severity)}</span></td><td>{n.status==='active'?'Active':n.status==='read'?'Read':n.status==='expired'?'Expired':'Withdrawn'}</td><td>{stamp(n.createdAt)}</td><td>{stamp(n.expiresAt)}</td><td>{n.readCount}</td><td><button className="text-button" disabled={busy||!ready} onClick={()=>editAndReissue(n)} aria-label={`Edit and re-issue ${n.title}`}>Edit &amp; re-issue</button>{n.status==='active'&&<button className="text-button" disabled={busy} onClick={()=>withdraw(n.id)} aria-label={`Withdraw ${n.title}`}>Withdraw</button>}</td>
   </tr>)}</tbody></table></div>:<p className="detail-loading">{ready?'No notifications yet.':'Notifications unavailable.'}</p>}
   <div className="table-footer"><span>Latest 200 notifications · Users see up to 5 newest notices</span></div>
  </section>
 </div>
}
