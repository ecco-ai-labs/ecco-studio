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
test('STORY-04 Generate with AI opens an instruction dialog',async({page})=>{
  await boot(page);await page.getByLabel('Story Name',{exact:true}).fill('QA Story');
  for(const [label,value] of Object.entries({'Output':'audio','Story Type':'podcast','Genre':'Comedy','Audience age group':'All ages','Language':'English','One-time or recurring':'once'}))
    await page.getByLabel(label,{exact:true}).selectOption(value);
  await page.getByRole('button',{name:'Continue to Story',exact:true}).click();
  await page.locator('#page [data-ai]').click();
  await expect(page.locator('#ai-generation-dialog')).toBeVisible();
  await expect(page.locator('#ai-generation-dialog [name=instructions]')).toBeVisible();
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
  await boot(page);await page.locator('[data-category=Activity] > summary').click();
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
});
