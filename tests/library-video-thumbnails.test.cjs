const {test}=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom'),{readFileSync}=require('node:fs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(count=1){
 const dom=new JSDOM('<div id="page"><div class="section-head"><div class="row"><label class="library-view-label"><select><option value="list">List</option><option value="small">Small icons</option><option value="large">Large icons</option></select></label></div></div><div id="video-library-gallery"></div></div>',{runScripts:'outside-only',url:'https://studio.example/'});
 const w=dom.window,d=w.document,gallery=d.querySelector('#video-library-gallery'),decoders=[],draws=[],targets=new Set();let intersection;
 w.EccoAuth={user:{id:'one'}};w.state={records:[]};
 for(let i=0;i<count;i++){
  w.state.records.push({id:'video-'+i,title:'Clip '+i,filename:'clip-'+i+'.mp4',media:'video',created:1700000000+i});
  const card=d.createElement('article');card.className='card';card.dataset.libraryId='video-'+i;card.innerHTML='<video data-asset="video-'+i+'" src="blob:video-'+i+'" controls></video><div class="card-body"><p>Clip '+i+'</p></div>';gallery.append(card);card.querySelector('video').currentTime=4;
 }
 w.IntersectionObserver=class{constructor(callback){intersection=callback;}observe(target){targets.add(target);}unobserve(target){targets.delete(target);}disconnect(){targets.clear();}};
 const create=d.createElement.bind(d);
 d.createElement=(tag,...args)=>{
  const el=create(tag,...args);
  if(tag==='video'){
   Object.defineProperties(el,{videoWidth:{value:1920},videoHeight:{value:1080}});
   el.load=()=>{};el.play=()=>{throw new Error('Thumbnail must never play');};decoders.push(el);
  }
  if(tag==='canvas'){
   el.getContext=()=>({drawImage:(video,...size)=>draws.push({video,time:video.currentTime,size})});
   el.toDataURL=(type)=>{assert.equal(type,'image/jpeg');assert.equal(el.width,128);assert.equal(el.height,72);return 'data:image/jpeg;base64,frame'+draws.length;};
  }
  return el;
 };
 w.eval(readFileSync('library-browser.js','utf8'));
 return {w,d,gallery,decoders,draws,targets,
  mode:async value=>{const select=d.querySelector('.library-view-label select');select.value=value;select.dispatchEvent(new w.Event('change'));await tick();},
  visible:()=>intersection([...targets].map(target=>({target,isIntersecting:true}))),
  frame:async video=>{video.dispatchEvent(new w.Event('loadeddata'));await tick();},
  close:()=>{w.dispatchEvent(new w.Event('pagehide'));w.close();}
 };
}
test('video icon views lazily show frame zero without seeking or playing the original; both sizes reuse it',async()=>{
 const x=setup();try{await tick();const original=x.gallery.querySelector('.library-original video');assert.equal(x.decoders.length,0);
  await x.mode('small');assert.equal(x.decoders.length,0);x.visible();assert.equal(x.decoders.length,1);const decoder=x.decoders[0];assert.equal(decoder.getAttribute('src'),'blob:video-0');assert.equal(decoder.muted,true);
  await x.frame(decoder);assert.equal(x.draws[0].time,0);assert.equal(x.gallery.querySelector('.library-file-icon img').src,'data:image/jpeg;base64,frame1');assert.equal(original.currentTime,4);assert.equal(x.gallery.querySelector('.library-file-accessed').textContent,'—');assert.equal(x.w.localStorage.length,0);assert.equal(decoder.hasAttribute('src'),false);
  await x.mode('large');x.visible();assert.equal(x.decoders.length,1);assert.equal(x.gallery.dataset.fileView,'large');assert.equal(x.gallery.querySelector('.library-original video'),original);
 }finally{x.close();}
});
test('changing the media source in List invalidates the old thumbnail; filtering restores cached previews',async()=>{
 const x=setup();try{await tick();await x.mode('small');x.visible();await x.frame(x.decoders[0]);await x.mode('list');
  x.gallery.querySelector('.library-original video').src='blob:replacement';await tick();assert.equal(x.gallery.querySelector('.library-file-icon img'),null);assert.equal(x.decoders.length,1);
  await x.mode('large');x.visible();assert.equal(x.decoders.length,2);assert.equal(x.decoders[1].getAttribute('src'),'blob:replacement');await x.frame(x.decoders[1]);
  const search=x.d.querySelector('input[type=search]');search.value='missing';search.dispatchEvent(new x.w.Event('input'));await tick();assert.equal(x.gallery.querySelector('.card').hidden,true);
  search.value='';search.dispatchEvent(new x.w.Event('input'));await tick();assert.equal(x.gallery.querySelector('.card').hidden,false);assert.equal(x.gallery.querySelector('.library-file-icon img').src,'data:image/jpeg;base64,frame2');assert.equal(x.decoders.length,2);
 }finally{x.close();}
});
test('two-decoder limit, failed media fallback, and stale results after account changes',async()=>{
 const x=setup(4);try{await tick();await x.mode('small');x.visible();assert.equal(x.decoders.length,2);
  const failedSource=x.decoders[0].getAttribute('src');x.decoders[0].dispatchEvent(new x.w.Event('error'));await tick();assert.equal(x.decoders.length,3);const failedCard=[...x.gallery.querySelectorAll('.card')].find(card=>card.querySelector('video').getAttribute('src')===failedSource);assert.equal(failedCard.querySelector('.library-file-icon img'),null);
  const late=x.decoders[1].onloadeddata;x.w.EccoAuth.user={id:'two'};x.d.dispatchEvent(new x.w.Event('ecco:auth-change'));await tick();assert.equal(x.gallery.querySelectorAll('.library-file-icon img').length,0);late();await tick();assert.equal(x.draws.length,0);
  x.visible();assert.equal(x.decoders.length,5);await x.frame(x.decoders[3]);assert.equal(x.draws.length,1);assert.equal(x.decoders.length,6);
 }finally{x.close();}
});
test('returning to icon view retries a decode abandoned in List',async()=>{
 const x=setup();try{await tick();await x.mode('small');x.visible();await x.mode('list');await x.frame(x.decoders[0]);assert.equal(x.draws.length,0);
  await x.mode('small');x.visible();assert.equal(x.decoders.length,2);await x.frame(x.decoders[1]);assert.ok(x.gallery.querySelector('.library-file-icon.has-thumbnail img'));
 }finally{x.close();}
});
