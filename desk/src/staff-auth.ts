// The staff identity is independent of the customer's Studio identity.
const key='ecco-desk-staff-session';
const base='https://vowmjru85f2gzo-8888.proxy.runpod.net/api/auth/';
export const staffToken=()=>localStorage.getItem(key)||'';
let revision=0;
let googleScript:Promise<void>|undefined;
async function api(path:string,body:unknown,token=staffToken()){
 const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 const result=await r.json();if(!r.ok)throw Error(result.error||'Support sign-in failed.');return result;
}
function loadGoogle(){
 if((window as any).google?.accounts?.id)return Promise.resolve();
 if(!googleScript)googleScript=new Promise<void>((resolve,reject)=>{
  const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;
  const failed=()=>{clearTimeout(timer);script.remove();reject(Error('Google sign-in could not load. Please try again.'))};
  const timer=setTimeout(failed,20000);script.onerror=failed;
  script.onload=()=>{clearTimeout(timer);(window as any).google?.accounts?.id?resolve():failed()};
  document.head.append(script);
 }).catch(e=>{googleScript=undefined;throw e});
 return googleScript;
}
export function mountStaffSignIn(host:HTMLElement,update:(message:string,failed?:boolean)=>void){
 let active=true,submitting=false;
 const attempt=revision,valid=()=>active&&attempt===revision;
 update('Loading Google sign-in…');
 void (async()=>{
  try{
   await loadGoogle();if(!valid())return;
   const pending=await api('challenge',{});if(!valid())return;
   const google=(window as any).google;
   google.accounts.id.initialize({client_id:pending.client_id,nonce:pending.nonce,auto_select:false,button_auto_select:false,use_fedcm_for_button:false,callback:async(result:any)=>{
    if(!valid()||submitting)return;submitting=true;update('Signing in…');
    try{
     const auth=await api('google',{credential:result.credential,challenge:pending.challenge});
     if(!auth.session_token||!auth.user?.id)throw Error('Invalid sign-in response.');
     if(!valid()){void api('logout',{},auth.session_token).catch(()=>{});return;}
     revision++;localStorage.setItem(key,auth.session_token);document.dispatchEvent(new Event('ecco:desk-auth-change'));
    }catch(e){if(valid())update((e as Error).message,true)}finally{submitting=false}
   }});
   google.accounts.id.renderButton(host,{type:'standard',theme:'outline',size:'large',text:'signin_with',width:280});
   update('Choose your support or administrator account.');
  }catch(e){if(valid())update((e as Error).message,true)}
 })();
 return()=>{active=false;host.replaceChildren()};
}
export function signOutStaff(){
 const token=staffToken();revision++;
 // Clear the local account immediately, even when the service is unreachable.
 localStorage.removeItem(key);document.dispatchEvent(new Event('ecco:desk-auth-change'));
 if(token)void api('logout',{},token).catch(()=>{});
}
window.addEventListener('storage',e=>{if(e.storageArea===localStorage&&(e.key===key||e.key===null)){revision++;document.dispatchEvent(new Event('ecco:desk-auth-change'))}});
