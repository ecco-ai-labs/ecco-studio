const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {JSDOM}=require('jsdom');
function setup(){
 const dom=new JSDOM('<div id="connection-indicators"></div><div id="page"></div>',{runScripts:'outside-only',url:'https://ecco-ai-labs.github.io/ecco-studio/'}),w=dom.window;
 w.$=s=>w.document.querySelector(s);w.esc=s=>String(s??'');w.names={};w.EccoStorage={ready:true};
 w.state={config:{youtube_configured:true,youtube_channel:{id:'UC-test',title:'Owner'}},records:[
 {id:'video-a',kind:'asset',media:'video',stage:'prod',title:'First video',story_id:'story-a'},
 {id:'video-b',kind:'asset',media:'video',stage:'prod',title:'Second video',story_id:'story-b'},
 {id:'video-sent',kind:'asset',media:'video',stage:'prod',title:'Already sent',upload_state:'uploaded'},
 {id:'audio-a',kind:'asset',media:'audio',stage:'prod',title:'Narration'},
 {id:'audio-b',kind:'asset',media:'audio',stage:'dev',title:'Music'}]};
 w.assets=()=>w.state.records.filter(a=>a.story_id==='story-a');w.currentStory=()=>({id:'story-a',title:'First story'});
 w.notice=(message,error)=>{w.lastNotice={message,error};};w.action=async fn=>{try{await fn();}catch(e){w.notice(e.message,true);}};
 const source=readFileSync(join(__dirname,'../studio.js'),'utf8');w.eval(source.slice(source.indexOf('function connectYouTube('),source.indexOf('function navigate(p)')));
 for(const file of ['publishing-platforms.js','youtube-playlists.js','publishing-library.js'])w.eval(readFileSync(join(__dirname,'../'+file),'utf8'));
 w.navigate=()=>w.publishPage();w.EccoWorkspaceUI={openLibrary:kind=>{
  w.$('#page').innerHTML='<h2>'+kind+' library</h2><button id="video-library-publish">Publish</button><div id="'+kind+'-library-gallery">'+w.state.records.filter(a=>a.media===kind&&!a.deleted).map(a=>'<article class="card"><'+kind+' data-asset="'+a.id+'"></'+kind+'><p>'+a.title+'</p></article>').join('')+'</div>';
  w.EccoPublishingMedia.mountLibrary(kind);
 }};
 w.publishPage();return {dom,w};
}
const change=(w,element,value)=>{element.value=value;element.dispatchEvent(new w.Event('change'));};
const choose=(w,id,checked=true)=>{const input=w.document.querySelector('[data-publish-select="'+id+'"] input');input.checked=checked;input.dispatchEvent(new w.Event('change'));};
const open=(w,kind)=>change(w,w.$('.publishing-panel:not([hidden]) select[name=asset_id]'),'library:'+kind);
const add=w=>w.$('#publishing-library-picker [data-add]').click();
test('library picker supports multiple cross-story videos, removes selections and preserves platform draft',t=>{
 const {dom,w}=setup();t.after(()=>dom.window.close());const form=w.$('#publish-form');form.elements.description.value='Shared description';form.elements.visibility.value='unlisted';
 open(w,'video');assert.equal(w.$('[data-publish-select="video-sent"] input').disabled,true);assert.equal(w.$('#publishing-library-picker [data-add]').disabled,true);
 choose(w,'video-a');choose(w,'video-b');assert.equal(w.$('#publishing-library-picker [data-add]').textContent,'Add selected (2)');add(w);
 let next=w.$('#publish-form');assert.deepEqual(Array.from(next.publishingSelection.items,x=>x.id),['video-a','video-b']);assert.equal(next.elements.description.value,'Shared description');assert.equal(next.elements.visibility.value,'unlisted');assert.equal(next.elements.asset_id.required,false);assert.equal(next.elements.title.disabled,true);assert.equal(next.elements.confirmed.checked,false);
 assert.equal(next.querySelectorAll('.publishing-selection input').length,2);next.querySelector('[aria-label="Remove First video from publishing"]').click();assert.deepEqual(Array.from(next.publishingSelection.items,x=>x.id),['video-b']);
 open(w,'video');assert.equal(w.$('[data-publish-select="video-b"] input').checked,true);w.$('#publishing-library-picker [data-cancel]').click();assert.equal(w.$('#publish-form').publishingSelection.items.length,1);
});
test('Select all excludes uploaded items and Clear selection disables Add',t=>{
 const {dom,w}=setup();t.after(()=>dom.window.close());open(w,'video');w.$('[data-all]').click();assert.equal(w.$('[data-add]').textContent,'Add selected (2)');w.$('[data-clear]').click();assert.equal(w.$('[data-add]').disabled,true);
});
test('audio library supports multi-select and warns that YouTube needs a video without sending requests',t=>{
 const {dom,w}=setup();t.after(()=>dom.window.close());let calls=0;w.api=()=>{calls++;};open(w,'audio');choose(w,'audio-a');choose(w,'audio-b');add(w);
 const form=w.$('#publish-form');assert.equal(form.publishingSelection.items.length,2);assert.equal(w.$('.publishing-toolbar button').disabled,true);assert.match(w.$('.publishing-toolbar [role=status]').textContent,/YouTube requires video/);assert.equal(calls,0);
});
test('confirmed multi-select queues exactly one upload per video with its own title and common settings',async t=>{
 const {dom,w}=setup();t.after(()=>dom.window.close());open(w,'video');choose(w,'video-a');choose(w,'video-b');add(w);
 const form=w.$('#publish-form'),requests=[];form.elements.description.value='Shared description';form.elements.made_for_kids.value='false';form.elements.visibility.value='unlisted';
 const title=form.querySelector('[name="publish-title-video-b"]');title.value='Edited second title';title.dispatchEvent(new w.Event('input'));form.elements.confirmed.checked=true;
 w.api=async(path,body)=>{requests.push({path,body});return {id:'job-'+requests.length};};
 form.dispatchEvent(new w.Event('submit',{cancelable:true}));await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(requests.length,2);assert.deepEqual(requests.map(r=>r.body.asset_id),['video-a','video-b']);assert.deepEqual(requests.map(r=>r.body.title),['First video','Edited second title']);
 for(const r of requests){assert.equal(r.path,'youtube/publish');assert.equal(r.body.channel_id,'UC-test');assert.equal(r.body.visibility,'unlisted');assert.equal(r.body.description,'Shared description');assert.equal(r.body.confirmed,true);assert.equal(r.body.made_for_kids,false);}
 assert.equal(w.$('.publishing-toolbar button').disabled,true);form.elements.confirmed.checked=true;form.dispatchEvent(new w.Event('submit',{cancelable:true}));await Promise.resolve();assert.equal(requests.length,2);
});
test('pending and partial failure never resend accepted or uncertain uploads',async t=>{
 const {dom,w}=setup();t.after(()=>dom.window.close());open(w,'video');choose(w,'video-a');choose(w,'video-b');add(w);
 const form=w.$('#publish-form');form.elements.confirmed.checked=true;form.elements.made_for_kids.value='false';let release;const requests=[];
 w.api=async(path,body)=>{requests.push(body.asset_id);if(requests.length===1)return new Promise(resolve=>release=resolve);throw Error('Network error');};
 form.dispatchEvent(new w.Event('submit',{cancelable:true}));form.dispatchEvent(new w.Event('submit',{cancelable:true}));assert.equal(requests.length,1);assert.equal(w.$('.publishing-toolbar button').disabled,true);release({id:'job'});await new Promise(resolve=>setTimeout(resolve,0));
 assert.deepEqual(requests,['video-a','video-b']);assert.match(w.lastNotice.message,/1 upload\(s\) queued/);assert.equal(w.$('.publishing-toolbar button').disabled,true);assert.match(form.querySelector('.publishing-selection').textContent,/Upload queued/);assert.match(form.querySelector('.publishing-selection').textContent,/not confirmed/);
});
test('other platforms have the same picker and retain selection without routing to YouTube',t=>{
 const {dom,w}=setup();t.after(()=>dom.window.close());for(const platform of ['tiktok','instagram','whatsapp','meta','x']){
  w.$('[role=tab][data-platform='+platform+']').click();open(w,'video');choose(w,'video-a');choose(w,'video-b');add(w);
  assert.equal(w.$('[role=tab][aria-selected=true]').dataset.platform,platform);assert.equal(w.$('.publishing-panel:not([hidden]) form').publishingSelection.items.length,2);assert.equal(w.$('.publishing-toolbar button').disabled,true);
 }
});
