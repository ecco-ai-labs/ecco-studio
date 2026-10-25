// The staff identity is independent of the customer's Studio identity.
const key='ecco-desk-staff-session';
const base='https://vowmjru85f2gzo-8888.proxy.runpod.net/api/auth/';
export const staffToken=()=>localStorage.getItem(key)||'';
async function api(path:string,body:unknown){
 const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(staffToken()?{Authorization:'Bearer '+staffToken()}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 const result=await r.json();if(!r.ok)throw Error(result.error||'Support sign-in failed.');return result;
}
export async function signInStaff(){
 let dialog=document.querySelector<HTMLDialogElement>('#desk-staff-signin');
 if(dialog){dialog.showModal();return;}
 dialog=document.createElement('dialog');dialog.id='desk-staff-signin';dialog.style.cssText='border:1px solid #dce0e7;border-radius:16px;padding:24px;max-width:420px;font:14px Arial,sans-serif';
 dialog.innerHTML='<form method="dialog"><button aria-label="Close support sign-in" style="float:right">×</button></form><h2>Sign in to support</h2><p>Choose support@saazztechnologies.com or your assigned support account. Your Ecco Studio customer login stays signed in.</p><div data-google-button></div><p role="status">Loading Google sign-in…</p>';
 document.body.append(dialog);dialog.addEventListener('close',()=>dialog?.remove());dialog.showModal();
 const status=dialog.querySelector('[role="status"]')!;
 try{
  if(!(window as any).google?.accounts?.id)await new Promise<void>((resolve,reject)=>{const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;script.onload=()=>resolve();script.onerror=()=>reject(Error('Google sign-in could not load.'));document.head.append(script)});
  const pending=await api('challenge',{});
  const google=(window as any).google;
  google.accounts.id.initialize({client_id:pending.client_id,nonce:pending.nonce,auto_select:false,button_auto_select:false,use_fedcm_for_button:false,callback:async(result:any)=>{
   status.textContent='Signing in…';
   try{const auth=await api('google',{credential:result.credential,challenge:pending.challenge});if(!auth.session_token||!auth.user?.id)throw Error('Invalid sign-in response.');localStorage.setItem(key,auth.session_token);dialog?.close();document.dispatchEvent(new Event('ecco:desk-auth-change'))}catch(e){status.textContent=(e as Error).message;}
  }});
  google.accounts.id.renderButton(dialog.querySelector('[data-google-button]'),{type:'standard',theme:'outline',size:'large',text:'signin_with',width:280});status.textContent='Select your support account in Google’s account chooser.';
 }catch(e){status.textContent=(e as Error).message;}
}
export async function signOutStaff(){
 if(staffToken())await api('logout',{});
 localStorage.removeItem(key);document.dispatchEvent(new Event('ecco:desk-auth-change'));await signInStaff();
}
window.addEventListener('storage',e=>{if(e.key===key)document.dispatchEvent(new Event('ecco:desk-auth-change'))});
