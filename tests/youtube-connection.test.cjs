const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {JSDOM}=require('jsdom');
const source=readFileSync(join(__dirname,'../studio.js'),'utf8');
const helpers=source.slice(source.indexOf('function connectYouTube(){'),source.indexOf('function navigate(p)'));
function setup(){
 const dom=new JSDOM('<main><header></header><div id="page"></div></main>',{runScripts:'outside-only',url:'https://ecco-ai-labs.github.io/ecco-studio/'}),w=dom.window;
 w.$=selector=>w.document.querySelector(selector);w.esc=s=>String(s??'');
 w.state={config:{youtube_configured:true,youtube_channel:null},records:[{id:'a',media:'video',stage:'prod',title:'Approved test video'}]};
 w.assets=()=>w.state.records;w.currentStory=()=>({title:'Test story'});w.names={};
 w.notice=(message,error)=>w.lastNotice={message,error};w.action=async fn=>{try{await fn();}catch(e){w.notice(e.message,true);}};
 w.eval(helpers);w.eval(readFileSync(join(__dirname,'../publishing-platforms.js'),'utf8'));w.publishPage();
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
 assert.equal(w.$('#connect-youtube').parentElement.querySelector('.badge').textContent,'Ecco AI Labs · @EccoAILabs');
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
