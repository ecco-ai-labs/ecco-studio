'use strict';
/* Review page (Image Level 4, IMG-4.4; 21 Nov 2026). Opened from a link the owner shares from Image Studio:
   review.html#t=<token>. Shows only the pictures in that review; a click pins a comment to that spot.
   The token travels in the fragment, so it is never sent in a Referer or kept in server logs. */
(function(){
 const STORAGE='https://cb9x2l5ao7p3op-8888.proxy.runpod.net',NAME='ecco-review-name';
 const params=new URLSearchParams(location.hash.slice(1)),token=params.get('t')||'';
 // A different storage service is allowed only on RunPod's https proxy (tests use the local fixture host).
 const given=params.get('e')||'',endpoint=/^https:\/\/[a-z0-9]+-\d+\.proxy\.runpod\.net$/.test(given)||/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(given)?given:STORAGE;
 const root=document.getElementById('review'),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let data=null,draft=null,sending=false;const urls={};
 const where=(x,y)=>{const v=y<1/3?'top':y>2/3?'bottom':'middle',h=x<1/3?'left':x>2/3?'right':'centre';return v==='middle'&&h==='centre'?'centre':v==='middle'?h+' side':v+' '+h;};
 async function call(path,body){
  const r=await fetch(endpoint+'/api/review/public/'+encodeURIComponent(token)+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
  const out=r.headers.get('Content-Type')?.includes('json')?await r.json():null;if(!r.ok)throw Error(out?.error||'The review could not be reached.');return out;
 }
 async function picture(id){
  if(urls[id])return urls[id];
  const r=await fetch(endpoint+'/api/review/public/'+encodeURIComponent(token)+'/media/'+encodeURIComponent(id));if(!r.ok)throw Error('A picture could not be loaded.');
  urls[id]=URL.createObjectURL(await r.blob());return urls[id];
 }
 function fail(message){root.innerHTML='<div class="rv-error" role="alert"><h1>This review is not available</h1><p>'+esc(message)+'</p><p class="help">Ask the person who shared it for a new link.</p></div>';}
 function render(){
  const focus=document.activeElement?.id,value=document.activeElement?.value;
  root.innerHTML='<h1>'+esc(data.title)+'</h1><p class="help">Click a spot on a picture to leave a comment there. Open until '+esc(new Date(data.expires*1000).toLocaleDateString())+'.</p>'+
   data.pictures.map((p,i)=>{const list=data.comments.filter(c=>c.asset_id===p.id),d=draft&&draft.asset_id===p.id?draft:null;
    return '<section class="rv-picture" aria-label="Picture '+(i+1)+': '+esc(p.title)+'"><h2 class="help">Picture '+(i+1)+' · '+esc(p.title)+'</h2><div class="rv-stage" data-id="'+esc(p.id)+'"><img alt="Picture '+(i+1)+': '+esc(p.title)+'" data-src="'+esc(p.id)+'">'+
     list.map((c,n)=>'<span class="rv-pin" style="left:'+c.x*100+'%;top:'+c.y*100+'%" aria-hidden="true">'+(n+1)+'</span>').join('')+(d?'<span class="rv-pin draft" style="left:'+d.x*100+'%;top:'+d.y*100+'%" aria-hidden="true">'+(list.length+1)+'</span>':'')+'</div>'+
     (d?'<div class="rv-form" role="group" aria-label="New comment"><label>Comment '+(list.length+1)+' · '+esc(where(d.x,d.y))+'<input id="rv-text" maxlength="500" placeholder="For example: make the price bigger"></label><label>Your name<input id="rv-name" maxlength="60" value="'+esc(localStorage.getItem(NAME)||'')+'"></label><button type="button" data-act="send"'+(sending?' disabled':'')+'>'+(sending?'Sending…':'Add comment')+'</button><button type="button" class="secondary" data-act="cancel">Cancel</button></div>':'')+
     (list.length?'<ol>'+list.map(c=>'<li><strong>'+esc(c.name)+'</strong> · '+esc(where(c.x,c.y))+': '+esc(c.text)+'</li>').join('')+'</ol>':'<p class="help">No comments yet.</p>')+'</section>';}).join('');
  for(const im of root.querySelectorAll('img[data-src]'))picture(im.dataset.src).then(u=>{im.src=u;}).catch(()=>{im.alt='This picture could not be loaded.';});
  const el=focus&&document.getElementById(focus);if(el){el.focus();if(typeof value==='string')el.value=value;}else document.getElementById('rv-text')?.focus();
 }
 root.addEventListener('click',async e=>{
  const b=e.target.closest('button[data-act]');
  if(b){
   if(b.dataset.act==='cancel'){draft=null;render();return;}
   const text=document.getElementById('rv-text')?.value.trim(),name=document.getElementById('rv-name')?.value.trim();if(!text||!draft)return;
   try{localStorage.setItem(NAME,name||'');}catch{}
   sending=true;render();document.getElementById('rv-text').value=text;
   try{const c=await call('/comment',{...draft,text,name});data.comments.push(c);draft=null;}catch(error){alertBox(error.message);}finally{sending=false;render();}
   return;
  }
  const stage=e.target.closest('.rv-stage');if(!stage||e.target.tagName!=='IMG')return;
  const r=e.target.getBoundingClientRect();draft={asset_id:stage.dataset.id,x:Math.round((e.clientX-r.left)/r.width*1000)/1000,y:Math.round((e.clientY-r.top)/r.height*1000)/1000};render();
 });
 root.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.id==='rv-text'){e.preventDefault();root.querySelector('button[data-act=send]')?.click();}});
 function alertBox(message){const p=document.createElement('p');p.className='rv-error';p.setAttribute('role','alert');p.textContent=message;root.prepend(p);setTimeout(()=>p.remove(),6000);}
 if(!/^[A-Za-z0-9_-]{24,64}$/.test(token))fail('The link is incomplete.');
 else call('').then(d=>{data=d;render();}).catch(error=>fail(error.message));
})();
