'use strict';
/* Credit UI. Live balances require an authenticated server adapter. */
(()=>{
 const PACKS=[{id:'p500',credits:500,cents:2500},{id:'p750',credits:750,cents:5000},{id:'p1500',credits:1500,cents:10000}];
 const WARNING='You are going to run out of the credits soon, please purchase by selecting Purchase Additional Credits from the Account And Billing Menu.';
 const q=s=>document.querySelector(s),money=n=>'$'+(n/100).toFixed(2);
 let adapter=null,balance=null,used=0,pending=false,warned=false,billing={},cart={},cartMessage='';
 let panel=null,view='usage',warning=null,usageDrawer=null,usageTrigger=null;
 const button=(label,fn,secondary=false)=>{const b=document.createElement('button');b.type='button';b.textContent=label;if(secondary)b.className='secondary';b.onclick=fn;return b;};
 function dialog(title){const d=document.createElement('dialog');d.className='generation-dialog credits-dialog';const head=document.createElement('div');head.className='section-head';const h=document.createElement('h2');h.textContent=title;head.append(h,button('×',()=>d.close(),false));head.lastChild.setAttribute('aria-label','Close popup');d.append(head);document.body.append(d);d.addEventListener('close',()=>d.remove(),{once:true});return d;}
 function line(host,label,value){const p=document.createElement('p');p.className='credits-line';const name=document.createElement('span'),v=document.createElement('strong');name.textContent=label;v.textContent=value;p.append(name,v);host.append(p);}
 function status(host,text){const p=document.createElement('p');p.setAttribute('role','status');p.textContent=text;host.append(p);return p;}
 function notices(){return (window.EccoNotifications?.snapshot('billing').notifications||[]).filter(n=>!n.expiresAt||Date.parse(n.expiresAt)>Date.now());}
 function offers(){return notices().filter(n=>n.kind==='special_offer'&&n.severity==='informational'&&n.offer&&Number.isSafeInteger(n.offer.credits)&&n.offer.credits>0&&Number.isSafeInteger(n.offer.bonusCredits)&&n.offer.bonusCredits>=0&&Number.isSafeInteger(n.offer.cents)&&n.offer.cents>0).map(n=>({id:'offer:'+n.id,title:n.title,description:n.body,credits:n.offer.credits+n.offer.bonusCredits,baseCredits:n.offer.credits,bonusCredits:n.offer.bonusCredits,cents:n.offer.cents}));}
 function products(){return [...PACKS,...offers()];}
 function totals(){return products().reduce((a,p)=>({credits:a.credits+p.credits*(cart[p.id]||0),cents:a.cents+p.cents*(cart[p.id]||0),items:a.items+(cart[p.id]||0)}),{credits:0,cents:0,items:0});}
 function noticeLow(){if(balance===null||balance>100||warned)return;warned=true;warning=dialog('Low credits');status(warning,WARNING);warning.append(button('Purchase Additional Credits',()=>{warning.close();open('shop');}));warning.showModal();}
 function balanceLabel(){
  if(balance!==null)return String(balance);
  if(adapter&&pending)return 'Loading…';
  return window.EccoAuth?.user?'Unavailable':'Sign in to view';
 }
 function heading(host,text){const h=document.createElement('h3');h.textContent=text;host.append(h);}
 function selectPack(p){cart={[p.id]:1};cartMessage='';render();}
 function packCard(p){
  const item=document.createElement('section');item.className='credits-pack';item.dataset.selected=String(!!p&&!!cart[p.id]);
  heading(item,p.credits.toLocaleString()+' credits');
  const details=document.createElement('div');details.className='credits-pack-details';
  line(details,'Price',money(p.cents));
  const select=button(p&&cart[p.id]?'✓ Selected':'Select',()=>selectPack(p));select.disabled=!p;select.dataset.creditFocus=p?.id||'special-offer';select.setAttribute('aria-pressed',String(!!p&&!!cart[p.id]));
  item.append(details,select);return item;
 }
 function readAction(n,card){
  const read=button(n.readAt?'Read':'Mark as Read',async()=>{
   const focused=document.activeElement===read,container=card.closest('.credits-dialog,#workspace-billing-drawer,#workspace-usage-drawer');read.disabled=true;
   const ok=await window.EccoNotifications.markRead(n.id);
   if(ok&&focused&&n.kind==='marketing_campaign'){
    const current=Array.from((container||document).querySelectorAll('.credits-promotion')).find(el=>el.dataset.noticeId===n.id&&el.getClientRects().length);
    const title=current?.querySelector('h3');if(title){title.tabIndex=-1;title.focus();}
   }
   if(!ok&&card.isConnected){read.disabled=false;status(card,'Could not mark as read. Please try again.');}
  },true);
  read.disabled=!!n.readAt;read.dataset.creditFocus='read:'+n.id;return read;
 }
 function billingNotices(allowSelection=false){
  const upcoming=(window.EccoNotifications?.snapshot('billing').upcomingCampaigns||[]).filter(n=>Date.parse(n.expiresAt)>Date.now());
  const rows=notices();if(!rows.length&&!upcoming.length)return null;
  const section=document.createElement('section');section.className='credits-notices';section.setAttribute('aria-label','Offers and announcements');
  upcoming.forEach(n=>{
   const card=document.createElement('article');card.className='credits-promotion';card.dataset.campaignId=n.campaignId;card.dataset.noticeId=n.id;card.dataset.state='upcoming';card.dataset.read=String(!!n.readAt);
   const head=document.createElement('div');head.className='credits-promotion-heading';
   const state=document.createElement('span');state.className='credits-promotion-badge';state.textContent='Upcoming';head.append(state);
   if(n.badge&&n.badge!=='Upcoming'){const badge=document.createElement('span');badge.className='credits-promotion-badge';badge.textContent=n.badge;head.append(badge);}
   heading(head,n.title);card.append(head);const message=document.createElement('p');message.className='credits-promotion-message';message.textContent=n.body;card.append(message);
   for(const [label,value] of [['Starts ',n.startsAt],['Offer lasts till ',n.expiresAt]]){
    const date=document.createElement('p');date.className='credits-promotion-expiry';const time=document.createElement('time');time.dateTime=value;
    time.textContent=new Date(value).toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:n.timezone||undefined,timeZoneName:'short'});date.append(label,time);card.append(date);
   }
   if(Date.parse(n.startsAt)<=Date.now()){const pending=document.createElement('p');pending.className='credits-promotion-expiry';pending.textContent='Starting soon';card.append(pending);}
   if(window.EccoNotifications?.snapshot('billing').campaignReadVersion===1&&window.EccoNotifications?.markRead){const actions=document.createElement('div');actions.className='credits-promotion-actions';actions.append(readAction(n,card));card.append(actions);}
   section.append(card);
  });
  rows.sort((a,b)=>Number(b.kind==='special_offer'||b.kind==='marketing_campaign')-Number(a.kind==='special_offer'||a.kind==='marketing_campaign')).forEach(n=>{
   const card=document.createElement('article');card.className='credits-promotion';card.dataset.noticeId=n.id;card.dataset.severity=n.severity;
   if(n.kind==='marketing_campaign')card.dataset.read=String(!!n.readAt);
   const head=document.createElement('div');head.className='credits-promotion-heading';
   if(n.kind==='special_offer'||n.kind==='marketing_campaign'){const icon=document.createElement('span');icon.className='credits-promotion-badge';icon.textContent=n.badge||'NEW';head.append(icon);}
   heading(head,n.title);card.append(head);const message=document.createElement('p');message.className='credits-promotion-message';message.textContent=n.body;card.append(message);
   const expires=document.createElement('p');expires.className='credits-promotion-expiry';
   if(n.expiresAt){const time=document.createElement('time');time.dateTime=n.expiresAt;time.textContent=new Date(n.expiresAt).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});expires.append('Offer lasts till ',time);}else expires.textContent='Available until read';
   if(n.kind!=='special_offer'&&n.kind!=='marketing_campaign'&&n.expiresAt)expires.firstChild.textContent='Expires ';
   card.append(expires);
   const p=offers().find(p=>p.id==='offer:'+n.id),actions=document.createElement('div');actions.className='credits-promotion-actions';
   if(p){line(card,'Credits',p.baseCredits+' + '+p.bonusCredits+' free');line(card,'Price',money(p.cents));const select=button(cart[p.id]?'✓ Selected':'Select',()=>selectPack(p));select.dataset.creditFocus=p.id;select.setAttribute('aria-label','Select '+p.title);select.setAttribute('aria-pressed',String(!!cart[p.id]));card.dataset.selected=String(!!cart[p.id]);if(allowSelection)actions.append(select);}
   if(window.EccoNotifications?.markRead)actions.append(readAction(n,card));
   if(actions.children.length)card.append(actions);section.append(card);
  });return section;
 }
 function refreshBillingNotices(){
  const drawer=q('#workspace-billing-drawer');if(!drawer)return;
  let host=drawer.querySelector('[data-billing-promotions]');if(!host){host=document.createElement('div');host.dataset.billingPromotions='';drawer.prepend(host);}
  host.replaceChildren();const cards=billingNotices();drawer.classList.toggle('has-promotions',!!cards);
  if(cards){host.append(cards,button('Purchase Additional Credits',()=>{window.EccoBilling?.close();const menu=drawer.closest('details');if(menu)menu.open=false;open('shop');}));}
 }
 function refreshUsageNotices(){if(!usageDrawer)return;usageDrawer.querySelector('.credits-notices')?.remove();const notices=billingNotices();if(notices)usageDrawer.querySelector('.credits-usage-body').prepend(notices);}
 function render(){if(!panel)return;
  const focus=panel.contains(document.activeElement)?document.activeElement.dataset.creditFocus:null;
  panel.querySelector('[data-credits-body]')?.remove();const body=document.createElement('div');body.dataset.creditsBody='';body.className='form';panel.append(body);
  const title=panel.querySelector('h2');title.textContent=({usage:'Credits and Usage',shop:'Purchase Additional Credits',cart:'Your Cart',checkout:'Checkout'})[view];title.tabIndex=-1;
  if(view==='usage'){
   const notices=billingNotices();if(notices)body.append(notices);
   body.classList.add('credits-usage-body');
   line(body,'Starting allowance','500 credits');line(body,'Studio usage','100 credits / minute');line(body,'Available credits',balanceLabel());line(body,'Credits used',balance===null?'—':String(used));
   body.append(button('Purchase Additional Credits',()=>open('shop')));
  }else{const divider=document.createElement('hr');divider.className='credits-divider';body.append(divider);}
  if(cartMessage)status(body,cartMessage);
  if(view==='shop'){
   const notices=billingNotices(true);if(notices)body.append(notices);
   heading(body,'Regular Credit Options');
   const grid=document.createElement('div');grid.className='credits-pack-grid';grid.setAttribute('aria-label','Choose one credit package');
   PACKS.forEach(p=>grid.append(packCard(p)));body.append(grid);
   const footer=document.createElement('div');footer.className='credits-shop-footer';
   const selection=status(footer,totals().items?totals().credits.toLocaleString()+' credits · '+money(totals().cents):'Select one credit package.');selection.setAttribute('aria-live','polite');
   const viewCart=button('View Cart',()=>open('cart'));viewCart.disabled=!totals().items;viewCart.dataset.creditFocus='view-cart';footer.append(viewCart);body.append(footer);
  }
  if(view==='cart'||view==='checkout'){
   const layout=document.createElement('div');layout.className='credits-cart-layout';const list=document.createElement('div');list.className='credits-cart-items';layout.append(list);
   if(!totals().items)status(list,'Your cart is empty.');
   products().filter(p=>cart[p.id]).forEach(p=>{
    const row=document.createElement('section');row.className='credits-cart-row';const details=document.createElement('div');details.className='credits-cart-details';
    heading(details,p.title||p.credits.toLocaleString()+' credits');
    status(details,p.baseCredits?p.baseCredits+' credits + '+p.bonusCredits+' free': 'Credit package');
    status(details,money(p.cents)+' each');
    const controls=document.createElement('div');controls.className='credits-item-controls';const label=document.createElement('label');label.textContent='Quantity';
    const input=document.createElement('select');for(let n=1;n<=99;n++){const o=document.createElement('option');o.value=n;o.textContent=n;input.append(o);}input.value=cart[p.id];input.setAttribute('aria-label','Quantity for '+p.credits+' credits');input.dataset.creditFocus='quantity';
    input.onchange=()=>{const n=Number(input.value);if(Number.isInteger(n)&&n>=1&&n<=99){cart[p.id]=n;render();}};
    label.append(input);const remove=button('Remove',()=>{delete cart[p.id];render();panel.querySelector('h2').focus();},true);controls.append(label,remove);details.append(controls);
    const price=document.createElement('strong');price.className='credits-item-price';price.textContent=money(p.cents*cart[p.id]);row.append(details,price);list.append(row);
   });
   list.append(button('Continue Shopping',()=>open('shop'),true));
   const summary=document.createElement('section');summary.className='credits-order-summary';summary.setAttribute('aria-label','Order summary');heading(summary,'Order Summary');
   line(summary,'Items ('+totals().items+')',money(totals().cents));line(summary,'Total credits',totals().credits.toLocaleString());
   const total=document.createElement('div');total.className='credits-order-total';line(total,'Order total (USD)',money(totals().cents));summary.append(total);
   if(view==='cart'){const checkout=button('Proceed to Checkout',()=>open('checkout'));checkout.disabled=!totals().items;summary.append(checkout);}
   else{list.append(button('Billing Information',editBilling,true));if(billing.name)line(list,'Billing name',billing.name);status(summary,'Payments are not enabled. No payment will be taken and no credits will be added.');const pay=button('Complete purchase',()=>{});pay.disabled=true;summary.append(pay);}
   layout.append(summary);body.append(layout);
  }
  if(focus)Array.from(panel.querySelectorAll('[data-credit-focus]')).find(el=>el.dataset.creditFocus===focus)?.focus();
 }
 function editBilling(){const d=dialog('Billing Information'),form=document.createElement('form');form.className='form credits-billing-form';const fields=[['name','Full name','text'],['email','Email','email'],['company','Company (optional)','text'],['address','Address','text'],['city','City','text'],['region','State / province','text'],['postal','Postal code','text'],['country','Country','text']];for(const [key,label,type] of fields){const l=document.createElement('label');l.textContent=label;const input=document.createElement('input');input.name=key;input.type=type;input.maxLength=200;input.value=billing[key]||'';input.required=key!=='company'&&key!=='region';l.append(input);form.append(l);}const save=document.createElement('button');save.type='submit';save.textContent='Save billing information';form.append(save);form.onsubmit=e=>{e.preventDefault();billing=Object.fromEntries(new FormData(form));d.close();render();};d.append(form);d.showModal();}
 function closeUsage(refocus=false){
  if(!usageDrawer)return;
  const drawer=usageDrawer,trigger=usageTrigger;
  // Removing a focused child can synchronously fire focusout and reenter this handler.
  // Clear ownership first so the same drawer is never removed twice.
  usageDrawer=null;usageTrigger=null;trigger?.setAttribute('aria-expanded','false');
  drawer.remove();if(refocus)trigger?.focus();
 }
 function updateUsage(){
  if(!usageDrawer)return;
  usageDrawer.querySelector('[data-credit-balance]').textContent=balanceLabel();
  usageDrawer.querySelector('[data-credit-used]').textContent=balance===null?'—':String(used);
 }
 function openUsage(trigger,fromHover=false){
  // Once a panel is open, crossing another row must not replace it. Click to switch.
  if(fromHover&&(usageDrawer||q('#workspace-billing-drawer:not([hidden])')))return;
  const menu=trigger.closest('.workspace-menu-items');if(!menu)return;
  window.EccoBilling?.close();
  if(usageDrawer&&usageTrigger===trigger)return;
  closeUsage();usageTrigger=trigger;
  usageDrawer=document.createElement('div');usageDrawer.id='workspace-usage-drawer';usageDrawer.className='credits-dialog credits-usage-drawer';usageDrawer.setAttribute('role','region');usageDrawer.setAttribute('aria-label','Credits and Usage');
  const head=document.createElement('div');head.className='section-head';const title=document.createElement('h2');title.textContent='Credits and Usage';head.append(title);usageDrawer.append(head);
  const body=document.createElement('div');body.className='form credits-usage-body';line(body,'Starting allowance','500 credits');line(body,'Studio usage','100 credits / minute');line(body,'Available credits','');body.lastChild.querySelector('strong').dataset.creditBalance='';line(body,'Credits used','');body.lastChild.querySelector('strong').dataset.creditUsed='';body.append(button('Purchase Additional Credits',()=>open('shop')));usageDrawer.append(body);menu.append(usageDrawer);trigger.setAttribute('aria-expanded','true');updateUsage();refreshUsageNotices();window.EccoNotifications?.refresh();
  if(!menu.dataset.usageDrawerBound){
   menu.dataset.usageDrawerBound='true';
   menu.addEventListener('focusout',event=>{if(usageDrawer?.parentElement===menu&&event.relatedTarget&&!menu.closest('details')?.contains(event.relatedTarget))closeUsage();});
   menu.addEventListener('keydown',event=>{if(usageDrawer?.parentElement===menu&&(event.key==='Escape'||event.key==='ArrowRight')){event.preventDefault();event.stopPropagation();closeUsage(true);}});
   menu.closest('details')?.addEventListener('toggle',()=>{if(!menu.closest('details').open&&usageDrawer?.parentElement===menu)closeUsage();});
  }
 }
 function open(next='usage',trigger,{hover=false}={}){
  if(next==='usage'&&trigger)return openUsage(trigger,hover);
  const menu=usageTrigger?.closest('details');closeUsage();if(menu)menu.open=false;
  view=next;if(!panel||!panel.isConnected){panel=dialog('Credits and Usage');panel.addEventListener('close',()=>{panel=null;});render();panel.showModal();}else{render();panel.querySelector('h2').focus();}if(next==='shop')window.EccoNotifications?.refresh();
 }
 async function tick(){
  if(!adapter||pending)return;pending=true;try{const result=await adapter.heartbeat();if(!Number.isFinite(result.balance)||result.balance<0)throw Error('Invalid credit balance');balance=result.balance;used=result.used;if(view==='usage')render();updateUsage();noticeLow();}catch(e){if(panel&&view==='usage'){render();status(panel.querySelector('[data-credits-body]'),'Credit balance could not be refreshed.');}if(usageDrawer){usageDrawer.querySelector('[data-credit-balance]').textContent='Could not refresh';}}finally{pending=false;}
 }
 function mount(){if(q('#workspace-billing-drawer')&&!q('#workspace-billing-drawer [data-billing-promotions]'))refreshBillingNotices();const old=q('#workspace-credits');if(old&&!old.dataset.creditStore){old.dataset.creditStore='true';old.textContent='Credits and Usage';old.dataset.userFlyout='usage';old.setAttribute('aria-controls','workspace-usage-drawer');old.setAttribute('aria-expanded','false');old.onclick=()=>open('usage',old);old.addEventListener('pointerenter',()=>open('usage',old,{hover:true}));old.addEventListener('keydown',event=>{if(event.key==='ArrowLeft'){event.preventDefault();open('usage',old);usageDrawer?.querySelector('button')?.focus();}});}q('#purchase-additional-credits')?.remove();}
 const style=document.createElement('style');style.textContent='.credits-dialog{color:var(--text,#eeebf5);background:var(--panel,#242147)}.credits-line{display:flex;justify-content:space-between;gap:14px;margin:5px 0}.credits-pack-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.credits-pack,.credits-cart-row{padding:10px;border:1px solid var(--border,#51496f);border-radius:8px}.credits-pack button{width:100%;margin-top:10px}.credits-dialog>.section-head>button{width:26px;height:26px;padding:0;background:#ffdc24;color:#211b33;font-size:calc(20px - 2pt)}.credits-dialog [role=status]{font-size:calc(12px - 2pt)}.credits-dialog input{min-width:0}.credits-dialog>.credits-billing-form{padding-top:1em}.credits-dialog>.credits-usage-body{padding-top:1em;gap:.5em}.credits-usage-body>.credits-line,.credits-usage-body>[role=status]{margin:0}';document.head.append(style);
 const shopStyle=document.createElement('style');shopStyle.textContent=`
 .credits-notices{display:grid;gap:10px;min-width:0;margin-bottom:8px}
 .credits-promotion{padding:12px;border:1px solid var(--ecco-theme-border,var(--border,#51496f));border-radius:8px;min-width:0}
 .credits-promotion-heading{display:flex;align-items:center;flex-wrap:wrap;gap:6px}
 .credits-promotion-badge{display:inline-flex;align-items:center;border-radius:4px;padding:3px 5px;background:var(--ecco-theme-accent,var(--accent,#ffdc24));color:var(--ecco-theme-contrast,#211b33);font-size:calc(11px - 2pt);font-weight:700;max-width:100%;overflow-wrap:anywhere}
 .credits-promotion-message{font-size:calc(13px - 2pt);white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0 8px}
 .credits-promotion[data-read=false] h3,.credits-promotion[data-read=false] .credits-promotion-message{font-weight:700}
 .credits-promotion[data-read=true] h3,.credits-promotion[data-read=true] .credits-promotion-message,.credits-promotion[data-read=true] .credits-promotion-badge{font-weight:400}
 .credits-promotion-expiry{font-size:calc(12px - 2pt);margin:0 0 10px;color:var(--ecco-theme-muted,var(--muted,#c6c2d5))}
 .credits-promotion-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.credits-promotion-actions button{width:auto}
 .credits-promotion[data-selected=true]{border-color:var(--ecco-theme-accent,var(--accent,#ffdc24));box-shadow:inset 0 0 0 1px var(--ecco-theme-accent,var(--accent,#ffdc24))}
 #workspace-billing-drawer.has-promotions{width:360px;max-width:calc(100vw - 32px);justify-content:flex-start;max-height:80dvh;overflow:auto}
 #workspace-billing-drawer .credits-notices{max-height:50dvh;overflow:auto}
 #workspace-billing-drawer .credits-promotion h3{font-size:calc(14px - 2pt);margin:0;overflow-wrap:anywhere}
 #workspace-billing-drawer .credits-promotion-expiry{font-size:calc(12px - 2pt)}
 #workspace-billing-drawer [data-billing-promotions]>button{width:100%;font-size:calc(12px - 2pt)}
 #workspace-usage-drawer .credits-notices{max-width:340px;max-height:45dvh;overflow:auto}
 .credits-divider{width:100%;border:0;border-top:1px solid var(--ecco-theme-border,var(--border,#51496f));margin:0 0 4px}
 .credits-dialog h3{font-size:calc(14px - 2pt);line-height:1.4;margin:0;overflow-wrap:anywhere}
 .credits-pack{display:flex;flex-direction:column;gap:8px;min-width:0}
 .credits-pack-details{flex:1}.credits-pack-details h3{font-size:calc(13px - 2pt)}.credits-pack-details [role=status]{white-space:pre-wrap;overflow-wrap:anywhere}
 .credits-pack .credits-line{flex-wrap:wrap;gap:4px}.credits-pack[data-selected=true]{border-color:var(--ecco-theme-accent,var(--accent,#ffdc24));box-shadow:inset 0 0 0 1px var(--ecco-theme-accent,var(--accent,#ffdc24))}
 .credits-shop-footer{display:flex;align-items:center;justify-content:space-between;gap:10px}.credits-shop-footer>button{width:auto}
 .credits-cart-layout{display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:18px;align-items:start}
 .credits-cart-items{display:grid;gap:14px;min-width:0}.credits-cart-items>button{justify-self:start;width:auto}
 .credits-cart-row{display:flex;justify-content:space-between;gap:14px}.credits-cart-details{min-width:0}.credits-item-price{white-space:nowrap}
 .credits-item-controls{display:flex;align-items:end;gap:10px;margin-top:14px}.credits-item-controls label{display:flex;align-items:center;gap:6px;margin:0}.credits-item-controls select{width:auto;min-width:56px}.credits-item-controls button{width:auto}
 .credits-order-summary{padding:14px;border:1px solid var(--ecco-theme-border,var(--border,#51496f));border-radius:8px;display:grid;gap:10px}.credits-order-total{border-top:1px solid var(--ecco-theme-border,var(--border,#51496f));padding-top:10px;font-weight:700}
 .credits-order-summary>button{width:100%}
 .credits-dialog [data-credits-body] button:not(:disabled):hover{filter:none;box-shadow:none}
 @media(max-width:740px){.credits-pack-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.credits-cart-layout{grid-template-columns:1fr}}
 @media(max-width:420px){.credits-pack-grid{grid-template-columns:1fr}.credits-shop-footer{flex-wrap:wrap}}
 `;document.head.append(shopStyle);
 let lastOffers='';document.addEventListener('ecco:notifications-change',()=>{
  const snapshot=window.EccoNotifications?.snapshot('billing'),key=JSON.stringify(snapshot);if(key===lastOffers)return;lastOffers=key;
  const valid=new Set(products().map(p=>p.id));for(const id of Object.keys(cart))if(!valid.has(id)){delete cart[id];cartMessage='The special offer is no longer available. Please select another package.';}
  if(panel)render();refreshUsageNotices();refreshBillingNotices();
 });
 let queued=false;new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;mount();});}).observe(document.body,{childList:true,subtree:true});mount();setInterval(tick,1000);
 const flyoutStyle=document.createElement('style');flyoutStyle.textContent='#workspace-usage-drawer{position:absolute;left:auto;right:100%;top:0;box-sizing:border-box;width:max-content;max-width:calc(100vw - 32px);padding:10px;border:1px solid var(--ecco-theme-border,#48405c);border-radius:9px;box-shadow:0 12px 32px #0006;color:var(--ecco-theme-text,var(--text,#eeebf5));background:var(--ecco-theme-surface,var(--panel,#252039));z-index:2;animation:credits-slide-left .2s ease}#workspace-usage-drawer .section-head{margin:0;gap:14px}#workspace-usage-drawer h2{font-size:calc(13px - 2pt);margin:0}#workspace-usage-drawer .credits-line{font-size:calc(13px - 2pt)}#workspace-usage-drawer>.credits-usage-body{display:flex;flex-direction:column;gap:.5em;padding-top:1em}#workspace-usage-drawer .credits-usage-body>button{min-height:30px;padding:4px 8px;font-size:calc(12px - 2pt);background:var(--ecco-theme-accent,var(--accent,#ffdc24))!important;color:var(--ecco-theme-contrast,#211b3c)!important;filter:none!important;box-shadow:none!important}html:is([data-ecco-theme="ocean"],[data-ecco-theme="dark-sky"]) #workspace-usage-drawer .credits-usage-body>button{background:var(--ecco-theme-control)!important;color:var(--ecco-theme-text)!important;box-shadow:inset 0 0 0 1px var(--ecco-theme-border)!important}@keyframes credits-slide-left{from{clip-path:inset(0 0 0 100%)}to{clip-path:inset(0)}}@media(prefers-reduced-motion:reduce){#workspace-usage-drawer{animation:none}}';document.head.append(flyoutStyle);
 document.addEventListener('ecco:auth-change',()=>{cart={};billing={};cartMessage='';updateUsage();if(panel)render();});
 window.EccoCredits={open,closeUsage,async connect(authenticatedAdapter){if(!authenticatedAdapter||typeof authenticatedAdapter.heartbeat!=='function')throw Error('Authenticated credit service required');adapter=authenticatedAdapter;warned=false;await tick();},disconnect(){closeUsage();adapter=null;balance=null;used=0;warned=false;if(panel)render();}};
})();
