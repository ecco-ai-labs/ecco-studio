import {test,expect} from '@playwright/test';
const librarySelectors={image:'#image-library-nav > details > summary',audio:'#workspace-audio-library > summary',video:'#workspace-video-library > summary',story:'.project > details > summary',workflow:'#workflow-library > summary'};
async function boot(page,options={}){
  const errors=[];page.on('pageerror',error=>errors.push(error.message));page.qaErrors=errors;
  // A second network boundary: even fixture mistakes cannot reach production services.
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    return url.hostname==='127.0.0.1'?route.continue():route.abort('blockedbyclient');
  });
  await page.goto('/?__qa=1&theme='+(options.theme||'default'));
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
    const pixels=await decoded.evaluate(el=>{
      const c=document.createElement('canvas');c.width=160;c.height=90;const ctx=c.getContext('2d');ctx.drawImage(el,0,0,160,90);
      return [Array.from(ctx.getImageData(10,45,1,1).data),Array.from(ctx.getImageData(100,45,1,1).data)];
    });
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
test('NAV-03 popup and menu Back dismiss one layer and retain the originating screen',async({page})=>{
  await boot(page);await openLibrary(page,'video');
  const preferences=page.locator('#workspace-settings-controls details');await preferences.locator('summary').click();
  await preferences.locator('.workspace-menu-items > .ecco-back').click();await expect(preferences).not.toHaveAttribute('open');
  await expect(preferences.locator('summary')).toBeFocused();
  await page.locator('#activity-files-menu').click();await expect(page.locator('#activity-files')).toBeVisible();
  await page.locator('#activity-files > .ecco-back').click();await expect(page.locator('#activity-files')).toBeHidden();
  await expect(page.locator('#video-library-gallery')).toBeVisible();await expect(page.locator('#activity-files-menu')).toBeFocused();
  const viewport=page.viewportSize();await page.mouse.move(viewport.width-1,viewport.height/2);
  await page.locator('#activity-edge-arrow').click();await expect(page.locator('#activity-panel')).toBeVisible();
  await page.locator('#activity-panel > .ecco-back').click();await expect(page.locator('#activity-panel')).toBeHidden();
  await expect(page.locator('#activity-edge-arrow')).toBeFocused();
});
test('NAV-04 checkout Back returns to cart, selection and the usage menu without losing the package',async({page})=>{
  await boot(page);await page.locator('#google-user-menu > summary').click();
  await page.getByRole('button',{name:'Credit and Usage',exact:true}).click();
  await page.getByRole('button',{name:'Purchase Additional Credits',exact:true}).click();
  await page.getByRole('button',{name:'Select',exact:true}).first().click();await page.getByRole('button',{name:'View Cart',exact:true}).click();
  await page.getByRole('button',{name:'Proceed to Checkout',exact:true}).click();
  await page.locator('dialog[open] > .ecco-back').click();await expect(page.getByRole('heading',{name:'Your Cart',exact:true})).toBeVisible();
  await page.locator('dialog[open] > .ecco-back').click();await expect(page.getByRole('heading',{name:'Purchase Additional Credits',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'✓ Selected',exact:true})).toBeVisible();
  await page.locator('dialog[open] > .ecco-back').click();await expect(page.locator('#workspace-usage-drawer')).toBeVisible();
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
  await page.getByRole('button',{name:'User Notifications',exact:true}).click();await expect(page.getByRole('button',{name:'Connect Google',exact:true})).toBeVisible();
  await expect(page.locator('.notification-composer')).toHaveCount(0);
 });
test('UPLOAD-01 inline AI prompt, selection boundary and matching clear text control',async({page})=>{
  await boot(page);await page.getByLabel('Story Name',{exact:true}).fill('Upload controls QA');
  for(const [name,value] of Object.entries({output:'audio',type:'podcast',genre:'Comedy',audience:'All ages',language:'English',recurrence:'once'}))
    await page.locator('#story-simple-details [name='+name+']').selectOption(value);
  await page.getByRole('button',{name:'Continue to Story',exact:true}).click();
  const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Upload PDF',exact:true}).click();
  await (await chooser).setFiles({name:'upload-qa.txt',mimeType:'text/plain',buffer:Buffer.from('The original document remains untouched.')});
  const dialog=page.getByRole('dialog',{name:'Select Story Text',exact:true});await expect(dialog).toBeVisible();
  const selected=dialog.locator('[data-selected]');await expect(selected).toHaveValue('');
  await expect(dialog.locator('.source-text-preview')).toHaveText('The original document remains untouched.');
  const find=dialog.locator('.pdf-find-replace summary'),improve=dialog.locator('.pdf-improve-selection summary'),clear=dialog.getByRole('button',{name:'Clear Selected Text',exact:true});
  expect((await find.boundingBox()).y).toBeLessThan((await improve.boundingBox()).y);expect((await improve.boundingBox()).y).toBeLessThan((await clear.boundingBox()).y);
  const labelStyle=await find.evaluate(el=>({font:getComputedStyle(el).fontSize,weight:getComputedStyle(el).fontWeight}));
  expect(await clear.evaluate(el=>({font:getComputedStyle(el).fontSize,weight:getComputedStyle(el).fontWeight}))).toEqual(labelStyle);
  await expect(clear).toHaveCSS('background-color','rgba(0, 0, 0, 0)');await expect(clear).toHaveCSS('border-top-width','0px');
  await expect(dialog.locator('.pdf-selected-label')).toHaveCSS('border-top-color','rgb(255, 220, 36)');
  await improve.focus();await page.keyboard.press('Enter');await expect(dialog.getByLabel('Prompt',{exact:true})).toBeVisible();
  await page.keyboard.press('Tab');await expect(dialog.getByLabel('Prompt',{exact:true})).toBeFocused();
  await selected.fill('Only these selected words.');await dialog.getByLabel('Prompt',{exact:true}).fill('Make it simpler.');
  await dialog.getByRole('button',{name:'Improve',exact:true}).click();
  await expect(dialog.locator('[data-ai-status]')).toContainText(/Connect AI and workspace storage|QA fixture/);
  await expect(page.locator('dialog[open]')).toHaveCount(1);await expect(selected).toHaveValue('Only these selected words.');
  await clear.click();await expect(selected).toHaveValue('');await expect(dialog.getByRole('button',{name:'Apply Selected Text',exact:true})).toBeDisabled();
  await expect(dialog.locator('.source-text-preview')).toHaveText('The original document remains untouched.');
});
