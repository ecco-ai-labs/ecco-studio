import {test,expect} from '@playwright/test';
const librarySelectors={image:'#image-library-nav > details > summary',audio:'#workspace-audio-library > summary',video:'#workspace-video-library > summary',story:'.project > details > summary',workflow:'#workflow-library > summary'};
async function boot(page,options={}){
  const errors=[];page.on('pageerror',error=>errors.push(error.message));page.qaErrors=errors;
  // A second network boundary: even fixture mistakes cannot reach production services.
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    return url.hostname==='127.0.0.1'?route.continue():route.abort('blockedbyclient');
  });
  await page.goto('/?__qa=1&theme='+(options.theme||'default')+'&sourceFit='+(options.sourceFit||''));
  await page.waitForFunction(()=>window.__qaReady);
  await expect(page.locator('#entry-tell-story')).toBeEnabled();
  if(options.enter!==false){
    await page.locator('#entry-tell-story').click();
    await page.getByRole('button',{name:'New Story',exact:true}).click();
  }
}
async function openLibrary(page,kind){
  const group=page.locator('#workspace-library-group');
  if(await group.getAttribute('open')===null)await group.locator(':scope > summary').click();
  await page.locator(librarySelectors[kind]).click();
  await expect(page.locator('#page .library-files')).toBeVisible();
  return page.locator('#page .library-files');
}
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
  await expect(page.getByRole('heading',{name:'Choose a library',exact:true})).toBeVisible();
  await expect(page.locator('body > aside')).toBeVisible();
  await expect(page.locator('#story-workspace-header')).toBeHidden();
  const choices=page.locator('#library-home-list button');
  await expect(choices).toHaveCount(5);
  expect(await choices.evaluateAll(rows=>rows.map(row=>row.dataset.libraryDestination))).toEqual(kinds);
  const bounds=await choices.evaluateAll(rows=>rows.map(row=>({left:row.getBoundingClientRect().left,width:row.getBoundingClientRect().width,iconLeft:row.querySelector('svg').getBoundingClientRect().left})));
  for(const row of bounds){expect(row.left).toBe(bounds[0].left);expect(row.width).toBe(bounds[0].width);expect(row.iconLeft).toBe(bounds[0].iconLeft);}
  await choices.first().press('Tab');await expect(choices.nth(1)).toBeFocused();
  expect(await choices.nth(1).evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('solid');
  for(const kind of kinds){
    const choice=page.locator('[data-library-destination="'+kind+'"]');
    await expect(choice.locator('.library-home-icon')).toBeVisible();
    await expect(choice.locator('.library-home-detail')).toBeVisible();
    if(kind==='story')await choice.click();else await choice.press('Enter');
    await expect(page.locator('#page .library-files')).toBeVisible();
    await expect(page.locator(librarySelectors[kind])).toHaveAttribute('aria-current','page');
    await expect(page.locator(librarySelectors[kind])).toBeFocused();
    await page.locator('#workspace-library-group > summary').click();
  }
});
test('LAYOUT-library-home narrow light-theme chooser keeps all choices and descriptions visible',async({page})=>{
  await page.setViewportSize({width:390,height:900});await boot(page,{theme:'desert'});
  await page.locator('#workspace-library-group > summary').click();
  const choices=page.locator('#library-home-list button');await expect(choices).toHaveCount(5);
  for(const choice of await choices.all()){
    await expect(choice).toBeVisible();await expect(choice.locator('.library-home-detail')).toBeVisible();
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
  await expect(page.getByRole('heading',{name:'Agents',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Run checks',exact:true})).toBeEnabled();
  await expect(page.locator('.support-hours')).toHaveCount(0);await expect(page.getByLabel('Assign findings to',{exact:true})).toHaveCount(0);
  await page.evaluate(()=>sessionStorage.setItem('qa-studio-session','synthetic-only'));
  await page.getByLabel('Action',{exact:true}).selectOption('workflow');await page.getByLabel('Workflow',{exact:true}).selectOption('story');
  await page.getByRole('button',{name:'Run checks',exact:true}).click();
  await expect(page.getByRole('button',{name:'Run checks',exact:true})).toBeEnabled({timeout:30000});
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
  await dialog.getByLabel('AI instructions',{exact:true}).fill('Make it simpler.');await dialog.getByRole('button',{name:'Improve with AI',exact:true}).click();const error=page.getByRole('dialog',{name:'Unable to Improve Text',exact:true});await expect(error).toContainText(/Connect AI and workspace storage|QA fixture/);await error.getByRole('button',{name:'OK',exact:true}).click();await expect(dialog).toBeVisible();await expect(dialog.getByLabel('AI Output',{exact:true})).toHaveValue('');
  await dialog.getByRole('button',{name:'Save Draft',exact:true}).click();await expect(dialog.locator('[role=status]')).toContainText('Draft saved');
  await expect(clear).toHaveClass('secondary');expect(await clear.evaluate(el=>el.nextElementSibling.matches('[data-extract]'))).toBe(true);await clear.click();await expect(selected).toHaveValue('');await expect(dialog.getByRole('button',{name:'Apply Text',exact:true})).toBeDisabled();await expect(dialog.locator('.source-text-preview')).toHaveText('The original document remains untouched.');
  await page.setViewportSize({width:390,height:844});await find.click();const panel=await dialog.locator('.pdf-find-replace .pdf-tool-panel').boundingBox();expect(panel.x).toBeGreaterThanOrEqual(0);expect(panel.x+panel.width).toBeLessThanOrEqual(390);await page.keyboard.press('Escape');await expect(dialog).toBeVisible();
});
test('UPLOAD-02 AI output review and fiction versus Sports News confirmation preserve deliberate choice',async({page})=>{
  await boot(page,{sourceFit:'fiction'});await page.getByLabel('Story Name',{exact:true}).fill('Sports News');
  for(const [name,value] of Object.entries({output:'audio',type:'news',genre:'Sports',audience:'All ages',language:'English',recurrence:'once'}))await page.locator('#story-simple-details [name='+name+']').selectOption(value);
  await page.getByRole('button',{name:'Continue to Story',exact:true}).click();const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Upload PDF',exact:true}).click();await (await chooser).setFiles({name:'Alibaba.txt',mimeType:'text/plain',buffer:Buffer.from('Alibaba found a cave. PRIVATE_UNSELECTED_REST')});
  const source=page.getByRole('dialog',{name:'Select Story Text',exact:true});await source.locator('[data-selected]').fill('Alibaba found a cave.');await source.getByLabel('AI instructions',{exact:true}).fill('Make it clearer.');await source.getByRole('button',{name:'Improve with AI',exact:true}).click();await expect(source.getByLabel('AI Output',{exact:true})).toHaveValue('Alibaba discovered a hidden cave.');await expect(source.locator('[data-selected]')).toHaveValue('Alibaba found a cave.');
  await source.getByRole('button',{name:'Use AI Text',exact:true}).click();await expect(source.locator('[data-selected]')).toHaveValue('Alibaba discovered a hidden cave.');
  await source.getByRole('button',{name:'Apply Text',exact:true}).click();const warning=page.getByRole('dialog',{name:'Review source compatibility',exact:true});await expect(warning).toBeVisible();await expect(warning.locator('[data-story]')).toContainText('Sports News');await expect(warning.locator('[data-reason]')).toContainText('fiction');await expect(page.locator('#story-simple-script')).toHaveValue('');
  await warning.getByRole('button',{name:'Choose Different Text',exact:true}).click();await expect(warning).toHaveCount(0);await expect(source).toBeVisible();await expect(source.getByRole('button',{name:'Apply Text',exact:true})).toBeFocused();await expect(source.locator('[data-selected]')).toHaveValue('Alibaba discovered a hidden cave.');
  await source.getByRole('button',{name:'Apply Text',exact:true}).click();await warning.getByRole('button',{name:'Use Anyway',exact:true}).click();await expect(source).toBeHidden();await expect(page.locator('#story-simple-script')).toHaveValue('Alibaba discovered a hidden cave.');
  const calls=await page.evaluate(()=>window.__qaCalls.filter(c=>c.path==='ai/enhance'));expect(JSON.stringify(calls)).not.toContain('PRIVATE_UNSELECTED_REST');expect(calls.find(c=>c.body.fields[0].id==='source_compatibility').body.context.genre).toBe('Sports');
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
  await page.getByRole('button',{name:'Run checks',exact:true}).click();
  await expect(page.getByRole('button',{name:'Run checks',exact:true})).toBeEnabled({timeout:75000});
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
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/desk/index.html?__qa=1');
  await page.getByRole('button',{name:'Notifications',exact:true}).click();
  await page.getByRole('tab',{name:'Campaign',exact:true}).click();
  await page.getByRole('button',{name:'New Campaign',exact:true}).click();
  await expect(page.getByLabel('Campaign Name',{exact:true})).toBeFocused();
  await page.getByLabel('Campaign Name',{exact:true}).fill('Cyber Monday');
  await page.getByLabel('Bell Icon',{exact:true}).uncheck();await page.getByLabel('Icon',{exact:true}).selectOption('Dhamaka');
  await expect(page.getByLabel('Repeat',{exact:true})).toHaveValue('cyber_monday');
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
 await page.locator('#story-simple-details [name=language]').selectOption('Urdu');await page.getByRole('tab',{name:'2. Story & Characters',exact:true}).click();await page.getByRole('button',{name:'Preview & Select',exact:true}).click();await expect(ribbon.getByLabel('Language',{exact:true})).toHaveValue('Urdu');await expect(source.locator('[data-selected]')).toHaveValue('Alibaba found a cave.');
});

test('UPLOAD-04 AI clarification opens a popup and preserves equal text boxes and selected content',async({page})=>{
 await boot(page,{sourceFit:'clarification'});await page.getByLabel('Story Name',{exact:true}).fill('Alibaba');
 for(const [name,value] of Object.entries({output:'audio',type:'storybook',genre:'Fantasy',audience:'All ages',language:'English',recurrence:'once'}))await page.locator('#story-simple-details [name='+name+']').selectOption(value);
 await page.getByRole('button',{name:'Continue to Story',exact:true}).click();const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Upload PDF',exact:true}).click();await (await chooser).setFiles({name:'jars.txt',mimeType:'text/plain',buffer:Buffer.from('Thirty-nine jars.')});
 const source=page.getByRole('dialog',{name:'Select Story Text',exact:true});await source.locator('[data-selected]').fill('Thirty-nine jars.');await source.getByLabel('AI instructions',{exact:true}).fill('Improve the narration.');await source.getByRole('button',{name:'Improve with AI',exact:true}).click();
 const notice=page.getByRole('dialog',{name:'AI Needs Clarification',exact:true});await expect(notice).toBeVisible();await expect(notice).toContainText('Should there be forty jars in total?');await expect(source.getByLabel('AI Output',{exact:true})).toHaveValue('');await expect(source.locator('[data-ai-status]')).toHaveText('');
 await notice.getByRole('button',{name:'Edit Prompt',exact:true}).click();await expect(notice).toHaveCount(0);await expect(source.getByLabel('AI instructions',{exact:true})).toBeFocused();await expect(source.locator('[data-selected]')).toHaveValue('Thirty-nine jars.');const a=await source.getByLabel('AI instructions',{exact:true}).boundingBox(),b=await source.getByLabel('AI Output',{exact:true}).boundingBox();expect(Math.abs(a.height-b.height)).toBeLessThan(1);
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
