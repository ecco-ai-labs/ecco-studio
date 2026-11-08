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
async function openLibrary(page,kind){
  const group=page.locator('#workspace-library-group');
  if(await group.getAttribute('open')===null)await group.locator(':scope > summary').click();
  await page.locator(librarySelectors[kind]).click();
  await expect(page.locator('#page .library-files')).toBeVisible();
  return page.locator('#page .library-files');
}
async function popupControls(popup){
 const close=popup.locator('.ecco-popup-close'),minimize=popup.getByRole('button',{name:'Minimize popup',exact:true});
 await expect(close).toBeVisible();await expect(minimize).toBeVisible();
 for(const property of ['width','height','background-color','color'])expect(await close.evaluate((el,p)=>getComputedStyle(el).getPropertyValue(p),property)).toBe(await minimize.evaluate((el,p)=>getComputedStyle(el).getPropertyValue(p),property));
 await expect(close).toHaveCSS('width','26px');await expect(minimize).toHaveCSS('height','26px');
}
for(const theme of ['default','dark','forest','desert','ocean','dark-sky'])test(`POPUP-01 Notifications close, minimize and resume in ${theme}`,async({page})=>{
 await boot(page,{theme});const bell=page.locator('#notification-bell'),panel=page.locator('#notification-list'),dock=page.locator('#ecco-popup-resume');
 await bell.click();await popupControls(panel);const unread=await bell.getAttribute('aria-label');
 await panel.getByRole('button',{name:'Minimize popup',exact:true}).click();await expect(panel).toBeHidden();
 await page.getByLabel('Story Name',{exact:true}).click();await expect(dock).toBeVisible();
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
  const choices=page.locator('#story-home-list button');await expect(choices).toHaveText(['Describe Your Story','StoryBoard Your Story','Create Audio for Your Story','Create Images for Your Story','Create Videos for Your Story','Publish Your Story']);
  await expect(page.locator('#story-workspace-header')).toBeHidden();await expect(page.locator('#journey-guide')).toBeHidden();await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(choices.first()).toHaveCSS('font-size','14px');await expect(page.locator('#workspace-production-group [data-page=journey-preview]')).toHaveText('6. Publish Your Story');
  expect(await page.locator('#workspace-production-group .journey-step').evaluateAll(rows=>rows.every(row=>getComputedStyle(row).fontSize==='14px'))).toBe(true);
  await choices.first().focus();await choices.first().press('Tab');await expect(choices.nth(1)).toBeFocused();expect(await choices.nth(1).evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('solid');
  await choices.first().press('Enter');await expect(page.locator('#story-simple-details')).toBeVisible();await expect(page.getByLabel('Story Name',{exact:true})).toHaveValue('');
  await page.locator('#workspace-back').click();await expect(page.locator('#story-home-list')).toBeVisible();
});
test('STORY-home sidebar and Back preserve edited drafts and open the existing tools',async({page})=>{
  await boot(page);await page.getByLabel('Story Name',{exact:true}).fill('Keep this story');
  await page.locator('#workspace-production-group > summary').click();await expect(page.locator('#story-home-list')).toBeVisible();
  await expect(page.locator('#workspace-production-group > summary')).toHaveAttribute('aria-current','page');await expect(page.locator('#story-workspace-header')).toBeHidden();
  await page.locator('#workspace-back').click();await expect(page.getByLabel('Story Name',{exact:true})).toHaveValue('Keep this story');
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
  expect(await landingStyle()).toEqual({padding:'24px',font:'14px',borders:true});
  const storyStyle=await choices.first().evaluate(el=>{const s=getComputedStyle(el);return [s.minHeight,s.padding,s.color,s.backgroundColor,s.gridTemplateColumns];});
  await page.locator('#workspace-library-group > summary').click();
  expect(await page.locator('#library-home-list button').first().evaluate(el=>{const s=getComputedStyle(el);return [s.minHeight,s.padding,s.color,s.backgroundColor,s.gridTemplateColumns];})).toEqual(storyStyle);
  expect(await landingStyle()).toEqual({padding:'24px',font:'14px',borders:true});
});
test('STORY-01 three tabs and left navigation stay visible',async({page})=>{
  await boot(page);await expect(page.locator('#story-workspace-header [role=tab]')).toHaveCount(3);
  await expect(page.locator('body > aside')).toBeVisible();
  await expect(page.getByLabel('Story Name',{exact:true})).toHaveValue('');
});
test('STORY-02 name validation blocks an empty story',async({page})=>{
  await boot(page);await page.getByRole('button',{name:'Continue to Story',exact:true}).click();
  await expect(page.getByLabel('Story Name',{exact:true})).toBeVisible();
  expect(await page.getByLabel('Story Name',{exact:true}).evaluate(el=>el.validity.valueMissing)).toBe(true);
});
test('STORY-03 new story clears previous fields',async({page})=>{
  await boot(page);await page.getByLabel('Story Name',{exact:true}).fill('Prior story must not leak');
  await openLibrary(page,'story');await page.getByRole('button',{name:'New Story',exact:true}).click();
  await expect(page.getByLabel('Story Name',{exact:true})).toHaveValue('');
});
test('STORY-04 Generate With AI carries options and synchronizes Story Details',async({page})=>{
  await boot(page);await page.getByLabel('Story Name',{exact:true}).fill('QA Story');
  for(const [name,value] of Object.entries({output:'audio',type:'podcast',genre:'Comedy',audience:'All ages',language:'English',recurrence:'once'}))
    await page.locator('#story-simple-details [name='+name+']').selectOption(value);
  await page.getByRole('button',{name:'Continue to Story',exact:true}).click();
  const actions=page.locator('#page .story-source-actions');
  for(const width of [1440,1024,390]){
    await page.setViewportSize({width,height:1000});const row=await actions.boundingBox(),buttons=await actions.locator('.story-source-control').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right};}));
    expect(buttons).toHaveLength(3);for(const button of buttons){expect(Math.abs(button.width-buttons[0].width)).toBeLessThan(1);expect(Math.abs(button.height-buttons[0].height)).toBeLessThan(1);expect(button.x).toBeGreaterThanOrEqual(row.x-1);expect(button.right).toBeLessThanOrEqual(row.x+row.width+1);}
    for(const y of new Set(buttons.map(button=>button.y)))expect(Math.abs(Math.max(...buttons.filter(button=>button.y===y).map(button=>button.right))-(row.x+row.width))).toBeLessThan(1);
    if(width>=1024)expect(new Set(buttons.map(button=>button.y)).size).toBe(1);
  }
  await page.setViewportSize({width:1440,height:1000});await actions.getByRole('button',{name:'Write',exact:true}).click();await expect(page.locator('#story-simple-script')).toBeFocused();
  await page.locator('#page [data-ai]').click();
  await expect(page.locator('#ai-generation-dialog')).toBeVisible();
  await expect(page.getByRole('dialog',{name:'Generate With AI',exact:true})).toBeVisible();
  const ai=page.locator('#ai-generation-dialog');await expect(ai.locator('[name=instructions]')).toBeFocused();
  const uploadBox=await page.locator('#page [data-upload]').boundingBox(),generateBox=await page.locator('#page [data-ai]').boundingBox();
  expect(generateBox.width).toBe(uploadBox.width);expect(generateBox.height).toBe(uploadBox.height);
  expect((await ai.boundingBox()).width).toBeGreaterThan(page.viewportSize().width*.9);
  for(const [name,value] of Object.entries({story_type:'podcast',genre:'Comedy',age_group:'All ages',language:'English'}))await expect(ai.locator('[name='+name+']')).toHaveValue(value);
  for(const [name,value] of Object.entries({story_type:'storybook',genre:'Fantasy',age_group:'Children (9–12)',language:'Hindi'}))await ai.locator('[name='+name+']').selectOption(value);
  await ai.getByRole('button',{name:'Close popup',exact:true}).click();
  await page.getByRole('tab',{name:'1. Story Details',exact:true}).click();
  for(const [name,value] of Object.entries({type:'storybook',genre:'Fantasy',audience:'Children (9–12)',language:'Hindi'}))await expect(page.locator('#story-simple-details [name='+name+']')).toHaveValue(value);
});
test('LIB-home-01 chooser shows aligned icons and opens each matching sidebar destination',async({page})=>{
  await boot(page);
  const kinds=['story','image','audio','video','workflow'];
  await page.locator('#workspace-library-group > summary').click();
  await expect(page.locator('#heading')).toHaveText('Library');
  await expect(page.locator('#page h2,#page .library-home-detail,#page .library-home-arrow')).toHaveCount(0);
  await expect(page.locator('body > aside')).toBeVisible();
  await expect(page.locator('#story-workspace-header')).toBeHidden();
  const choices=page.locator('#library-home-list button');
  await expect(choices).toHaveCount(5);
  await expect(choices.first()).toHaveCSS('font-size','14px');
  for(const selector of Object.values(librarySelectors))await expect(page.locator(selector)).toHaveCSS('font-size','14px');
  expect(await choices.evaluateAll(rows=>rows.map(row=>row.dataset.libraryDestination))).toEqual(kinds);
  const bounds=await choices.evaluateAll(rows=>rows.map(row=>({left:row.getBoundingClientRect().left,width:row.getBoundingClientRect().width,iconLeft:row.querySelector('svg').getBoundingClientRect().left})));
  for(const row of bounds){expect(row.left).toBe(bounds[0].left);expect(row.width).toBe(bounds[0].width);expect(row.iconLeft).toBe(bounds[0].iconLeft);}
  await choices.first().press('Tab');await expect(choices.nth(1)).toBeFocused();
  expect(await choices.nth(1).evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('solid');
  for(const kind of kinds){
    const choice=page.locator('[data-library-destination="'+kind+'"]');
    await expect(choice.locator('.workspace-home-icon')).toBeVisible();
    await expect(choice).toHaveText(new RegExp(kind[0].toUpperCase()+kind.slice(1)+' Library'));
    if(kind==='story')await choice.click();else await choice.press('Enter');
    await expect(page.locator('#page .library-files')).toBeVisible();
    await expect(page.locator(librarySelectors[kind])).toHaveAttribute('aria-current','page');
    await expect(page.locator(librarySelectors[kind])).toBeFocused();
    await page.locator('#workspace-library-group > summary').click();
  }
});
test('LAYOUT-library-home narrow light-theme chooser shows only the five library names',async({page})=>{
  await page.setViewportSize({width:390,height:900});await boot(page,{theme:'desert'});
  await page.locator('#workspace-library-group > summary').click();
  const choices=page.locator('#library-home-list button');await expect(choices).toHaveCount(5);
  for(const choice of await choices.all()){
    await expect(choice).toBeVisible();await expect(choice.locator('span')).toHaveCount(1);
    expect(await choice.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&el.scrollWidth<=el.clientWidth;})).toBe(true);
  }
});
for(const kind of Object.keys(librarySelectors)){
  test(`LIB-${kind}-01 opening hides Story tabs and defaults to List`,async({page})=>{
    await boot(page);const gallery=await openLibrary(page,kind);
    await expect(page.locator('#story-workspace-header')).toBeHidden();
    await expect(page.locator('#page .library-view-label select')).toHaveValue('list');
    expect(await page.locator('#page .library-view-label option').allTextContents()).toEqual(['List','Small icons','Large icons']);
    await expect(gallery.locator('[role=columnheader]')).toHaveCount(4);
    await expect(gallery.locator('.card').first()).toBeVisible();
  });
  for(const mode of ['list','small','large']){
    test(`LIB-${kind}-${mode} compact rows show metadata and accessible file names`,async({page})=>{
      await boot(page);const gallery=await openLibrary(page,kind);
      await page.locator('#page .library-view-label select').selectOption(mode);
      await expect(gallery).toHaveAttribute('data-file-view',mode);
      const row=gallery.locator('.card').first();await expect(row).toBeVisible();
      await expect(row.locator('.library-file-open')).toHaveAttribute('aria-label',/^Open .+/);
      await expect(row.locator('.library-file-type')).not.toBeEmpty();
      await expect(row.locator('.library-file-created')).not.toBeEmpty();
      expect(await row.evaluate(el=>getComputedStyle(el).boxShadow)).toBe('none');
      if(mode!=='list')await expect(row.locator('.library-file-icon')).toBeVisible();
    });
  }
}
for(const kind of ['image','audio','video']){
  test(`LIB-${kind}-search filtering and clearing preserve file rows`,async({page})=>{
    await boot(page);const gallery=await openLibrary(page,kind);
    const search=page.getByRole('searchbox',{name:`Filter ${kind} library`});
    await search.fill('Alpha');await expect(gallery.locator('.card:visible')).toHaveCount(1);
    await search.fill('no-such-file');await expect(gallery.locator('.card:visible')).toHaveCount(0);
    await expect(gallery.locator('.library-filter-empty')).toBeVisible();
    await search.fill('');await expect(gallery.locator('.card:visible')).toHaveCount(2);
  });
  test(`LIB-${kind}-sort file names sort both ways`,async({page})=>{
    await boot(page);const gallery=await openLibrary(page,kind);
    const sort=gallery.locator('[data-sort=title] button');await sort.click();
    await expect(gallery.locator('.card:visible .library-file-open').first()).toHaveAttribute('aria-label',/^Open Alpha/);
    await sort.click();await expect(gallery.locator('.card:visible .library-file-open').first()).toHaveAttribute('aria-label',/^Open Zebra/);
  });
}
// Check actual pixels of a known media fixture. A generic SVG or blank tile fails.
for(const kind of ['image','video'])for(const mode of ['small','large']){
  test(`THUMB-${kind}-${mode} icon displays the real sample frame`,async({page})=>{
    await boot(page);const gallery=await openLibrary(page,kind);
    await page.locator('#page .library-view-label select').selectOption(mode);
    const icon=gallery.locator('.card').first().locator('.library-file-icon');
    await expect(icon).toBeVisible();
    const decoded=icon.locator('img,video,canvas');
    await expect(decoded,'Expected a decoded media thumbnail; a generic icon is not a preview').toHaveCount(1);
    await expect(decoded).toBeVisible();
    await expect.poll(()=>decoded.evaluate(el=>el instanceof HTMLImageElement?el.complete&&el.naturalWidth>0:el instanceof HTMLVideoElement?el.readyState>=2:el.width>0)).toBe(true);
    const samplePixels=()=>decoded.evaluate(el=>{
      const c=document.createElement('canvas');c.width=160;c.height=90;const ctx=c.getContext('2d');ctx.drawImage(el,0,0,160,90);
      return [Array.from(ctx.getImageData(10,45,1,1).data),Array.from(ctx.getImageData(100,45,1,1).data)];
    });
    // HAVE_CURRENT_DATA may precede a drawable video frame. Keep the real-pixel
    // requirement while allowing the media decoder to finish presenting it.
    await expect.poll(async()=>{
      const pixels=await samplePixels();
      return Math.min(pixels[0][0]-pixels[0][1],pixels[1][1]-pixels[1][0]);
    },{message:'The decoded thumbnail must display both the red stripe and green field'}).toBeGreaterThan(100);
    const pixels=await samplePixels();
    expect(pixels[0][0]-pixels[0][1],'Left red stripe should come from the actual media').toBeGreaterThan(100);
    expect(pixels[1][1]-pixels[1][0],'Right green field should come from the actual media').toBeGreaterThan(100);
  });
}
test('LIB-preview close restores keyboard focus to its file',async({page})=>{
  await boot(page);const gallery=await openLibrary(page,'image');const file=gallery.locator('.library-file-open').first();
  await file.click();await expect(page.locator('.library-file-preview')).toBeVisible();
  await page.locator('.library-file-preview').getByRole('button',{name:'Close popup',exact:true}).click();
  await expect(page.locator('.library-file-preview')).toHaveCount(0);await expect(file).toBeFocused();
});
for(const theme of ['default','dark','forest','desert','ocean','dark-sky']){
  test(`THEME-${theme} library controls remain visible and sidebar stays flat`,async({page})=>{
    await boot(page,{theme});await openLibrary(page,'image');
    await expect(page.locator('html')).toHaveAttribute('data-ecco-theme',theme);
    const summary=page.locator('#workspace-library-group > summary');await expect(summary).toBeVisible();
    expect(await summary.evaluate(el=>getComputedStyle(el).boxShadow)).toBe('none');
    await expect(page.getByRole('searchbox',{name:'Filter image library'})).toBeVisible();
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
  await expect(unread.first().locator('.notification-title')).toHaveCSS('font-size','14px');
  await expect(unread.first().locator('.notification-body')).toHaveCSS('font-size','13px');
  await expect(page.locator('[data-notification-items] td').first()).toHaveCSS('padding-top','16px');
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
  await boot(page);await page.getByLabel('Story Name',{exact:true}).fill('Navigation draft');
  await openLibrary(page,'image');await page.getByRole('searchbox',{name:'Filter image library'}).fill('Alpha');
  await page.locator('#page .library-view-label select').selectOption('large');
  await page.getByRole('button',{name:'Model Garden',exact:true}).click();await expect(page.locator('#models-form')).toBeVisible();
  await page.locator('#workspace-back').click();await expect(page.locator('#page .library-view-label select')).toHaveValue('large');
  await expect(page.getByRole('searchbox',{name:'Filter image library'})).toHaveValue('Alpha');
  await page.locator('#workspace-back').click();await expect(page.locator('#library-home-list')).toBeVisible();
  await page.locator('#workspace-back').click();await expect(page.getByLabel('Story Name',{exact:true})).toHaveValue('Navigation draft');
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
  await expect(page.locator('#video-library-gallery')).toBeVisible();await expect(page.locator('#activity-files-menu')).toBeFocused();
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
  await boot(page);await page.getByLabel('Story Name',{exact:true}).fill('Upload controls QA');
  for(const [name,value] of Object.entries({output:'audio',type:'podcast',genre:'Comedy',audience:'All ages',language:'English',recurrence:'once'}))await page.locator('#story-simple-details [name='+name+']').selectOption(value);
  await page.getByRole('button',{name:'Continue to Story',exact:true}).click();
  const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Upload PDF',exact:true}).click();await (await chooser).setFiles({name:'upload-qa.txt',mimeType:'text/plain',buffer:Buffer.from('The original document remains untouched.')});
  const dialog=page.getByRole('dialog',{name:'Select Story Text',exact:true}),selected=dialog.locator('[data-selected]');await expect(dialog).toBeVisible();await expect(selected).toHaveValue('');
  await expect(dialog.locator('[data-story-context]')).toHaveCount(0);
  for(const width of [1440,1024]){
    await page.setViewportSize({width,height:1000});
    const panes=await dialog.locator('.pdf-selection-layout > *').evaluateAll(els=>els.map(el=>({x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y,width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,bottom:el.getBoundingClientRect().bottom})));
    expect(panes).toHaveLength(3);for(const pane of panes){expect(Math.abs(pane.width-panes[0].width)).toBeLessThan(2);expect(Math.abs(pane.height-panes[0].height)).toBeLessThan(2);expect(pane.y).toBe(panes[0].y);}
    expect((await dialog.locator('.pdf-selection-ribbon').boundingBox()).y).toBeGreaterThanOrEqual(panes[0].bottom);
    const inputHeight=(await dialog.getByLabel('AI instructions',{exact:true}).boundingBox()).height,outputHeight=(await dialog.getByLabel('AI Output',{exact:true}).boundingBox()).height;expect(Math.abs(inputHeight-outputHeight)).toBeLessThan(1);
    for(const label of ['AI instructions','AI Output']){await expect(dialog.getByLabel(label,{exact:true})).toBeVisible();expect((await dialog.getByLabel(label,{exact:true}).boundingBox()).height).toBeGreaterThan(120);}
  }
  const find=dialog.locator('.pdf-find-replace summary'),clear=dialog.getByRole('button',{name:'Clear Text',exact:true});
  await expect(dialog.locator('.pdf-selected-label')).toHaveCSS('border-top-color','rgb(255, 220, 36)');
  await selected.fill('Only these selected words.');await find.press('Enter');await expect(dialog.getByLabel('Find',{exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(find).toBeFocused();await expect(dialog).toBeVisible();
  await dialog.getByLabel('AI instructions',{exact:true}).fill('Make it simpler.');await dialog.getByRole('button',{name:'Improve with AI',exact:true}).click();const error=page.getByRole('dialog',{name:'Unable to Improve Text',exact:true});await expect(error).toContainText(/Connect your saved workspace from Connections → Storage/);await expect(error.locator('[data-ai-recommendation]')).not.toBeEmpty();await error.getByRole('button',{name:'Continue Without AI',exact:true}).click();await expect(dialog.getByRole('button',{name:'Generate Script',exact:true})).toBeFocused();await expect(dialog).toBeVisible();await expect(dialog.getByLabel('AI Output',{exact:true})).toHaveValue('');
  await dialog.getByRole('button',{name:'Save Draft',exact:true}).click();await expect(dialog.locator('[role=status]')).toContainText('Draft saved');
  await expect(clear).toHaveClass('secondary');expect(await clear.evaluate(el=>el.nextElementSibling.matches('[data-extract]'))).toBe(true);await clear.click();await expect(selected).toHaveValue('');await expect(dialog.getByRole('button',{name:'Generate Script',exact:true})).toBeDisabled();await expect(dialog.locator('.source-text-preview')).toHaveText('The original document remains untouched.');
  await page.setViewportSize({width:390,height:844});await find.click();const panel=await dialog.locator('.pdf-find-replace .pdf-tool-panel').boundingBox();expect(panel.x).toBeGreaterThanOrEqual(0);expect(panel.x+panel.width).toBeLessThanOrEqual(390);await page.keyboard.press('Escape');await expect(dialog).toBeVisible();
});
test('UPLOAD-02 AI output review and fiction versus Sports News confirmation preserve deliberate choice',async({page})=>{
  await boot(page,{sourceFit:'fiction'});await page.getByLabel('Story Name',{exact:true}).fill('Sports News');
  for(const [name,value] of Object.entries({output:'audio',type:'news',genre:'Sports',audience:'All ages',language:'English',recurrence:'once'}))await page.locator('#story-simple-details [name='+name+']').selectOption(value);
  await page.getByRole('button',{name:'Continue to Story',exact:true}).click();const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Upload PDF',exact:true}).click();await (await chooser).setFiles({name:'Alibaba.txt',mimeType:'text/plain',buffer:Buffer.from('Alibaba found a cave. PRIVATE_UNSELECTED_REST')});
  const source=page.getByRole('dialog',{name:'Select Story Text',exact:true});await source.locator('[data-selected]').fill('Alibaba found a cave.');await source.getByLabel('AI instructions',{exact:true}).fill('Make it clearer.');await source.getByRole('button',{name:'Improve with AI',exact:true}).click();await expect(source.getByLabel('AI Output',{exact:true})).toHaveValue('Alibaba discovered a hidden cave.');await expect(source.locator('[data-selected]')).toHaveValue('Alibaba found a cave.');
  await source.getByRole('button',{name:'Use AI Text',exact:true}).click();await expect(source.locator('[data-selected]')).toHaveValue('Alibaba discovered a hidden cave.');
  await source.getByRole('button',{name:'Generate Script',exact:true}).click();const warning=page.getByRole('dialog',{name:'Review source compatibility',exact:true});await expect(warning).toBeVisible();await expect(warning.locator('[data-story]')).toContainText('Sports News');await expect(warning.locator('[data-reason]')).toContainText('fiction');await expect(page.locator('#story-simple-script')).toHaveValue('');
  await warning.getByRole('button',{name:'Choose Different Text',exact:true}).click();await expect(warning).toHaveCount(0);await expect(source).toBeVisible();await expect(source.getByRole('button',{name:'Generate Script',exact:true})).toBeFocused();await expect(source.locator('[data-selected]')).toHaveValue('Alibaba discovered a hidden cave.');
  await source.getByRole('button',{name:'Generate Script',exact:true}).click();await warning.getByRole('button',{name:'Use Anyway',exact:true}).click();await expect(source).toBeHidden();await applyScriptReview(page);await expect(page.locator('#story-simple-script')).toHaveValue('Narrator: Alibaba discovered a hidden cave.');
  const calls=await page.evaluate(()=>window.__qaCalls.filter(c=>c.path==='ai/enhance'));expect(JSON.stringify(calls)).not.toContain('PRIVATE_UNSELECTED_REST');expect(calls.find(c=>c.body.fields[0].id==='source_compatibility').body.context.genre).toBe('Sports');
});

test('UPLOAD-06 Apply Text selects the audio cast, fills voice properties and keeps Story Details synchronized through Back',async({page})=>{
  await boot(page,{sourceFit:'cast'});await page.getByLabel('Story Name',{exact:true}).fill('Ali and Morgiana');
  for(const [name,value] of Object.entries({output:'audio',type:'news',genre:'Sports',audience:'All ages',language:'English',recurrence:'once'}))await page.locator('#story-simple-details [name='+name+']').selectOption(value);
  await page.getByRole('button',{name:'Continue to Story',exact:true}).click();
  const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Upload PDF',exact:true}).click();await (await chooser).setFiles({name:'Cast.txt',mimeType:'text/plain',buffer:Buffer.from('Ali and Morgiana found a cave. PRIVATE_UNSELECTED_REST')});
  const source=page.getByRole('dialog',{name:'Select Story Text',exact:true});await source.getByLabel('Story Type',{exact:true}).selectOption('storybook');await source.getByLabel('Genre',{exact:true}).selectOption('Adventure');
  await source.locator('[data-selected]').fill('Ali and Morgiana found a cave.');await source.getByLabel('AI instructions',{exact:true}).fill('Make this a scene with the characters speaking.');await source.getByRole('button',{name:'Improve with AI',exact:true}).click();await source.getByRole('button',{name:'Use AI Text',exact:true}).click();
  expect(await page.evaluate(()=>window.__qaCalls.filter(c=>c.body?.fields?.[0]?.id==='story_workspace').length)).toBe(0);
  await source.getByRole('button',{name:'Generate Script',exact:true}).click();await expect(source).toBeHidden();await applyScriptReview(page);await expect(page.locator('[data-character-tabs] [role=tab]')).toHaveCount(3);
  await expect(page.locator('[data-cast-reason]')).toContainText('3 audio characters identified');await expect(page.locator('#story-simple-script')).toHaveValue('Narrator: At the cave.\n\nAli: Open sesame!\n\nMorgiana: I will help.');await expect(page.locator('#story-simple-candidate')).toBeHidden();
  await page.getByRole('tab',{name:'Character 2',exact:true}).click();await expect(page.getByLabel('Character 2 Name',{exact:true})).toHaveValue('Ali');await page.getByRole('tab',{name:'Character 3',exact:true}).click();await expect(page.getByLabel('Character 3 Name',{exact:true})).toHaveValue('Morgiana');await page.getByRole('tab',{name:'Character 2',exact:true}).click();
  const character=page.locator('#story-character-properties .story-simple-character');await character.locator('summary').press('Enter');await expect(page.getByLabel('Character 2 Accent',{exact:true})).toHaveValue('Indian English');await expect(page.getByLabel('Character 2 Speaking style',{exact:true})).toHaveValue('Curious');await expect(page.getByLabel('Character 2 Emotion',{exact:true})).toHaveValue('surprise');await expect(page.getByLabel('Character 2 Voice',{exact:true})).not.toHaveValue('');await expect(page.locator('[data-property=appearance]')).toHaveCount(0);
  const calls=await page.evaluate(()=>window.__qaCalls.filter(c=>c.body?.fields?.[0]?.id==='story_workspace'));expect(calls).toHaveLength(1);expect(JSON.parse(calls[0].body.context.summary)).toMatchObject({output:'audio',story_type:'storybook'});expect(calls[0].body.context.genre).toBe('Adventure');expect(calls[0].body.context.lines).toHaveLength(0);expect(JSON.stringify(calls)).not.toContain('PRIVATE_UNSELECTED_REST');
  await page.locator('#workspace-back').click();await expect(page.locator('#story-simple-details [name=type]')).toHaveValue('storybook');await expect(page.locator('#story-simple-details [name=genre]')).toHaveValue('Adventure');await expect(page.locator('#story-simple-details [name=output]')).toHaveValue('audio');
  await page.locator('#story-simple-details [name=type]').selectOption('audio-drama');await page.getByRole('tab',{name:'2. Story and Characters',exact:true}).click();await expect(page.locator('[data-character-tabs] [role=tab]')).toHaveCount(3);
});

test('UPLOAD-07 real PDF pages and listed chapters populate original editable text before AI and final application',async({page})=>{
 await boot(page,{sourceFit:'cast',pdf:true});await page.getByLabel('Story Name',{exact:true}).fill('PDF source test');
 for(const [name,value]of Object.entries({output:'audio',type:'storybook',genre:'Adventure',audience:'All ages',language:'English',recurrence:'once'}))await page.locator('#story-simple-details [name='+name+']').selectOption(value);
 await page.getByRole('button',{name:'Continue to Story',exact:true}).click();const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Upload PDF',exact:true}).click();await(await chooser).setFiles(new URL('../fixtures/source-chapters.pdf',import.meta.url).pathname);
 const source=page.getByRole('dialog',{name:'Select Story Text',exact:true}),middle=source.locator('[data-selected]');await expect(source.locator('[data-document-info]')).toContainText('10 PDF pages');await expect(middle).toHaveValue('');
 await source.locator('[data-pages-menu] summary').click();await source.locator('[data-pages]').fill('2–3');await source.locator('[data-pages]').press('Enter');await expect(middle).toHaveValue(/Page 2, line 1/);await expect(middle).toHaveValue(/Page 3, line 48/);await expect(middle).not.toHaveValue(/Page 1,|Page 4,|PRIVATE_NEXT_CHAPTER/);
 await source.getByRole('button',{name:'Clear Text',exact:true}).click();await source.locator('[data-chapter-menu] summary').press('Enter');await expect(source.locator('[data-chapter-list]')).toBeFocused();await source.locator('[data-chapter-list]').selectOption({label:'Chapter One · page 1'});await source.getByRole('button',{name:'Add Chapter',exact:true}).click();await expect(middle).toHaveValue(/^Chapter One\nBy A. Writer/);await expect(middle).not.toHaveValue(/Chapter Two|PRIVATE_NEXT_CHAPTER/);expect((await middle.inputValue()).length).toBeGreaterThan(30000);expect(await page.evaluate(()=>window.__qaCalls.filter(c=>c.path==='ai/enhance').length)).toBe(0);
 await middle.fill((await middle.inputValue()).replace('By A. Writer\n',''));await expect(middle).not.toHaveValue(/By A. Writer/);await source.getByLabel('AI instructions',{exact:true}).fill('Make a short scene with the three characters speaking.');await source.getByRole('button',{name:'Improve with AI',exact:true}).click();await expect(source.getByLabel('AI Output',{exact:true})).toHaveValue(/Morgiana: I will help/);await expect(middle).toHaveValue(/Page 9, line 48/);
 await source.getByRole('button',{name:'Use AI Text',exact:true}).click();await expect(middle).toHaveValue('Narrator: At the cave.\n\nAli: Open sesame!\n\nMorgiana: I will help.');await source.getByRole('button',{name:'Generate Script',exact:true}).click();await expect(source).toBeHidden();await applyScriptReview(page);await expect(page.locator('[data-character-tabs] [role=tab]')).toHaveCount(3);
 const calls=await page.evaluate(()=>window.__qaCalls.filter(c=>c.path==='ai/enhance'));expect(JSON.stringify(calls)).not.toContain('PRIVATE_NEXT_CHAPTER');const cast=JSON.parse(calls.find(c=>c.body.fields[0].id==='story_workspace').body.context.summary);expect(cast.script).toBe('Narrator: At the cave.\n\nAli: Open sesame!\n\nMorgiana: I will help.');expect(cast.script).not.toContain('By A. Writer');
});


test('UPLOAD-08 mouse selection, Find and Replace, manual edits and saved selection use only chosen PDF text',async({page})=>{
 await boot(page,{sourceFit:'cast',pdf:true});await page.getByLabel('Story Name',{exact:true}).fill('Selection editing test');for(const [name,value]of Object.entries({output:'audio',type:'storybook',genre:'Adventure',audience:'All ages',language:'English',recurrence:'once'}))await page.locator('#story-simple-details [name='+name+']').selectOption(value);await page.getByRole('button',{name:'Continue to Story',exact:true}).click();
 const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Upload PDF',exact:true}).click();await(await chooser).setFiles(new URL('../fixtures/source-chapters.pdf',import.meta.url).pathname);
 const source=page.getByRole('dialog',{name:'Select Story Text',exact:true}),middle=source.locator('[data-selected]');const author=source.locator('.textLayer span').filter({hasText:/^By A\. Writer$/});await expect(author).toBeVisible();const rect=await author.boundingBox();await page.mouse.move(rect.x,rect.y+rect.height/2);await page.mouse.down();await page.mouse.move(rect.x+rect.width+2,rect.y+rect.height/2,{steps:8});await page.mouse.up();await expect(middle).toHaveValue('By A. Writer');
 await source.getByRole('button',{name:'Clear Text',exact:true}).click();await expect(middle).toHaveValue('');await source.locator('[data-pages-menu] summary').click();await source.locator('[data-pages]').fill('2');await source.locator('[data-pages]').press('Enter');await expect(middle).toHaveValue(/Page 2, line 48/);
 await source.locator('.pdf-find-replace summary').click();await source.getByLabel('Find',{exact:true}).fill('Ali');await source.getByLabel('Replace with',{exact:true}).fill('Asha');await source.locator('[data-replace-scope]').selectOption('all');await source.getByRole('button',{name:'Replace',exact:true}).click();await expect(middle).toHaveValue(/Asha and Morgiana/);await expect(middle).not.toHaveValue(/Ali and Morgiana|Page 1,|Page 3,/);await page.keyboard.press('Escape');
 await middle.fill('Asha: I will help.\nMorgiana: Thank you.');await source.getByRole('button',{name:'Save Draft',exact:true}).click();await expect(source.locator('[role=status]')).toContainText('Draft saved');await page.keyboard.press('Escape');await page.getByRole('button',{name:'Resume Saved Selection',exact:true}).click();await expect(source.locator('[data-selected]')).toHaveValue('Asha: I will help.\nMorgiana: Thank you.');await source.getByRole('button',{name:'Generate Script',exact:true}).click();await applyScriptReview(page);await expect(page.locator('#story-simple-script')).toHaveValue('Asha: I will help.\n\nMorgiana: Thank you.');
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
  await expect(page.getByLabel('Title',{exact:true})).toHaveCSS('font-size','12px');
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

test('UPLOAD-03 compact AI ribbon synchronizes Story Details and sends current choices with the prompt',async({page})=>{
 await boot(page,{sourceFit:'fiction'});await page.getByLabel('Story Name',{exact:true}).fill('Ribbon story');
 for(const [name,value] of Object.entries({output:'audio',type:'podcast',genre:'Comedy',audience:'All ages',language:'English',recurrence:'once'}))await page.locator('#story-simple-details [name='+name+']').selectOption(value);
 await page.getByRole('button',{name:'Continue to Story',exact:true}).click();const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Upload PDF',exact:true}).click();await (await chooser).setFiles({name:'ribbon.txt',mimeType:'text/plain',buffer:Buffer.from('PRIVATE_UNSELECTED original document.')});
 const source=page.getByRole('dialog',{name:'Select Story Text',exact:true}),ribbon=source.getByRole('group',{name:'AI story controls',exact:true}),ai=ribbon.getByRole('button',{name:'Improve with AI',exact:true});
 for(const [name,value] of Object.entries({story_type:'podcast',genre:'Comedy',age_group:'All ages',language:'English'}))await expect(ribbon.locator('[data-ai-setting='+name+']')).toHaveValue(value);
 await expect(source.getByText('Uses only Selected Text. Highlight words there to limit the change.',{exact:true})).toHaveCount(0);await expect(source.getByText('Prompt',{exact:true})).toHaveCount(0);await expect(ai).toHaveText('✦');expect((await ai.boundingBox()).width).toBeLessThanOrEqual(32);expect((await ribbon.boundingBox()).y).toBeLessThan((await source.getByLabel('AI instructions',{exact:true}).boundingBox()).y);
 const fields=await ribbon.locator('select').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().y));expect(new Set(fields).size).toBe(1);
 for(const [name,value] of Object.entries({story_type:'storybook',genre:'Fantasy',age_group:'Children (9–12)',language:'Hindi'}))await ribbon.locator('[data-ai-setting='+name+']').selectOption(value);
 await source.locator('[data-selected]').fill('Alibaba found a cave.');await source.getByLabel('AI instructions',{exact:true}).fill('Make it simpler.');await ai.click();await expect(source.getByLabel('AI Output',{exact:true})).toHaveValue('Alibaba discovered a hidden cave.');
 const call=await page.evaluate(()=>window.__qaCalls.find(c=>c.body?.fields?.[0]?.id==='source_excerpt'));expect(call.body.context.language).toBe('Hindi');expect(call.body.context.genre).toBe('Fantasy');expect(JSON.parse(call.body.context.summary)).toMatchObject({story_type:'storybook',age_group:'Children (9–12)'});expect(JSON.stringify(call)).not.toContain('PRIVATE_UNSELECTED');
 await ribbon.getByLabel('Genre',{exact:true}).selectOption('Adventure');await expect(source.getByLabel('AI Output',{exact:true})).toHaveValue('');await expect(source.locator('[data-selected]')).toHaveValue('Alibaba found a cave.');await expect(source.getByRole('button',{name:'Use AI Text',exact:true})).toBeDisabled();
 await source.getByRole('button',{name:'Close popup',exact:true}).click();await page.getByRole('tab',{name:'1. Story Details',exact:true}).click();
 for(const [name,value] of Object.entries({type:'storybook',genre:'Adventure',audience:'Children (9–12)',language:'Hindi'}))await expect(page.locator('#story-simple-details [name='+name+']')).toHaveValue(value);
 await page.locator('#story-simple-details [name=language]').selectOption('Urdu');await page.getByRole('tab',{name:'2. Story and Characters',exact:true}).click();await page.getByRole('button',{name:'Preview & Select',exact:true}).click();await expect(ribbon.getByLabel('Language',{exact:true})).toHaveValue('Urdu');await expect(source.locator('[data-selected]')).toHaveValue('Alibaba found a cave.');
});

test('UPLOAD-04 AI clarification opens a popup and preserves equal text boxes and selected content',async({page})=>{
 await boot(page,{sourceFit:'clarification'});await page.getByLabel('Story Name',{exact:true}).fill('Alibaba');
 for(const [name,value] of Object.entries({output:'audio',type:'storybook',genre:'Fantasy',audience:'All ages',language:'English',recurrence:'once'}))await page.locator('#story-simple-details [name='+name+']').selectOption(value);
 await page.getByRole('button',{name:'Continue to Story',exact:true}).click();const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Upload PDF',exact:true}).click();await (await chooser).setFiles({name:'jars.txt',mimeType:'text/plain',buffer:Buffer.from('Thirty-nine jars.')});
 const source=page.getByRole('dialog',{name:'Select Story Text',exact:true});await source.locator('[data-selected]').fill('Thirty-nine jars.');await source.getByLabel('AI instructions',{exact:true}).fill('Improve the narration.');await source.getByRole('button',{name:'Improve with AI',exact:true}).click();
 const notice=page.getByRole('dialog',{name:'AI Needs Clarification',exact:true});await expect(notice).toBeVisible();await expect(notice).toContainText('Should the burial count be 38, or should the oil be stored separately?');await expect(notice.getByRole('button',{name:'Set burial count to 38 Recommended',exact:true})).toBeVisible();await expect(notice.getByRole('button',{name:'Store oil separately',exact:true})).toBeVisible();await expect(notice.locator('[data-ai-recommendation]')).toContainText('change the burial count to 38');await expect(source.getByLabel('AI Output',{exact:true})).toHaveValue('');await expect(source.locator('[data-ai-status]')).toHaveText('');
 await notice.getByRole('button',{name:'Edit Prompt',exact:true}).click();await expect(notice).toHaveCount(0);await expect(source.getByLabel('AI instructions',{exact:true})).toBeFocused();await expect(source.locator('[data-selected]')).toHaveValue('Thirty-nine jars.');const a=await source.getByLabel('AI instructions',{exact:true}).boundingBox(),b=await source.getByLabel('AI Output',{exact:true}).boundingBox();expect(Math.abs(a.height-b.height)).toBeLessThan(1);
 await source.getByRole('button',{name:'Improve with AI',exact:true}).click();await notice.getByRole('button',{name:'Continue Anyway',exact:true}).click();await expect(notice).toHaveCount(0);await expect(source.getByLabel('AI Output',{exact:true})).toHaveValue('Thirty-nine jars stood ready, one holding oil. Later, thirty-nine robbers were buried.');await expect(source.locator('[data-selected]')).toHaveValue('Thirty-nine jars.');expect(await page.evaluate(()=>window.__qaCalls.filter(c=>c.body?.fields?.[0]?.id==='source_excerpt').length)).toBe(2);
});

for(const answer of ['Set burial count to 38','Store oil separately'])test(`UPLOAD-05 ${answer} resumes generation with one click`,async({page})=>{
 await boot(page,{sourceFit:'clarification'});await page.getByLabel('Story Name',{exact:true}).fill('Alibaba');
 for(const [name,value] of Object.entries({output:'audio',type:'storybook',genre:'Fantasy',audience:'All ages',language:'English',recurrence:'once'}))await page.locator('#story-simple-details [name='+name+']').selectOption(value);
 await page.getByRole('button',{name:'Continue to Story',exact:true}).click();const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Upload PDF',exact:true}).click();await (await chooser).setFiles({name:'jars.txt',mimeType:'text/plain',buffer:Buffer.from('PRIVATE_UNSELECTED document.')});
 const source=page.getByRole('dialog',{name:'Select Story Text',exact:true});await source.locator('[data-selected]').fill('Thirty-nine jars.');await source.getByLabel('AI instructions',{exact:true}).fill('Improve the narration.');await source.getByRole('button',{name:'Improve with AI',exact:true}).click();
 const notice=page.getByRole('dialog',{name:'AI Needs Clarification',exact:true});const choice=notice.getByRole('button',{name:answer==='Set burial count to 38'?answer+' Recommended':answer,exact:true});await choice.focus();await page.keyboard.press('Enter');await expect(notice).toHaveCount(0);
 const output=source.getByLabel('AI Output',{exact:true});await expect(output).toHaveValue(answer==='Set burial count to 38'?'Thirty-nine jars held one jar of oil and thirty-eight robbers. They buried thirty-eight robbers.':'Thirty-nine jars hid thirty-nine robbers. The oil was stored separately.');await expect(source.locator('[data-selected]')).toHaveValue('Thirty-nine jars.');
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
  document.addEventListener('input',e=>{if(e.target.matches('input[aria-label^="Filter "]'))top.__agentActions.push('search');},true);
  document.addEventListener('click',e=>{if(e.target.closest('[data-sort] button'))top.__agentActions.push('sort');},true);
  document.addEventListener('change',e=>{if(e.target.matches('.library-view-label select'))top.__agentActions.push('view:'+e.target.value);},true);
 });
 await page.goto('/desk/index.html?__qa=1');await page.getByRole('button',{name:'Agents',exact:true}).click();await page.locator('.agent-card').click();
 await expect(page.getByRole('button',{name:'Run selected tests (0)',exact:true})).toBeDisabled();
 expect(await page.locator('.agent-browser iframe').getAttribute('src')).toBe('about:blank');
 await page.getByLabel('Action',{exact:true}).selectOption('workflow');await page.getByLabel('Workflow',{exact:true}).selectOption('video');
 await page.getByRole('button',{name:'Select all tests',exact:true}).click();await expect(page.locator('.agent-test-grid input:checked')).toHaveCount(9);
 await page.getByRole('button',{name:'Clear all tests',exact:true}).click();await expect(page.getByRole('button',{name:'Run selected tests (0)',exact:true})).toBeDisabled();
 const small=page.getByRole('checkbox',{name:'Video Library: Small thumbnails',exact:true});await small.focus();await page.keyboard.press('Space');await expect(small).toBeChecked();
 await page.getByRole('button',{name:'Run selected tests (1)',exact:true}).click();await expect(small).toBeDisabled();
 await expect(page.getByRole('button',{name:'Run selected tests (1)',exact:true})).toBeEnabled({timeout:60000});
 let report=await page.evaluate(()=>JSON.parse(localStorage.getItem('ecco-tester-runs:v1:qa-desk-user'))[0]);
 expect(report.selection.ids).toEqual(['video-small']);expect(report.checks).toHaveLength(2);
 expect(report.checks.every(c=>c.id.startsWith('video-small-thumb-')&&c.status==='passed')).toBe(true);
 expect(report.findings).toHaveLength(0);expect(await page.evaluate(()=>window.__agentActions)).toEqual(['view:small','view:list']);
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
 await boot(page,{sourceFit:'audioPreview'});await page.getByLabel('Story Name',{exact:true}).fill('Audio preview regression');
 for(const [name,value] of Object.entries({output:'audio',type:'audiobook',genre:'Adventure',audience:'All ages',language:'English',recurrence:'once'}))await page.locator('#story-simple-details [name='+name+']').selectOption(value);
 await page.getByRole('button',{name:'Continue to Story',exact:true}).click();await page.locator('#story-simple-script').fill('Narrator: Welcome to the story.');await page.getByRole('button',{name:'Generate',exact:true}).click();
 const generate=page.locator('#generate-audio');await expect(generate).toBeEnabled();await page.locator('.story-simple-advanced > summary').click();await expect(page.locator('#audio-form [name=compute]')).toHaveValue('cpu');
 await page.locator('#audio-form [data-open-controls]').click();await page.getByRole('button',{name:'Listen to selected voice',exact:true}).click();const preview=page.locator('#audio-voice-preview-dialog');await expect(preview.getByLabel('Voice preview playback',{exact:true})).toBeVisible();expect(await generate.isEnabled()).toBe(true);
 await preview.getByRole('button',{name:'Close popup',exact:true}).click();await page.locator('#generation-controls-dialog').getByRole('button',{name:'Close popup',exact:true}).click();await generate.click();await expect(generate).toBeDisabled();await expect(page.locator('#audio-job-status')).toContainText(/running|Generating/);
 await page.locator('#audio-form [data-open-controls]').click();await page.getByRole('button',{name:'Listen to selected voice',exact:true}).click();await expect(preview.getByLabel('Voice preview playback',{exact:true})).toBeVisible();expect(await generate.isEnabled()).toBe(false);
 const calls=await page.evaluate(()=>window.__qaCalls.filter(c=>c.path==='audio/generate'));expect(calls).toHaveLength(2);expect(calls[0].body.title).toContain('Voice preview');expect(calls[1].body.lines[0].text).toBe('Welcome to the story.');
});

test('UPLOAD-09 narrator-only answers recover automatically and a full chapter reaches audio generation intact',async({page})=>{
 await boot(page,{sourceFit:'castRetry'});await page.getByLabel('Story Name',{exact:true}).fill('Complete cave chapter');
 for(const [name,value]of Object.entries({output:'audio',type:'storybook',genre:'Adventure',audience:'All ages',language:'English',recurrence:'once'}))await page.locator('#story-simple-details [name='+name+']').selectOption(value);
 await page.getByRole('button',{name:'Continue to Story',exact:true}).click();
 const text='Ali: Open sesame!\n\nMorgiana: I will help.\n\n'+Array.from({length:85},(_,i)=>'Narrator: Passage '+i+'. The woodcutter carried the logs through the forest and returned home before nightfall.').join('\n\n');
 const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Upload PDF',exact:true}).click();await(await chooser).setFiles({name:'complete-chapter.txt',mimeType:'text/plain',buffer:Buffer.from(text)});
 const source=page.getByRole('dialog',{name:'Select Story Text',exact:true});await source.locator('[data-selected]').fill(text);await source.getByRole('button',{name:'Generate Script',exact:true}).click();
 await expect(source).toBeHidden();await applyScriptReview(page);await expect(page.locator('[data-cast-panel]')).toHaveAttribute('aria-busy','false');await expect(page.locator('[data-character-tabs] [role=tab]')).toHaveCount(3);await expect(page.locator('#story-simple-script')).toHaveValue(text);
 const calls=await page.evaluate(()=>window.__qaCalls.filter(c=>c.body?.fields?.[0]?.id==='story_workspace'));expect(calls.length).toBeGreaterThan(2);expect(calls[1].body.context.instructions).toContain('narrator-only');
 await page.getByRole('button',{name:'Generate',exact:true}).click();await expect(page.locator('#audio-form')).toBeVisible();await expect(page.locator('#audio-lines textarea[data-field=text]')).toHaveCount(87);
 await page.locator('#generate-audio').click();await expect.poll(()=>page.evaluate(()=>window.__qaCalls.filter(c=>c.path==='audio/generate').length)).toBe(1);
 const request=await page.evaluate(()=>window.__qaCalls.find(c=>c.path==='audio/generate').body);
 expect(request.long_form_version).toBe(1);expect(request.lines.length).toBeGreaterThan(80);expect(request.lines.reduce((n,l)=>n+l.text.length,0)).toBeGreaterThan(4000);expect(request.lines.every(l=>l.text.length<=500)).toBe(true);
 expect(request.lines.map(l=>l.text).join('\n\n')).toBe(text.replace(/^(Ali|Morgiana|Narrator): /gm,''));
});


test('UPLOAD-10 Apply Text turns a long prose chapter into a complete speaker-labelled script',async({page})=>{
 await boot(page,{sourceFit:'castRetry'});await page.getByLabel('Story Name',{exact:true}).fill('Complete prose chapter');
 for(const [name,value]of Object.entries({output:'audio',type:'storybook',genre:'Adventure',audience:'All ages',language:'English',recurrence:'once'}))await page.locator('#story-simple-details [name='+name+']').selectOption(value);
 await page.getByRole('button',{name:'Continue to Story',exact:true}).click();
 const prose=Array.from({length:100},(_,i)=>'Passage '+i+'. Ali reached the cave after walking through the forest. “Open sesame!” said Ali. Morgiana replied, “I will help.” The friends returned safely to the village before nightfall, carrying the wood they had gathered.').join('\n\n');
 expect(prose.length).toBeGreaterThan(20000);
 const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Upload PDF',exact:true}).click();await(await chooser).setFiles({name:'prose-chapter.txt',mimeType:'text/plain',buffer:Buffer.from(prose)});
 const source=page.getByRole('dialog',{name:'Select Story Text',exact:true});await source.locator('[data-selected]').fill(prose);await source.getByRole('button',{name:'Generate Script',exact:true}).click();
 await applyScriptReview(page);await expect(page.locator('[data-cast-reason]')).toContainText('3 audio characters identified');
 await expect(page.locator('#story-simple-script')).toHaveValue(/Ali: “Open sesame!”/);await expect(page.locator('#story-simple-script')).toHaveValue(/Morgiana: “I will help.”/);
 await page.getByRole('button',{name:'Generate',exact:true}).click();await expect(page.locator('#audio-form')).toBeVisible();await expect(page.locator('#story-simple-error')).toBeEmpty();
 const words=await page.locator('#audio-lines textarea[data-field=text]').evaluateAll(nodes=>nodes.map(n=>n.value).join(' '));expect(words.replace(/\s+/g,' ').trim()).toBe(prose.replace(/\s+/g,' ').trim());
});

async function applyScriptReview(page){const review=page.getByRole('dialog',{name:'Generated Script',exact:true});await expect(review).toBeVisible();const apply=review.getByRole('button',{name:'Apply Text',exact:true});await expect(apply).toBeEnabled();await apply.click();await expect(review).toHaveCount(0);}

for(const output of ['audio','video'])test('UPLOAD-11 Generate Script review edits, character dropdown, minimize and Apply for '+output,async({page},testInfo)=>{
 await boot(page,{sourceFit:'cast'});await page.getByLabel('Story Name',{exact:true}).fill('Reviewed cave story');
 for(const [name,value]of Object.entries({output,type:'storybook',genre:'Adventure',audience:'All ages',language:'English',recurrence:'once'}))await page.locator('#story-simple-details [name='+name+']').selectOption(value);
 await page.getByRole('button',{name:'Continue to Story',exact:true}).click();
 const text='Narrator: At the cave.\n\nAli: Open sesame!\n\nMorgiana: I will help.',chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Upload PDF',exact:true}).click();await(await chooser).setFiles({name:'review.txt',mimeType:'text/plain',buffer:Buffer.from(text)});
 const source=page.getByRole('dialog',{name:'Select Story Text',exact:true});await source.locator('[data-selected]').fill(text);await source.getByRole('button',{name:'Generate Script',exact:true}).press('Enter');
 const review=page.getByRole('dialog',{name:'Generated Script',exact:true});await expect(review.getByRole('button',{name:'Apply Text',exact:true})).toBeEnabled();await expect(page.locator('#story-simple-script')).toHaveValue('');await popupControls(review);
 const turns=review.getByRole('region',{name:'Script turns',exact:true}),properties=review.getByRole('region',{name:'Character properties',exact:true});expect((await turns.boundingBox()).x).toBeLessThan((await properties.boundingBox()).x);
 await expect(review.getByLabel('Turn 2 speaker',{exact:true}).locator('option')).toHaveCount(3);await review.getByLabel('Turn 2 text',{exact:true}).fill('Open the cave, please!');await review.getByLabel('Turn 3 speaker',{exact:true}).selectOption('a');
 await review.getByLabel('Character properties for',{exact:true}).selectOption('a');await review.getByLabel('Character 2 Name',{exact:true}).fill('Ali Baba');await review.getByLabel('Character 2 Accent',{exact:true}).fill('British English');
 await expect(review.getByLabel('Turn 2 speaker',{exact:true}).locator('option:checked')).toHaveText('Ali Baba');
 if(output==='video')await review.getByLabel('Character 2 Appearance',{exact:true}).fill('A woodcutter in a green tunic.');else await expect(review.locator('[data-property=appearance]')).toHaveCount(0);
 await review.getByRole('button',{name:'Minimize popup',exact:true}).click();await expect(review).toBeHidden();await page.getByRole('button',{name:'Resume Generated Script',exact:true}).click();await expect(review.getByLabel('Turn 2 text',{exact:true})).toHaveValue('Open the cave, please!');
 if(output==='video'){await page.setViewportSize({width:390,height:844});const box=await review.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);expect(await review.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);}
 await page.screenshot({path:testInfo.outputPath('generated-script-'+output+'.png'),fullPage:true});
 await review.getByRole('button',{name:'Close popup',exact:true}).click();await page.getByRole('button',{name:'Resume Script',exact:true}).click();await expect(review.getByLabel('Turn 2 text',{exact:true})).toHaveValue('Open the cave, please!');
 await review.getByRole('button',{name:'Apply Text',exact:true}).click();await expect(review).toHaveCount(0);await expect(page.getByRole('button',{name:'Generate',exact:true})).toBeFocused();await expect(page.locator('#story-simple-script')).toHaveValue('Narrator: At the cave.\n\nAli Baba: Open the cave, please!\n\nAli Baba: I will help.');
 await page.getByRole('button',{name:'Generate',exact:true}).click();await expect(page.locator(output==='audio'?'#audio-form':'#video-form')).toBeVisible();
 if(output==='video')await page.getByRole('button',{name:'Prepare Audio',exact:true}).click();
 const sent=await page.evaluate(()=>{const key=Object.keys(localStorage).find(k=>k.startsWith('ecco-audio-draft:'));return JSON.parse(localStorage.getItem(key));});expect(sent.lines[1].text).toBe('Open the cave, please!');expect(sent.lines[2].speaker_id).toBe('a');expect(sent.speakers.find(c=>c.id==='a').dialect).toBe('British English');
 expect(page.qaErrors).toEqual([]);
});


test('STORY-05 compact control panels and character tabs preserve edits, keyboard focus and popup errors',async({page},info)=>{
 await boot(page);await page.getByLabel('Story Name',{exact:true}).fill('Character tab test');for(const [name,value]of Object.entries({output:'audio',type:'podcast',genre:'Adventure',audience:'All ages',language:'English',recurrence:'once'}))await page.locator('#story-simple-details [name='+name+']').selectOption(value);await page.getByRole('button',{name:'Continue to Story',exact:true}).click();
 await expect(page.getByLabel('Number of characters',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Choose from Library',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Create Character',exact:true})).toHaveCount(0);await expect(page.locator('[data-source]')).toHaveCount(0);
 const tabs=page.getByRole('tablist',{name:'Story characters',exact:true});await expect(tabs.getByRole('tab')).toHaveCount(2);await tabs.getByRole('button',{name:'Add character',exact:true}).click();await expect(tabs.getByRole('tab')).toHaveCount(3);await expect(page.getByLabel('Character 3 Name',{exact:true})).toBeFocused();await page.getByLabel('Character 3 Name',{exact:true}).fill('Morgiana');await tabs.getByRole('tab',{name:'Character 1',exact:true}).click();await tabs.getByRole('tab',{name:'Character 1',exact:true}).press('End');await expect(tabs.getByRole('tab',{name:'Character 3',exact:true})).toBeFocused();await page.keyboard.press('Enter');await expect(page.getByLabel('Character 3 Name',{exact:true})).toHaveValue('Morgiana');
 const brief=page.getByLabel('What should your story be about? (optional)',{exact:true});await expect(brief).toHaveAttribute('rows','2');await expect(brief).toHaveCSS('height','62px');const row=await page.locator('.story-source-actions').boundingBox(),label=await brief.locator('..').boundingBox();expect(label.y-row.y-row.height).toBeLessThanOrEqual(14);
 await page.screenshot({path:info.outputPath('character-tabs.png'),fullPage:true});await page.getByRole('button',{name:'Generate',exact:true}).click();const error=page.locator('#ecco-error-popup');await expect(error).toBeVisible();await popupControls(error);await expect(error).toContainText(/story|script/i);await error.getByRole('button',{name:'Close popup',exact:true}).click();await expect(page.getByLabel('Character 3 Name',{exact:true})).toHaveValue('Morgiana');await page.setViewportSize({width:390,height:844});await expect(brief).toHaveCSS('height','62px');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('character-tabs-mobile.png'),fullPage:true});
});
for(const output of ['audio','video'])test(`STORY-06 AI story review stays in its popup before turn-by-turn screenplay for ${output}`,async({page},info)=>{
 await boot(page,{sourceFit:'cast'});await page.getByLabel('Story Name',{exact:true}).fill('AI cave adventure');for(const [name,value]of Object.entries({output,type:'storybook',genre:'Adventure',audience:'All ages',language:'English',recurrence:'once'}))await page.locator('#story-simple-details [name='+name+']').selectOption(value);await page.getByRole('button',{name:'Continue to Story',exact:true}).click();await page.getByRole('button',{name:'Generate With AI',exact:true}).click();const ai=page.getByRole('dialog',{name:'Generate With AI',exact:true});await popupControls(ai);await ai.getByLabel('What should AI generate?',{exact:true}).fill('Write a cave adventure with Ali and Morgiana.');await ai.getByRole('button',{name:'Generate',exact:true}).click();await expect(ai.getByLabel('Generated story',{exact:true})).toHaveValue('Narrator: At the cave.\n\nAli: Open sesame!\n\nMorgiana: I will help.');await expect(page.locator('#story-simple-script')).toHaveValue('');await expect(ai).toBeVisible();await ai.getByLabel('Generated story',{exact:true}).fill('Narrator: At the cave.\n\nAli: Open sesame!\n\nMorgiana: I will help.\n\nAli: We are safe.');await ai.getByRole('button',{name:'Close popup',exact:true}).click();await page.getByRole('button',{name:'Generate With AI',exact:true}).click();await expect(ai.getByLabel('Generated story',{exact:true})).toHaveValue(/We are safe/);await page.screenshot({path:info.outputPath('ai-story-review.png')});await page.setViewportSize({width:390,height:844});const next=ai.getByRole('button',{name:'Generate Script',exact:true});await expect(next).toBeInViewport();expect(await ai.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await page.screenshot({path:info.outputPath('ai-story-review-mobile.png')});await page.setViewportSize({width:1440,height:1000});await next.click();await expect(ai).toHaveCount(0);
 const screenplay=page.getByRole('dialog',{name:'Generated Script',exact:true});await expect(screenplay.locator('[data-turn-text]')).toHaveCount(4);await expect(screenplay.getByLabel('Turn 4 speaker',{exact:true})).toHaveValue('a');await screenplay.getByLabel('Turn 2 text',{exact:true}).fill('');await screenplay.getByRole('button',{name:'Apply Text',exact:true}).click();const error=page.locator('#ecco-error-popup');await expect(error).toBeVisible();await popupControls(error);await error.getByRole('button',{name:'Close popup',exact:true}).click();await expect(screenplay).toBeVisible();await screenplay.getByLabel('Turn 2 text',{exact:true}).fill('Open sesame!');await screenplay.getByRole('button',{name:'Minimize popup',exact:true}).click();await openLibrary(page,'video');await page.locator('#ecco-popup-resume').getByRole('button',{name:'Resume Generated Script',exact:true}).click();await expect(screenplay.getByLabel('Turn 4 text',{exact:true})).toHaveValue('We are safe.');await screenplay.getByRole('button',{name:'Apply Text',exact:true}).click();await expect(screenplay).toHaveCount(0);await expect(page.locator('#story-simple-script')).toHaveValue(/Ali: We are safe/);await expect(page.locator('[data-character-tabs] [role=tab]')).toHaveCount(3);await page.getByRole('button',{name:'Generate',exact:true}).click();await expect(page.locator(output==='audio'?'#audio-form':'#video-form')).toBeVisible();
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
