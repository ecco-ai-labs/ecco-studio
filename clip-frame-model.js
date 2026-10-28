/* Frame identities refer to the original 25 fps review timeline, never to an edit index. */
(function(root, factory) {
 'use strict';
 const api = factory();
 if (typeof module === 'object' && module.exports) module.exports = api;
 else root.EccoFrameModel = api;
})(typeof window === 'undefined' ? globalThis : window, function() {
 'use strict';
 const FPS = 25;
 function ids(values, total) {
  if (!Array.isArray(values) || values.some(n => !Number.isInteger(n) || n < 1 || n > total)) throw Error('Frame numbers must be within the original video.');
  return [...new Set(values)].sort((a,b) => a-b);
 }
 function parse(text, total) {
  if (!text.trim()) return [];
  const values=[];
  for (const token of text.split(',')) {
   const match=token.trim().match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
   if (!match) throw Error('Use frame numbers or ranges, for example 128, 132, 137–140.');
   const a=Number(match[1]), b=Number(match[2] || match[1]);
   if (a<1 || b>total || a>b) throw Error('Choose frames between 1 and '+total+'.');
   for (let n=a;n<=b;n++) values.push(n);
  }
  return ids(values,total);
 }
 function ranges(values) {
  const sorted=[...new Set(values)].sort((a,b)=>a-b), result=[];
  for (const n of sorted) { const last=result.at(-1); if(last && n===last[1]+1) last[1]=n; else result.push([n,n]); }
  return result;
 }
 const format=values=>ranges(values).map(([a,b])=>a===b?String(a):a+'–'+b).join(', ');
 function boundaries(total, seconds=3) {
  if(![3,4].includes(Number(seconds))) throw Error('Choose 3 or 4 seconds.');
  const ends=[];
  for(let end=seconds*FPS;end<total;end+=seconds*FPS) ends.push(end);
  ends.push(total); return ends;
 }
 function clips(doc) {
  let start=1;
  return doc.ends.map((end,index)=>{const clip={index,start,end,count:end-start+1};start=end+1;return clip;});
 }
 function create(total, seconds=3) {
  if(!Number.isInteger(total)||total<1||total>3000) throw Error('Choose a video up to 2 minutes for frame review.');
  return {version:1,fps:FPS,total,seconds,ends:boundaries(total,seconds),removed:[],replacements:{},repairs:[],endings:{}};
 }
 function validate(doc,total) {
  if(!doc||doc.version!==1||doc.fps!==FPS||doc.total!==total) throw Error('This saved edit belongs to a different source timeline.');
  ids(doc.removed,total);
  const ends=ids(doc.ends,total);
  if(ends.at(-1)!==total||JSON.stringify(ends)!==JSON.stringify(doc.ends)) throw Error('Invalid clip boundaries.');
  if(!doc.replacements||typeof doc.replacements!=='object') throw Error('Invalid replacements.');
  for(const key of Object.keys(doc.replacements)) { ids([Number(key)],total); if(!/^data:image\/(png|jpeg|webp);base64,/.test(doc.replacements[key].dataUrl||'')) throw Error('Invalid replacement image.'); }
  return doc;
 }
 function keep(doc,start=1,end=doc.total) {
  const removed=new Set(doc.removed), result=[];
  for(let n=start;n<=end;n++) if(!removed.has(n)) result.push(n);
  return result;
 }
 function context(values,total,pad=10) {
  const selected=ids(values,total), windows=[];
  for(const [a,b] of ranges(selected)) {
   const from=Math.max(1,a-pad),to=Math.min(total,b+pad),last=windows.at(-1);
   if(last && from<=last.to+1) { last.to=Math.max(last.to,to); last.replace.push(...selected.filter(n=>n>=a&&n<=b)); }
   else windows.push({from,to,replace:selected.filter(n=>n>=a&&n<=b)});
  }
  return windows;
 }
 function change(doc,operation,selected=[]) {
  const next=JSON.parse(JSON.stringify(doc)), chosen=ids(selected,doc.total), removed=new Set(doc.removed);
  if(operation==='remove') chosen.forEach(n=>removed.add(n));
  else if(operation==='restore') chosen.forEach(n=>removed.delete(n));
  else throw Error('Unknown frame operation.');
  if(removed.size===doc.total) throw Error('Keep at least one frame in the video.');
  next.removed=[...removed].sort((a,b)=>a-b);return next;
 }
 function repair(doc, selected, prompt) {
  if(!selected.length) throw Error('Select frames to repair.');
  if(!prompt.trim()) throw Error('Describe the correction first.');
  return {version:1,fps:FPS,original_frame_ids:ids(selected,doc.total),context_frames:10,windows:context(selected,doc.total),instructions:prompt.trim(),status:'prepared',preserve_duration:true};
 }
 function playback(doc,selected,clip,scope,edited=true) {
  if(scope==='selected')return ids(selected,doc.total);
  return edited?keep(doc,clip.start,clip.end):Array.from({length:clip.count},(_,i)=>clip.start+i);
 }
 const revision=doc=>JSON.stringify({total:doc.total,fps:doc.fps,replacements:doc.replacements,removed:doc.removed});
 function acceptRepair(doc,draft,candidate) {
  if(draft.revision!==revision(doc))throw Error('The edit changed after this repair was prepared. Start a new repair from the current edit.');
  const targets=ids(draft.original_frame_ids,doc.total),actual=Object.keys(candidate.frames||{}).map(Number).sort((a,b)=>a-b);
  if(candidate.id!==draft.request_id||candidate.asset_id!==draft.asset_id||candidate.fps!==FPS||candidate.total!==doc.total||JSON.stringify(actual)!==JSON.stringify(targets))throw Error('The repaired frames do not match this source and selection.');
  const next=JSON.parse(JSON.stringify(doc));
  for(const n of targets){const dataUrl=candidate.frames[n];if(typeof dataUrl!=='string'||!/^data:image\/jpeg;base64,/.test(dataUrl)||dataUrl.length>120000)throw Error('Invalid repaired frame.');next.replacements[n]={dataUrl,name:'AI repair '+candidate.id,repairId:candidate.id};}
  if(Object.keys(next.replacements).length>100)throw Error('Export this edit before adding more than 100 replacement frames.');next.removed=next.removed.filter(n=>!targets.includes(n));validate(next,doc.total);return next;
 }
 return {FPS,ids,parse,ranges,format,boundaries,clips,create,validate,keep,context,change,repair,playback,revision,acceptRepair};
});
