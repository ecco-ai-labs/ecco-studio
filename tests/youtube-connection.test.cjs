const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {JSDOM}=require('jsdom');
const source=readFileSync(join(__dirname,'../studio.js'),'utf8');
const helpers=source.slice(source.indexOf('function connectYouTube(){'),source.indexOf('function navigate(p)'));
function setup(){
 const dom=new JSDOM('<main><header><div id="connection-indicators"></div></header><div id="page"></div></main><dialog id="connection-dialog"><div id="connections"></div></dialog>',{runScripts:'outside-only',url:'https://ecco-ai-labs.github.io/ecco-studio/'}),w=dom.window;
 w.$=selector=>w.document.querySelector(selector);w.esc=s=>String(s??'');
 w.state={config:{youtube_configured:true,youtube_channel:null},records:[{id:'a',media:'video',stage:'prod',title:'Approved test video'}]};
 w.EccoStorage={ready:true,open:()=>{}};
 w.assets=()=>w.state.records;w.currentStory=()=>({title:'Test story'});w.names={};
 w.notice=(message,error)=>w.lastNotice={message,error};w.action=async fn=>{try{await fn();}catch(e){w.notice(e.message,true);}};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 w.eval(helpers);w.eval(readFileSync(join(__dirname,'../publishing-platforms.js'),'utf8'));w.publishPage();
 w.EccoAI={connections:()=>{w.$('#connections').replaceChildren();w.EccoYouTube.mount(w.$('#connections'));w.EccoPublishing.mountConnections(w.$('#connections'));w.$('#connection-dialog').showModal();}};w.EccoAI.connections();
 return {dom,w};
}
test('Google window opens during click; failed request restores button and closes blank window',async t=>{
 const {dom,w}=setup();t.after(()=>dom.window.close());const order=[];
 const popup={location:{},closed:false,close(){this.closed=true;}};w.open=()=>{order.push('window');return popup;};
 let reject;w.api=()=>{order.push('request');return new Promise((_,r)=>{reject=r;});};
 const pending=w.connectYouTube();assert.deepEqual(order,['window','request']);assert.equal(w.$('#connect-youtube').disabled,true);
 reject(Error('Storage is unavailable'));await pending;
 assert.equal(popup.closed,true);assert.equal(w.$('#connect-youtube').disabled,false);assert.equal(w.lastNotice.message,'Storage is unavailable');
});
test('blocked windows make no request and untrusted redirect URLs never open',async t=>{
 const {dom,w}=setup();t.after(()=>dom.window.close());let requests=0;
 w.open=()=>null;w.api=async()=>{requests++;return {url:'https://untrusted.example/'};};
 await w.connectYouTube();assert.equal(requests,0);assert.match(w.lastNotice.message,/Allow the Google/);
 const popup={location:{},close(){this.closed=true;}};w.open=()=>popup;
 await w.connectYouTube();assert.equal(popup.closed,true);assert.equal(popup.location.href,undefined);
});
test('verified channel updates badge and Publish without replacing edits, focus or platform tab',async t=>{
 const {dom,w}=setup();t.after(()=>dom.window.close());
 const title=w.$('[name=title]'),publish=w.$('.publishing-toolbar button');title.value='Keep my edited title';title.focus();
 assert.equal(publish.disabled,true);
 w.state.config.youtube_channel={id:'UC-test',title:'Ecco AI Labs',handle:'@EccoAILabs'};w.updateYouTubeConnection();
 assert.equal(publish.disabled,false);assert.equal(title.value,'Keep my edited title');assert.equal(w.document.activeElement,title);
 assert.equal(w.$('#publish-form [name=channel_id]').value,'UC-test');
 const tiktok=w.$('[data-platform=tiktok]');tiktok.click();tiktok.focus();w.updateYouTubeConnection();
 assert.equal(tiktok.getAttribute('aria-selected'),'true');assert.equal(publish.disabled,true);assert.equal(w.document.activeElement,tiktok);
 w.$('[data-platform=youtube]').click();assert.equal(publish.disabled,false);
 w.state.config.youtube_channel=null;w.updateYouTubeConnection();assert.equal(publish.disabled,true);
});
test('YouTube requests use authenticated CPU endpoint even with no GPU connected',async t=>{
 const {dom,w}=setup();t.after(()=>dom.window.close());const requests=[];let gpuRequests=0;
 w.sessionStorage.setItem('ecco-storage-access','fixture-owner-key');w.AbortSignal=AbortSignal;
 w.gpuConnected=()=>false;w.api=async()=>{gpuRequests++;};w.refresh=async()=>{};
 w.fetch=async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({url:'https://accounts.google.com/o/oauth2/auth'})};};
 w.eval(readFileSync(join(__dirname,'../storage-client.js'),'utf8'));
 await w.api('youtube/connect',{});await w.api('youtube/publish',{confirmed:true});
 assert.equal(gpuRequests,0);assert.equal(requests.length,2);
 for(const request of requests){assert.match(request.url,/^https:\/\/vowmjru85f2gzo-8888\.proxy\.runpod\.net\/api\/youtube\//);assert.equal(request.options.headers.Authorization,'Bearer fixture-owner-key');}
});
test('channel change clears confirmation and submits the reviewed channel ID',async t=>{
 const {dom,w}=setup();t.after(()=>dom.window.close());
 w.state.config.youtube_channel={id:'UC-owner',title:'Owner',handle:'@Owner'};w.updateYouTubeConnection();
 const form=w.$('#publish-form'),confirmed=form.querySelector('[name=confirmed]');confirmed.checked=true;
 w.state.config.youtube_channel={id:'UC-next',title:'Next',handle:''};w.updateYouTubeConnection();
 assert.equal(confirmed.checked,false);assert.match(confirmed.nextElementSibling.textContent,/Next \(UC-next\)/);
 assert.equal(form.querySelector('[name=channel_id]').value,'UC-next');
 assert.equal(w.$('#connect-youtube').textContent,'Connected');assert.equal(w.$('#connect-youtube').title,'Reconnect YouTube');
 let request;w.api=async(path,body)=>{request={path,body};};confirmed.checked=true;
 form.querySelector('[name=made_for_kids]').value='false';
 form.dispatchEvent(new w.Event('submit',{cancelable:true}));await Promise.resolve();
 assert.equal(request.body.channel_id,'UC-next');assert.equal(request.body.confirmed,true);
});
test('scheduling uses UTC and only the YouTube panel exposes it',async t=>{
 const {dom,w}=setup();t.after(()=>dom.window.close());const form=w.$('#publish-form');
 const visibility=form.querySelector('[name=visibility]'),date=form.querySelector('[name=publish_at]');
 visibility.value='schedule';visibility.dispatchEvent(new w.Event('change'));assert.equal(date.required,true);assert.equal(date.closest('label').hidden,false);
 date.value='2099-01-02T12:30';let request;w.api=async(path,body)=>{request={path,body};};
 form.dispatchEvent(new w.Event('submit',{cancelable:true}));await Promise.resolve();
 assert.equal(request.body.visibility,'private');assert.equal(request.body.publish_at,new Date(date.value).toISOString());
 assert.equal(w.document.querySelectorAll('[name=publish_at]').length,1);
});
test('disconnect uses CPU auth and immediately removes the destination',async t=>{
 const {dom,w}=setup();t.after(()=>dom.window.close());w.state.config.youtube_channel={id:'UC-owner',title:'Owner',handle:'@Owner'};w.updateYouTubeConnection();
 let path;w.api=async p=>{path=p;};await w.$('#disconnect-youtube').onclick();
 assert.equal(path,'youtube/disconnect');assert.equal(w.state.config.youtube_channel,null);assert.equal(w.$('.publishing-toolbar button').disabled,true);
});
test('GPU config cannot replace the CPU-owned YouTube connection',async t=>{
 const {dom,w}=setup();t.after(()=>dom.window.close());
 w.sessionStorage.setItem('ecco-storage-access','fixture-owner-key');w.localStorage.setItem('ecco-selected-gpu','test-gpu');w.localStorage.setItem('ecco-connected-gpus','["test-gpu"]');w.AbortSignal=AbortSignal;
 w.api=async()=>{};w.refresh=async()=>{};w.gpuConnected=()=>false;
 w.fetch=async()=>({ok:true,json:async()=>({records:[],config:{youtube_configured:true,youtube_channel:{id:'UC-owner'},youtube_setup_available:false,gpu_relay:{gpus:[{id:'test-gpu',ready:true,config:{youtube_configured:false,youtube_channel:{id:'UC-wrong'},youtube_setup_available:true}}]}}})});
 w.eval(readFileSync(join(__dirname,'../storage-client.js'),'utf8'));
 const state=await w.api('state');assert.equal(state.config.youtube_configured,true);assert.equal(state.config.youtube_channel.id,'UC-owner');assert.equal(state.config.youtube_setup_available,false);
});
test('first-time setup is clickable before backend setup and opens without a Google window',async t=>{
 const {dom,w}=setup();t.after(()=>dom.window.close());w.state.config.youtube_configured=false;
 w.updateYouTubeConnection();assert.equal(w.$('#connect-youtube').disabled,false);
 w.state.config.youtube_setup_available=true;w.updateYouTubeConnection();assert.equal(w.$('#connect-youtube').disabled,false);
 w.open=()=>{throw Error('Must not open Google before setup');};w.connectYouTube();
 const dialog=w.$('#youtube-setup-dialog');assert.equal(dialog.open,true);assert.equal(w.document.activeElement,dialog.querySelector('input'));
 w.connectYouTube();assert.equal(w.document.querySelectorAll('#youtube-setup-dialog').length,1);
 dialog.querySelector('[data-close]').click();assert.equal(w.$('#youtube-setup-dialog'),null);assert.equal(w.document.activeElement,w.$('#connect-youtube'));
});
test('JSON upload uses CPU auth, closes on success, preserves drafts and never caches secrets',async t=>{
 const {dom,w}=setup();t.after(()=>dom.window.close());w.state.config.youtube_configured=false;w.state.config.youtube_setup_available=true;
 w.sessionStorage.setItem('ecco-storage-access','fixture-owner-key');w.AbortSignal=AbortSignal;w.gpuConnected=()=>false;w.api=async()=>{throw Error('GPU must not be used');};w.refresh=async()=>{};
 const requests=[];w.fetch=async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({youtube_configured:true,youtube_setup_available:false,youtube_channel:null})};};
 w.eval(readFileSync(join(__dirname,'../storage-client.js'),'utf8'));
 w.$('[name=title]').value='Keep my edited title';w.connectYouTube();
 const input=w.$('#youtube-setup-dialog input'),form=input.form;
 Object.defineProperty(input,'files',{value:[{size:100,text:async()=>JSON.stringify({web:{client_secret:'fixture-json-secret'}})}]});
 await form.onsubmit({preventDefault(){}});
 assert.equal(requests.length,1);assert.match(requests[0].url,/\/api\/youtube\/configure$/);assert.equal(requests[0].options.headers.Authorization,'Bearer fixture-owner-key');
 assert.equal(w.$('#youtube-setup-dialog'),null);assert.equal(w.state.config.youtube_configured,true);assert.equal(w.state.config.youtube_setup_available,false);
 assert.equal(w.$('[name=title]').value,'Keep my edited title');assert.equal(w.state.config.youtube_channel,null);
 for(const value of [JSON.stringify(w.state),JSON.stringify(w.sessionStorage),JSON.stringify(w.localStorage),w.document.body.textContent])assert.ok(!value.includes('fixture-json-secret'));
});
test('invalid and oversized files make no requests and parse errors never reveal file contents',async t=>{
 const {dom,w}=setup();t.after(()=>dom.window.close());w.state.config.youtube_configured=false;w.state.config.youtube_setup_available=true;
 let requests=0;w.api=async()=>{requests++;};
 for(const file of [{size:32769,text:async()=>''},{size:100,text:async()=>'fixture-secret-not-json'},{size:100,text:async()=>'[]'}]){
  w.connectYouTube();const dialog=w.$('#youtube-setup-dialog'),input=dialog.querySelector('input');
  Object.defineProperty(input,'files',{value:[file]});await input.form.onsubmit({preventDefault(){}});
  assert.equal(requests,0);assert.ok(!dialog.textContent.includes('fixture-secret-not-json'));assert.equal(input.disabled,false);dialog.close();
 }
});
test('install errors retain retry controls and prevent duplicate submissions',async t=>{
 const {dom,w}=setup();t.after(()=>dom.window.close());w.state.config.youtube_configured=false;w.state.config.youtube_setup_available=true;
 let reject,requests=0;w.api=()=>{requests++;return new Promise((_,r)=>{reject=r;});};w.connectYouTube();
 const dialog=w.$('#youtube-setup-dialog'),input=dialog.querySelector('input'),form=input.form;
 Object.defineProperty(input,'files',{value:[{size:100,text:async()=>'{"web":{}}'}]});
 const pending=form.onsubmit({preventDefault(){}});await Promise.resolve();await form.onsubmit({preventDefault(){}});assert.equal(requests,1);
 reject(Error('This JSON is for a different OAuth client.'));await pending;
 assert.equal(dialog.open,true);assert.match(dialog.querySelector('[data-status]').textContent,/different OAuth client/);assert.equal(form.querySelector('[type=submit]').disabled,false);assert.equal(w.state.config.youtube_configured,false);
});

test('Connections owns all platform controls and header icon preserves publishing drafts',t=>{
 const {dom,w}=setup();t.after(()=>dom.window.close());
 assert.equal(w.$('#page #connect-youtube'),null);assert.equal(w.$('#page #disconnect-youtube'),null);
 w.$('[name=title]').value='Preserve my draft';w.$('#connection-dialog').close();
 assert.equal(w.$('#open-youtube-connections'),null);assert.equal(w.$('#page .connection'),null);assert.ok(!w.$('#page').textContent.includes('Connect TikTok'));w.$('#studio-publishing-icon').click();
 assert.equal(w.$('#connection-dialog').open,true);assert.equal(w.document.activeElement,w.$('#connect-youtube'));
 assert.equal(w.$('[name=title]').value,'Preserve my draft');assert.equal(w.document.querySelectorAll('#connect-youtube').length,1);
});
test('disconnected workspace can choose JSON but cannot install or open Google before authentication',async t=>{
 const {dom,w}=setup();t.after(()=>dom.window.close());w.EccoStorage.ready=false;w.state.config={};
 let storageOptions,requests=0;w.EccoStorage.open=options=>{storageOptions=options;};w.api=async()=>{requests++;};w.open=()=>{throw Error('No Google before storage');};
 w.updateYouTubeConnection();assert.equal(w.$('#connect-youtube').disabled,false);w.$('#connect-youtube').click();
 const d=w.$('#youtube-setup-dialog'),input=d.querySelector('input');assert.equal(d.open,true);assert.equal(input.disabled,false);assert.equal(d.querySelector('[type=submit]').disabled,true);
 assert.match(d.querySelector('[data-requirement]').textContent,/storage access key is separate/);
 Object.defineProperty(input,'files',{value:[{size:100,text:async()=>'{}'}]});await input.form.onsubmit({preventDefault(){}});assert.equal(requests,0);
 d.querySelector('[data-storage]').click();assert.equal(storageOptions.preservePage,true);
 w.EccoStorage.ready=true;w.state.config.youtube_setup_available=true;w.updateYouTubeConnection();
 assert.equal(d.querySelector('[type=submit]').disabled,false);assert.equal(d.querySelector('[data-storage]').hidden,true);assert.equal(input.files.length,1);
 d.close();assert.equal(w.$('#connection-dialog').open,true);assert.equal(w.document.activeElement,w.$('#connect-youtube'));
});
test('existing configuration discovered after storage login offers Google authorization instead of replacement',async t=>{
 const {dom,w}=setup();t.after(()=>dom.window.close());w.EccoStorage.ready=false;w.connectYouTube();
 const d=w.$('#youtube-setup-dialog');w.EccoStorage.ready=true;w.state.config.youtube_configured=true;w.updateYouTubeConnection();
 assert.equal(d.querySelector('[data-import]').hidden,true);assert.equal(d.querySelector('[type=submit]').hidden,true);assert.equal(d.querySelector('[data-authorize]').hidden,false);
 const popup={location:{},close(){}};let requests=0;w.open=()=>popup;w.api=async path=>{requests++;assert.equal(path,'youtube/connect');return {url:'https://accounts.google.com/o/oauth2/auth'};};
 d.querySelector('[data-authorize]').click();await new Promise(r=>setImmediate(r));assert.equal(requests,1);assert.equal(w.$('#youtube-setup-dialog'),null);
});
test('connection state updates outside Publishing and duplicate Google requests are blocked',async t=>{
 const {dom,w}=setup();t.after(()=>dom.window.close());w.$('#page').replaceChildren();
 w.state.config.youtube_channel={id:'UC-test',title:'Owner'};w.updateYouTubeConnection();assert.equal(w.$('#youtube-connection [data-youtube-status]').textContent,'Owner');
 let resolve,requests=0;w.open=()=>({location:{},close(){}});w.api=()=>{requests++;return new Promise(r=>{resolve=r;});};
 const pending=w.connectYouTube();w.connectYouTube();assert.equal(requests,1);resolve({url:'https://accounts.google.com/o/oauth2/auth'});await pending;
 assert.equal(w.$('#connect-youtube').disabled,false);
});
test('nested storage authentication preserves the JSON selection and publishing draft',async t=>{
 const {dom,w}=setup();t.after(()=>dom.window.close());w.state.config={};w.AbortSignal=AbortSignal;w.gpuConnected=()=>false;
 let navigations=0;w.navigate=()=>{navigations++;};w.api=async()=>{};w.refresh=async next=>{w.state=next;w.updateYouTubeConnection();};
 w.EccoErrors={show:error=>{throw error;}};
 w.fetch=async()=>({ok:true,json:async()=>({records:[],config:{youtube_configured:false,youtube_setup_available:true}})});
 w.eval(readFileSync(join(__dirname,'../storage-client.js'),'utf8'));
 w.$('[name=title]').value='Keep draft while connecting';w.connectYouTube();
 const dialog=w.$('#youtube-setup-dialog'),input=dialog.querySelector('input'),file={size:100,text:async()=>'{}'};
 Object.defineProperty(input,'files',{value:[file]});dialog.querySelector('[data-storage]').click();
 const form=w.$('#storage-access-dialog form');form.elements.key.value='fixture-owner-storage-key-32-characters';
 await form.onsubmit({preventDefault(){},target:form});
 assert.equal(w.EccoStorage.ready,true);assert.equal(navigations,0);assert.equal(w.$('[name=title]').value,'Keep draft while connecting');
 assert.equal(dialog.open,true);assert.equal(input.files[0],file);assert.equal(dialog.querySelector('[type=submit]').disabled,false);assert.equal(w.$('#storage-access-dialog').open,false);
});

// Multiple destinations must stay explicit across refreshes and disconnections.
test('channel selector retains selection, clears consent and binds upload to the selected channel',async t=>{
 const {dom,w}=setup();t.after(()=>dom.window.close());
 const first={id:'UC-one',title:'First',handle:'@First'},second={id:'UC-two',title:'Second',handle:'@Second'};
 w.state.config.youtube_channels=[first,second];w.state.config.youtube_multi_channel=true;w.updateYouTubeConnection();
 const select=w.$('#publish-form [name=channel_id]'),check=w.$('#publish-form [name=confirmed]'),publish=w.$('.publishing-toolbar button');
 assert.equal(select.options.length,3);assert.equal(select.value,'');assert.equal(publish.disabled,true);assert.match(publish.title,/Choose a YouTube channel/);
 select.value=second.id;select.dispatchEvent(new w.Event('change'));check.checked=true;w.updateYouTubeConnection();assert.equal(check.checked,true);assert.equal(select.value,second.id);
 w.state.config.youtube_channels=[first,second,{id:'UC-three',title:'Third'}];w.updateYouTubeConnection();assert.equal(select.value,second.id);assert.equal(check.checked,true);
 let request;w.api=async(path,body)=>{request={path,body};};w.$('#publish-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await Promise.resolve();assert.equal(request.body.channel_id,second.id);
 select.value=first.id;select.dispatchEvent(new w.Event('change'));assert.equal(check.checked,false);assert.match(check.nextElementSibling.textContent,/UC-one/);
 w.state.config.youtube_channels=[second,{id:'UC-three',title:'Third'}];w.updateYouTubeConnection();assert.equal(select.value,'');assert.equal(publish.disabled,true);
});
test('header dropdown shows connected destinations only, supports keyboard and focuses Connections',t=>{
 const {dom,w}=setup();t.after(()=>dom.window.close());const menu=w.$('#publishing-connection-menu');assert.equal(menu.hidden,true);assert.equal(w.$('#studio-publishing-icon').disabled,false);
 w.state.config.youtube_channels=[{id:'UC-one',title:'One'}];w.updateYouTubeConnection();assert.equal(menu.hidden,true);assert.equal(w.$('#studio-publishing-icon').dataset.connected,'true');
 w.state.config.publishing_connections=[{platform:'instagram',id:'ig-1',title:'Instagram owner',connected:true},{platform:'x',id:'x-1',title:'Disconnected',connected:false}];w.updateYouTubeConnection();
 assert.equal(menu.hidden,false);assert.equal(menu.querySelectorAll('button').length,2);assert.ok(menu.textContent.includes('Instagram owner'));assert.ok(!menu.textContent.includes('Disconnected'));
 const summary=menu.querySelector('summary');summary.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));assert.equal(w.document.activeElement,menu.querySelector('button'));
 w.document.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(menu.open,false);assert.equal(w.document.activeElement,summary);
 menu.querySelector('button').click();assert.equal(w.$('#connection-dialog').open,true);assert.equal(w.$('#youtube-manage-channel').value,'UC-one');assert.equal(w.document.activeElement,w.$('#youtube-manage-channel'));
 w.EccoStorage.ready=false;w.updateYouTubeConnection();assert.equal(menu.hidden,true);assert.equal(menu.querySelectorAll('button').length,0);assert.equal(w.$('#studio-publishing-icon').dataset.connected,'false');
});
test('Publish explains absence of an approved video and unsupported platform without enabling upload',t=>{
 const {dom,w}=setup();t.after(()=>dom.window.close());w.state.config.youtube_channel={id:'UC-one',title:'One'};w.state.records=[];w.updateYouTubeConnection();
 const publish=w.$('.publishing-toolbar button');assert.equal(publish.disabled,true);assert.match(w.$('.publishing-toolbar [role=status]').textContent,/Approve a video/);
 w.$('[data-platform=tiktok]').click();assert.equal(publish.disabled,true);assert.match(w.$('.publishing-toolbar [role=status]').textContent,/not available yet/);
});
test('disconnect targets only the selected connection and creation opens the official YouTube page',async t=>{
 const {dom,w}=setup();t.after(()=>dom.window.close());const first={id:'UC-one',title:'One'},second={id:'UC-two',title:'Two'};
 w.state.config.youtube_channels=[first,second];w.updateYouTubeConnection();const select=w.$('#youtube-manage-channel');select.value=second.id;select.dispatchEvent(new w.Event('change'));
 let body;w.api=async(path,payload)=>{body=payload;return {youtube_channels:[first],youtube_channel:first};};await w.$('#disconnect-youtube').onclick();assert.equal(body.channel_id,second.id);assert.equal(w.state.config.youtube_channels.length,1);
 const create=w.$('#youtube-connection a');assert.equal(create.href,'https://www.youtube.com/channel_switcher');assert.equal(create.target,'_blank');assert.match(create.rel,/noopener/);assert.equal(w.$('#page a[href*="channel_switcher"]'),null);
});
