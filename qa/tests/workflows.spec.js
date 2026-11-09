import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const librarySelectors={image:'#image-library-nav > details > summary',audio:'#workspace-audio-library > summary',video:'#workspace-video-library > summary',story:'.project > details > summary',workflow:'#workflow-library > summary'};
async function boot(page,options={}){
  const errors=[];page.on('pageerror',error=>errors.push(error.message));page.qaErrors=errors;
  // A second network boundary: even fixture mistakes cannot reach production services.
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    return url.hostname==='127.0.0.1'?route.continue():route.abort('blockedbyclient');
  });
  if(options.pdf)await page.route('https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/**',async route=>{
    const asset=new URL(route.request().url()).pathname.split('/pdfjs-dist@6.4.299/')[1];
    if(!['build/pdf.min.mjs','build/pdf.worker.min.mjs','web/pdf_viewer.css'].includes(asset))return route.abort();
    await route.fulfill({body:await readFile(new URL('../node_modules/pdfjs-dist/'+asset,import.meta.url)),contentType:asset.endsWith('.css')?'text/css':'application/javascript',headers:{'Access-Control-Allow-Origin':'*'}});
  });
  await page.goto('/?__qa=1&theme='+(options.theme||'default')+'&sourceFit='+(options.sourceFit||'')+(options.pdf?'&pdf=1':''));
  await page.waitForFunction(()=>window.__qaReady);
  await expect(page.locator('#entry-tell-story')).toBeEnabled();
  if(options.enter!==false){
    await page.locator('#entry-tell-story').click();
    await page.getByRole('button',{name:'New Story',exact:true}).click();
    if(!options.landing)await page.locator('[data-story-destination="story-setup"]').click();
  }
}
async function fillStoryDetail(page,name,value){
 if(name==='output')await page.locator('#story-simple-details input[name=output][value="'+value+'"]').check();
 else if(['type','genre'].includes(name)){await page.locator('#story-detail-'+name+'-button').click();await page.locator('#story-detail-'+name+'-panel [data-choice-value='+JSON.stringify(value)+']').click();}
 else await page.locator('#story-simple-details [name='+name+']').selectOption(value);
}
async function setScript(page,text){await page.getByRole('tab',{name:'4. Script',exact:true}).click();await page.locator('#story-simple-script').fill(text);}
async function scriptStep(page){await page.getByRole('tab',{name:'4. Script',exact:true}).click();await expect(page.locator('#story-simple-script')).toBeVisible();}
async function charactersStep(page){await page.getByRole('tab',{name:'3. Characters',exact:true}).click();await expect(page.getByRole('tablist',{name:'Story characters',exact:true})).toBeVisible();}
async function openLibrary(page,kind,{keepView=false}={}){
  const group=page.locator('#workspace-library-group');
  if(await group.getAttribute('open')===null)await group.locator(':scope > summary').click();
  await page.locator('#library-hub-nav [data-lib="'+kind+'"]').click();
  const hub=page.locator('#page .lh[data-kind="'+kind+'"]');
  await expect(hub).toBeVisible();
  if(!keepView)await hub.locator('[data-act=view][data-view=grid]').click();
  return hub;
}
async function popupControls(popup){
 const close=popup.locator('.ecco-popup-close'),minimize=popup.getByRole('button',{name:'Minimize popup',exact:true});
 await expect(close).toBeVisible();await expect(minimize).toBeVisible();
 for(const property of ['width','height','background-color','color'])expect(await close.evaluate((el,p)=>getComputedStyle(el).getPropertyValue(p),property)).toBe(await minimize.evaluate((el,p)=>getComputedStyle(el).getPropertyValue(p),property));
 await expect(close).toHaveCSS('width','30px');await expect(minimize).toHaveCSS('height','30px');
}
for(const theme of ['default','dark','forest','desert','ocean','dark-sky'])test(`POPUP-01 Notifications close, minimize and resume in ${theme}`,async({page})=>{
 await boot(page,{theme});const bell=page.locator('#notification-bell'),panel=page.locator('#notification-list'),dock=page.locator('#ecco-popup-resume');
 await bell.click();await popupControls(panel);const unread=await bell.getAttribute('aria-label');
 await panel.getByRole('button',{name:'Minimize popup',exact:true}).click();await expect(panel).toBeHidden();
 await page.getByLabel('Story name (required)',{exact:true}).click();await expect(dock).toBeVisible();
 await dock.getByRole('button',{name:'Resume Notifications',exact:true}).click();await expect(panel).toBeVisible();await expect(dock).toBeHidden();await expect(bell).toHaveAttribute('aria-label',unread);
 await panel.getByRole('button',{name:'Close popup',exact:true}).press('Enter');await expect(panel).toBeHidden();await expect(bell).toBeFocused();
 await bell.click();await panel.getByRole('button',{name:'Minimize popup',exact:true}).click();await bell.click();await expect(panel).toBeVisible();await expect(dock).toBeHidden();
 await page.setViewportSize({width:390,height:844});await popupControls(panel);const box=await panel.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);
 await panel.getByRole('button',{name:'Close popup',exact:true}).press('Escape');await expect(panel).toBeHidden();
});
test('POPUP-02 native purchase dialog retains its selected option across minimize and restore',async({page})=>{
 await boot(page);await page.locator('#google-user-menu > summary').click();await page.getByRole('button',{name:'Credit and Usage',exact:true}).click();await page.getByRole('button',{name:'Purchase Additional Credits',exact:true}).click();
 const popup=page.locator('dialog[open].credits-dialog');await popupControls(popup);await popup.getByRole('button',{name:'Select',exact:true}).first().click();
 await popup.getByRole('button',{name:'Minimize popup',exact:true}).click();await expect(popup).toBeHidden();await page.locator('#ecco-popup-resume button').click();await expect(popup).toBeVisible();await expect(popup.getByRole('button',{name:'✓ Selected',exact:true})).toBeVisible();
 expect(await page.locator('dialog').evaluateAll(dialogs=>dialogs.every(dialog=>dialog.querySelectorAll(':scope > .ecco-popup-close').length===1&&dialog.querySelectorAll(':scope > .ecco-popup-minimize').length===1))).toBe(true);
 await popup.getByRole('button',{name:'Close popup',exact:true}).click();await expect(popup).toHaveCount(0);
});
test('POPUP-03 Desk forms and ticket details retain drafts across navigation and restore',async({page})=>{
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());await page.goto('/desk/index.html?__qa=1');
 await page.getByRole('button',{name:'Create task',exact:true}).click();const form=page.getByRole('dialog',{name:'Create an internal task',exact:true});await popupControls(form);
 await form.locator('[name=title]').fill('Keep popup draft');await form.locator('[name=description]').fill('Keep all entered work.');await form.getByRole('button',{name:'Minimize popup',exact:true}).click();await expect(form).toBeHidden();
 await page.getByRole('button',{name:'Notifications',exact:true}).click();await page.locator('#ecco-popup-resume button').click();await expect(form.locator('[name=title]')).toHaveValue('Keep popup draft');await expect(form.locator('[name=description]')).toHaveValue('Keep all entered work.');
 await form.getByRole('button',{name:'Create task',exact:true}).click();const ticket=page.getByRole('dialog',{name:'TASK-0001',exact:true});await popupControls(ticket);
 await ticket.getByRole('textbox',{name:'Reply message',exact:true}).fill('Unsent reply survives minimizing.');await ticket.getByRole('button',{name:'Minimize popup',exact:true}).click();await page.getByRole('button',{name:'Overview',exact:true}).click();await page.locator('#ecco-popup-resume button').click();await expect(ticket.getByRole('textbox',{name:'Reply message',exact:true})).toHaveValue('Unsent reply survives minimizing.');await ticket.getByRole('button',{name:'Close ticket',exact:true}).click();await expect(ticket).toHaveCount(0);
 await page.getByRole('button',{name:'Team members',exact:true}).click();await page.getByRole('button',{name:'Add team member',exact:true}).click();const member=page.getByRole('dialog',{name:'Add a team member',exact:true});await popupControls(member);await member.getByLabel('Role',{exact:true}).selectOption('admin');await member.getByRole('button',{name:'Minimize popup',exact:true}).click();await page.locator('#ecco-popup-resume button').click();await expect(member.getByLabel('Role',{exact:true})).toHaveValue('admin');await member.getByRole('button',{name:'Close dialog',exact:true}).press('Escape');await expect(member).toHaveCount(0);
});
test.afterEach(async({page},info)=>{
  if(page.qaErrors?.length){
    await info.attach('browser-errors',{body:JSON.stringify(page.qaErrors,null,2),contentType:'application/json'});
    expect.soft(page.qaErrors,'Uncaught browser errors').toEqual([]);
  }
  await info.attach('service-calls',{body:JSON.stringify(await page.evaluate(()=>window.__qaCalls||[]),null,2),contentType:'application/json'});
});
test('ENTRY-01 welcome has one enabled Tell Your Story action',async({page})=>{
  await boot(page,{enter:false});await expect(page.locator('#entry-tell-story')).toBeVisible();
  await expect(page.locator('#workspace-entry button:visible')).toHaveCount(1);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});
for(const action of ['New Story','Go to Studio'])test(`ENTRY-home ${action} opens the same six-option Tell Your Story page`,async({page})=>{
  await boot(page,{enter:false});await page.locator('#entry-tell-story').click();await page.getByRole('button',{name:action,exact:true}).click();
  await expect(page.locator('#heading')).toHaveText('Tell Your Story');
  const choices=page.locator('#story-home-list button');await expect(choices).toHaveText(['1. Describe Your Story','2. StoryBoard Your Story','3. Create Audio for Your Story','4. Create Images for Your Story','5. Create Videos for Your Story','6. Publish Your Story']);
  await expect(page.locator('#story-workspace-header')).toBeHidden();await expect(page.locator('#journey-guide')).toBeHidden();await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(choices.first()).toHaveCSS('font-size','14px');await expect(page.locator('#workspace-production-group [data-page=journey-preview]')).toHaveText('6. Publish Your Story');
  expect(await page.locator('#workspace-production-group .journey-step').evaluateAll(rows=>rows.every(row=>getComputedStyle(row).fontSize==='12px'))).toBe(true);
  await choices.first().focus();await choices.first().press('Tab');await expect(choices.nth(1)).toBeFocused();expect(await choices.nth(1).evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('solid');
  await choices.first().press('Enter');await expect(page.locator('#story-simple-details')).toBeVisible();await expect(page.getByLabel('Story name (required)',{exact:true})).toHaveValue('');
  await page.locator('#workspace-back').click();await expect(page.locator('#story-home-list')).toBeVisible();
});
test('STORY-home sidebar and Back preserve edited drafts and open the existing tools',async({page})=>{
  await boot(page);await page.getByLabel('Story name (required)',{exact:true}).fill('Keep this story');
  await page.locator('#workspace-production-group > summary').click();await expect(page.locator('#story-home-list')).toBeVisible();
  await expect(page.locator('#workspace-production-group > summary')).toHaveAttribute('aria-current','page');await expect(page.locator('#story-workspace-header')).toBeHidden();
  await page.locator('#workspace-back').click();await expect(page.getByLabel('Story name (required)',{exact:true})).toHaveValue('Keep this story');
  for(const [target,selector]of [['story-setup','#story-simple-details'],['board','#page form'],['audio','#audio-form'],['images','#image-form'],['render','#video-form'],['journey-preview','#page [data-platform]']]){
    await page.locator('#workspace-production-group > summary').click();await page.locator('[data-story-destination="'+target+'"]').click();
    await expect(page.locator('#story-home-list')).toHaveCount(0);
    if(target==='journey-preview')await expect(page.locator('#heading')).toHaveText(/Publish/);else if(target==='board')await expect(page.locator('#heading')).toHaveText('Storyboard');else await expect(page.locator(selector).first()).toBeVisible();
  }
  expect((await page.evaluate(()=>window.__qaCalls||[])).some(call=>/^(images|videos|audio\/generate|publish)$/.test(call.path))).toBe(false);
});
for(const theme of ['default','dark','forest','desert','ocean','dark-sky'])test(`LAYOUT-story-home matches Library at mobile width in ${theme}`,async({page})=>{
  await page.setViewportSize({width:390,height:900});await boot(page,{landing:true,theme});
  const choices=page.locator('#story-home-list button');await expect(choices).toHaveCount(6);
  for(const choice of await choices.all())expect(await choice.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&el.scrollWidth<=el.clientWidth;})).toBe(true);
  const landingStyle=async()=>page.locator('#page .workspace-home').evaluate(el=>({padding:getComputedStyle(el).paddingTop,font:getComputedStyle(el.querySelector('button')).fontSize,borders:[...el.querySelectorAll('ul,li,button')].every(row=>{const s=getComputedStyle(row);return ['borderTopWidth','borderBottomWidth','borderLeftWidth','borderRightWidth'].every(p=>s[p]==='0px');})}));
  expect(await landingStyle()).toEqual({padding:'22px',font:'14px',borders:true});
});
test('STORY-01 six steps and left navigation stay visible',async({page})=>{
  await boot(page);await expect(page.locator('#story-workspace-header [role=tab]')).toHaveText(['1. Details','2. Story','3. Characters','4. Script','5. Generate','6. Publish']);
  await expect(page.locator('body > aside')).toBeVisible();
  await expect(page.getByLabel('Story name (required)',{exact:true})).toHaveValue('');
});
test('STORY-02 name validation blocks an empty story',async({page})=>{
  await boot(page);await page.getByRole('button',{name:'Next: Story',exact:true}).click();
  await expect(page.getByLabel('Story name (required)',{exact:true})).toBeVisible();
  expect(await page.getByLabel('Story name (required)',{exact:true}).evaluate(el=>el.validity.valueMissing)).toBe(true);
});
test('STORY-03 new story clears previous fields',async({page})=>{
  await boot(page);await page.getByLabel('Story name (required)',{exact:true}).fill('Prior story must not leak');
  await openLibrary(page,'story');await page.getByRole('button',{name:'New Story',exact:true}).click();
  await expect(page.getByLabel('Story name (required)',{exact:true})).toHaveValue('');
});
test('STORY-04 story settings labels and source tabs carry Story Details and synchronize back',async({page})=>{
  await boot(page);await page.getByLabel('Story name (required)',{exact:true}).fill('QA Story');
  for(const [name,value] of Object.entries({output:'audio',type:'podcast',genre:'Comedy',audience:'All ages',language:'English'}))
    await fillStoryDetail(page,name,value);
  await page.getByRole('button',{name:'Next: Story',exact:true}).click();
  const settings=page.getByRole('group',{name:'Story settings',exact:true});
  for(const [label,value] of Object.entries({'Story Type':'podcast','Genre / Topic':'Comedy','Audience':'All ages','Language':'English'}))await expect(settings.getByLabel(label,{exact:true})).toHaveValue(value);
  const sources=page.getByRole('tablist',{name:'Story source',exact:true}),pdf=sources.getByRole('tab',{name:'Upload PDF',exact:true}),ai=sources.getByRole('tab',{name:'Generate With AI',exact:true}),write=sources.getByRole('tab',{name:'Write Yourself',exact:true});
  await expect(sources.getByRole('tab')).toHaveText(['Upload PDF','Generate With AI','Write Yourself']);await expect(pdf).toHaveAttribute('aria-selected','true');
  const pdfPanel=page.getByRole('tabpanel',{name:'Upload PDF',exact:true});await expect(pdfPanel.getByRole('button',{name:'Upload PDF',exact:true})).toBeVisible();for(const heading of ['Selected Text','Improve with AI'])await expect(pdfPanel.getByText(heading,{exact:true})).toBeVisible();await expect(page.getByText('Story / Script',{exact:true})).toBeHidden();await expect(page.locator('#story-simple-script')).toBeHidden();await expect(page.getByRole('dialog',{name:'Select Story Text',exact:true})).toHaveCount(0);await expect(page.getByRole('dialog',{name:'Generate With AI',exact:true})).toBeHidden();
  await pdf.focus();await page.keyboard.press('ArrowRight');await expect(ai).toBeFocused();await expect(ai).toHaveAttribute('aria-selected','true');
  await expect(page.getByRole('dialog',{name:'Generate With AI',exact:true})).toBeVisible();await expect(page.getByRole('dialog',{name:'Select Story Text',exact:true})).toBeHidden();
  await page.keyboard.press('End');await expect(write).toBeFocused();await expect(page.getByRole('dialog',{name:'Write Yourself',exact:true})).toBeVisible();
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});const box=await settings.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
  await page.setViewportSize({width:1440,height:1000});
  for(const [label,value] of Object.entries({'Story Type':'storybook','Genre / Topic':'Fantasy','Audience':'Children (9–12)','Language':'Hindi'}))await settings.getByLabel(label,{exact:true}).selectOption(value);
  await page.getByRole('tab',{name:'1. Details',exact:true}).click();
  for(const [name,value] of Object.entries({type:'storybook',genre:'Fantasy',audience:'Children (9–12)',language:'Hindi'}))await expect(page.locator('#story-simple-details [name='+name+']')).toHaveValue(value);
  await page.locator('#story-simple-details [name=language]').selectOption('Urdu');await page.getByRole('tab',{name:'2. Story',exact:true}).click();
  await expect(settings.getByLabel('Language',{exact:true})).toHaveValue('Urdu');await expect(write).toHaveAttribute('aria-selected','true');
});
test('LIB-hub-01 Library is a collapsible "+" row, closed by default, with a switcher for all five libraries',async({page})=>{
  await boot(page);
  const group=page.locator('#workspace-library-group'),summary=group.locator(':scope > summary');
  await expect(group).not.toHaveAttribute('open');
  await expect(page.locator('#library-hub-nav')).toBeHidden();
  expect(await summary.locator('.library-symbol').evaluate(el=>getComputedStyle(el,'::before').content)).toBe('"+"');
  await summary.click();
  expect(await summary.locator('.library-symbol').evaluate(el=>getComputedStyle(el,'::before').content)).toBe('"−"');
  await expect(page.locator('#heading')).toHaveText('Library');
  const choices=page.locator('#library-home-list button');await expect(choices).toHaveCount(5);
  expect(await choices.evaluateAll(rows=>rows.map(row=>row.dataset.libraryDestination))).toEqual(['story','image','audio','video','workflow']);
  await choices.nth(1).click();await expect(page.locator('#page .lh[data-kind="image"]')).toBeVisible();
  await expect(page.locator('#library-hub-nav [data-lib="image"]')).toHaveAttribute('aria-current','page');
  const buttons=page.locator('#library-hub-nav .lh-libs button');
  expect(await buttons.evaluateAll(b=>b.map(x=>x.dataset.lib))).toEqual(['story','image','audio','video','workflow']);
  await expect(page.locator('#library-hub-nav')).toBeVisible();
  await expect(page.locator('body > aside')).toBeVisible();
  await summary.click();await expect(page.locator('#library-hub-nav')).toBeHidden();
});
for(const kind of ['story','image','audio','video','workflow']){
  test(`LIB-${kind}-01 opens the new screen with List default, tools, count and details panel`,async({page})=>{
    await boot(page);await page.evaluate(()=>{state.config.storage.library_labels=1;storyControls();});const hub=await openLibrary(page,kind,{keepView:true});
    await expect(page.locator('#story-workspace-header')).toBeHidden();
    await expect(hub.locator('.lh-title')).toHaveText('All '+({story:'stories',image:'images',audio:'audio clips',video:'videos',workflow:'workflows'}[kind]));
    await expect(hub.locator('[data-act=view][data-view=list]')).toHaveAttribute('aria-pressed','true');await expect(hub.locator('.lh-headrow')).toBeVisible();
    await expect(hub.getByRole('searchbox')).toBeVisible();
    await expect(hub.locator('#lh-type')).toBeVisible();await expect(hub.locator('#lh-sort')).toBeVisible();
    await expect(hub.locator('.lh-count')).toHaveText(/^\d+ /);
    const card=hub.locator('.lh-row[data-pick]').first();await expect(card).toBeVisible();
    await expect(hub.locator('.lh-details')).toBeHidden();
    await card.click();
    const details=hub.locator('.lh-details');await expect(details).toBeVisible();
    await expect(details.locator('#lh-name')).toBeVisible();
    await expect(details.getByRole('button',{name:'+ Add label'})).toBeVisible();
    await expect(details.locator('.lh-danger')).toBeVisible();
    await details.getByRole('button',{name:'Close details'}).click();await expect(details).toBeHidden();
    await expect(page.locator('#library-hub-nav [data-lib="'+kind+'"]')).toHaveAttribute('aria-current','page');
  });
  test(`LIB-${kind}-list list view shows Name, Labels, Type and Created`,async({page})=>{
    await boot(page);const hub=await openLibrary(page,kind);
    await hub.locator('[data-act=view][data-view=list]').click();
    await expect(hub.locator('.lh-headrow [role=columnheader]')).toHaveText(['Name','Labels','Type','Created']);
    const row=hub.locator('.lh-row[data-pick]').first();await expect(row).toBeVisible();
    await expect(row.locator('.lh-name')).not.toBeEmpty();
    await expect(row).toContainText('No labels');
  });
}
for(const kind of ['image','audio','video']){
  test(`LIB-${kind}-search search and sort work and an empty search can be reset`,async({page})=>{
    await boot(page);const hub=await openLibrary(page,kind);
    const search=hub.getByRole('searchbox');
    await search.fill('Alpha');await expect(hub.locator('.lh-card')).toHaveCount(1);
    await search.fill('no-such-file');await expect(hub.locator('.lh-card')).toHaveCount(0);
    await hub.getByRole('button',{name:'Reset search and filters'}).click();
    await expect(hub.locator('.lh-card')).toHaveCount(2);
    await hub.locator('#lh-sort').selectOption('name');
    await expect(hub.locator('.lh-card .lh-name').first()).toHaveText(/^Alpha/);
    await hub.locator('#lh-sort').selectOption('old');
    await expect(hub.locator('.lh-card .lh-name').first()).toHaveText(/^Alpha/);
    await hub.locator('#lh-sort').selectOption('new');
    await expect(hub.locator('.lh-card .lh-name').first()).toHaveText(/^Zebra/);
  });
}
// Check actual pixels of a known media fixture. A generic SVG or blank tile fails.
for(const kind of ['image','video'])for(const view of ['grid','list']){
  test(`THUMB-${kind}-${view} thumbnail displays the real sample frame`,async({page})=>{
    await boot(page);const hub=await openLibrary(page,kind);
    await hub.locator('[data-act=view][data-view='+view+']').click();
    const tile=hub.locator(view==='grid'?'.lh-card .lh-thumb':'.lh-row[data-pick] .lh-mini').first();
    await expect(tile).toBeVisible();
    const decoded=tile.locator('img,video');
    await expect(decoded,'Expected a decoded media thumbnail; a generic icon is not a preview').toHaveCount(1);
    await expect(decoded).toBeVisible();
    await expect.poll(()=>decoded.evaluate(el=>el instanceof HTMLImageElement?el.complete&&el.naturalWidth>0:el.readyState>=2)).toBe(true);
    const samplePixels=()=>decoded.evaluate(el=>{
      const c=document.createElement('canvas');c.width=160;c.height=90;const ctx=c.getContext('2d');ctx.drawImage(el,0,0,160,90);
      return [Array.from(ctx.getImageData(10,45,1,1).data),Array.from(ctx.getImageData(100,45,1,1).data)];
    });
    await expect.poll(async()=>{const px=await samplePixels();return Math.min(px[0][0]-px[0][1],px[1][1]-px[1][0]);},{message:'The decoded thumbnail must display both the red stripe and green field'}).toBeGreaterThan(100);
  });
}
test('LIB-image-preview opens full size and closing restores focus to the picked file',async({page})=>{
  await boot(page);const hub=await openLibrary(page,'image');
  const card=hub.locator('.lh-card').first();await card.click();
  await hub.getByRole('button',{name:'Open full size'}).click();
  const viewer=page.locator('#library-hub-viewer');await expect(viewer).toBeVisible();
  await viewer.getByRole('button',{name:'Close popup',exact:true}).click();
  await expect(viewer).toBeHidden();await expect(card).toBeFocused();
});
async function seedLabels(page){
  await page.evaluate(async()=>{
    state.config.storage.library_labels=1;state.config.storage.rename_available=true;
    state.records.push(
      {id:'qa-f-people',kind:'image_folder',name:'People',created:1700005000},
      {id:'qa-f-kids',kind:'image_folder',name:'People / Kids',created:1700005001},
      {id:'qa-f-pets',kind:'image_folder',name:'Pets',created:1700005002},
      {id:'qa-l-0',kind:'library_item',asset_id:'qa-image-0',folder_id:'qa-f-people',created:1700005000},
      {id:'qa-l-1',kind:'library_item',asset_id:'qa-image-1',folder_id:'qa-f-kids',created:1700005001},
      {id:'qa-l-2',kind:'library_item',asset_id:'qa-image-1',folder_id:'qa-f-pets',created:1700005002});
    await refresh();storyControls();
  });
}
test('LIB-tree boxed +/− toggles expand nested labels and counts include nested items',async({page})=>{
  await boot(page);await seedLabels(page);const hub=await openLibrary(page,'image');
  const tree=page.locator('#library-hub-nav .lh-tree');
  await expect(tree.locator('.lh-node',{hasText:'Kids'})).toHaveCount(0);
  const toggle=tree.getByRole('button',{name:'Expand People'});
  await expect(toggle).toHaveText('+');
  expect(await toggle.evaluate(el=>parseFloat(getComputedStyle(el).borderTopWidth))).toBeGreaterThan(0);
  expect(await tree.locator('.lh-node').first().evaluate(el=>el.getBoundingClientRect().height)).toBeLessThanOrEqual(30);
  await expect(tree.locator('.lh-node',{hasText:'People'}).locator('small')).toHaveText('2');
  await toggle.click();
  await expect(tree.getByRole('button',{name:'Collapse People'})).toHaveText('−');
  await expect(tree.locator('.lh-node',{hasText:'Kids'}).locator('small')).toHaveText('1');
  await tree.locator('.lh-node',{hasText:'People'}).click();
  await expect(hub.locator('.lh-card')).toHaveCount(2);
  await expect(hub.locator('.lh-crumb')).toContainText('People');
});
test('LIB-filter multiple labels use AND, show chips, and clearing restores everything',async({page})=>{
  await boot(page);await seedLabels(page);const hub=await openLibrary(page,'image');
  const tree=page.locator('#library-hub-nav .lh-tree');
  await tree.locator('.lh-node',{hasText:'People'}).click();await expect(hub.locator('.lh-card')).toHaveCount(2);
  await tree.locator('.lh-node',{hasText:'Pets'}).click();
  await expect(hub.locator('.lh-card')).toHaveCount(1);
  await expect(hub.locator('.lh-card .lh-name')).toHaveText('Zebra image sample');
  await expect(hub.locator('.lh-chips')).toContainText('Items with all of:');
  await expect(hub.locator('.lh-chips .lh-chip')).toHaveCount(2);
  await hub.getByRole('button',{name:'Remove filter Pets'}).click();await expect(hub.locator('.lh-card')).toHaveCount(2);
  await hub.getByRole('button',{name:'Clear all'}).click();await expect(hub.locator('.lh-chips')).toBeHidden();
  await expect(hub.locator('.lh-title')).toHaveText('All images');
});
test('LIB-label-edit details panel adds, removes and renames; each item can carry several labels',async({page})=>{
  await boot(page);await seedLabels(page);const hub=await openLibrary(page,'image');
  await page.evaluate(()=>{
    window.__calls=[];const original=api;
    api=async(path,body)=>{window.__qaCalls.push({path,body});
      if(path==='library/save'){state.records.push({id:'qa-new-'+body.folder_id,kind:'library_item',asset_id:body.asset_id,folder_id:body.folder_id,created:1});return {};}
      if(path==='library/labels/remove'){const r=state.records.find(x=>x.kind==='library_item'&&x.asset_id===body.item_id&&x.folder_id===body.folder_id);if(r)r.deleted=true;return {removed:1};}
      if(path==='library/rename'){const r=state.records.find(x=>x.id===body.id);r.title=body.name;r.name=r.kind==='asset'?r.name:body.name;return {};}
      return original(path,body);};
  });
  await hub.locator('.lh-card',{hasText:'Alpha'}).click();
  const details=hub.locator('.lh-details');
  await details.getByRole('button',{name:'+ Add label'}).click();
  await details.getByRole('button',{name:'Pets'}).click();
  await expect(details.locator('.lh-chip',{hasText:'Pets'})).toBeVisible();
  await expect(details.locator('.lh-chip')).toHaveCount(2);
  expect((await page.evaluate(()=>window.__qaCalls)).some(c=>c.path==='library/save'&&c.body.asset_id==='qa-image-0'&&c.body.folder_id==='qa-f-pets')).toBe(true);
  await details.getByRole('button',{name:'Remove label Pets'}).click();
  await expect(details.locator('.lh-chip',{hasText:'Pets'})).toHaveCount(0);
  await details.locator('#lh-name').fill('Alpha renamed');await details.locator('#lh-name').press('Tab');
  await expect.poll(()=>page.evaluate(()=>window.__qaCalls.some(c=>c.path==='library/rename'&&c.body.name==='Alpha renamed'))).toBe(true);
});
test('LIB-label-new sidebar creates a nested label through the inline form',async({page})=>{
  await boot(page);await seedLabels(page);await openLibrary(page,'image');
  await page.evaluate(()=>{const original=api;api=async(path,body)=>{window.__qaCalls.push({path,body});
    if(path==='library/folders'){const f={id:'qa-new-folder',kind:'image_folder',name:body.name,created:1700006000};state.records.push(f);return f;}return original(path,body);};});
  const nav=page.locator('#library-hub-nav');
  await nav.getByRole('button',{name:'+ New label'}).click();
  await nav.getByLabel('Label name').fill('Villains');await nav.getByLabel('Inside').selectOption('People');
  await nav.getByLabel('Label name').press('Enter');
  await expect(nav.locator('.lh-node',{hasText:'Villains'})).toBeVisible();
  expect((await page.evaluate(()=>window.__qaCalls)).some(c=>c.path==='library/folders'&&c.body.name==='People / Villains')).toBe(true);
});
test('LIB-label-gate labels for video, story and workflow need the storage update',async({page})=>{
  await boot(page);const hub=await openLibrary(page,'video');
  await expect(page.locator('#library-hub-nav')).toContainText('need the storage service update');
  await expect(page.locator('#library-hub-nav').getByRole('button',{name:'+ New label'})).toHaveCount(0);
  await hub.locator('.lh-card').first().click();
  await expect(hub.locator('.lh-details').getByRole('button',{name:'+ Add label'})).toHaveCount(0);
  await expect(hub.locator('.lh-details')).toContainText('Labels need the storage service update');
});
for(const theme of ['default','dark','forest','desert','ocean','dark-sky']){
  test(`THEME-${theme} library controls remain visible and sidebar stays flat`,async({page})=>{
    await boot(page,{theme});await openLibrary(page,'image');
    await expect(page.locator('html')).toHaveAttribute('data-ecco-theme',theme);
    const summary=page.locator('#workspace-library-group > summary');await expect(summary).toBeVisible();
    expect(await summary.evaluate(el=>getComputedStyle(el).boxShadow)).toBe('none');
    await expect(page.getByRole('searchbox',{name:'Search images'})).toBeVisible();
    const accents={default:'rgb(255, 220, 36)',dark:'rgb(199, 199, 206)',forest:'rgb(255, 255, 255)',desert:'rgb(107, 66, 38)',ocean:'rgb(0, 100, 200)','dark-sky':'rgb(105, 201, 255)'};
    const back=page.locator('#workspace-back');await expect(back).toBeEnabled();
    await page.mouse.move(0,0);await expect(back).toHaveCSS('color',accents[theme]);
    await back.hover();await expect(back).toHaveCSS('color',accents[theme]);
    await page.mouse.move(0,0);await expect(back).toHaveCSS('color',accents[theme]);
    await back.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
    await expect(back).toBeFocused();await expect(back).toHaveCSS('color',accents[theme]);
    await expect(back).toHaveCSS('outline-color',accents[theme]);
    await page.locator('#workspace-trash').click();
    await expect(page.locator('#page .section-head h2')).toHaveText('Trash · all stories');
    await expect(back).toHaveCSS('color',accents[theme]);
    await expect(back).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  });
}
for(const width of [1440,1024,768]){
  test(`LAYOUT-${width} library stays within the viewport`,async({page})=>{
    await page.setViewportSize({width,height:1000});await boot(page);await openLibrary(page,'video');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Page must not overflow horizontally; file table can scroll internally').toBe(true);
  });
}
test('DRIVE-01 search filters immediately and all four columns are sortable',async({page})=>{
  await boot(page);await expect(page.locator('#workspace-settings-controls')).toBeVisible();
  await page.locator('#activity-files-menu').click();
  await expect(page.locator('#activity-files')).toBeVisible();
  await page.locator('#activity-files-search').fill('Alpha');
  await expect(page.locator('#activity-files-list tr[data-asset-id]')).toHaveCount(3);
  await expect(page.locator('#activity-files-table th button')).toHaveCount(4);
  await page.locator('#activity-files-table th button').first().click();
  await expect(page.locator('#activity-files-table th').first()).toHaveAttribute('aria-sort','ascending');
});
test('AUTH-01 local sign-out returns to the first screen',async({page})=>{
  await boot(page);await page.locator('#google-user-menu > summary').click();
  await page.getByRole('button',{name:'Log Off',exact:true}).click();
  await expect(page.locator('#workspace-entry')).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('ecco-user-session'))).toBeNull();
  await expect(page.locator('#workspace-back')).toBeHidden();
});

test('NOTIFY-01 numbered unread notices move to three-item read history',async({page})=>{
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/?__qa=1&notices=1');await page.waitForFunction(()=>window.__qaReady);
  await page.locator('#entry-tell-story').click();await page.getByRole('button',{name:'New Story',exact:true}).click();await page.locator('#notification-bell').click();
  const unread=page.locator('#notification-list [data-read="false"]'),old=page.locator('#notification-list [data-read="true"]');
  await expect(unread).toHaveCount(2);await expect(old).toHaveCount(3);
  await expect(unread.first().locator('.notification-title')).toHaveText('New notice 1');
  await expect(unread.first().locator('.notification-body')).toHaveCSS('font-weight','700');
  await expect(old.first().locator('.notification-body')).toHaveCSS('font-weight','400');
  await expect(page.getByRole('table',{name:'New notifications',exact:true}).getByRole('columnheader')).toHaveText(['Number','Notification','Date it expires']);
  await expect(page.locator('[data-notification-items] .notification-number').first()).toHaveText('1');
  await expect(unread.first().locator('.notification-title')).toHaveCSS('font-size','11.3333px');
  await expect(unread.first().locator('.notification-body')).toHaveCSS('font-size','10.3333px');
  await expect(page.locator('[data-notification-items] td').first()).toHaveCSS('padding-top','14px');
  await expect(page.locator('[data-notification-items] time').first()).toBeVisible();
  await unread.first().press('Enter');await expect(unread).toHaveCount(1);await expect(old).toHaveCount(3);
  await expect(old.first()).toContainText('New notice 1');await expect(unread.first()).toBeFocused();
  await unread.first().press('Enter');await expect(unread).toHaveCount(0);
  await expect(page.locator('[data-notification-status]')).toHaveText('No New notifications');
  await expect(page.getByRole('heading',{name:'Old Notfication',exact:true})).toBeVisible();
  await page.locator('#notification-bell').press('Escape');await expect(page.locator('#notification-list')).toBeHidden();
});

test('NOTIFY-02 history opens an editable re-issue draft and retains the original',async({page})=>{
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/desk/index.html?__qa=1');await page.getByRole('button',{name:'Notifications',exact:true}).click();
  await expect(page.locator('.notification-composer')).toHaveCount(0);await page.getByRole('button',{name:'New Notification',exact:true}).click();
  await page.getByLabel('Title',{exact:true}).fill('Original notice');await page.getByLabel('Message',{exact:true}).fill('Original message');
  await page.getByRole('button',{name:'Publish notification',exact:true}).click();
  await page.getByRole('button',{name:'Edit and re-issue Original notice',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Re-issue Notification',exact:true})).toBeVisible();
  await expect(page.getByLabel('Title',{exact:true})).toBeFocused();await expect(page.getByLabel('Message',{exact:true})).toHaveValue('Original message');
  await page.getByLabel('Title',{exact:true}).fill('Updated notice');await page.getByLabel('Duration (days)',{exact:true}).fill('7');
  await page.getByRole('button',{name:'Re-issue notification',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('Notification re-issued.');
  await expect(page.locator('.notification-history tbody tr')).toHaveCount(2);
  await expect(page.locator('.notification-history')).toContainText('Original notice');await expect(page.locator('.notification-history')).toContainText('Updated notice');
  const posts=await page.evaluate(()=>window.__deskPosts);expect(posts[1].requestId).not.toBe(posts[0].requestId);expect(posts[1].durationDays).toBe(7);
});

test('NAV-01 Back restores library search/view and the unfinished story',async({page})=>{
  await boot(page);await page.getByLabel('Story name (required)',{exact:true}).fill('Navigation draft');
  const hub=await openLibrary(page,'image');await hub.getByRole('searchbox').fill('Alpha');
  await hub.locator('[data-act=view][data-view=list]').click();
  await page.getByRole('button',{name:'Model Garden',exact:true}).click();await expect(page.locator('#models-form')).toBeVisible();
  await page.locator('#workspace-back').click();
  const again=page.locator('#page .lh[data-kind=image]');await expect(again).toBeVisible();
  await expect(again.locator('[data-act=view][data-view=list]')).toHaveAttribute('aria-pressed','true');
  await expect(again.getByRole('searchbox')).toHaveValue('Alpha');
  await page.locator('#workspace-back').click();await expect(page.locator('#library-home-list')).toBeVisible();
  await page.locator('#workspace-back').click();await expect(page.getByLabel('Story name (required)',{exact:true})).toHaveValue('Navigation draft');
});
test('NAV-02 Support Back returns to the preceding screen, never the entry page',async({page})=>{
  await boot(page);await page.getByRole('button',{name:'Model Garden',exact:true}).click();
  await page.locator('#workspace-support').click();await expect(page.locator('#ecco-desk-support')).toBeVisible();
  await expect(page.getByText('← Back to Studio',{exact:true})).toHaveCount(0);
  await page.locator('#workspace-back').click();await expect(page.locator('#models-form')).toBeVisible();
  await expect(page.locator('#workspace-entry')).toBeHidden();
});
test('NAV-03 Back belongs only to the page, never menus, hover drawers or popups',async({page})=>{
  await boot(page);await openLibrary(page,'video');
  const preferences=page.locator('#workspace-settings-controls details');await preferences.locator('summary').click();
  await expect(preferences.locator('.ecco-back')).toHaveCount(0);
  await page.locator('#theme-colors-open').hover();await expect(page.locator('#workspace-theme-drawer')).toBeVisible();
  await expect(page.locator('#workspace-theme-drawer').getByRole('button',{name:'Back',exact:true})).toHaveCount(0);
  await page.locator('#theme-colors-open').press('Escape');await preferences.locator('summary').press('Escape');
  await expect(preferences).not.toHaveAttribute('open');await expect(preferences.locator('summary')).toBeFocused();
  await page.locator('#activity-files-menu').click();await expect(page.locator('#activity-files')).toBeVisible();
  await expect(page.locator('#activity-files').getByRole('button',{name:'Back',exact:true})).toHaveCount(0);
  await page.locator('#activity-files').getByRole('button',{name:'Close popup',exact:true}).click();await expect(page.locator('#activity-files')).toBeHidden();
  await expect(page.locator('#page .lh[data-kind=video]')).toBeVisible();await expect(page.locator('#activity-files-menu')).toBeFocused();
  const viewport=page.viewportSize();await page.mouse.move(viewport.width-1,viewport.height/2);
  await page.locator('#activity-edge-arrow').click();await expect(page.locator('#activity-panel')).toBeVisible();
  await expect(page.locator('#activity-panel').getByRole('button',{name:'Back',exact:true})).toHaveCount(0);
  await page.locator('#close-activity').click();await expect(page.locator('#activity-panel')).toBeHidden();
  await expect(page.locator('.ecco-back')).toHaveCount(1);await expect(page.locator('#workspace-back')).toBeEnabled();
});
test('NAV-04 purchase popups omit Back and retain package selection and close behavior',async({page})=>{
  await boot(page);await page.locator('#google-user-menu > summary').click();
  await expect(page.locator('#google-user-menu .ecco-back')).toHaveCount(0);
  await page.getByRole('button',{name:'Credit and Usage',exact:true}).click();
  await expect(page.locator('#workspace-usage-drawer .ecco-back')).toHaveCount(0);
  await page.getByRole('button',{name:'Purchase Additional Credits',exact:true}).click();
  await expect(page.locator('dialog[open]').getByRole('button',{name:'Back',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Select',exact:true}).first().click();await page.getByRole('button',{name:'View Cart',exact:true}).click();
  await page.getByRole('button',{name:'Proceed to Checkout',exact:true}).click();
  await expect(page.locator('dialog[open]').getByRole('button',{name:'Back',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Continue Shopping',exact:true}).click();
  await expect(page.getByRole('button',{name:'✓ Selected',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close popup',exact:true}).click();await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('#story-simple-details')).toBeVisible();
});
test('NAV-05 Desk keeps page navigation but excludes Back from account menus and ticket forms',async({page})=>{
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/desk/index.html?__qa=1');
  await expect(page.locator('.topbar .desk-back')).toBeVisible();
  await expect(page.locator('.topbar .desk-back')).toHaveCSS('color','rgb(255, 220, 36)');
  await page.locator('.account-trigger').click();await expect(page.getByRole('menu').getByRole('menuitem',{name:'Back',exact:true})).toHaveCount(0);
  await page.getByRole('menu').getByRole('menuitem',{name:'Sign out',exact:true}).press('Escape');
  await page.getByRole('button',{name:'Create task',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByRole('dialog').getByRole('button',{name:'Back',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('AGENT-03 customer account can run agent and create its own Bug tickets',async({page})=>{
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/desk/index.html?__qa=1&role=customer');
  await page.getByRole('button',{name:'Agents',exact:true}).click();await page.locator('.agent-card').click();
  await expect(page.getByRole('heading',{name:'Agents',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:/^Run selected tests/})).toBeDisabled();
  await expect(page.locator('.support-hours')).toHaveCount(0);await expect(page.getByLabel('Assign findings to',{exact:true})).toHaveCount(0);
  await page.evaluate(()=>sessionStorage.setItem('qa-studio-session','synthetic-only'));
  await page.getByLabel('Action',{exact:true}).selectOption('workflow');await page.getByLabel('Workflow',{exact:true}).selectOption('story');
  await page.getByRole('button',{name:'Select all tests',exact:true}).click();
  await page.getByRole('button',{name:/^Run selected tests/}).click();
  await expect(page.getByRole('button',{name:/^Run selected tests/})).toBeEnabled({timeout:30000});
  await expect(page.locator('.tester-agent')).toBeVisible();
  const run=await page.evaluate(()=>JSON.parse(localStorage.getItem('ecco-tester-runs:v1:qa-desk-user')||'[]')[0]);
  expect(run.checks.some(c=>c.id==='story-choices'&&c.status==='passed')).toBe(true);
  const report={generated_at:'2026-11-07T12:00:00Z',commit:'customer-fixture',tests:[{id:'LIB-video-preview',status:'failed',error:'Missing thumbnail'}]};
  await page.getByLabel('Import CI report',{exact:true}).setInputFiles({name:'qa-summary.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(report))});
  await page.getByRole('button',{name:'Create ticket',exact:true}).click();await expect(page.locator('.agent-ticket-link')).toHaveText('SUP-0001 ↗');
  expect(await page.evaluate(()=>window.__deskPosts[0].type)).toBe('support');
  await page.getByRole('button',{name:'Refresh workspace',exact:true}).click();await expect(page.locator('.tester-agent')).toBeVisible();
  await page.getByRole('button',{name:'Notifications',exact:true}).click();await expect(page.getByRole('button',{name:'Connect Google',exact:true})).toBeVisible();
  await expect(page.locator('.notification-composer')).toHaveCount(0);
 });
test('UPLOAD-01 equal panes, permanent AI workspace and a bottom document ribbon',async({page})=>{
  await boot(page);await page.getByLabel('Story name (required)',{exact:true}).fill('Upload controls QA');
  for(const [name,value] of Object.entries({output:'audio',type:'podcast',genre:'Comedy',audience:'All ages',language:'English'}))await fillStoryDetail(page,name,value);
  await page.getByRole('button',{name:'Next: Story',exact:true}).click();
  const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Upload PDF',exact:true}).click();await (await chooser).setFiles({name:'upload-qa.txt',mimeType:'text/plain',buffer:Buffer.from('The original document remains untouched.')});
  const dialog=page.getByRole('dialog',{name:'Select Story Text',exact:true}),selected=dialog.locator('[data-selected]');await expect(dialog).toBeVisible();await expect(selected).toHaveValue('');
  await expect(dialog.locator('[data-story-context]')).toHaveCount(0);
  for(const width of [1440,1024]){
    await page.setViewportSize({width,height:1000});
    const panes=await dialog.locator('.pdf-selection-layout > *').evaluateAll(els=>els.map(el=>({x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y,width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,bottom:el.getBoundingClientRect().bottom})));
    expect(panes).toHaveLength(3);for(const pane of panes){expect(Math.abs(pane.width-panes[0].width)).toBeLessThan(2);expect(Math.abs(pane.height-panes[0].height)).toBeLessThan(2);expect(pane.y).toBe(panes[0].y);}
    expect((await dialog.locator('.pdf-selection-ribbon').boundingBox()).y).toBeGreaterThanOrEqual(panes[0].bottom);
    const inputHeight=(await dialog.getByLabel('AI instructions',{exact:true}).boundingBox()).height,outputHeight=(await dialog.getByLabel('Draft 1',{exact:true}).boundingBox()).height;expect(Math.abs(inputHeight-outputHeight)).toBeLessThan(1);
    for(const label of ['AI instructions','Draft 1']){await expect(dialog.getByLabel(label,{exact:true})).toBeVisible();expect((await dialog.getByLabel(label,{exact:true}).boundingBox()).height).toBeGreaterThan(120);}
  }
  const find=dialog.locator('.pdf-find-replace summary'),clear=dialog.getByRole('button',{name:'Clear Text',exact:true});
  await expect(dialog.locator('.pdf-selected-label')).toHaveCSS('border-top-color','rgb(255, 220, 36)');
  await selected.fill('Only these selected words.');await find.press('Enter');await expect(dialog.getByLabel('Find',{exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(find).toBeFocused();await expect(dialog).toBeVisible();
  await dialog.getByLabel('AI instructions',{exact:true}).fill('Make it simpler.');await dialog.getByRole('button',{name:'Improve with AI',exact:true}).click();const error=page.getByRole('dialog',{name:'Unable to Improve Text',exact:true});await expect(error).toContainText(/Connect your saved workspace from Connections → Storage/);await expect(error.locator('[data-ai-recommendation]')).not.toBeEmpty();await error.getByRole('button',{name:'Continue Without AI',exact:true}).click();await expect(dialog.locator('[data-selected]')).toBeFocused();await expect(dialog.getByRole('button',{name:'Generate Script',exact:true})).toHaveCount(0);await expect(dialog).toBeVisible();await expect(dialog.getByLabel('Draft 1',{exact:true})).toHaveValue('');
  await dialog.getByRole('button',{name:'Save Draft',exact:true}).click();await expect(dialog.locator('[role=status]')).toContainText('Draft saved');
  await expect(clear).toHaveClass('secondary');expect(await clear.evaluate(el=>el.nextElementSibling.matches('[data-extract]'))).toBe(true);await clear.click();await expect(selected).toHaveValue('');await expect(dialog.locator('.source-text-preview')).toHaveText('The original document remains untouched.');
  await page.setViewportSize({width:390,height:844});await find.click();const panel=await dialog.locator('.pdf-find-replace .pdf-tool-panel').boundingBox();expect(panel.x).toBeGreaterThanOrEqual(0);expect(panel.x+panel.width).toBeLessThanOrEqual(390);await page.keyboard.press('Escape');await expect(dialog).toBeVisible();
});
test('UPLOAD-02 AI output review keeps the chosen text and Next: Characters carries it to Script',async({page})=>{
  await boot(page,{sourceFit:'fiction'});await page.getByLabel('Story name (required)',{exact:true}).fill('Sports News');
  for(const [name,value] of Object.entries({output:'audio',type:'news',genre:'Sports',audience:'All ages',language:'English'}))await fillStoryDetail(page,name,value);
  await page.getByRole('button',{name:'Next: Story',exact:true}).click();const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Upload PDF',exact:true}).click();await (await chooser).setFiles({name:'Alibaba.txt',mimeType:'text/plain',buffer:Buffer.from('Alibaba found a cave. PRIVATE_UNSELECTED_REST')});
  const source=page.getByRole('dialog',{name:'Select Story Text',exact:true});await source.locator('[data-selected]').fill('Alibaba found a cave.');await source.getByLabel('AI instructions',{exact:true}).fill('Make it clearer.');await source.getByRole('button',{name:'Improve with AI',exact:true}).click();await expect(source.getByLabel('Draft 1',{exact:true})).toHaveValue('Alibaba discovered a hidden cave.');await expect(source.locator('[data-selected]')).toHaveValue('Alibaba found a cave.');
  await source.getByRole('button',{name:'Use AI Text',exact:true}).click();await expect(source.locator('[data-selected]')).toHaveValue('Alibaba discovered a hidden cave.');
  // The Story step only produces the story text (owner direction 2026-11-08); Next: Characters carries it to Script.
  await expect(source.getByRole('button',{name:'Generate Script',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Next: Characters',exact:true}).click();await scriptStep(page);await expect(page.locator('#story-simple-script')).toHaveValue('Alibaba discovered a hidden cave.');
  const calls=await page.evaluate(()=>window.__qaCalls.filter(c=>c.path==='ai/enhance'));expect(JSON.stringify(calls)).not.toContain('PRIVATE_UNSELECTED_REST');
});

test('UPLOAD-06 Next: Characters selects the audio cast, fills voice properties and keeps Story Details synchronized through Back',async({page})=>{
  await boot(page,{sourceFit:'cast'});await page.getByLabel('Story name (required)',{exact:true}).fill('Ali and Morgiana');
  for(const [name,value] of Object.entries({output:'audio',type:'news',genre:'Sports',audience:'All ages',language:'English'}))await fillStoryDetail(page,name,value);
  await page.getByRole('button',{name:'Next: Story',exact:true}).click();
  const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Upload PDF',exact:true}).click();await (await chooser).setFiles({name:'Cast.txt',mimeType:'text/plain',buffer:Buffer.from('Ali and Morgiana found a cave. PRIVATE_UNSELECTED_REST')});
  const source=page.getByRole('dialog',{name:'Select Story Text',exact:true});const settings=page.getByRole('group',{name:'Story settings',exact:true});await settings.getByLabel('Story Type',{exact:true}).selectOption('storybook');await settings.getByLabel('Genre / Topic',{exact:true}).selectOption('Adventure');
  await source.locator('[data-selected]').fill('Ali and Morgiana found a cave.');await source.getByLabel('AI instructions',{exact:true}).fill('Make this a scene with the characters speaking.');await source.getByRole('button',{name:'Improve with AI',exact:true}).click();await source.getByRole('button',{name:'Use AI Text',exact:true}).click();
  expect(await page.evaluate(()=>window.__qaCalls.filter(c=>c.body?.fields?.[0]?.id==='story_workspace').length)).toBe(0);
  await expect(source.getByRole('button',{name:'Generate Script',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Next: Characters',exact:true}).click();await expect(page.locator('[data-character-tabs] [role=tab]')).toHaveCount(3);
  await expect(page.locator('[data-cast-reason]')).toContainText('3 characters suggested from your story');await expect(page.locator('#story-simple-candidate')).toBeHidden();await scriptStep(page);await expect(page.locator('#story-simple-script')).toHaveValue('Narrator: At the cave.\n\nAli: Open sesame!\n\nMorgiana: I will help.');await charactersStep(page);
  await page.getByRole('tab',{name:'Ali',exact:true}).click();await expect(page.getByLabel('Character 2 Name',{exact:true})).toHaveValue('Ali');await page.getByRole('tab',{name:'Morgiana',exact:true}).click();await expect(page.getByLabel('Character 3 Name',{exact:true})).toHaveValue('Morgiana');await page.getByRole('tab',{name:'Ali',exact:true}).click();
  await expect(page.locator('#story-character-properties details')).toHaveAttribute('open','');await expect(page.getByLabel('Character 2 Dialect',{exact:true})).toHaveValue('Indian English');await expect(page.getByLabel('Character 2 Speaking style',{exact:true})).toHaveValue('Curious');await expect(page.getByLabel('Character 2 Emotion',{exact:true})).toHaveValue('surprise');await expect(page.getByLabel('Character 2 Voice',{exact:true})).not.toHaveValue('');await expect(page.locator('[data-property=appearance]')).toHaveCount(0);
  const calls=await page.evaluate(()=>window.__qaCalls.filter(c=>c.body?.fields?.[0]?.id==='story_workspace'));expect(calls).toHaveLength(1);expect(JSON.parse(calls[0].body.context.summary)).toMatchObject({output:'audio',story_type:'storybook'});expect(calls[0].body.context.genre).toBe('Adventure');expect(calls[0].body.context.lines).toHaveLength(0);expect(JSON.stringify(calls)).not.toContain('PRIVATE_UNSELECTED_REST');
  // Back now walks the visited steps (Characters ← Script ← Characters); keep walking back to Details.
  for(let i=0;i<6&&!(await page.locator('#story-simple-details').count());i++)await page.locator('#workspace-back').click();await expect(page.locator('#story-simple-details [name=type]')).toHaveValue('storybook');await expect(page.locator('#story-simple-details [name=genre]')).toHaveValue('Adventure');await expect(page.locator('#story-simple-details [name=output][value=audio]')).toBeChecked();
  await fillStoryDetail(page,'type','audio-drama');await page.getByRole('tab',{name:'3. Characters',exact:true}).click();await expect(page.locator('[data-character-tabs] [role=tab]')).toHaveCount(3);
});

test('UPLOAD-07 real PDF pages and listed chapters populate original editable text before AI and final application',async({page})=>{
 await boot(page,{sourceFit:'cast',pdf:true});await page.getByLabel('Story name (required)',{exact:true}).fill('PDF source test');
 for(const [name,value]of Object.entries({output:'audio',type:'storybook',genre:'Adventure',audience:'All ages',language:'English'}))await fillStoryDetail(page,name,value);
 await page.getByRole('button',{name:'Next: Story',exact:true}).click();const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Upload PDF',exact:true}).click();await(await chooser).setFiles(new URL('../fixtures/source-chapters.pdf',import.meta.url).pathname);
 const source=page.getByRole('dialog',{name:'Select Story Text',exact:true}),middle=source.locator('[data-selected]');await expect(source.locator('[data-document-info]')).toContainText('10 PDF pages');await expect(middle).toHaveValue('');
 await source.locator('[data-pages-menu] summary').click();await source.locator('[data-pages]').fill('2–3');await source.locator('[data-pages]').press('Enter');await expect(middle).toHaveValue(/Page 2, line 1/);await expect(middle).toHaveValue(/Page 3, line 48/);await expect(middle).not.toHaveValue(/Page 1,|Page 4,|PRIVATE_NEXT_CHAPTER/);
 await source.getByRole('button',{name:'Clear Text',exact:true}).click();await source.locator('[data-chapter-menu] summary').press('Enter');await expect(source.locator('[data-chapter-list]')).toBeFocused();await source.locator('[data-chapter-list]').selectOption({label:'Chapter One · page 1'});await source.getByRole('button',{name:'Add Chapter',exact:true}).click();await expect(middle).toHaveValue(/^Chapter One\nBy A. Writer/);await expect(middle).not.toHaveValue(/Chapter Two|PRIVATE_NEXT_CHAPTER/);expect((await middle.inputValue()).length).toBeGreaterThan(30000);expect(await page.evaluate(()=>window.__qaCalls.filter(c=>c.path==='ai/enhance').length)).toBe(0);
 await middle.fill((await middle.inputValue()).replace('By A. Writer\n',''));await expect(middle).not.toHaveValue(/By A. Writer/);await source.getByLabel('AI instructions',{exact:true}).fill('Make a short scene with the three characters speaking.');await source.getByRole('button',{name:'Improve with AI',exact:true}).click();await expect(source.getByLabel('Draft 1',{exact:true})).toHaveValue(/Morgiana: I will help/);await expect(middle).toHaveValue(/Page 9, line 48/);
 await source.getByRole('button',{name:'Use AI Text',exact:true}).click();await expect(middle).toHaveValue('Narrator: At the cave.\n\nAli: Open sesame!\n\nMorgiana: I will help.');await page.getByRole('button',{name:'Next: Characters',exact:true}).click();await expect(page.locator('[data-character-tabs] [role=tab]')).toHaveCount(3);
 const calls=await page.evaluate(()=>window.__qaCalls.filter(c=>c.path==='ai/enhance'));expect(JSON.stringify(calls)).not.toContain('PRIVATE_NEXT_CHAPTER');const cast=JSON.parse(calls.find(c=>c.body.fields[0].id==='story_workspace').body.context.summary);expect(cast.script).toBe('Narrator: At the cave.\n\nAli: Open sesame!\n\nMorgiana: I will help.');expect(cast.script).not.toContain('By A. Writer');
});


test('UPLOAD-08 mouse selection, Find and Replace, manual edits and saved selection use only chosen PDF text',async({page})=>{
 await boot(page,{sourceFit:'cast',pdf:true});await page.getByLabel('Story name (required)',{exact:true}).fill('Selection editing test');for(const [name,value]of Object.entries({output:'audio',type:'storybook',genre:'Adventure',audience:'All ages',language:'English'}))await fillStoryDetail(page,name,value);await page.getByRole('button',{name:'Next: Story',exact:true}).click();
 const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Upload PDF',exact:true}).click();await(await chooser).setFiles(new URL('../fixtures/source-chapters.pdf',import.meta.url).pathname);
 const source=page.getByRole('dialog',{name:'Select Story Text',exact:true}),middle=source.locator('[data-selected]');const author=source.locator('.textLayer span').filter({hasText:/^By A\. Writer$/});await expect(author).toBeVisible();const rect=await author.boundingBox();await page.mouse.move(rect.x,rect.y+rect.height/2);await page.mouse.down();await page.mouse.move(rect.x+rect.width+2,rect.y+rect.height/2,{steps:8});await page.mouse.up();await expect(middle).toHaveValue('By A. Writer');
 await source.getByRole('button',{name:'Clear Text',exact:true}).click();await expect(middle).toHaveValue('');await source.locator('[data-pages-menu] summary').click();await source.locator('[data-pages]').fill('2');await source.locator('[data-pages]').press('Enter');await expect(middle).toHaveValue(/Page 2, line 48/);
 await source.locator('.pdf-find-replace summary').click();await source.getByLabel('Find',{exact:true}).fill('Ali');await source.getByLabel('Replace with',{exact:true}).fill('Asha');await source.locator('[data-replace-scope]').selectOption('all');await source.getByRole('button',{name:'Replace',exact:true}).click();await expect(middle).toHaveValue(/Asha and Morgiana/);await expect(middle).not.toHaveValue(/Ali and Morgiana|Page 1,|Page 3,/);await page.keyboard.press('Escape');
 await middle.fill('Asha: I will help.\nMorgiana: Thank you.');await source.getByRole('button',{name:'Save Draft',exact:true}).click();await expect(source.locator('[role=status]')).toContainText('Draft saved');await page.keyboard.press('Escape');await page.getByRole('button',{name:'Resume Saved Selection',exact:true}).click();await expect(source.locator('[data-selected]')).toHaveValue('Asha: I will help.\nMorgiana: Thank you.');await page.getByRole('button',{name:'Next: Characters',exact:true}).click();await scriptStep(page);await expect(page.locator('#story-simple-script')).toHaveValue('Asha: I will help.\nMorgiana: Thank you.');
});

test('DESK-BRAND-01 original light Desk styling retains Ecco name and logo',async({page})=>{
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/desk/index.html?__qa=1');
  const logo=page.getByRole('img',{name:'Ecco AI Labs logo'});
  await expect(logo).toBeVisible();await expect.poll(()=>logo.evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
  await expect(page.locator('.app-shell')).toHaveCSS('background-color','rgb(247, 248, 250)');
  await expect(page.locator('.sidebar')).toHaveCSS('background-color','rgb(17, 42, 56)');
  await page.getByRole('button',{name:'Notifications',exact:true}).click();
  await expect(page.getByRole('button',{name:'New Notification',exact:true})).toHaveCSS('background-color','rgb(243, 212, 99)');
  await expect(page.getByRole('tab',{name:'Notifications',exact:true})).toHaveCSS('background-color','rgb(255, 255, 255)');
  await page.getByRole('button',{name:'New Notification',exact:true}).click();
  await expect(page.getByLabel('Title',{exact:true})).toHaveCSS('background-color','rgb(255, 255, 255)');
  await expect(page.getByRole('button',{name:'Publish notification',exact:true})).toHaveCSS('background-color','rgb(17, 42, 56)');
  await expect(page.locator('.notification-composer')).toHaveCSS('font-family',/Arial/);
  await expect(page.getByLabel('Title',{exact:true})).toHaveCSS('font-size','11px');
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByLabel('Message',{exact:true})).toBeVisible();
  expect(await page.locator('.notification-composer').evaluate(el=>el.getBoundingClientRect().right)).toBeLessThanOrEqual(390);
  await page.goto('/desk/index.html?__qa=1&signedOut=1');
  await expect(page.getByRole('heading',{name:'Sign in to Ecco Desk',exact:true})).toBeVisible();
  await expect(logo).toBeVisible();await expect.poll(()=>logo.evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
  await expect(page.locator('.signin')).toHaveCSS('background-color','rgb(247, 248, 246)');
});

test('NOTIFY-03 notification table stays inside a narrow viewport',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/?__qa=1&notices=1');await page.waitForFunction(()=>window.__qaReady);
  await page.locator('#entry-tell-story').click();await page.getByRole('button',{name:'New Story',exact:true}).click();await page.locator('#notification-bell').click();
  const panel=page.locator('#notification-list');
  const bounds=await panel.evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,scroll:el.scrollWidth,width:el.clientWidth}));
  expect(bounds.left).toBeGreaterThanOrEqual(0);expect(bounds.right).toBeLessThanOrEqual(390);expect(bounds.scroll).toBeLessThanOrEqual(bounds.width);
  await expect(page.getByRole('table',{name:'New notifications',exact:true}).getByRole('columnheader')).toHaveText(['Number','Notification','Date it expires']);
});

test('AGENT-04 administrator creates, saves and runs a shared ordered workflow',async({page})=>{
  test.setTimeout(90000);
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/desk/index.html?__qa=1');
  await page.getByRole('button',{name:'Agents',exact:true}).click();
  await page.getByRole('button',{name:'Create New Agents',exact:true}).click();
  await expect(page.getByLabel('Agent Name',{exact:true})).toBeFocused();
  await page.getByLabel('Agent Name',{exact:true}).fill('Release Review');
  await page.getByLabel('Purpose',{exact:true}).fill('Review story navigation and video previews');
  await page.getByRole('button',{name:'Add Step',exact:true}).click();
  await page.getByLabel('Step 2 workflow',{exact:true}).selectOption('story');
  await page.getByRole('button',{name:'Move step 2 up',exact:true}).click();
  await expect(page.getByLabel('Step 1 workflow',{exact:true})).toHaveValue('story');
  await page.getByRole('button',{name:'Create Agent',exact:true}).click();
  await expect(page.locator('.agent-card')).toHaveCount(2);
  await expect(page.getByRole('button',{name:'Create New Agents',exact:true})).toBeFocused();
  await page.reload();await page.getByRole('button',{name:'Agents',exact:true}).click();
  await page.locator('.agent-card').filter({hasText:'Release Review'}).click();
  await expect(page.getByRole('heading',{name:'Release Review',exact:true})).toBeVisible();
  await expect(page.locator('.agent-step-summary li')).toHaveCount(2);
  await page.getByRole('button',{name:'Select all tests',exact:true}).click();
  await page.getByRole('button',{name:/^Run selected tests/}).click();
  await expect(page.getByRole('button',{name:/^Run selected tests/})).toBeEnabled({timeout:75000});
  const run=await page.evaluate(()=>{const id=JSON.parse(localStorage.getItem('ecco-desk-qa-agents'))[0].id;return JSON.parse(localStorage.getItem('ecco-agent-runs:v1:qa-desk-user:'+id))[0];});
  expect(run.scope).toBe('Release Review');expect(run.status).toBe('completed');
  expect(run.checks.some(c=>c.id==='step-1/story-choices'&&c.status==='passed')).toBe(true);
  expect(run.checks.some(c=>c.id==='step-2/video-small-thumb-0'&&c.status==='passed')).toBe(true);
  expect(new Set(run.checks.map(c=>c.id)).size).toBe(run.checks.length);
  await expect(page.locator('.agent-finding')).toHaveCount(1);
  await page.getByRole('button',{name:'Create ticket',exact:true}).click();await expect(page.locator('.agent-ticket-link')).toHaveCount(1);
});
test('AGENT-05 only administrators see creation; shortened navigation remains available',async({page})=>{
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  for(const role of ['customer','staff','group']){
    await page.goto('/desk/index.html?__qa=1&role='+role);
    await expect(page.getByRole('button',{name:'Notifications',exact:true})).toBeVisible();
    if(role!=='staff')await expect(page.getByRole('button',{name:/^Support 0$/})).toBeVisible();
    await page.getByRole('button',{name:'Agents',exact:true}).click();
    await expect(page.getByRole('button',{name:'Create New Agents',exact:true})).toHaveCount(role==='group'?1:0);
  }
});

test('CAMPAIGN-01 schedule, edit, pause and resume a persistent annual campaign',async({page})=>{
  await page.clock.setFixedTime(new Date('2026-11-08T00:00:00Z'));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/desk/index.html?__qa=1');
  await page.getByRole('button',{name:'Notifications',exact:true}).click();
  await page.getByRole('tab',{name:'Campaign',exact:true}).click();
  await page.getByRole('button',{name:'New Campaign',exact:true}).click();
  await expect(page.getByLabel('Campaign Name',{exact:true})).toBeFocused();
  await page.getByLabel('Campaign Name',{exact:true}).fill('Cyber Monday');
  await expect(page.getByLabel('Show Upcoming (days before)',{exact:true})).toHaveValue('7');await page.getByLabel('Show Upcoming (days before)',{exact:true}).fill('14');
  await page.getByLabel('Bell Icon',{exact:true}).uncheck();await page.getByLabel('Icon',{exact:true}).selectOption('Dhamaka');
  await page.getByLabel('Start',{exact:true}).fill('2026-11-01');await page.getByLabel('End',{exact:true}).fill('2028-12-31');await page.getByLabel('Recurrence',{exact:true}).selectOption('cyber_monday');
  await expect(page.locator('.campaign-next')).toContainText('Nov 30, 2026');
  await page.getByLabel('Title',{exact:true}).fill('Cyber Monday is here');
  await page.getByLabel('Message',{exact:true}).fill('Our annual announcement.');
  await page.getByRole('button',{name:'Create & Schedule',exact:true}).click();
  await expect(page.locator('.campaign-card')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'New Campaign',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'Pause Cyber Monday',exact:true}).click();
  await expect(page.locator('.campaign-state')).toHaveText('Paused');
  await page.getByRole('button',{name:'Edit Cyber Monday',exact:true}).click();
  await expect(page.getByLabel('Bell Icon',{exact:true})).not.toBeChecked();await expect(page.getByLabel('Billing',{exact:true})).toBeChecked();await expect(page.getByLabel('Icon',{exact:true})).toHaveValue('Dhamaka');
  await expect(page.getByLabel('Show Upcoming (days before)',{exact:true})).toHaveValue('14');
  await page.getByLabel('Message',{exact:true}).fill('Updated annual announcement.');
  await page.getByRole('button',{name:'Save Campaign',exact:true}).click();
  await page.getByRole('button',{name:'Resume Cyber Monday',exact:true}).click();
  await expect(page.locator('.campaign-state')).toHaveText('Active');
  await page.reload();await page.getByRole('button',{name:'Notifications',exact:true}).click();
  await page.getByRole('tab',{name:'Campaign',exact:true}).click();
  await expect(page.locator('.campaign-card')).toHaveCount(1);
  await page.locator('.campaign-card summary').click();await expect(page.locator('.campaign-card')).toContainText('Updated annual announcement.');
  await page.setViewportSize({width:768,height:1000});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(768);
  expect(await page.evaluate(()=>window.__deskPosts.filter(p=>p.op==='createNotification').length)).toBe(0);

});


test('NOTIFY-04 history-first category tabs and circled create actions',async({page})=>{
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/desk/index.html?__qa=1');await page.getByRole('button',{name:'Notifications',exact:true}).click();
  await expect(page.getByRole('tablist',{name:'Notification categories'}).getByRole('tab')).toHaveText(['Notifications','OutReach','Campaign']);
  await expect(page.getByLabel('Type',{exact:true})).toHaveCount(0);await expect(page.locator('.notification-composer')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'New Notification',exact:true})).toHaveCSS('border-radius','50%');
  await page.getByRole('tab',{name:'Notifications',exact:true}).press('ArrowRight');await expect(page.getByRole('tab',{name:'OutReach',exact:true})).toBeFocused();
  await expect(page.getByRole('tab',{name:'OutReach',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.locator('.notification-composer')).toHaveCount(0);await page.getByRole('button',{name:'New OutReach',exact:true}).click();
  await expect(page.getByLabel('Title',{exact:true})).toBeFocused();await page.getByLabel('Title',{exact:true}).fill('OutReach example');await page.getByLabel('Message',{exact:true}).fill('Example bonus credit offer');
  await page.getByLabel('Bell Icon',{exact:true}).uncheck();await page.getByLabel('Icon',{exact:true}).selectOption('Dhamaka');
  await page.getByLabel('Purchase credits',{exact:true}).fill('100');await page.getByLabel('Free bonus credits',{exact:true}).fill('50');await page.getByLabel('Price (USD)',{exact:true}).fill('10');
  await page.getByRole('button',{name:'Publish outreach',exact:true}).click();await expect(page.locator('.notification-composer')).toHaveCount(0);await expect(page.locator('.notification-history')).toContainText('OutReach example');await expect(page.locator('.notification-history')).toContainText('Billing');
  await page.getByRole('button',{name:'Edit and re-issue OutReach example',exact:true}).click();await expect(page.getByLabel('Bell Icon',{exact:true})).not.toBeChecked();await expect(page.getByLabel('Icon',{exact:true})).toHaveValue('Dhamaka');await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('tab',{name:'Notifications',exact:true}).click();await expect(page.locator('.notification-history')).toHaveCount(0);await expect(page.getByText('No notifications yet.',{exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'Campaign',exact:true}).click();await expect(page.locator('.notification-composer')).toHaveCount(0);await page.getByRole('button',{name:'New Campaign',exact:true}).click();await expect(page.getByLabel('Campaign Name',{exact:true})).toBeFocused();await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByRole('button',{name:'New Campaign',exact:true})).toBeFocused();
  await page.setViewportSize({width:390,height:844});const tabs=page.getByRole('tablist',{name:'Notification categories'});expect(await tabs.evaluate(el=>el.scrollWidth)).toBeLessThanOrEqual(await tabs.evaluate(el=>el.clientWidth));
});

test('UPLOAD-03 story settings labels synchronize Story Details and send current choices with the prompt',async({page})=>{
 await boot(page,{sourceFit:'fiction'});await page.getByLabel('Story name (required)',{exact:true}).fill('Ribbon story');
 for(const [name,value] of Object.entries({output:'audio',type:'podcast',genre:'Comedy',audience:'All ages',language:'English'}))await fillStoryDetail(page,name,value);
 await page.getByRole('button',{name:'Next: Story',exact:true}).click();const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Upload PDF',exact:true}).click();await (await chooser).setFiles({name:'ribbon.txt',mimeType:'text/plain',buffer:Buffer.from('PRIVATE_UNSELECTED original document.')});
 const source=page.getByRole('dialog',{name:'Select Story Text',exact:true}),ribbon=source.getByRole('group',{name:'AI story controls',exact:true}),ai=ribbon.getByRole('button',{name:'Improve with AI',exact:true}),settings=page.getByRole('group',{name:'Story settings',exact:true});
 await expect(ribbon.locator('select')).toHaveCount(0);for(const [name,value] of Object.entries({story_type:'podcast',genre:'Comedy',age_group:'All ages',language:'English'}))await expect(settings.locator('[data-story-setting='+name+']')).toHaveValue(value);
 await expect(source.getByText('Uses only Selected Text. Highlight words there to limit the change.',{exact:true})).toHaveCount(0);await expect(source.getByText('Prompt',{exact:true})).toHaveCount(0);await expect(ai).toHaveText('✦');expect((await ai.boundingBox()).width).toBeLessThanOrEqual(32);expect((await ribbon.boundingBox()).y).toBeLessThan((await source.getByLabel('AI instructions',{exact:true}).boundingBox()).y);
 const fields=await settings.locator('select').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().y));expect(new Set(fields).size).toBe(1);
 for(const [name,value] of Object.entries({story_type:'storybook',genre:'Fantasy',age_group:'Children (9–12)',language:'Hindi'}))await settings.locator('[data-story-setting='+name+']').selectOption(value);
 await source.locator('[data-selected]').fill('Alibaba found a cave.');await source.getByLabel('AI instructions',{exact:true}).fill('Make it simpler.');await ai.click();await expect(source.getByLabel('Draft 1',{exact:true})).toHaveValue('Alibaba discovered a hidden cave.');
 const call=await page.evaluate(()=>window.__qaCalls.find(c=>c.body?.fields?.[0]?.id==='source_excerpt'));expect(call.body.context.language).toBe('Hindi');expect(call.body.context.genre).toBe('Fantasy');expect(JSON.parse(call.body.context.summary)).toMatchObject({story_type:'storybook',age_group:'Children (9–12)'});expect(JSON.stringify(call)).not.toContain('PRIVATE_UNSELECTED');
 await settings.getByLabel('Genre / Topic',{exact:true}).selectOption('Adventure');await expect(source.getByLabel('Draft 1',{exact:true})).toHaveValue('');await expect(source.locator('[data-selected]')).toHaveValue('Alibaba found a cave.');await expect(source.getByRole('button',{name:'Use AI Text',exact:true})).toBeDisabled();
 await page.getByRole('tab',{name:'1. Details',exact:true}).click();
 for(const [name,value] of Object.entries({type:'storybook',genre:'Adventure',audience:'Children (9–12)',language:'Hindi'}))await expect(page.locator('#story-simple-details [name='+name+']')).toHaveValue(value);
 await page.locator('#story-simple-details [name=language]').selectOption('Urdu');await page.getByRole('tab',{name:'2. Story',exact:true}).click();await expect(settings.getByLabel('Language',{exact:true})).toHaveValue('Urdu');await expect(source.locator('[data-selected]')).toHaveValue('Alibaba found a cave.');
});

test('UPLOAD-04 AI clarification opens a popup and preserves equal text boxes and selected content',async({page})=>{
 await boot(page,{sourceFit:'clarification'});await page.getByLabel('Story name (required)',{exact:true}).fill('Alibaba');
 for(const [name,value] of Object.entries({output:'audio',type:'storybook',genre:'Fantasy',audience:'All ages',language:'English'}))await fillStoryDetail(page,name,value);
 await page.getByRole('button',{name:'Next: Story',exact:true}).click();const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Upload PDF',exact:true}).click();await (await chooser).setFiles({name:'jars.txt',mimeType:'text/plain',buffer:Buffer.from('Thirty-nine jars.')});
 const source=page.getByRole('dialog',{name:'Select Story Text',exact:true});await source.locator('[data-selected]').fill('Thirty-nine jars.');await source.getByLabel('AI instructions',{exact:true}).fill('Improve the narration.');await source.getByRole('button',{name:'Improve with AI',exact:true}).click();
 const notice=page.getByRole('dialog',{name:'AI Needs Clarification',exact:true});await expect(notice).toBeVisible();await expect(notice).toContainText('Should the burial count be 38, or should the oil be stored separately?');await expect(notice.getByRole('button',{name:'Set burial count to 38 Recommended',exact:true})).toBeVisible();await expect(notice.getByRole('button',{name:'Store oil separately',exact:true})).toBeVisible();await expect(notice.locator('[data-ai-recommendation]')).toContainText('change the burial count to 38');await expect(source.getByLabel('Draft 1',{exact:true})).toHaveValue('');await expect(source.locator('[data-ai-status]')).toHaveText('');
 await notice.getByRole('button',{name:'Edit Prompt',exact:true}).click();await expect(notice).toHaveCount(0);await expect(source.getByLabel('AI instructions',{exact:true})).toBeFocused();await expect(source.locator('[data-selected]')).toHaveValue('Thirty-nine jars.');const a=await source.getByLabel('AI instructions',{exact:true}).boundingBox(),b=await source.getByLabel('Draft 1',{exact:true}).boundingBox();expect(Math.abs(a.height-b.height)).toBeLessThan(1);
 await source.getByRole('button',{name:'Improve with AI',exact:true}).click();await notice.getByRole('button',{name:'Continue Anyway',exact:true}).click();await expect(notice).toHaveCount(0);await expect(source.getByLabel('Draft 1',{exact:true})).toHaveValue('Thirty-nine jars stood ready, one holding oil. Later, thirty-nine robbers were buried.');await expect(source.locator('[data-selected]')).toHaveValue('Thirty-nine jars.');expect(await page.evaluate(()=>window.__qaCalls.filter(c=>c.body?.fields?.[0]?.id==='source_excerpt').length)).toBe(2);
});

for(const answer of ['Set burial count to 38','Store oil separately'])test(`UPLOAD-05 ${answer} resumes generation with one click`,async({page})=>{
 await boot(page,{sourceFit:'clarification'});await page.getByLabel('Story name (required)',{exact:true}).fill('Alibaba');
 for(const [name,value] of Object.entries({output:'audio',type:'storybook',genre:'Fantasy',audience:'All ages',language:'English'}))await fillStoryDetail(page,name,value);
 await page.getByRole('button',{name:'Next: Story',exact:true}).click();const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Upload PDF',exact:true}).click();await (await chooser).setFiles({name:'jars.txt',mimeType:'text/plain',buffer:Buffer.from('PRIVATE_UNSELECTED document.')});
 const source=page.getByRole('dialog',{name:'Select Story Text',exact:true});await source.locator('[data-selected]').fill('Thirty-nine jars.');await source.getByLabel('AI instructions',{exact:true}).fill('Improve the narration.');await source.getByRole('button',{name:'Improve with AI',exact:true}).click();
 const notice=page.getByRole('dialog',{name:'AI Needs Clarification',exact:true});const choice=notice.getByRole('button',{name:answer==='Set burial count to 38'?answer+' Recommended':answer,exact:true});await choice.focus();await page.keyboard.press('Enter');await expect(notice).toHaveCount(0);
 const output=source.getByLabel('Draft 1',{exact:true});await expect(output).toHaveValue(answer==='Set burial count to 38'?'Thirty-nine jars held one jar of oil and thirty-eight robbers. They buried thirty-eight robbers.':'Thirty-nine jars hid thirty-nine robbers. The oil was stored separately.');await expect(source.locator('[data-selected]')).toHaveValue('Thirty-nine jars.');
 const calls=await page.evaluate(()=>window.__qaCalls.filter(c=>c.body?.fields?.[0]?.id==='source_excerpt'));expect(calls).toHaveLength(2);expect(calls[1].body.context.instructions).toContain('User selected this answer to the clarification: '+answer);expect(JSON.stringify(calls)).not.toContain('PRIVATE_UNSELECTED');
});


// Release management uses isolated GitHub/hosting receipts; never deploy from QA.
async function releaseDesk(page,query=''){
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.goto('/desk/index.html?__qa=1'+query);
 await page.getByRole('button',{name:'Releases',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Pending changes',exact:true})).toBeVisible();
}
test('RELEASE-01 prepare freezes reviewed changes and only Publish requests deployment',async({page})=>{
 await releaseDesk(page);
 await expect(page.getByRole('button',{name:'Create task',exact:true})).toHaveCount(0);
 await page.getByLabel('Release name',{exact:true}).fill('Library improvements');
 await page.getByRole('button',{name:'Prepare release',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Prepared releases',exact:true})).toBeFocused();
 await expect(page.getByRole('link',{name:'Preview Library improvements',exact:true})).toHaveAttribute('href','https://ecco-ai-labs.github.io/ecco-studio/previews/'+'a'.repeat(40)+'/');
 expect(await page.evaluate(()=>window.__deskPosts.map(p=>p.op))).toEqual(['prepareRelease']);
 // Later Dev edits must not alter the prepared release or the publish payload.
 await page.evaluate(()=>window.__releaseData.head='d'.repeat(40));
 await page.getByRole('button',{name:'Refresh status',exact:true}).click();
 await page.getByRole('button',{name:'Publish Library improvements to Production',exact:true}).click();
 await expect(page.getByText('Queued',{exact:true})).toBeVisible();
 const posts=await page.evaluate(()=>window.__deskPosts);expect(posts[1]).toEqual({op:'publishRelease',id:posts[0].id});expect(posts[0].sha).toBe('a'.repeat(40));
 await expect(page.getByRole('link',{name:'Preview Library improvements',exact:true})).toHaveAttribute('href',/a{40}/);
});
test('RELEASE-02 failed checks block preparation and setup blocks publishing',async({page})=>{
 await releaseDesk(page,'&releaseChecks=failure');await page.getByLabel('Release name',{exact:true}).fill('Not ready');
 await expect(page.getByRole('button',{name:'Prepare release',exact:true})).toBeDisabled();
 await page.goto('/desk/index.html?__qa=1&releaseSetup=blocked');await page.getByRole('button',{name:'Releases',exact:true}).click();
 await expect(page.getByRole('region',{name:'Production setup'})).toBeVisible();
 await page.getByLabel('Release name',{exact:true}).fill('Waiting for hosting');await page.getByRole('button',{name:'Prepare release',exact:true}).click();
 await expect(page.getByRole('button',{name:'Publish Waiting for hosting to Production',exact:true})).toBeDisabled();
 expect(await page.evaluate(()=>window.__deskPosts.filter(p=>p.op==='publishRelease'))).toEqual([]);
});
test('RELEASE-03 staff and customers cannot access release controls',async({page})=>{
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 for(const role of ['staff','customer','group']){
  await page.goto('/desk/index.html?__qa=1&role='+role);await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.getByRole('button',{name:'Releases',exact:true})).toHaveCount(0);
 }
});
test('RELEASE-04 history prepares a rollback with keyboard and narrow layout',async({page})=>{
 await releaseDesk(page);
 await page.evaluate(()=>{window.__releaseData.history.push({id:'older',title:'Earlier release',sha:'c'.repeat(40),actor:'QA Admin',publishedAt:'2026-11-05T18:00:00Z',url:'https://github.com/ecco-ai-labs/ecco-studio/releases/tag/older'});});
 await page.getByRole('button',{name:'Refresh status',exact:true}).click();
 await page.getByRole('button',{name:'Prepare rollback',exact:true}).focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('heading',{name:'Prepared releases',exact:true})).toBeFocused();
 const posts=await page.evaluate(()=>window.__deskPosts);expect(posts[0].op).toBe('prepareRollback');expect(posts[0].sha).toBe('c'.repeat(40));
 await page.setViewportSize({width:768,height:1024});await expect(page.getByRole('button',{name:'Publish Rollback to cccccccc to Production',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('BILLING-01 configured promotion icons and expiry appear above regular packages',async({page})=>{
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto('/?__qa=1&promotions=1');await page.locator('#entry-tell-story').click();await page.locator('#google-user-menu > summary').click();await page.getByRole('button',{name:'Billing',exact:true}).click();
 const billing=page.getByRole('region',{name:'Billing',exact:true});await expect(billing.locator('.credits-promotion-badge')).toHaveText(['Dhamaka','NEW']);await expect(billing.locator('time')).toHaveCount(2);
 await billing.getByRole('button',{name:'Purchase Additional Credits',exact:true}).click();const shop=page.locator('dialog[open]');
 await expect(shop.locator('.credits-promotion')).toHaveCount(2);await expect(shop.locator('.credits-pack')).toHaveCount(3);await expect(shop.locator('.credits-promotion-expiry').first()).toContainText('Offer lasts till');
 expect((await shop.locator('.credits-notices').boundingBox()).y).toBeLessThan((await shop.locator('.credits-pack-grid').boundingBox()).y);
 await shop.getByRole('button',{name:'Select Diwali bonus',exact:true}).click();await shop.getByRole('button',{name:'View Cart',exact:true}).click();await expect(shop.locator('.credits-order-summary')).toContainText('150');await expect(shop.locator('.credits-order-total')).toContainText('$10.00');
 await shop.getByRole('button',{name:'Continue Shopping',exact:true}).click();await page.setViewportSize({width:390,height:844});await expect(shop.locator('.credits-promotion-badge').first()).toHaveText('Dhamaka');expect(await shop.evaluate(el=>el.scrollWidth)).toBeLessThanOrEqual(await shop.evaluate(el=>el.clientWidth));
 await shop.locator('[data-notice-id=promo-outreach]').getByRole('button',{name:'Mark as Read',exact:true}).click();await expect(shop.locator('[data-notice-id=promo-outreach]')).toHaveCount(0);await expect(shop.getByRole('button',{name:'View Cart',exact:true})).toBeDisabled();await expect(shop.locator('.credits-pack')).toHaveCount(3);
});


test('CAMPAIGN-02 calendar range accepts past dates and persists recurrence',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-11-08T00:00:00Z'));
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto('/desk/index.html?__qa=1');await page.getByRole('button',{name:'Notifications',exact:true}).click();await page.getByRole('tab',{name:'Campaign',exact:true}).click();await page.getByRole('button',{name:'New Campaign',exact:true}).click();
 await expect(page.getByLabel('Start',{exact:true})).toHaveAttribute('type','date');await expect(page.getByLabel('End',{exact:true})).toHaveAttribute('type','date');await expect(page.getByLabel('Start',{exact:true})).not.toHaveAttribute('min',/.+/);await expect(page.getByLabel('Year',{exact:true})).toHaveCount(0);await expect(page.getByLabel('Month',{exact:true})).toHaveCount(0);await expect(page.getByLabel('Day of Month',{exact:true})).toHaveCount(0);
 await page.getByLabel('Recurrence',{exact:true}).focus();await page.keyboard.press('Shift+Tab');await expect(page.getByLabel('End',{exact:true})).toBeFocused();
 await page.getByLabel('Start',{exact:true}).fill('2020-11-01');await page.getByLabel('End',{exact:true}).fill('2020-11-30');await page.getByLabel('Recurrence',{exact:true}).selectOption('monthly');
 await expect(page.locator('.campaign-next')).toContainText('No remaining runs');await expect(page.getByRole('alert')).toHaveCount(0);await expect(page.getByRole('button',{name:'Create & Schedule',exact:true})).toBeEnabled();
 await page.getByLabel('Campaign Name',{exact:true}).fill('Calendar campaign');await page.getByLabel('Title',{exact:true}).fill('November offer');await page.getByLabel('Message',{exact:true}).fill('Saved historical range.');await page.getByRole('button',{name:'Create & Schedule',exact:true}).click();await expect(page.locator('.campaign-state')).toHaveText('Completed');
 await page.reload();await page.getByRole('button',{name:'Notifications',exact:true}).click();await page.getByRole('tab',{name:'Campaign',exact:true}).click();await page.getByRole('button',{name:'Edit Calendar campaign',exact:true}).click();await expect(page.getByLabel('Start',{exact:true})).toHaveValue('2020-11-01');await expect(page.getByLabel('End',{exact:true})).toHaveValue('2020-11-30');await expect(page.getByLabel('Recurrence',{exact:true})).toHaveValue('monthly');
 await page.getByLabel('Start',{exact:true}).fill('2026-11-01');await page.getByLabel('End',{exact:true}).fill('2026-11-30');await page.getByLabel('Recurrence',{exact:true}).selectOption('daily');await expect(page.locator('.campaign-next')).toContainText('Starts now · Nov 7, 2026');await page.getByRole('button',{name:'Save Campaign',exact:true}).click();await expect(page.locator('.campaign-state')).toHaveText('Active');
 await page.getByRole('button',{name:'Edit Calendar campaign',exact:true}).click();await page.getByLabel('End',{exact:true}).fill('2026-10-31');await expect(page.getByRole('alert')).toHaveText('End must be on or after Start.');await expect(page.getByRole('button',{name:'Save Campaign',exact:true})).toBeDisabled();await page.getByLabel('End',{exact:true}).fill('2028-11-30');await page.getByLabel('Recurrence',{exact:true}).selectOption('yearly');await expect(page.locator('.campaign-next')).toContainText('Nov 1, 2027');await expect(page.getByRole('alert')).toHaveCount(0);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);await expect(page.getByLabel('Start',{exact:true})).toBeVisible();await expect(page.getByLabel('End',{exact:true})).toBeVisible();await page.screenshot({path:'test-results/campaign-calendar-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'Save Campaign',exact:true}).click();await page.reload();await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.getByRole('button',{name:'Notifications',exact:true}).click();await page.getByRole('tab',{name:'Campaign',exact:true}).click();await page.getByRole('button',{name:'Edit Calendar campaign',exact:true}).click();await expect(page.getByLabel('Start',{exact:true})).toHaveValue('2026-11-01');await expect(page.getByLabel('End',{exact:true})).toHaveValue('2028-11-30');await expect(page.getByLabel('Recurrence',{exact:true})).toHaveValue('yearly');
 expect(await page.evaluate(()=>window.__deskPosts.filter(p=>p.op==='createNotification').length)).toBe(0);
});

test('CAMPAIGN-03 a campaign starting today previews immediate activation after its send time',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-11-08T01:30:00Z'));
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto('/desk/index.html?__qa=1');await page.getByRole('button',{name:'Notifications',exact:true}).click();await page.getByRole('tab',{name:'Campaign',exact:true}).click();await page.getByRole('button',{name:'New Campaign',exact:true}).click();
 await page.getByLabel('Start',{exact:true}).fill('2026-11-07');await page.getByLabel('End',{exact:true}).fill('2028-03-31');await page.getByLabel('Recurrence',{exact:true}).selectOption('yearly');await page.getByLabel('Notification Duration (days)',{exact:true}).fill('30');await page.getByLabel('Bell Icon',{exact:true}).uncheck();
 await expect(page.locator('.campaign-next')).toContainText('Starts now · Nov 7, 2026');await expect(page.locator('.campaign-next')).not.toContainText('2027');
 await page.getByLabel('Send Time',{exact:true}).fill('21:00');await expect(page.locator('.campaign-next')).toContainText('Nov 7, 2026, 9:00 PM');await expect(page.locator('.campaign-next')).not.toContainText('Starts now');await page.getByLabel('Send Time',{exact:true}).fill('09:00');await expect(page.locator('.campaign-next')).toContainText('Starts now');
 await page.getByLabel('Campaign Name',{exact:true}).fill('Starts today');await page.getByLabel('Title',{exact:true}).fill('Annual offer');await page.getByLabel('Message',{exact:true}).fill('Visible for 30 days.');await page.getByRole('button',{name:'Create & Schedule',exact:true}).click();await expect(page.locator('.campaign-card')).toContainText('Starts now · Nov 7, 2026');
 await page.getByRole('button',{name:'Edit Starts today',exact:true}).click();await expect(page.getByLabel('Notification Duration (days)',{exact:true})).toHaveValue('30');await expect(page.getByLabel('Billing',{exact:true})).toBeChecked();await expect(page.getByLabel('Bell Icon',{exact:true})).not.toBeChecked();await expect(page.locator('.campaign-next')).toContainText('Starts now');
});


test('CAMPAIGN-04 Upcoming remains after reading across Billing surfaces and transitions on refresh',async({page})=>{
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.goto('/?__qa=1&upcoming=1');await page.locator('#entry-tell-story').click();await page.locator('#google-user-menu > summary').click();await page.getByRole('button',{name:'Billing',exact:true}).click();
 const drawer=page.locator('#workspace-billing-drawer'),preview=drawer.locator('[data-state=upcoming]');
 await expect(preview).toContainText('Upcoming');await expect(preview).toContainText('Dhamaka');await expect(preview).toContainText('Festival preview');await expect(preview).toContainText('Starts');await expect(preview).toContainText('Offer lasts till');await expect(preview.locator('time')).toHaveCount(2);await expect(preview.getByRole('button',{name:'Mark as Read',exact:true})).toBeVisible();await expect(preview.locator('h3')).toHaveCSS('font-weight','700');await preview.getByRole('button',{name:'Mark as Read',exact:true}).click();await expect(preview).toHaveAttribute('data-read','true');await expect(preview.locator('h3')).toHaveCSS('font-weight','400');await expect(preview.locator('h3')).toBeFocused();await expect(page.locator('#notification-bell')).toHaveAttribute('aria-label','Notifications');
 await drawer.getByRole('button',{name:'Purchase Additional Credits',exact:true}).click();
 const shop=page.locator('dialog[open].credits-dialog');await expect(shop.locator('[data-state=upcoming]')).toBeVisible();await expect(shop.locator('[data-state=upcoming]').getByRole('button',{name:'Read',exact:true})).toBeDisabled();await expect(shop.locator('[data-state=upcoming] h3')).toHaveCSS('font-weight','400');await expect(shop.locator('.credits-pack')).toHaveCount(3);await expect(shop.getByRole('button',{name:'View Cart',exact:true})).toBeDisabled();
 expect(await shop.evaluate(el=>!!(el.querySelector('[data-state=upcoming]').compareDocumentPosition(el.querySelector('.credits-pack-grid'))&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
 await shop.getByRole('button',{name:'Close popup',exact:true}).click();await page.locator('#google-user-menu > summary').click();await page.getByRole('button',{name:'Credit and Usage',exact:true}).click();await expect(page.locator('#workspace-usage-drawer [data-state=upcoming]')).toBeVisible();
 await page.evaluate(async()=>{const readAt=window.__qaUpcoming[0].readAt;window.__qaUpcoming.length=0;window.__qaBillingNotices.push({readAt,id:'active-campaign',kind:'marketing_campaign',title:'Festival preview',body:'Our offer is now active.',severity:'informational',badge:'Dhamaka',expiresAt:'2099-12-07T05:00:00Z'});await window.EccoNotifications.refresh()});
 await expect(page.locator('#workspace-usage-drawer [data-state=upcoming]')).toHaveCount(0);await expect(page.locator('#workspace-usage-drawer [data-notice-id=active-campaign]')).toContainText('Our offer is now active.');await expect(page.locator('#workspace-usage-drawer [data-notice-id=active-campaign] h3')).toHaveCSS('font-weight','400');await expect(page.locator('#notification-bell')).toHaveAttribute('aria-label','Notifications');
});

test('AGENT-06 choose individual tests and never execute unchecked actions',async({page})=>{
 test.setTimeout(90000);
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.addInitScript(()=>{
  if(window===top){window.__agentActions=[];return;}
  document.addEventListener('input',e=>{if(e.target.matches('#lh-search'))top.__agentActions.push('search');},true);
  document.addEventListener('change',e=>{if(e.target.matches('#lh-sort'))top.__agentActions.push('sort');},true);
  document.addEventListener('click',e=>{const b=e.target.closest('[data-act=view]');if(b)top.__agentActions.push('view:'+b.dataset.view);},true);
 });
 await page.goto('/desk/index.html?__qa=1');await page.getByRole('button',{name:'Agents',exact:true}).click();await page.locator('.agent-card').click();
 await expect(page.getByRole('button',{name:'Run selected tests (0)',exact:true})).toBeDisabled();
 expect(await page.locator('.agent-browser iframe').getAttribute('src')).toBe('about:blank');
 await page.getByLabel('Action',{exact:true}).selectOption('workflow');await page.getByLabel('Workflow',{exact:true}).selectOption('video');
 await page.getByRole('button',{name:'Select all tests',exact:true}).click();await expect(page.locator('.agent-test-grid input:checked')).toHaveCount(9);
 await page.getByRole('button',{name:'Clear all tests',exact:true}).click();await expect(page.getByRole('button',{name:'Run selected tests (0)',exact:true})).toBeDisabled();
 const small=page.getByRole('checkbox',{name:'Video Library: List thumbnails',exact:true});await small.focus();await page.keyboard.press('Space');await expect(small).toBeChecked();
 await page.getByRole('button',{name:'Run selected tests (1)',exact:true}).click();await expect(small).toBeDisabled();
 await expect(page.getByRole('button',{name:'Run selected tests (1)',exact:true})).toBeEnabled({timeout:60000});
 let report=await page.evaluate(()=>JSON.parse(localStorage.getItem('ecco-tester-runs:v1:qa-desk-user'))[0]);
 expect(report.selection.ids).toEqual(['video-small']);expect(report.checks).toHaveLength(2);
 expect(report.checks.every(c=>c.id.startsWith('video-small-thumb-')&&c.status==='passed')).toBe(true);
 expect(report.findings).toHaveLength(0);expect(await page.evaluate(()=>window.__agentActions)).toEqual([]);
 await expect(page.locator('.agent-run-selection')).toContainText('Selected 1 of 9 tests');
 await page.getByRole('button',{name:'Clear all tests',exact:true}).click();await page.getByRole('checkbox',{name:'Video Library: Sort names Z–A',exact:true}).check();
 await page.getByRole('button',{name:'Run selected tests (1)',exact:true}).click();await expect(page.getByRole('button',{name:'Run selected tests (1)',exact:true})).toBeEnabled({timeout:30000});
 report=await page.evaluate(()=>JSON.parse(localStorage.getItem('ecco-tester-runs:v1:qa-desk-user'))[0]);expect(report.checks.map(c=>[c.id,c.status])).toEqual([['video-sort-descending','passed']]);
 await page.getByLabel('Workflow',{exact:true}).selectOption('image');await expect(page.getByRole('button',{name:'Run selected tests (0)',exact:true})).toBeDisabled();
 await page.setViewportSize({width:768,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(768);
 expect(await page.evaluate(()=>window.__deskPosts.length)).toBe(0);
});

test('AGENT-07 saved agents run only selected steps and tests',async({page})=>{
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.addInitScript(()=>{if(window===top)localStorage.setItem('ecco-desk-qa-agents',JSON.stringify([{id:'qa-selective-agent',name:'Selective review',description:'Isolated fixture',steps:[{mode:'workflow',workflow:'video'},{mode:'workflow',workflow:'story'}]}]));});
 await page.goto('/desk/index.html?__qa=1');await page.getByRole('button',{name:'Agents',exact:true}).click();await page.locator('.agent-card').filter({hasText:'Selective review'}).click();
 await expect(page.getByRole('button',{name:'Run selected tests (0)',exact:true})).toBeDisabled();
 await page.locator('.agent-test-group summary').filter({hasText:'Step 2 · Story entry'}).click();
 await page.getByRole('checkbox',{name:'Step 2 · Story entry: Story entry choices',exact:true}).check();
 await page.getByRole('button',{name:'Run selected tests (1)',exact:true}).click();await expect(page.getByRole('button',{name:'Run selected tests (1)',exact:true})).toBeEnabled({timeout:20000});
 const run=await page.evaluate(()=>JSON.parse(localStorage.getItem('ecco-agent-runs:v1:qa-desk-user:qa-selective-agent'))[0]);
 expect(run.selection.ids).toEqual(['step-2/story-choices']);expect(run.checks.map(c=>[c.id,c.status])).toEqual([['step-2/story-choices','passed']]);
 expect(await page.evaluate(()=>window.__deskPosts.length)).toBe(0);
});

test('AUDIO-01 delayed voice preview restores Generate and never enables a duplicate active recording',async({page})=>{
 await boot(page,{sourceFit:'audioPreview'});await page.getByLabel('Story name (required)',{exact:true}).fill('Audio preview regression');
 for(const [name,value] of Object.entries({output:'audio',type:'storybook',genre:'Adventure',audience:'All ages',language:'English'}))await fillStoryDetail(page,name,value);
 await page.getByRole('button',{name:'Next: Story',exact:true}).click();await setScript(page,'Narrator: Welcome to the story.');await page.getByRole('button',{name:'Generate',exact:true}).click();
 const generate=page.locator('#generate-audio');await expect(generate).toBeEnabled();await page.locator('.story-simple-advanced > summary').click();await expect(page.locator('#audio-form [name=compute]')).toHaveValue('cpu');
 await page.locator('#audio-form [data-open-controls]').click();await page.getByRole('button',{name:'Listen to selected voice',exact:true}).click();const preview=page.locator('#audio-voice-preview-dialog');await expect(preview.getByLabel('Voice preview playback',{exact:true})).toBeVisible();expect(await generate.isEnabled()).toBe(true);
 await preview.getByRole('button',{name:'Close popup',exact:true}).click();await page.locator('#generation-controls-dialog').getByRole('button',{name:'Close popup',exact:true}).click();await generate.click();await expect(generate).toBeDisabled();await expect(page.locator('#audio-job-status')).toContainText(/running|Generating/);
 await page.locator('#audio-form [data-open-controls]').click();await page.getByRole('button',{name:'Listen to selected voice',exact:true}).click();await expect(preview.getByLabel('Voice preview playback',{exact:true})).toBeVisible();expect(await generate.isEnabled()).toBe(false);
 const calls=await page.evaluate(()=>window.__qaCalls.filter(c=>c.path==='audio/generate'));expect(calls).toHaveLength(2);expect(calls[0].body.title).toContain('Voice preview');expect(calls[1].body.lines[0].text).toBe('Welcome to the story.');
});

test('UPLOAD-09 a full chapter carried by Next: Characters reaches audio generation intact',async({page})=>{
 await boot(page,{sourceFit:'castRetry'});await page.getByLabel('Story name (required)',{exact:true}).fill('Complete cave chapter');
 for(const [name,value]of Object.entries({output:'audio',type:'storybook',genre:'Adventure',audience:'All ages',language:'English'}))await fillStoryDetail(page,name,value);
 await page.getByRole('button',{name:'Next: Story',exact:true}).click();
 const text='Ali: Open sesame!\n\nMorgiana: I will help.\n\n'+Array.from({length:85},(_,i)=>'Narrator: Passage '+i+'. The woodcutter carried the logs through the forest and returned home before nightfall.').join('\n\n');
 const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Upload PDF',exact:true}).click();await(await chooser).setFiles({name:'complete-chapter.txt',mimeType:'text/plain',buffer:Buffer.from(text)});
 const source=page.getByRole('dialog',{name:'Select Story Text',exact:true});await source.locator('[data-selected]').fill(text);await page.getByRole('button',{name:'Next: Characters',exact:true}).click();
await expect(page.locator('[data-cast-panel]')).toHaveAttribute('aria-busy','false');await expect(page.locator('[data-character-tabs] [role=tab]')).toHaveCount(3);await scriptStep(page);await expect(page.locator('#story-simple-script')).toHaveValue(text);
 await page.getByRole('button',{name:'Generate',exact:true}).click();await expect(page.locator('#audio-form')).toBeVisible();await expect(page.locator('#audio-lines textarea[data-field=text]')).toHaveCount(87);
 await page.locator('#generate-audio').click();await expect.poll(()=>page.evaluate(()=>window.__qaCalls.filter(c=>c.path==='audio/generate').length)).toBe(1);
 const request=await page.evaluate(()=>window.__qaCalls.find(c=>c.path==='audio/generate').body);
 expect(request.long_form_version).toBe(1);expect(request.lines.length).toBeGreaterThan(80);expect(request.lines.reduce((n,l)=>n+l.text.length,0)).toBeGreaterThan(4000);expect(request.lines.every(l=>l.text.length<=500)).toBe(true);
 expect(request.lines.map(l=>l.text).join('\n\n')).toBe(text.replace(/^(Ali|Morgiana|Narrator): /gm,''));
});


async function applyScriptReview(page){const review=page.getByRole('dialog',{name:'Generated Script',exact:true});await expect(review).toBeVisible();const apply=review.getByRole('button',{name:'Apply Text',exact:true});await expect(apply).toBeEnabled();await apply.click();await expect(review).toHaveCount(0);}


test('STORY-05 compact control panels and character tabs preserve edits, keyboard focus and popup errors',async({page},info)=>{
 await boot(page);await page.getByLabel('Story name (required)',{exact:true}).fill('Character tab test');for(const [name,value]of Object.entries({output:'audio',type:'podcast',genre:'Adventure',audience:'All ages',language:'English'}))await fillStoryDetail(page,name,value);await page.getByRole('button',{name:'Next: Story',exact:true}).click();
 await expect(page.getByLabel('Number of characters',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Choose from Library',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Create Character',exact:true})).toHaveCount(0);await expect(page.locator('[data-source]')).toHaveCount(0);
 await expect(page.getByRole('tablist',{name:'Story source',exact:true}).getByRole('tab')).toHaveCount(3);await expect(page.locator('[data-cast-panel]')).toHaveCount(0);await page.getByRole('button',{name:'Next: Characters',exact:true}).click();
 const tabs=page.getByRole('tablist',{name:'Story characters',exact:true});await expect(tabs.getByRole('tab')).toHaveCount(2);await tabs.getByRole('button',{name:'Add character',exact:true}).click();await expect(tabs.getByRole('tab')).toHaveCount(3);await expect(page.getByLabel('Character 3 Name',{exact:true})).toBeFocused();await page.getByLabel('Character 3 Name',{exact:true}).fill('Morgiana');await tabs.getByRole('tab',{name:'Host',exact:true}).click();await tabs.getByRole('tab',{name:'Host',exact:true}).press('End');await expect(tabs.getByRole('tab',{name:'Morgiana',exact:true})).toBeFocused();await page.keyboard.press('Enter');await expect(page.getByLabel('Character 3 Name',{exact:true})).toHaveValue('Morgiana');
 await page.screenshot({path:info.outputPath('character-tabs.png'),fullPage:true});await expect(page.getByRole('button',{name:'Next: Script',exact:true})).toBeDisabled();await expect(page.locator('[data-cast-progress]')).toContainText('Create every character to continue');await scriptStep(page);await page.getByRole('button',{name:'Generate',exact:true}).click();const error=page.locator('#ecco-error-popup');await expect(error).toBeVisible();await popupControls(error);await expect(error).toContainText(/story|script/i);await error.getByRole('button',{name:'Close popup',exact:true}).click();await charactersStep(page);await page.getByRole('tab',{name:'Morgiana',exact:true}).click();await expect(page.getByLabel('Character 3 Name',{exact:true})).toHaveValue('Morgiana');await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('character-tabs-mobile.png'),fullPage:true});
});
for(const output of ['audio','video'])test(`STORY-06 Generate With AI tab writes drafts and Next: Characters carries the story for ${output}`,async({page},info)=>{
 await boot(page,{sourceFit:'cast'});await page.getByLabel('Story name (required)',{exact:true}).fill('AI cave adventure');for(const [name,value]of Object.entries({output,type:'storybook',genre:'Adventure',audience:'All ages',language:'English'}))await fillStoryDetail(page,name,value);await page.getByRole('button',{name:'Next: Story',exact:true}).click();
 await page.getByRole('tab',{name:'Generate With AI',exact:true}).click();const ai=page.getByRole('dialog',{name:'Generate With AI',exact:true}),story=ai.getByLabel('Story Text',{exact:true});await expect(ai.locator('.ecco-popup-close')).toHaveCount(0);
 await ai.getByLabel('What should your story be about?',{exact:true}).fill('Write a cave adventure with Ali and Morgiana.');await ai.getByRole('button',{name:'Write Story',exact:true}).click();
 await expect(ai.getByLabel('Draft 1',{exact:true})).toHaveValue('Narrator: At the cave.\n\nAli: Open sesame!\n\nMorgiana: I will help.');await expect(story).toHaveValue('');await expect(page.locator('#story-simple-script')).toHaveValue('');
 await ai.getByRole('button',{name:'Use AI Text',exact:true}).click();await expect(story).toHaveValue('Narrator: At the cave.\n\nAli: Open sesame!\n\nMorgiana: I will help.');await story.fill('Narrator: At the cave.\n\nAli: Open sesame!\n\nMorgiana: I will help.\n\nAli: We are safe.');
 await page.getByRole('tab',{name:'Upload PDF',exact:true}).click();await page.locator('dialog.story-tab-warning').getByRole('button',{name:'Go back',exact:true}).click();await expect(page.getByRole('tab',{name:'Generate With AI',exact:true})).toHaveAttribute('aria-selected','true');await expect(story).toHaveValue(/We are safe/);await expect(ai.getByLabel('What should your story be about?',{exact:true})).toHaveValue('Write a cave adventure with Ali and Morgiana.');
 await page.screenshot({path:info.outputPath('ai-story-review.png')});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('ai-story-review-mobile.png'),fullPage:true});await page.setViewportSize({width:1440,height:1000});
 await expect(ai.getByRole('button',{name:'Generate Script',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Next: Characters',exact:true}).click();await expect(page.locator('[data-character-tabs] [role=tab]')).toHaveCount(3);await scriptStep(page);await expect(page.locator('#story-simple-script')).toHaveValue(/Ali: We are safe/);await page.getByRole('button',{name:'Generate',exact:true}).click();await expect(page.locator(output==='audio'?'#audio-form':'#video-form')).toBeVisible();
});



test('STORY-16 Next: Characters reads the story and makes one tab per character with suggested traits',async({page})=>{
 await boot(page,{sourceFit:'cast'});await page.getByLabel('Story name (required)',{exact:true}).fill('Cave cast');
 for(const [name,value]of Object.entries({output:'audio',type:'storybook',genre:'Adventure',audience:'All ages',language:'English'}))await fillStoryDetail(page,name,value);
 await page.getByRole('button',{name:'Next: Story',exact:true}).click();
 const tools=page.locator('[data-source-panel=pdf] .pdf-document-pane .pdf-pane-tools');await expect(tools).toHaveCount(0);const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Upload PDF',exact:true}).click();await(await chooser).setFiles({name:'cave.txt',mimeType:'text/plain',buffer:Buffer.from('Ali found a cave.')});
 await expect(tools.getByRole('button')).toHaveText(['','']);await expect(tools.getByRole('button',{name:'Upload PDF',exact:true})).toBeVisible();const full=tools.locator('[data-expand-preview]');await expect(full).toHaveAccessibleName('Full Screen');await full.click();await expect(full).toHaveAccessibleName('Exit Full Screen');await expect(page.locator('.pdf-document-pane.pdf-preview-fullscreen')).toHaveCount(1);await page.keyboard.press('Escape');await expect(full).toHaveAttribute('aria-pressed','false');await expect(page.locator('.pdf-preview-fullscreen')).toHaveCount(0);
 await page.getByRole('tab',{name:'Write Yourself',exact:true}).click();await page.locator('dialog.story-tab-warning').getByRole('button',{name:'Proceed',exact:true}).click();const box=page.getByRole('dialog',{name:'Write Yourself',exact:true});await box.locator('[data-selected]').fill('Narrator: At the cave.\n\nAli: Open sesame!\n\nMorgiana: I will help.');
 // Real AI sometimes adds a question beside the characters; Next: Characters still uses the characters.
 await page.evaluate(()=>{window.__qaAsk=true;}); const next=page.getByRole('button',{name:'Next: Characters',exact:true});expect(await next.evaluate(b=>getComputedStyle(b.parentElement).justifyContent)).toBe('flex-end');await next.click();await expect(page.locator('#ecco-error-popup')).toBeHidden();
 const tabs=page.getByRole('tablist',{name:'Story characters',exact:true});await expect(tabs.getByRole('tab')).toHaveText(['Narrator','Ali','Morgiana']);await tabs.getByRole('tab',{name:'Ali',exact:true}).click();
 await expect(page.locator('#story-character-properties details')).toHaveAttribute('open','');for(const [label,value] of [['Gender','Male'],['Age group','Adult'],['Dialect','Indian English'],['Speaking style','Curious'],['Personality','Brave and kind']])await expect(page.getByLabel('Character 2 '+label,{exact:true})).toHaveValue(value);
 await expect(page.locator('[data-cast-reason]')).toContainText('3 characters suggested from your story');
 const reads=()=>page.evaluate(()=>window.__qaCalls.filter(c=>c.body?.fields?.[0]?.id==='story_workspace').length);expect(await reads()).toBe(1);
 const call=await page.evaluate(()=>window.__qaCalls.find(c=>c.body?.fields?.[0]?.id==='story_workspace'));expect(JSON.parse(call.body.context.summary).script).toContain('Morgiana: I will help.');expect(call.body.context.instructions).toContain('Do not ask questions.');
 await page.getByRole('tab',{name:'2. Story',exact:true}).click();await page.getByRole('button',{name:'Next: Characters',exact:true}).click();await expect(tabs.getByRole('tab')).toHaveCount(3);expect(await reads()).toBe(1);
 // Moving between steps while AI is still reading does not throw the answer away.
 await page.getByRole('tab',{name:'2. Story',exact:true}).click();await page.getByRole('tab',{name:'Write Yourself',exact:true}).click();await box.locator('[data-selected]').fill('Narrator: Night fell.\n\nAli: Open sesame!\n\nMorgiana: I will help.');
 await page.evaluate(()=>{window.__qaHold=new Promise(r=>window.__qaRelease=r);});await page.getByRole('button',{name:'Next: Characters',exact:true}).click();await expect(page.locator('[data-cast-reason]')).toContainText('Identifying characters');await expect(page.getByRole('progressbar',{name:'Generating characters',exact:true})).toBeVisible();await expect(page.locator('[data-cast-reason] .generation-spinner')).toBeVisible();expect(await page.locator('.story-cast-progress>span').evaluate(el=>getComputedStyle(el).animationName)).toBe('story-cast-progress');
 await page.locator('#workspace-back').click();await expect(page.getByRole('tablist',{name:'Story source',exact:true})).toBeVisible();await page.getByRole('group',{name:'Story settings',exact:true}).getByLabel('Genre / Topic',{exact:true}).selectOption('Fantasy');
 await page.evaluate(()=>{window.__qaHold=null;window.__qaRelease();});await expect.poll(reads).toBe(2);await page.getByRole('tab',{name:'3. Characters',exact:true}).click();await expect(tabs.getByRole('tab')).toHaveText(['Narrator','Ali','Morgiana']);await expect(page.locator('[data-cast-reason]')).toContainText('3 characters suggested');await expect(page.getByRole('progressbar',{name:'Generating characters',exact:true})).toHaveCount(0);await expect(page.locator('[data-cast-reason] .generation-spinner')).toHaveCount(0);expect(page.qaErrors).toEqual([]);
});
test('STORY-17 switching story tabs asks before erasing, and every tab uses the same AI icon',async({page})=>{
 await boot(page,{sourceFit:'drafts'});await page.getByLabel('Story name (required)',{exact:true}).fill('One story');
 for(const [name,value]of Object.entries({output:'audio',type:'storybook',genre:'Adventure',audience:'All ages',language:'English'}))await fillStoryDetail(page,name,value);
 await page.getByRole('button',{name:'Next: Story',exact:true}).click();const tab=name=>page.getByRole('tab',{name,exact:true}),warning=page.locator('dialog.story-tab-warning');
 await tab('Generate With AI').click();await expect(warning).toHaveCount(0);await expect(tab('Generate With AI')).toHaveAttribute('aria-selected','true');for(const title of ['Select Story Text','Generate With AI','Write Yourself'])await expect(page.locator('.pdf-story-inline > .pdf-dialog-head strong',{hasText:title})).toBeHidden();
 const ai=page.getByRole('dialog',{name:'Generate With AI',exact:true}),write=page.getByRole('dialog',{name:'Write Yourself',exact:true});
 const writeStory=ai.getByRole('button',{name:'Write Story',exact:true});await expect(writeStory).toHaveClass(/pdf-ai-icon/);await expect(writeStory).toHaveText('✦');await expect(ai.getByRole('button',{name:'Improve with AI',exact:true})).toHaveClass(/pdf-ai-icon/);
 await tab('Write Yourself').click();await expect(warning).toHaveCount(0);const story=write.locator('[data-selected]');await expect(write.getByRole('button',{name:'Improve with AI',exact:true})).toHaveClass(/pdf-ai-icon/);await story.fill('Ali found a cave.');
 await tab('Upload PDF').click();await expect(warning).toBeVisible();await expect(warning.getByRole('heading')).toHaveText('Leave Write Yourself?');await expect(warning).toContainText('Everything in Write Yourself will be erased if you switch to Upload PDF.');
 await warning.getByRole('button',{name:'Go back',exact:true}).click();await expect(warning).toHaveCount(0);await expect(tab('Write Yourself')).toHaveAttribute('aria-selected','true');await expect(story).toHaveValue('Ali found a cave.');
 await tab('Generate With AI').click();await warning.getByRole('button',{name:'Proceed',exact:true}).click();await expect(warning).toHaveCount(0);await expect(tab('Generate With AI')).toHaveAttribute('aria-selected','true');
 await tab('Write Yourself').click();await expect(warning).toHaveCount(0);await expect(write.locator('[data-selected]')).toHaveValue('');expect(await page.evaluate(()=>{const k=Object.keys(localStorage).find(k=>k.includes('qa')&&localStorage.getItem(k).includes('One story'));return k?JSON.parse(localStorage.getItem(k)).simple_workspace?.writtenStory||'':'';})).toBe('');
 await write.locator('[data-selected]').fill('Second story.');await page.keyboard.press('Shift+Tab');await tab('Write Yourself').focus();await page.keyboard.press('ArrowLeft');await expect(warning).toBeVisible();await page.keyboard.press('Escape');await expect(warning).toHaveCount(0);await expect(tab('Write Yourself')).toHaveAttribute('aria-selected','true');await expect(write.locator('[data-selected]')).toHaveValue('Second story.');
 expect(page.qaErrors).toEqual([]);
});
for(const tab of ['Upload PDF','Generate With AI','Write Yourself'])test(`STORY-15 ${tab} keeps three AI drafts and uses the chosen one`,async({page})=>{
 await boot(page,{sourceFit:'drafts'});await page.getByLabel('Story name (required)',{exact:true}).fill('Draft choices');
 for(const [name,value]of Object.entries({output:'audio',type:'storybook',genre:'Adventure',audience:'All ages',language:'English'}))await fillStoryDetail(page,name,value);
 await page.getByRole('button',{name:'Next: Story',exact:true}).click();
 const names={'Upload PDF':'Select Story Text','Generate With AI':'Generate With AI','Write Yourself':'Write Yourself'};
 await page.getByRole('tab',{name:tab,exact:true}).click();
 if(tab==='Upload PDF'){const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Upload PDF',exact:true}).click();await(await chooser).setFiles({name:'cave.txt',mimeType:'text/plain',buffer:Buffer.from('Ali found a cave.')});}
 const box=page.getByRole('dialog',{name:names[tab],exact:true}),text=box.locator('[data-selected]'),drafts=box.getByRole('tablist',{name:'Drafts',exact:true}),improve=box.getByRole('button',{name:/Improve/}).first();
 await expect(drafts.getByRole('tab')).toHaveText(['Draft 1','Draft 2','Draft 3']);await expect(drafts.getByRole('tab',{name:'Draft 1',exact:true})).toHaveAttribute('aria-selected','true');
 await text.fill('Ali found a cave.');await box.getByLabel('AI instructions',{exact:true}).fill('Make it vivid.');
 for(const n of [1,2,3]){await improve.click();await expect(drafts.getByRole('tab',{name:'Draft '+n,exact:true})).toHaveAttribute('aria-selected','true');await expect(box.getByLabel('Draft '+n,{exact:true})).toHaveValue('Version '+n+' of the cave story.');}
 await expect(improve).toBeDisabled();await expect(box.locator('[data-ai-status]')).toContainText('All three drafts are in use');
 await drafts.getByRole('tab',{name:'Draft 3',exact:true}).focus();await page.keyboard.press('ArrowLeft');await expect(drafts.getByRole('tab',{name:'Draft 2',exact:true})).toBeFocused();await expect(box.getByLabel('Draft 2',{exact:true})).toHaveValue('Version 2 of the cave story.');
 await box.getByRole('button',{name:'Clear AI Output',exact:true}).click();await expect(box.getByLabel('Draft 2',{exact:true})).toHaveValue('');await expect(improve).toBeEnabled();
 await drafts.getByRole('tab',{name:'Draft 1',exact:true}).click();await expect(box.getByLabel('Draft 1',{exact:true})).toHaveValue('Version 1 of the cave story.');await box.getByRole('button',{name:'Use AI Text',exact:true}).click();await expect(text).toHaveValue('Version 1 of the cave story.');
 await drafts.getByRole('tab',{name:'Draft 3',exact:true}).click();await box.getByRole('button',{name:'Use AI Text',exact:true}).click();await expect(text).toHaveValue('Version 3 of the cave story.');await expect(box.getByLabel('Draft 3',{exact:true})).toHaveValue('Version 3 of the cave story.');
 await text.fill('Ali found a hidden cave.');await expect(drafts.getByRole('tab',{name:'Draft 1',exact:true})).toHaveAttribute('aria-selected','true');await expect(box.getByLabel('Draft 1',{exact:true})).toHaveValue('');await expect(box.locator('[data-ai-status]')).toContainText('Selected Text changed');await expect(box.getByRole('button',{name:'Generate Script',exact:true})).toHaveCount(0);
 expect(page.qaErrors).toEqual([]);
});

test('CAMPAIGN-05 current and upcoming read campaigns survive reload and expire normally',async({page})=>{
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.goto('/?__qa=1&upcoming=1&promotions=1');await page.locator('#entry-tell-story').click();await page.locator('#google-user-menu > summary').click();await page.getByRole('button',{name:'Billing',exact:true}).click();
 const drawer=page.locator('#workspace-billing-drawer');
 for(const selector of ['[data-state=upcoming]','[data-notice-id=promo-campaign]']){
  const card=drawer.locator(selector);await expect(card.locator('h3')).toHaveCSS('font-weight','700');
  await card.getByRole('button',{name:'Mark as Read',exact:true}).click();await expect(card).toBeVisible();await expect(card.locator('h3')).toHaveCSS('font-weight','400');await expect(card.locator('.credits-promotion-message')).toHaveCSS('font-weight','400');await expect(card.locator('h3')).toBeFocused();
 }
 await page.reload();await page.locator('#entry-tell-story').click();await page.locator('#google-user-menu > summary').click();await page.getByRole('button',{name:'Billing',exact:true}).click();
 await expect(drawer.locator('[data-read=true]')).toHaveCount(2);for(const title of await drawer.locator('[data-read=true] h3').all())await expect(title).toHaveCSS('font-weight','400');
 await drawer.getByRole('button',{name:'Purchase Additional Credits',exact:true}).click();const shop=page.locator('dialog[open].credits-dialog');await expect(shop.locator('[data-read=true]')).toHaveCount(2);
 await page.setViewportSize({width:390,height:844});expect(await shop.evaluate(el=>el.scrollWidth)).toBeLessThanOrEqual(await shop.evaluate(el=>el.clientWidth));await page.screenshot({path:'test-results/campaign-read-mobile.png',fullPage:true});
 await page.evaluate(async()=>{window.__qaUpcoming[0].expiresAt='2000-01-01T00:00:00Z';window.__qaBillingNotices.find(n=>n.id==='promo-campaign').expiresAt='2000-01-01T00:00:00Z';await window.EccoNotifications.refresh()});
 await expect(shop.locator('[data-state=upcoming]')).toHaveCount(0);await expect(shop.locator('[data-notice-id=promo-campaign]')).toHaveCount(0);await expect(shop.locator('.credits-pack')).toHaveCount(3);
});

test('STORY-07 presentation types and genres/topics stay distinct across onboarding',async({page})=>{
 const types=['Narrated Story','Dramatized Story','Podcast','Interview','News Report','Documentary','Lesson / Tutorial','Training','Advertisement','Presentation','Music / Ambient','Other'];
 const genres=['Comedy','Adventure','Action','Drama','Fantasy','Mystery','Thriller','Horror','Romance','Science Fiction','History','Biography','Business','Science & Technology','Sports','Nature','Other'];
 const choices=async select=>select.locator('option').evaluateAll(options=>options.filter(o=>o.value).map(o=>o.textContent));
 await boot(page);const details=page.locator('#story-simple-details'),type=details.locator('[name=type]'),genre=details.locator('[name=genre]');
 expect(await choices(type)).toEqual(types);expect(await choices(genre)).toEqual(genres);
 await page.locator('#story-detail-type-button').focus();await page.locator('#story-detail-type-button').press('Tab');await expect(page.locator('#story-detail-genre-button')).toBeFocused();
 await page.getByLabel('Story name (required)',{exact:true}).fill('History interview');
 for(const [name,value] of Object.entries({output:'audio',type:'interview',genre:'History',audience:'All ages',language:'English'}))await fillStoryDetail(page,name,value);
 await page.getByRole('button',{name:'Next: Story',exact:true}).click();await charactersStep(page);await expect(page.locator('[data-character-tabs] [role=tab]')).toHaveCount(2);await page.getByRole('tab',{name:'2. Story',exact:true}).click();
 const settings=page.getByRole('group',{name:'Story settings',exact:true});
 expect(await choices(settings.locator('[name=story_type]'))).toEqual(types);expect(await choices(settings.locator('[name=genre]'))).toEqual(genres);
 await expect(settings.locator('[name=story_type]')).toHaveValue('interview');await settings.locator('[name=story_type]').selectOption('documentary');await settings.locator('[name=genre]').selectOption('Nature');
 const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Upload PDF',exact:true}).click();await (await chooser).setFiles({name:'Nature.txt',mimeType:'text/plain',buffer:Buffer.from('A forest shelters many animals.')});
 const source=page.getByRole('dialog',{name:'Select Story Text',exact:true});
 await expect(source).toBeVisible();await expect(source.locator('select[data-ai-setting]')).toHaveCount(0);
 await expect(settings.getByLabel('Story Type',{exact:true})).toHaveValue('documentary');await expect(settings.getByLabel('Genre / Topic',{exact:true})).toHaveValue('Nature');
 await settings.getByLabel('Genre / Topic',{exact:true}).selectOption('Science & Technology');
 await page.getByRole('tab',{name:'1. Details',exact:true}).click();await expect(type).toHaveValue('documentary');await expect(genre).toHaveValue('Science & Technology');
 await page.setViewportSize({width:390,height:900});for(const field of [page.locator('#story-detail-type-button'),page.locator('#story-detail-genre-button')])expect(await field.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})).toBe(true);
 expect(await page.evaluate(()=>window.__qaCalls.filter(c=>c.path==='ai/enhance'||c.path==='ai/news/research'||c.path==='stories'||/generate/.test(c.path)))).toEqual([]);
});
for(const [type,label,genre] of [['book-adaptation','Book Adaptation','Documentary'],['retired-custom','retired-custom','Custom topic']])test(`STORY-08 saved ${type} selections remain intact`,async({page})=>{
 await boot(page);
 await page.evaluate(({type,genre})=>window.EccoWorkspaceUI.startNewStory({id:type,format:'audio',seed:{simple_workspace:{...window.EccoStoryWorkspaceModel.fresh({type,output:'audio'}),title:'Saved legacy story',genre,audience:'All ages',language:'English',recurrence:'once'}}}),{type,genre});
 const details=page.locator('#story-simple-details');await expect(details.locator('[name=type]')).toHaveValue(type);await expect(details.locator('[name=type] option:checked')).toHaveText(label);await expect(details.locator('[name=genre]')).toHaveValue(genre);
 await page.getByRole('button',{name:'Next: Story',exact:true}).click();const settings=page.getByRole('group',{name:'Story settings',exact:true});await expect(settings.locator('[name=story_type] option:checked')).toHaveText(label);await expect(settings.locator('[name=genre]')).toHaveValue(genre);
 await page.getByRole('tab',{name:'1. Details',exact:true}).click();await expect(details.locator('[name=type]')).toHaveValue(type);await expect(details.locator('[name=genre]')).toHaveValue(genre);
 expect(await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('ecco-new-story-draft')).simple_workspace;return {type:s.type,genre:s.genre};})).toEqual({type,genre});
});

for(const theme of ['default','ocean'])test(`STORY-09 approved cards, defaults and persistent next action in ${theme}`,async({page},info)=>{
 await page.setViewportSize({width:1280,height:940});await boot(page,{theme});
 const form=page.locator('#story-simple-details'),cards=form.locator('.story-details-card'),next=form.getByRole('button',{name:'Next: Story',exact:true});
 await expect(cards).toHaveCount(2);await expect(cards.locator('h2')).toHaveText(['Your Story','Your Audience']);
 expect(await cards.first().locator('[data-story-fields] > :not([hidden])').evaluateAll(els=>els.map(e=>e.querySelector('[name]').name))).toEqual(['title','output','type','genre']);
 for(const name of ['title','type','genre','location'])await expect(form.locator('[name='+name+']')).toHaveValue('');
 await expect(form.getByRole('radio')).toHaveCount(3);await expect(form.locator('[name=output]:checked')).toHaveCount(0);
 await expect(form.locator('[name=audience]')).toHaveValue('All ages');await expect(form.locator('[name=language]')).toHaveValue('English');await expect(form.locator('[data-default]:visible')).toHaveCount(2);
 await expect(form.locator('[name=recurrence]')).toHaveCount(0);await expect(page.locator('#story-simple-save')).toHaveText('Draft saved in this browser');await expect(form.locator('.help')).toHaveText('Publishing schedule: set in the last step.');
 const boxes=await cards.evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};}));expect(boxes[0].y).toBe(boxes[1].y);expect(boxes[0].w).toBe(boxes[1].w);expect(boxes[0].h).toBe(boxes[1].h);expect(boxes[1].x).toBeGreaterThan(boxes[0].x+boxes[0].w);for(const box of boxes)expect(box.w).toBeLessThanOrEqual(640);
 expect(await next.evaluate(e=>{const r=e.getBoundingClientRect(),f=e.closest('form').getBoundingClientRect();return {height:r.height,right:Math.abs(r.right-f.right),font:getComputedStyle(e).fontSize};})).toEqual({height:30,right:0,font:'10px'});await expect(next).toBeInViewport();
 await page.screenshot({path:info.outputPath('story-details-'+theme+'.png')});
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,document.querySelector('#story-simple-details').offsetTop));
 expect(await form.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);await expect(next).toBeInViewport();
 const mobile=await cards.evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};}));expect(mobile[1].x).toBe(mobile[0].x);expect(mobile[0].w).toBe(mobile[1].w);expect(mobile[0].h).toBe(mobile[1].h);expect(mobile[1].y).toBeGreaterThan(mobile[0].y);for(const box of mobile){expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.w).toBeLessThanOrEqual(390);}
 await page.screenshot({path:info.outputPath('story-details-'+theme+'-mobile.png')});
 await page.getByRole('radio',{name:'Image',exact:true}).check();await expect(form.locator('[name=output]:checked')).toHaveCount(1);await expect(page.getByRole('radio',{name:'Image',exact:true})).toBeChecked();
});
test('STORY-10 one linked summary identifies every missing detail and clears errors as fields are corrected',async({page})=>{
 await boot(page);const form=page.locator('#story-simple-details'),summary=form.locator('#story-details-errors'),next=form.getByRole('button',{name:'Next: Story',exact:true});
 await next.click();await expect(summary).toBeFocused();await expect(summary.locator('a')).toHaveCount(4);await expect(page.getByRole('dialog')).toHaveCount(0);
 for(const name of ['title','output','type','genre']){await expect(form.locator('[name='+name+']').first()).toHaveAttribute('aria-invalid','true');await expect(form.locator('#story-detail-'+name+'-error')).toBeVisible();}
 await summary.getByRole('link',{name:'What are you making?: Choose Audio, Image or Video.',exact:true}).click();await expect(page.getByRole('radio',{name:'Audio',exact:true})).toBeFocused();
 await page.getByRole('radio',{name:'Audio',exact:true}).press('ArrowRight');await expect(page.getByRole('radio',{name:'Image',exact:true})).toBeChecked();await expect(summary.locator('a')).toHaveCount(3);
 await form.locator('[name=audience]').selectOption('');await form.locator('[name=language]').selectOption('');await expect(summary.locator('a')).toHaveCount(5);await expect(form.locator('[data-default]:visible')).toHaveCount(0);
 await page.getByRole('tab',{name:'2. Story',exact:true}).click();await expect(summary).toBeFocused();await expect(page.getByRole('tab',{name:'1. Details',exact:true})).toHaveAttribute('aria-selected','true');
 await form.locator('[name=title]').fill('  ');await expect(form.locator('[name=title]')).toHaveAttribute('aria-invalid','true');await form.locator('[name=title]').fill('Forest documentary');
 for(const [name,value]of Object.entries({type:'documentary',genre:'Nature',audience:'All ages',language:'English'}))await fillStoryDetail(page,name,value);
 await expect(summary).toBeHidden();await expect(form.locator('[aria-invalid=true]')).toHaveCount(0);await expect(form.locator('[data-default]:visible')).toHaveCount(0);
 const genreOptions=await form.locator('[name=genre] option').allTextContents();await fillStoryDetail(page,'type','interview');await expect(form.locator('[name=genre]')).toHaveValue('Nature');expect(await form.locator('[name=genre] option').allTextContents()).toEqual(genreOptions);await fillStoryDetail(page,'genre','Comedy');await expect(form.locator('[name=type]')).toHaveValue('interview');
 await next.click();await expect(page.getByRole('tablist',{name:'Story source',exact:true})).toBeVisible();await expect(page.locator('#story-simple-script')).toBeHidden();await page.locator('#workspace-back').click();await expect(page.getByRole('radio',{name:'Image',exact:true})).toBeChecked();expect(await form.locator('[name=output]').evaluateAll(els=>els.map(e=>e.value))).toEqual(['audio','image','video']);
 expect(await page.evaluate(()=>window.__qaCalls.filter(c=>c.path==='stories'||/generate/.test(c.path)))).toEqual([]);
});
test('STORY-11 recurrence moves to Generate and Publish and remains saved after returning to details',async({page})=>{
 await boot(page);await page.getByLabel('Story name (required)',{exact:true}).fill('Publishing preference');for(const [name,value]of Object.entries({output:'audio',type:'storybook',genre:'Adventure'}))await fillStoryDetail(page,name,value);
 await page.getByRole('button',{name:'Next: Story',exact:true}).click();await setScript(page,'Narrator: A new day begins.');await page.getByRole('button',{name:'Generate',exact:true}).click();await expect(page.locator('#audio-form')).toBeVisible();
 const recurrence=page.locator('#story-simple-publishing [name=recurrence]');await expect(recurrence).toHaveValue('');await recurrence.selectOption('recurring');await expect(page.getByRole('button',{name:'Start next episode / chapter',exact:true})).toBeVisible();
 await page.getByRole('tab',{name:'1. Details',exact:true}).click();await expect(page.locator('[name=recurrence]')).toHaveCount(0);await page.getByRole('tab',{name:'5. Generate',exact:true}).click();await expect(recurrence).toHaveValue('recurring');
 expect(await page.evaluate(()=>window.__qaCalls.filter(c=>/generate|publish/.test(c.path)))).toEqual([]);
});

for(const viewport of [{width:1440,height:1000},{width:390,height:844}])test(`STORY-12 grouped menus stay on screen and support keyboard at ${viewport.width}px`,async({page},info)=>{
 await page.setViewportSize(viewport);await boot(page);
 for(const [name,groups,count,selected]of [['type',['Stories','Talk and news','Teaching and business','Other'],12,'audio-drama'],['genre',['Story genres','Real-world topics'],17,'Adventure']]){
  const trigger=page.locator('#story-detail-'+name+'-button'),panel=page.locator('#story-detail-'+name+'-panel'),options=panel.locator('[data-choice-value]');
  await expect(trigger).toHaveAttribute('aria-haspopup','dialog');await expect(trigger).toHaveAttribute('aria-expanded','false');await trigger.press('Enter');await expect(panel).toBeVisible();await expect(trigger).toHaveAttribute('aria-expanded','true');await expect(panel.locator('h3')).toHaveText(groups);await expect(options).toHaveCount(count);await expect(options.first()).toBeFocused();
  const bounds=await panel.evaluate(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:r.height,width:innerWidth,viewportHeight:innerHeight,overflow:e.scrollWidth>e.clientWidth};});expect(bounds.left).toBeGreaterThanOrEqual(0);expect(bounds.right).toBeLessThanOrEqual(viewport.width);expect(bounds.top).toBeGreaterThanOrEqual(0);expect(bounds.bottom).toBeLessThanOrEqual(viewport.height);expect(bounds.height).toBeLessThanOrEqual(470);expect(bounds.overflow).toBe(false);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(panel.locator('.story-choice-description')).toHaveCount(name==='type'?12:0);expect(await options.first().evaluate(e=>getComputedStyle(e).outlineStyle)).toBe('solid');
  for(let i=1;i<count;i++){await options.nth(i-1).press('Tab');await expect(options.nth(i)).toBeFocused();}
  await options.last().press('Escape');await expect(panel).toBeHidden();await expect(trigger).toBeFocused();await expect(trigger).toHaveAttribute('aria-expanded','false');await expect(page.locator('#story-simple-details [name='+name+']')).toHaveValue('');
  await trigger.press('Enter');await options.first().press('ArrowRight');await expect(options.nth(1)).toBeFocused();await options.nth(1).press('Enter');await expect(panel).toBeHidden();await expect(trigger).toBeFocused();await expect(page.locator('#story-simple-details [name='+name+']')).toHaveValue(selected);
  await trigger.click();await expect(panel.locator('[aria-pressed=true]')).toHaveCount(1);await expect(panel.locator('[data-choice-value='+JSON.stringify(selected)+']')).toHaveAttribute('aria-pressed','true');await expect(panel.locator('[aria-pressed=true] [data-choice-check]')).toBeVisible();
  await page.screenshot({path:info.outputPath('story-'+name+'-menu-'+viewport.width+'.png')});await page.locator('#story-details-story-title').click();await expect(panel).toBeHidden();
 }
});
test('STORY-13 every output filters and renumbers the sidebar and journey list with Publish retained',async({page})=>{
 await boot(page);const all=['story-setup','board','audio','images','render','journey-preview'],sidebar=page.locator('#workspace-production-group .journey-step:visible');expect(await sidebar.evaluateAll(els=>els.map(e=>e.dataset.page))).toEqual(all);
 for(const [output,expected]of [['audio',['story-setup','board','audio','journey-preview']],['image',['story-setup','board','images','journey-preview']],['video',all]]){
  await fillStoryDetail(page,'output',output);expect(await sidebar.evaluateAll(els=>els.map(e=>e.dataset.page))).toEqual(expected);expect(await sidebar.evaluateAll(els=>els.map(e=>Number(e.textContent.split('.')[0])))).toEqual(expected.map((_,i)=>i+1));
  await page.locator('#workspace-production-group > summary').click();const rows=page.locator('#story-home-list button');expect(await rows.evaluateAll(els=>els.map(e=>e.dataset.storyDestination))).toEqual(expected);expect(await rows.evaluateAll(els=>els.map(e=>Number(e.textContent.split('.')[0])))).toEqual(expected.map((_,i)=>i+1));await rows.first().click();await expect(page.getByRole('radio',{name:output[0].toUpperCase()+output.slice(1),exact:true})).toBeChecked();
 }
 expect(await page.evaluate(()=>window.__qaCalls.filter(c=>c.path==='stories'||/generate|publish/.test(c.path)))).toEqual([]);
});
test('STORY-14 Other descriptions are required and Default badges stay removed after an edit',async({page})=>{
 await boot(page);const form=page.locator('#story-simple-details');await form.locator('[name=title]').fill('Custom story');await fillStoryDetail(page,'output','audio');await fillStoryDetail(page,'type','custom');await fillStoryDetail(page,'genre','Other');
 const type=page.getByLabel('Describe your story type (required)',{exact:true}),genre=page.getByLabel('Describe your genre or topic (required)',{exact:true});await expect(type).toBeVisible();await expect(genre).toBeVisible();await form.getByRole('button',{name:'Next: Story',exact:true}).click();
 const summary=form.locator('#story-details-errors');await expect(summary.locator('a')).toHaveCount(2);await expect(type).toHaveAttribute('aria-invalid','true');await expect(genre).toHaveAttribute('aria-invalid','true');await summary.getByRole('link',{name:'Describe your story type: Describe your story type.',exact:true}).click();await expect(type).toBeFocused();await type.fill('A guided tour');await expect(summary.locator('a')).toHaveCount(1);await genre.fill('Architecture');await expect(summary).toBeHidden();
 await form.locator('[name=audience]').selectOption('Families');await form.locator('[name=audience]').selectOption('All ages');await form.locator('[name=language]').selectOption('Hindi');await form.locator('[name=language]').selectOption('English');await expect(form.locator('[data-default]:visible')).toHaveCount(0);
 await fillStoryDetail(page,'type','podcast');await expect(type).toBeHidden();await fillStoryDetail(page,'type','custom');await expect(type).toHaveValue('A guided tour');await form.getByRole('button',{name:'Next: Story',exact:true}).click();await page.getByRole('tab',{name:'1. Details',exact:true}).click();await expect(type).toHaveValue('A guided tour');await expect(genre).toHaveValue('Architecture');await expect(form.locator('[data-default]:visible')).toHaveCount(0);await expect(form.locator('[name=type]')).toHaveValue('custom');await expect(form.locator('[name=genre]')).toHaveValue('Other');
});

for(const viewport of [{width:1440,height:1000},{width:390,height:844}])test(`STORY-15 title stays below controls and above tabs at ${viewport.width}px`,async({page},info)=>{
 await page.setViewportSize(viewport);await boot(page);
 const title='Ali Baba and Forty Theives',heading=page.locator('#heading');
 await page.getByLabel('Story name (required)',{exact:true}).fill(title);
 for(const [name,value]of Object.entries({output:'audio',type:'audio-drama',genre:'Comedy'}))await fillStoryDetail(page,name,value);
 const layout=async()=>{
  const boxes=await page.evaluate(()=>{const box=s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:r.height};};return {heading:box('#heading'),controls:box('.workspace-ribbon>.header-right'),status:box('#story-simple-save'),tabs:box('#story-workspace-header [role=tablist]'),overflow:document.documentElement.scrollWidth>innerWidth};});
  expect(boxes.heading.top).toBeGreaterThanOrEqual(boxes.controls.bottom);expect(boxes.heading.top).toBeGreaterThanOrEqual(boxes.status.bottom);expect(boxes.tabs.top).toBeGreaterThanOrEqual(boxes.heading.bottom);
  expect(boxes.heading.left).toBe(boxes.tabs.left);expect(boxes.heading.right).toBeLessThanOrEqual(viewport.width);expect(boxes.controls.left).toBeGreaterThanOrEqual(0);expect(boxes.controls.right).toBeLessThanOrEqual(viewport.width);expect(boxes.overflow).toBe(false);
  return boxes.heading.height;
 };
 await page.getByRole('button',{name:'Next: Story',exact:true}).click();await expect(heading).toHaveText(title);await layout();
 await page.getByRole('tab',{name:'1. Details',exact:true}).click();const shortHeight=await layout();
 expect(await heading.evaluate(e=>e.getBoundingClientRect().left)).toBe(await page.locator('.story-details-card').first().evaluate(e=>e.getBoundingClientRect().left));
 await page.screenshot({path:info.outputPath('story-title-'+viewport.width+'.png')});
 // Keep the fixture within the field's existing 160-character title limit.
 const longTitle=title+' A very long adventure title '+'x'.repeat(90);
 await page.getByLabel('Story name (required)',{exact:true}).fill(longTitle);await page.getByRole('button',{name:'Next: Story',exact:true}).click();await expect(heading).toHaveText(longTitle);expect(await layout()).toBeGreaterThanOrEqual(shortHeight);expect(await heading.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
 await openLibrary(page,'image');await expect(page.locator('#story-simple-save')).toBeHidden();await expect(page.locator('.workspace-ribbon')).toHaveCSS('display','flex');
 await page.locator('#workspace-back').click();await expect(page.locator('#library-home-list')).toBeVisible();
 await page.locator('#workspace-back').click();await expect(heading).toHaveText(longTitle);await expect(page.locator('#story-simple-save')).toBeVisible();await layout();
});

for(const viewport of [{width:1440,height:1000},{width:390,height:844}])test(`TYPE-01 compact typography and controls at ${viewport.width}px`,async({page},info)=>{
 await page.setViewportSize(viewport);await boot(page);
 // Sizes come from the master size roster (design-system/size-roster.json), at every width.
 const font=async(selector,px)=>expect(await page.locator(selector).first().evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeCloseTo(px,3);
 await font('body',12);await font('#heading',20);await font('.story-details-card h2',15);await font('#story-detail-title',11);await font('.story-detail-qualifier',12);await font('#story-simple-save',12);
 for(const selector of ['#story-detail-title','#story-detail-audience'])await expect(page.locator(selector)).toHaveCSS('height','25px');
 await expect(page.locator('#story-detail-type-button')).toHaveCSS('height','30px');
 await expect(page.locator('.story-details-next')).toHaveCSS('min-height','30px');
 const trigger=page.locator('#story-detail-type-button'),panel=page.locator('#story-detail-type-panel');await trigger.press('Enter');
 const option=panel.locator('[data-choice-value]').first();await expect(option).toBeFocused();await font('#story-detail-type-panel .story-choice-option',10);await font('#story-detail-type-panel .story-choice-description',11);
 // Children inherit the smaller label exactly once, including after dynamic panel creation.
 expect(await option.evaluate(e=>getComputedStyle(e).fontSize)).toEqual(await option.locator('.story-choice-name').evaluate(e=>getComputedStyle(e).fontSize));
 await expect(option).toHaveCSS('outline-style','solid');expect(await panel.evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&e.scrollWidth<=e.clientWidth;})).toBe(true);
 await option.press('Escape');await expect(trigger).toBeFocused();await expect(panel).toBeHidden();
 await page.locator('#google-user-menu>summary').click();await page.getByRole('button',{name:'Credit and Usage',exact:true}).click();
 if(viewport.width<700)for(const selector of ['#google-user-menu>.workspace-menu-items','#workspace-usage-drawer'])await expect.poll(()=>page.locator(selector).evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&e.scrollWidth<=e.clientWidth;})).toBe(true);
 await page.screenshot({path:info.outputPath('compact-account-'+viewport.width+'.png')});
 await page.getByRole('button',{name:'Purchase Additional Credits',exact:true}).click();
 const shop=page.locator('dialog[open].credits-dialog');await expect(shop).toBeVisible();await font('.credits-pack h3',11);await popupControls(shop);expect(await shop.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);await shop.getByRole('button',{name:'Close popup',exact:true}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('compact-typography-'+viewport.width+'.png'),fullPage:true});
});
for(const viewport of [{width:1440,height:1000},{width:390,height:844}])test(`TYPE-02 compact Desk shadow-root typography at ${viewport.width}px`,async({page},info)=>{
 await page.setViewportSize(viewport);await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());await page.goto('/desk/index.html?__qa=1');
 if(viewport.width<=650)await page.getByRole('button',{name:'Open navigation',exact:true}).click();
 await page.getByRole('button',{name:'Notifications',exact:true}).click();await page.getByRole('button',{name:'New Notification',exact:true}).click();
 const title=page.getByLabel('Title',{exact:true});await expect(title).toHaveCSS('font-size','11px');expect(await title.evaluate(e=>Boolean(e.getRootNode().host))).toBe(true);await title.fill('Compact typography check');await title.press('Tab');await expect(page.getByLabel('Message',{exact:true})).toBeFocused();
 expect(await page.locator('.notification-composer').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&e.scrollWidth<=e.clientWidth;})).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('compact-desk-'+viewport.width+'.png'),fullPage:true});

});
// Master size roster: every element takes its size from design-system/size-roster.json.
import {rosterAudit} from './roster-audit.js';
// Characters step Create + Test (owner-approved mock-up, 8 November 2026). Voice samples and image jobs are
// replaced with synthetic results here; real voice and avatar generation needs storage and a GPU and stays blocked.
async function stubCharacterJobs(page){await page.evaluate(()=>{
 const image='data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#456"/></svg>'),sound='data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
 let voice=0,job=0;window.qaVoiceRequests=[];window.EccoAudioStudio.sample=async(character,text)=>{window.qaVoiceRequests.push({voice:character.voice,model:character.model,text});voice++;return {asset_id:'qa-voice-'+voice,url:sound};};
 window.EccoStorage.mediaURL=async id=>id.startsWith('qa-image-')?image:sound;localStorage.setItem('ecco-compute-image','qa-gpu');window.EccoCompute.validate=async()=>({});window.modelPayload=(kind,gpu,model)=>({gpu,model});
 const real=window.api;window.qaImageRequests=[];window.api=async(path,body)=>{if(path==='images'){window.qaImageRequests.push(body);job++;return {id:'qa-job-'+job};}if(path==='state')return {records:[{kind:'job',id:'qa-job-'+job,status:'done',result:['qa-image-'+job]},{kind:'asset',media:'image',id:'qa-image-'+job,job_id:'qa-job-'+job}]};return real(path,body);};
});}
async function openCharacters(page,output){await boot(page);await page.getByLabel('Story name (required)',{exact:true}).fill('Characters create and test');for(const [name,value] of Object.entries({output,type:'podcast',genre:'Adventure',audience:'All ages',language:'English'}))await fillStoryDetail(page,name,value);await page.getByRole('button',{name:'Next: Story',exact:true}).click();await page.getByRole('button',{name:'Next: Characters',exact:true}).click();await expect(page.getByRole('tablist',{name:'Story characters',exact:true})).toBeVisible();}
for(const output of ['audio','video'])test(`STORY-07 Characters step creates and tests each ${output} character before Next: Script`,async({page},info)=>{
 await openCharacters(page,output);await stubCharacterJobs(page);
 const tabs=page.getByRole('tablist',{name:'Story characters',exact:true}),next=page.getByRole('button',{name:'Next: Script',exact:true}),progress=page.locator('[data-cast-progress]');
 await expect(tabs.getByRole('tab',{name:'Host',exact:true})).toHaveAttribute('aria-description','Not created');await expect(next).toBeDisabled();await expect(progress).toHaveText('Created 0 of 2 · Tested 0 of 2 · Create every character to continue');
 await expect(page.getByRole('heading',{name:'From Story',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:output==='audio'?'Create voice':'Create avatar',exact:true})).toBeVisible();await expect(page.locator('.story-cast-empty').first()).toBeVisible();
 for(const [index,name] of [[1,'Host'],[2,'Guest']]){
  await tabs.getByRole('tab',{name,exact:true}).click();
  if(output==='audio'){await page.getByLabel('Character '+index+' Suggested voice',{exact:true}).fill('Warm, unhurried, a little playful.');const voice=page.getByLabel('Character '+index+' Voice',{exact:true});await voice.selectOption({index:1});await page.getByRole('button',{name:'Generate voice',exact:true}).click();await expect(page.getByRole('button',{name:'Generate again',exact:true})).toBeVisible();await page.getByLabel('Try your own line',{exact:true}).fill('Welcome to the show.');await page.getByRole('button',{name:'Play your line',exact:true}).click();await expect(page.getByLabel('Voice test playback',{exact:true})).toBeVisible();}
  else{await page.getByLabel('Character '+index+' Suggested avatar prompt',{exact:true}).fill('Short silver hair, green scarf, friendly smile.');await page.getByRole('button',{name:'Generate avatar',exact:true}).click();await expect(page.getByRole('button',{name:'Avatar option 1',exact:true})).toHaveAttribute('aria-pressed','true');await page.getByRole('button',{name:'Generate again',exact:true}).click();await page.getByRole('button',{name:'Avatar option 2',exact:true}).click();await expect(page.getByRole('button',{name:'Avatar option 2',exact:true})).toHaveAttribute('aria-pressed','true');}
  await expect(tabs.getByRole('tab',{name,exact:true})).toHaveAttribute('aria-description','Created');
  if(index===1){await expect(next).toBeDisabled();await page.locator('[data-cast-tested]').click();await expect(tabs.getByRole('tab',{name,exact:true})).toHaveAttribute('aria-description','Tested');await expect(page.locator('.story-cast-tested')).toBeVisible();}
 }
 if(output==='audio'){const requests=await page.evaluate(()=>window.qaVoiceRequests);expect(requests.length).toBe(4);expect(requests.every(r=>r.voice&&r.model)).toBe(true);}
 else{const requests=await page.evaluate(()=>window.qaImageRequests);expect(requests.length).toBe(4);expect(requests[0].prompt).toContain('Short silver hair, green scarf');}
 await expect(progress).toHaveText('Created 2 of 2 · Tested 1 of 2');await expect(next).toBeEnabled();
 const audit=await page.evaluate(rosterAudit);expect(audit.problems).toEqual([]);
 await page.screenshot({path:info.outputPath('characters-'+output+'.png'),fullPage:true});
 await page.getByRole('tab',{name:'1. Details',exact:true}).click();await charactersStep(page);await expect(tabs.getByRole('tab',{name:'Host',exact:true})).toHaveAttribute('aria-description','Tested');await expect(tabs.getByRole('tab',{name:'Guest',exact:true})).toHaveAttribute('aria-description','Created');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('characters-'+output+'-mobile.png'),fullPage:true});
 await next.click();await expect(page.getByRole('tab',{name:'4. Script',exact:true})).toHaveAttribute('aria-selected','true');expect(page.qaErrors).toEqual([]);
});
const rosterScreens={
 'Story details':async page=>boot(page),
 'Story and characters':async page=>{await boot(page);await page.getByLabel('Story name (required)',{exact:true}).fill('Roster audit');for(const [name,value] of Object.entries({output:'audio',type:'podcast',genre:'Comedy',audience:'All ages',language:'English'}))await fillStoryDetail(page,name,value);await page.getByRole('button',{name:'Next: Story',exact:true}).click();},
 'Characters step':async page=>openCharacters(page,'audio'),
 'Characters step video':async page=>openCharacters(page,'video'),
 'Story type menu':async page=>{await boot(page);await page.locator('#story-detail-type-button').click();},
 'Image library':async page=>{await boot(page);await openLibrary(page,'image');},
 'Model Garden':async page=>{await boot(page);await page.getByRole('button',{name:'Model Garden',exact:true}).click();await expect(page.locator('#models-form')).toBeVisible();},
 'Purchase credits':async page=>{await boot(page);await page.locator('#google-user-menu>summary').click();await page.getByRole('button',{name:'Credit and Usage',exact:true}).click();await page.getByRole('button',{name:'Purchase Additional Credits',exact:true}).click();await expect(page.locator('dialog[open].credits-dialog')).toBeVisible();},
 'Desk notifications':async page=>{await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());await page.goto('/desk/index.html?__qa=1');await page.getByRole('button',{name:'Notifications',exact:true}).click();await expect(page.getByRole('tablist',{name:'Notification categories'})).toBeVisible();},
};
for(const [screen,open] of Object.entries(rosterScreens))test(`ROSTER-01 every element on ${screen} follows the master size roster`,async({page})=>{
 await open(page);await page.waitForFunction(()=>window.EccoSizes?.state.roster);
 const result=await page.evaluate(rosterAudit);
 expect(result.checked).toBeGreaterThan(20);
 // An element listed here has a size that is not in the roster: add its type in size-roster.json or Look and Feel.
 expect(result.problems).toEqual([]);
});
test('ROSTER-02 the generated stylesheet matches the roster and both surfaces load it',async({page})=>{
 const roster=JSON.parse(await readFile(new URL('../../design-system/size-roster.json',import.meta.url),'utf8'));
 await boot(page);await page.waitForFunction(()=>window.EccoSizes?.state.roster);
 const css=await readFile(new URL('../../design-system/sizes.css',import.meta.url),'utf8');
 expect(await page.evaluate(r=>window.EccoSizes.compile(r),roster)).toBe(css);
 expect(await page.evaluate(()=>window.EccoSizes.state.source)).toBe('default');
 await page.goto('/desk/index.html?__qa=1');
 expect(await page.evaluate(()=>[...document.querySelector('#ecco-desk-root').shadowRoot.querySelectorAll('style[data-ecco-size-roster]')].length)).toBe(1);
});
async function openLookAndFeel(page){
 await page.locator('[data-category="Activity"] > summary').click();
 await page.locator('#look-and-feel-open').click();
 const panel=page.locator('#look-and-feel-panel');
 await expect(panel.locator('[data-entry]').first()).toBeVisible();
 return panel;
}
async function bootAdmin(page,query='lookAndFeelAdmin=1'){
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort('blockedbyclient'));
 await page.goto('/?__qa=1&'+query);await page.waitForFunction(()=>window.__qaReady);
 await page.locator('#entry-tell-story').click();await page.getByRole('button',{name:'New Story',exact:true}).click();await page.locator('[data-story-destination="story-setup"]').click();
}
test('LOOK-01 a size name changes live and Apply publishes it to everyone',async({page})=>{
 await bootAdmin(page);
 const next=page.locator('.story-details-next');await expect(next).toHaveCSS('font-size','10px');
 const panel=await openLookAndFeel(page);
 // The list starts with the elements on this screen; the Next button is a Button.
 await expect(panel.locator('[data-entry="button"] .count')).toContainText('on this screen');
 await expect(panel.getByRole('button',{name:'Apply to everyone',exact:true})).toBeDisabled();
 await panel.getByLabel('Button text size',{exact:true}).selectOption('@heading-1');
 await expect(next).toHaveCSS('font-size','20px');
 // Changing a size in the scale changes every element that uses it, immediately.
 await panel.getByRole('tab',{name:'Sizes',exact:true}).click();
 const h1=panel.getByLabel('Heading Heading 1 in pixels',{exact:true});await h1.fill('22');
 await expect(next).toHaveCSS('font-size','22px');
 await panel.getByRole('button',{name:'Apply to everyone',exact:true}).click();
 await expect(panel.locator('#msg')).toHaveText('Applied to everyone. Version 1 is live.');
 // A new visit loads the published roster.
 await page.reload();await page.waitForFunction(()=>window.EccoSizes?.state.version===1);
 await page.locator('#entry-tell-story').click();await page.getByRole('button',{name:'New Story',exact:true}).click();await page.locator('[data-story-destination="story-setup"]').click();
 await expect(page.locator('.story-details-next')).toHaveCSS('font-size','22px');
 expect(await page.evaluate(rosterAudit)).toMatchObject({problems:[]});
 const again=await openLookAndFeel(page);
 await again.getByRole('button',{name:'Use repository default',exact:true}).click();
 await expect(again.locator('#msg')).toHaveText('The repository default is now live for everyone.');
 await expect(page.locator('.story-details-next')).toHaveCSS('font-size','10px');
});
test('LOOK-02 Pick on page selects the clicked element and new elements join the roster',async({page})=>{
 await bootAdmin(page);
 const panel=await openLookAndFeel(page);
 await panel.getByRole('button',{name:'Pick on page',exact:true}).click();
 await page.locator('#workspace-back').click();
 // Picking never runs the page action.
 await expect(page.locator('#heading')).toHaveText('Tell Your Story');
 await expect(panel.locator('.el.sel b').first()).toHaveText('Back button');
 await panel.getByLabel('Back button text size',{exact:true}).selectOption('@text-regular');
 await expect(page.locator('#workspace-back')).toHaveCSS('font-size','10px');
 // An element can be added as a variant with its own size from the scale.
 await panel.locator('#addnew > summary').click();
 await panel.getByLabel('Name',{exact:true}).fill('Draft status');
 await panel.getByLabel('Kind',{exact:true}).selectOption({label:'Variant of Body text'});
 await panel.getByLabel('New element text size',{exact:true}).selectOption('@text-regular');
 await panel.getByLabel('Applies to: CSS selectors, one per line',{exact:true}).fill('#story-simple-save');
 await panel.getByRole('button',{name:'Add',exact:true}).click();
 await expect(page.locator('#story-simple-save')).toHaveCSS('font-size','10px');
 await expect(panel.locator('[data-entry="draft-status"]')).toBeVisible();
 // Invalid selectors are refused.
 await panel.locator('#addnew > summary').click();
 await panel.getByLabel('Name',{exact:true}).fill('Broken');await panel.getByLabel('Applies to: CSS selectors, one per line',{exact:true}).fill('p{color:red}');
 await panel.getByRole('button',{name:'Add',exact:true}).click();
 await expect(panel.locator('#msg')).toContainText('plain CSS selectors');
 await panel.getByRole('button',{name:'Discard changes',exact:true}).click();
 await expect(page.locator('#workspace-back')).toHaveCSS('font-size','15px');
});
test('LOOK-03 Look and Feel is for administrators, or anyone previewing with ?design',async({page})=>{
 await boot(page);await page.locator('[data-category="Activity"] > summary').click();
 await expect(page.locator('[data-category="Activity"] .workspace-menu-items')).toBeVisible();
 await expect(page.locator('#look-and-feel-open')).toHaveCount(0);
 await bootAdmin(page,'design=1');
 const panel=await openLookAndFeel(page);
 await panel.getByLabel('Button text size',{exact:true}).selectOption('@text-small');
 await expect(page.locator('.story-details-next')).toHaveCSS('font-size','8.5px');
 await expect(panel.getByRole('button',{name:'Apply to everyone',exact:true})).toBeDisabled();
});
