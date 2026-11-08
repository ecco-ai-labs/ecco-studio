import NoticePresentation,{presentationDefaults,type Presentation} from './NoticePresentation';
import {useCallback, useEffect, useRef, useState, type FormEvent} from 'react';
import Campaigns from './Campaigns';
import {AlertCircle, Bell, LoaderCircle, Send, Plus} from 'lucide-react';

type Notice={placements?:string[];badge?:string;kind?:string;campaignId?:string|null;offer?:{credits:number;bonusCredits:number;cents:number};id:string;title:string;body:string;severity:string;audience:string;recipientId?:string|null;durationDays?:number|null;recipientName:string|null;recipientEmail:string|null;createdAt:string;expiresAt:string|null;status:string;readCount:number};
type User={id:string;name:string;email:string};
type Api=(payload?:unknown,path?:string)=>Promise<any>;
const severityLabel=(value:string)=>({informational:'Informational',warning:'Warning',error:'Error'}[value]||value);
const newRequestId=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
const stamp=(value:string|null)=>value?new Date(value).toLocaleString():'Until read';

export default function Notifications({api}:{api:Api}){
 const [notices,setNotices]=useState<Notice[]>([]),[users,setUsers]=useState<User[]>([]);
 const [audience,setAudience]=useState('all'),[lifetime,setLifetime]=useState('duration'),[kind,setKind]=useState('notification'),[offersReady,setOffersReady]=useState(false),[campaignsReady,setCampaignsReady]=useState(false);
 const [loading,setLoading]=useState(true),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');
 const [presentation,setPresentation]=useState<Presentation>(presentationDefaults()),[presentationReady,setPresentationReady]=useState(false);
 const [editing,setEditing]=useState(false),[editorKey,setEditorKey]=useState(newRequestId());
 const createRef=useRef<HTMLButtonElement>(null);
 const tabs=[['notification','Notifications'],['special_offer','OutReach'],['marketing_campaign','Campaign']];
 const filtered=notices.filter(n=>kind==='special_offer'?n.kind==='special_offer':n.kind!=='special_offer'&&!n.campaignId);
 const category=kind==='special_offer'?'OutReach':'Notification';
 const [reissue,setReissue]=useState<{notice:Notice;key:string}|null>(null);
 const formRef=useRef<HTMLFormElement>(null);
 const requestId=useRef(newRequestId()),generation=useRef(0),mounted=useRef(true),submitting=useRef(false);
 const refresh=useCallback(async()=>{const seq=++generation.current;try{
  const result=await api(undefined,'?manageNotifications=1');if(!mounted.current||seq!==generation.current)return;
  if(result.notificationVersion!==1||!Array.isArray(result.notifications))throw new Error('User notifications are not available on the service yet.');
  setPresentationReady(result.notificationPresentationVersion===1);setCampaignsReady(result.campaignVersion===1);setOffersReady(result.specialOfferVersion===1);setNotices(result.notifications);setUsers(result.users);setReady(true);
 }catch(e){if(mounted.current&&seq===generation.current){setReady(false);setError((e as Error).message)}}finally{if(mounted.current&&seq===generation.current)setLoading(false)}},[api]);
 useEffect(()=>{mounted.current=true;refresh();const timer=setInterval(()=>{if(!document.hidden)refresh()},10000);return()=>{mounted.current=false;generation.current++;clearInterval(timer)}},[refresh]);
 useEffect(()=>{if(editing){const title=formRef.current?.elements.namedItem('title') as HTMLInputElement|null;title?.focus();title?.scrollIntoView?.({block:'center'});}},[editing,editorKey,reissue]);
 function selectTab(value:string){setKind(value);setEditing(false);setReissue(null);setError('');setSuccess('');}
 function createNew(){const key=newRequestId();requestId.current=key;setEditorKey(key);setReissue(null);setAudience('all');setLifetime('duration');setPresentation(presentationDefaults(kind==='special_offer'));setError('');setSuccess('');setEditing(true);}
 function closeEditor(){setEditing(false);setReissue(null);requestId.current=newRequestId();setTimeout(()=>createRef.current?.focus(),0);}
 function editAndReissue(notice:Notice){
  if(submitting.current||!ready)return;
  const key=newRequestId();requestId.current=key;setError('');setSuccess('');
  setAudience(notice.audience);setLifetime(notice.durationDays==null?'read':'duration');setKind(notice.kind==='special_offer'?'special_offer':'notification');setPresentation({placements:notice.placements||presentationDefaults(notice.kind==='special_offer').placements,badge:notice.badge||'NEW'});setEditorKey(key);setReissue({notice,key});setEditing(true);
 }
 async function publish(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(submitting.current||!ready||!presentationReady||!presentation.placements.length||kind==='special_offer'&&!offersReady)return;const form=e.currentTarget;
  const fields=Object.fromEntries(new FormData(form));
  submitting.current=true;setBusy(true);setError('');setSuccess('');
  try{const result=await api({op:'createNotification',requestId:requestId.current,title:fields.title,body:fields.body,
   kind,...presentation,offer:kind==='special_offer'?{credits:Number(fields.credits),bonusCredits:Number(fields.bonusCredits),cents:Math.round(Number(fields.price)*100)}:null,
   severity:kind==='special_offer'?'informational':fields.severity,audience,recipientId:audience==='user'?fields.recipientId:null,durationDays:lifetime==='duration'?Number(fields.durationDays):null});
   if(!mounted.current)return;
   if(result.notificationVersion!==1||result.notificationPresentationVersion!==1||kind==='special_offer'&&result.specialOfferVersion!==1)throw new Error('The service did not confirm this notification. Please refresh.');
   setSuccess(reissue?`${category} re-issued.`:`${category} published.`);closeEditor();await refresh();
  }catch(e){if(mounted.current)setError((e as Error).message)}finally{submitting.current=false;if(mounted.current)setBusy(false)}
 }
 async function withdraw(id:string){
  if(submitting.current)return;submitting.current=true;setBusy(true);setError('');setSuccess('');
  try{await api({op:'withdrawNotification',id});if(mounted.current){setSuccess('Notification withdrawn.');await refresh()}}
  catch(e){if(mounted.current)setError((e as Error).message)}finally{submitting.current=false;if(mounted.current)setBusy(false)}
 }
 return <div className="user-notifications">
  <div className="notification-tabs" role="tablist" aria-label="Notification categories">{tabs.map(([value,label],index)=><button key={value} type="button" role="tab" id={'notice-tab-'+value} aria-controls="notice-tab-panel" aria-selected={kind===value} tabIndex={kind===value?0:-1} disabled={busy} onClick={()=>selectTab(value)} onKeyDown={e=>{const offset=e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0;const target=e.key==='Home'?0:e.key==='End'?tabs.length-1:offset?(index+offset+tabs.length)%tabs.length:-1;if(target>=0){e.preventDefault();selectTab(tabs[target][0]);(e.currentTarget.parentElement?.children[target] as HTMLButtonElement)?.focus()}}}>{label}</button>)}</div>
  <div role="tabpanel" id="notice-tab-panel" aria-labelledby={'notice-tab-'+kind}>
  {error&&<div className="alert error" role="alert"><AlertCircle size={17}/>{error}<button type="button" className="text-button" onClick={()=>{setError('');refresh()}}>Retry</button></div>}
  {success&&<p className="notification-success" role="status">{success}</p>}
  {kind==='marketing_campaign'?<section className="ticket-section"><Campaigns api={api} users={users} ready={campaignsReady&&presentationReady}/></section>:<section className="ticket-section" aria-label={category+' history'}><div className="section-heading"><div><Bell size={18}/><h2>{editing?(reissue?'Re-issue ':'New ')+category:category+' History'}</h2>{!editing&&<span className="count">{filtered.length}</span>}</div>{!editing&&<div><button ref={createRef} className="notification-create" type="button" aria-label={'New '+category} title={'New '+category} disabled={busy||!ready||!presentationReady||kind==='special_offer'&&!offersReady} onClick={createNew}><Plus size={20}/></button></div>}</div>
   {editing?<form ref={formRef} key={editorKey} className="notification-composer" onSubmit={publish} onReset={createNew} aria-busy={busy}>
    <fieldset disabled={busy||!ready}>
     {reissue&&<p className="form-info">Edit the details below, then publish a fresh copy with a new lifetime.</p>}

     <div className="form-grid"><label>Recipients<select name="audience" value={audience} onChange={e=>setAudience(e.target.value)}><option value="all">All users</option><option value="user">Specific user</option></select></label>
      <label>Severity<select name="severity" key={kind} defaultValue={reissue?.notice.severity||'informational'} disabled={kind==='special_offer'}><option value="informational">Informational</option><option value="warning">Warning</option><option value="error">Error</option></select></label>
      {audience==='user'&&<label className="notification-full">User<select name="recipientId" required defaultValue={reissue?.notice.recipientId||''}><option value="">Choose a signed-in Studio user</option>{users.map(u=><option key={u.id} value={u.id}>{u.name} · {u.email} · {u.id.slice(-6)}</option>)}</select></label>}
     </div>
     <NoticePresentation value={presentation} onChange={setPresentation} promotional={kind==='special_offer'} ready={presentationReady}/>
     <label>Title<input name="title" defaultValue={reissue?.notice.title||''} required maxLength={160} placeholder="A short notification title"/></label>
     <label>Message<textarea name="body" aria-label="Message" defaultValue={reissue?.notice.body||''} required maxLength={4000} rows={3} placeholder="What should the user know?"/></label>
     {kind==='special_offer'&&<><div className="form-grid">
      <label>Purchase credits<input name="credits" defaultValue={reissue?.notice.offer?.credits} type="number" min={1} max={1000000} step={1} required/></label>
      <label>Free bonus credits<input name="bonusCredits" type="number" min={0} max={1000000} step={1} defaultValue={reissue?.notice.offer?.bonusCredits??0} required/></label>
      <label>Price (USD)<input name="price" defaultValue={reissue?.notice.offer? (reissue.notice.offer.cents/100).toFixed(2):''} type="number" min={0.01} max={1000000} step={0.01} required/></label>
     </div><p className="form-info">Appears in the selected locations. Billing shows active offers above regular credit options. Reading or expiry removes it for that user.</p></>}
     <div className="form-grid"><label>Active until<select name="lifetime" value={lifetime} onChange={e=>setLifetime(e.target.value)}><option value="duration">Read or duration ends</option><option value="read">Until read</option></select></label>
      {lifetime==='duration'&&<label>Duration (days)<input name="durationDays" type="number" min={1} max={365} step={1} defaultValue={reissue?.notice.durationDays??3} required/></label>}
     </div>
     <p className="form-info">Reading a Bell Icon notification moves it to Old Notfication for that user. The last 3 read notices remain until expiry; unread notices also expire automatically.</p>
     <div className="notification-actions"><button type="button" className="secondary-button" onClick={closeEditor}>Cancel</button><button type="reset" className="secondary-button">Clear form</button><button className="primary" type="submit" disabled={!presentation.placements.length}>{busy?<LoaderCircle className="spin" size={16}/>:<Send size={16}/>} {busy?'Saving…':reissue?`Re-issue ${category.toLowerCase()}`:`Publish ${category.toLowerCase()}`}</button></div>
    </fieldset>
   </form>:<>
   {loading?<p className="detail-loading" role="status"><LoaderCircle className="spin" size={17}/>Loading notifications…</p>:filtered.length?<div className="table-wrap"><table className="notification-history"><thead><tr><th>Notification</th><th>Recipients</th><th>Severity</th><th>Show in</th><th>Status</th><th>Created</th><th>Expires</th><th>Read</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{filtered.map(n=><tr key={n.id} data-status={n.status}>
    <td><details><summary>{n.title}</summary><p>{n.body}</p>{n.offer&&<p>OutReach · {n.offer.credits} credits + {n.offer.bonusCredits} free · ${(n.offer.cents/100).toFixed(2)}</p>}</details></td><td>{n.audience==='all'?'All users':<><span>{n.recipientName}</span><small>{n.recipientEmail}</small></>}</td><td><span className={`notification-severity ${n.severity}`}>{severityLabel(n.severity)}</span></td><td>{(n.placements||presentationDefaults(n.kind==='special_offer').placements).map(p=>p==='bell'?'Bell Icon':'Billing').join(', ')}</td><td>{n.status==='active'?'Active':n.status==='read'?'Read':n.status==='expired'?'Expired':'Withdrawn'}</td><td>{stamp(n.createdAt)}</td><td>{stamp(n.expiresAt)}</td><td>{n.readCount}</td><td><button className="text-button" disabled={busy||!ready} onClick={()=>editAndReissue(n)} aria-label={`Edit and re-issue ${n.title}`}>Edit &amp; re-issue</button>{n.status==='active'&&<button className="text-button" disabled={busy} onClick={()=>withdraw(n.id)} aria-label={`Withdraw ${n.title}`}>Withdraw</button>}</td>
   </tr>)}</tbody></table></div>:<p className="detail-loading">{ready?`No ${kind==='special_offer'?'OutReach':'notifications'} yet.`:`${category} unavailable.`}</p>}
   <div className="table-footer"><span>Latest 200 notifications · Users see up to 5 newest notices</span></div>
  </>}
  </section>}
  </div>
 </div>
}
