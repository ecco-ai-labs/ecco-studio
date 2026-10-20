'use strict';
/* Credit UI. Live balances require an authenticated server adapter. */
(()=>{
 const PACKS=[{id:'p500',credits:500,cents:2500},{id:'p750',credits:750,cents:5000},{id:'p1500',credits:1500,cents:10000}];
 const WARNING='You are going to run out of the credits soon, please purchase by selecting Purchase Additional Credits from the Account And Billing Menu.';
 const q=s=>document.querySelector(s),money=n=>'$'+(n/100).toFixed(2);
 let adapter=null,balance=null,used=0,pending=false,warned=false,billing={},cart={};
 let panel=null,view='usage',warning=null;
 const button=(label,fn,secondary=false)=>{const b=document.createElement('button');b.type='button';b.textContent=label;if(secondary)b.className='secondary';b.onclick=fn;return b;};
 function dialog(title){const d=document.createElement('dialog');d.className='generation-dialog credits-dialog';const head=document.createElement('div');head.className='section-head';const h=document.createElement('h2');h.textContent=title;head.append(h,button('×',()=>d.close(),false));head.lastChild.setAttribute('aria-label','Close popup');d.append(head);document.body.append(d);d.addEventListener('close',()=>d.remove(),{once:true});return d;}
 function line(host,label,value){const p=document.createElement('p');p.className='credits-line';const name=document.createElement('span'),v=document.createElement('strong');name.textContent=label;v.textContent=value;p.append(name,v);host.append(p);}
 function status(host,text){const p=document.createElement('p');p.setAttribute('role','status');p.textContent=text;host.append(p);return p;}
 function totals(){return PACKS.reduce((a,p)=>({credits:a.credits+p.credits*(cart[p.id]||0),cents:a.cents+p.cents*(cart[p.id]||0),items:a.items+(cart[p.id]||0)}),{credits:0,cents:0,items:0});}
 function noticeLow(){if(balance===null||balance>100||warned)return;warned=true;warning=dialog('Low credits');status(warning,WARNING);warning.append(button('Purchase Additional Credits',()=>{warning.close();open('shop');}));warning.showModal();}
 function render(){if(!panel)return;panel.querySelector('[data-credits-body]')?.remove();const body=document.createElement('div');body.dataset.creditsBody='';body.className='form';panel.append(body);panel.querySelector('h2').textContent=({usage:'Credits & Usage',shop:'Purchase Additional Credits',cart:'Your cart',checkout:'Checkout'})[view];
  if(view==='usage'){
   body.classList.add('credits-usage-body');
   line(body,'Starting allowance','500 credits');line(body,'Studio usage','100 credits / minute');line(body,'Available credits',balance===null?'Sign-in not connected':String(balance));line(body,'Credits used',balance===null?'—':String(used));
   if(!adapter)status(body,'Individual sign-in is not connected.');
   body.append(button('Purchase Additional Credits',()=>open('shop')));
  }
  if(view==='shop'){
   const grid=document.createElement('div');grid.className='credits-pack-grid';PACKS.forEach(p=>{const item=document.createElement('section');item.className='credits-pack';line(item,'Credits',String(p.credits));line(item,'Price',money(p.cents));item.append(button('Add to cart',()=>{cart[p.id]=(cart[p.id]||0)+1;render();}));grid.append(item);});body.append(grid);line(body,'Cart',totals().items+' items · '+money(totals().cents));body.append(button('View cart',()=>open('cart')));
  }
  if(view==='cart'||view==='checkout'){
   if(!totals().items)status(body,'Your cart is empty.');
   PACKS.filter(p=>cart[p.id]).forEach(p=>{const row=document.createElement('section');row.className='credits-cart-row';line(row,p.credits+' credits',money(p.cents*(cart[p.id]||0)));const label=document.createElement('label');label.textContent='Quantity';const input=document.createElement('input');input.type='number';input.min='1';input.max='99';input.value=cart[p.id];input.setAttribute('aria-label','Quantity for '+p.credits+' credits');input.onchange=()=>{const n=Number(input.value);if(!Number.isInteger(n)||n<1||n>99){input.value=cart[p.id];return;}cart[p.id]=n;render();};label.append(input);row.append(label,button('Remove',()=>{delete cart[p.id];render();},true));body.append(row);});
   line(body,'Total credits',String(totals().credits));line(body,'Total (USD)',money(totals().cents));body.append(button('Continue shopping',()=>open('shop'),true));
   if(view==='cart'){const checkout=button('Check out',()=>open('checkout'));checkout.disabled=!totals().items;body.append(checkout);}
   else{body.append(button('Billing Information',editBilling,true));if(billing.name)line(body,'Billing name',billing.name);status(body,'Payments are not enabled. No payment will be taken and no credits will be added.');const pay=button('Complete purchase',()=>{});pay.disabled=true;body.append(pay);}
  }
 }
 function editBilling(){const d=dialog('Billing Information'),form=document.createElement('form');form.className='form';const fields=[['name','Full name','text'],['email','Email','email'],['company','Company (optional)','text'],['address','Address','text'],['city','City','text'],['region','State / province','text'],['postal','Postal code','text'],['country','Country','text']];for(const [key,label,type] of fields){const l=document.createElement('label');l.textContent=label;const input=document.createElement('input');input.name=key;input.type=type;input.maxLength=200;input.value=billing[key]||'';input.required=key!=='company'&&key!=='region';l.append(input);form.append(l);}const save=document.createElement('button');save.type='submit';save.textContent='Save billing information';form.append(save);form.onsubmit=e=>{e.preventDefault();billing=Object.fromEntries(new FormData(form));d.close();render();};d.append(form);d.showModal();}
 function open(next='usage'){view=next;if(!panel||!panel.isConnected){panel=dialog('Credits & Usage');panel.addEventListener('close',()=>{panel=null;});render();panel.showModal();}else render();}
 async function tick(){
  if(!adapter||pending)return;pending=true;try{const result=await adapter.heartbeat();if(!Number.isFinite(result.balance)||result.balance<0)throw Error('Invalid credit balance');balance=result.balance;used=result.used;if(view==='usage')render();noticeLow();}catch(e){if(panel&&view==='usage'){render();status(panel.querySelector('[data-credits-body]'),'Credit balance could not be refreshed.');}}finally{pending=false;}
 }
 function mount(){const old=q('#workspace-credits');if(old&&!old.dataset.creditStore){old.dataset.creditStore='true';old.onclick=()=>{old.closest('details').open=false;open();};}const menu=q('[data-category="Account"] .workspace-menu-items');if(menu&&!q('#purchase-additional-credits')){const buy=button('Purchase Additional Credits',()=>{menu.closest('details').open=false;open('shop');});buy.id='purchase-additional-credits';menu.append(buy);}}
 const style=document.createElement('style');style.textContent='.credits-dialog{color:var(--text,#eeebf5);background:var(--panel,#242147)}.credits-line{display:flex;justify-content:space-between;gap:16px;margin:5px 0}.credits-pack-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.credits-pack,.credits-cart-row{padding:12px;border:1px solid var(--border,#51496f);border-radius:8px}.credits-pack button{width:100%;margin-top:10px}.credits-cart-row{display:grid;gap:8px}.credits-dialog>.section-head>button{width:26px;height:26px;padding:0;background:#ffdc24;color:#211b33;font-size:20px}.credits-dialog [role=status]{font-size:12px}.credits-dialog input{min-width:0}.credits-dialog>.credits-usage-body{padding-top:1em;gap:.5em}.credits-usage-body>.credits-line,.credits-usage-body>[role=status]{margin:0}@media(max-width:560px){.credits-pack-grid{grid-template-columns:1fr}}';document.head.append(style);
 let queued=false;new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;mount();});}).observe(document.body,{childList:true,subtree:true});mount();setInterval(tick,1000);
 window.EccoCredits={open,async connect(authenticatedAdapter){if(!authenticatedAdapter||typeof authenticatedAdapter.heartbeat!=='function')throw Error('Authenticated credit service required');adapter=authenticatedAdapter;warned=false;await tick();},disconnect(){adapter=null;balance=null;used=0;warned=false;if(panel)render();}};
})();
