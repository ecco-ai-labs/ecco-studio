'use strict';
/* Image Studio jobs, variations, picture sets and export (Image Level 2-3 build, 21 Nov 2026).
   Pure functions only: Image Studio (image-workspace.js) draws with them, and image-studio-jobs.test.cjs tests them.
   - stage(): what a picture job is doing right now, in words, with elapsed time, a measured estimate and a bar.
   - seeds(): different seeds for variations, so four pictures of one prompt are four different pictures.
   - pages(): one page per line for a picture set.
   - shapes(): the picture shapes a model offers (more appear when the server lists them).
   - zip(): a store-only ZIP so a set downloads as one file. */
(function(root){
 const ACTIVE=['queued','running','cancelling','paused'],FAILED=['failed','error','cancelled','interrupted'];
 const MAX_PAGES=24,MAX_VARIATIONS=4;
 const SHAPE_NAMES={'1664x928':'Wide 16:9','928x1664':'Tall 9:16','1328x1328':'Square 1:1','1472x1104':'Landscape 4:3','1104x1472':'Portrait 3:4','1584x1056':'Photo 3:2','1056x1584':'Poster 2:3',
  '1024x576':'Wide 16:9','1024x1024':'Square 1:1','768x1024':'Portrait 3:4','1280x720':'Wide 16:9','720x1280':'Tall 9:16'};
 const shapeName=size=>SHAPE_NAMES[size]||String(size||'').replace('x',' × ');
 function shapes(catalogSizes,serverSizes){
  const list=[...(Array.isArray(catalogSizes)?catalogSizes:[])];
  for(const s of Array.isArray(serverSizes)?serverSizes:[])if(/^\d{3,4}x\d{3,4}$/.test(s)&&!list.includes(s))list.push(s);
  return list.map(size=>({size,name:shapeName(size)}));
 }
 // A base seed for each press of Generate, then base+1, base+2... for the variations.
 function seeds(base,count){
  const n=Math.max(1,Math.min(MAX_VARIATIONS,Math.round(Number(count)||1)));
  const b=Number.isFinite(Number(base))?Math.floor(Math.abs(Number(base)))%2147483000:0;
  return Array.from({length:n},(_,i)=>b+i);
 }
 function pages(text){
  return String(text||'').split(/\r?\n/).map(s=>s.replace(/^\s*(?:page\s*)?\d+\s*[.):-]\s*/i,'').trim()).filter(Boolean).slice(0,MAX_PAGES);
 }
 const clock=s=>{s=Math.max(0,Math.round(s||0));if(s<60)return s+' s';const m=Math.floor(s/60);return m+' min '+String(s%60).padStart(2,'0')+' s';};
 const about=s=>{s=Math.max(0,Math.round(s||0));if(s<60)return 'about '+Math.max(5,Math.round(s/5)*5)+' s';return 'about '+Math.round(s/60)+' min';};
 // Typical seconds for a finished picture, measured from the last finished jobs of the same kind.
 function typical(jobs,kind,fallback){
  const done=(Array.isArray(jobs)?jobs:[]).filter(j=>j&&j.status==='done'&&Number(j.seconds)>0&&(!kind||kindOf(j)===kind)).sort((a,b)=>(b.created||0)-(a.created||0)).slice(0,8);
  if(done.length<2)return fallback;
  const list=done.map(j=>Number(j.seconds)).sort((a,b)=>a-b);return list[Math.floor(list.length/2)];
 }
 const kindOf=j=>/edit|compose|character/i.test(j?.label||'')?'edit':'image';
 // What the job is doing now. job: server job record. now: ms. queued: {place,wait_seconds} from the queue, if waiting.
 function stage(job,now,queued,seconds){
  if(!job)return {state:'sending',text:'Sending your picture…',pct:null,elapsed:'',left:''};
  const t=Number(now)||Date.now(),created=(Number(job.created)||t/1000)*1000,started=job.started?Number(job.started)*1000:0;
  const elapsed=clock((t-created)/1000);
  if(job.status==='done')return {state:'done',text:'Finished',pct:100,elapsed:job.seconds?clock(job.seconds):elapsed,left:''};
  if(FAILED.includes(job.status))return {state:job.status==='cancelled'?'cancelled':'failed',text:job.status==='cancelled'?'Cancelled':(job.error?'Failed: '+String(job.error).slice(0,160):'Failed'),pct:null,elapsed,left:''};
  const progress=String(job.progress||''),log=Array.isArray(job.worker_log)?job.worker_log:[];
  const step=/(\d+)\s*(?:\/|of)\s*(\d+)/i.exec(progress)||[...log].reverse().map(l=>/(\d+)\s*\/\s*(\d+)\s*\[/.exec(String(l))).find(Boolean);
  const typicalSeconds=Number(seconds)||60;
  if(job.status==='queued'&&!started){
   const place=queued&&queued.place?Number(queued.place):0,wait=queued&&Number(queued.wait_seconds)>0?Number(queued.wait_seconds):0;
   return {state:'waiting',text:place?(place===1?'Next in line':'Waiting in line · place '+place):'Waiting in line',pct:null,elapsed,left:wait?about(wait+typicalSeconds)+' left':''};
  }
  const running=started?(t-started)/1000:(t-created)/1000;
  if(step&&!/character sheet/i.test(progress)){
   const n=Number(step[1]),m=Math.max(1,Number(step[2])),pct=Math.max(1,Math.min(99,Math.round(n/m*100)));
   const left=running>0&&n>0?running/n*(m-n):typicalSeconds*(1-pct/100);
   return {state:'drawing',text:'Drawing the picture · step '+n+' of '+m,pct,elapsed,left:about(left)+' left'};
  }
  if(/character sheet/i.test(progress)&&step){const n=Number(step[1]),m=Math.max(1,Number(step[2]));return {state:'drawing',text:progress,pct:Math.round((n-1)/m*100),elapsed,left:''};}
  const loading=log.length>0||/load|prepar|model/i.test(progress);
  const left=Math.max(0,typicalSeconds-running);
  return {state:loading?'loading':'starting',text:loading?(progress&&!/^queued$/i.test(progress)?progress:'Loading the model'):'Starting a GPU worker',pct:null,elapsed,left:left?about(left)+' left':'Almost there'};
 }
 const active=job=>!job||ACTIVE.includes(job.status);
 /* ---------- ZIP (store only, no compression) ---------- */
 const TABLE=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
 function crc32(bytes){let c=0xFFFFFFFF;for(let i=0;i<bytes.length;i++)c=TABLE[(c^bytes[i])&0xFF]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}
 function zip(files){
  const enc=new TextEncoder(),parts=[],central=[];let offset=0;
  for(const f of files){
   const name=enc.encode(String(f.name).replace(/[\\]/g,'/').slice(0,180)),data=f.bytes instanceof Uint8Array?f.bytes:new Uint8Array(f.bytes),crc=crc32(data);
   const local=new Uint8Array(30+name.length),v=new DataView(local.buffer);
   v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x0800,true);v.setUint16(8,0,true);v.setUint16(10,0,true);v.setUint16(12,0x21,true);
   v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);v.setUint16(28,0,true);local.set(name,30);
   const head=new Uint8Array(46+name.length),h=new DataView(head.buffer);
   h.setUint32(0,0x02014b50,true);h.setUint16(4,20,true);h.setUint16(6,20,true);h.setUint16(8,0x0800,true);h.setUint16(10,0,true);h.setUint16(12,0,true);h.setUint16(14,0x21,true);
   h.setUint32(16,crc,true);h.setUint32(20,data.length,true);h.setUint32(24,data.length,true);h.setUint16(28,name.length,true);h.setUint32(42,offset,true);head.set(name,46);
   parts.push(local,data);central.push(head);offset+=local.length+data.length;
  }
  const size=central.reduce((s,c)=>s+c.length,0),end=new Uint8Array(22),e=new DataView(end.buffer);
  e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,size,true);e.setUint32(16,offset,true);
  const out=new Uint8Array(offset+size+22);let at=0;for(const p of [...parts,...central,end]){out.set(p,at);at+=p.length;}
  return out;
 }
 const safeName=s=>String(s||'picture').replace(/[^\w\- ]+/g,'').trim().replace(/\s+/g,'-').slice(0,60)||'picture';
 const api={MAX_PAGES,MAX_VARIATIONS,shapes,shapeName,seeds,pages,stage,typical,kindOf,active,clock,about,crc32,zip,safeName};
 if(typeof module==='object'&&module.exports)module.exports=api;
 root.EccoImageJobs=api;
})(typeof window!=='undefined'?window:globalThis);
