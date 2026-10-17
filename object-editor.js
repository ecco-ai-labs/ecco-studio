'use strict';
(() => {
const types={
 person:{name:'Person',colors:['Hair color','Eye color','Skin tone','Lips','Teeth color','Clothing'],ai:['Smile','Teeth visibility','Wrinkles','Pupil size','Hairstyle','Expression']},
 car:{name:'Car',colors:['Paint color','Wheels color','Windows','Interior'],ai:['Body style','Brand / model','Wheel design','Wheel size','Finish','Condition']},
 animal:{name:'Animal',colors:['Fur / feathers','Eyes','Accessories'],ai:['Expression','Pose','Coat pattern']},
 object:{name:'Other object',colors:['Surface color','Details'],ai:['Shape','Material','Style','Size','Condition']},
 background:{name:'Background',colors:['Background color','Details'],ai:['Lighting','Weather','Setting']}
};
const options=(arr,value)=>arr.map(v=>'<option '+(v===value?'selected':'')+'>'+esc(v)+'</option>').join('');
editImageDialog=function(aid){
 let dialog=document.getElementById('object-editor-dialog');
 if(!dialog){dialog=document.createElement('dialog');dialog.id='object-editor-dialog';document.body.appendChild(dialog);}
 const asset=state.records.find(x=>x.id===aid);
 const previous=asset.editor,source=previous&&state.records.find(x=>x.id===previous.source_asset_id&&!x.deleted)||asset;
 let recipe=previous&&source!==asset?structuredClone(previous.recipe):{version:1,objects:[]};
 let oi=0,part='',tool='paint',brush=.04,stroke=null,loaded=false,pending=false,original=false,showMask=true,dirty=false;
 const history=[],maskCache=new WeakMap();
 const newObj=(type)=>({id:crypto.randomUUID(),type,name:types[type].name+' '+(recipe.objects.length+1),bounds:null,attributes:{},ai:{}});
 if(!recipe.objects.length)recipe.objects.push(newObj('person'));
 const obj=()=>recipe.objects[oi],attr=()=>{const o=obj();return o.attributes[part]||(o.attributes[part]={color:'#795548',amount:0,shade:50,strokes:[]});};
 function snapshot(){history.push(JSON.stringify(recipe));if(history.length>30)history.shift();dirty=true;}
 dialog.innerHTML='<div class="oe-header"><div><span class="eyebrow">IMAGE EDITOR</span><h2>Objects & attributes</h2></div><button id="oe-close" class="secondary">Close</button></div>'+
 '<div class="oe-layout"><div class="oe-preview"><div class="oe-toolbar"><label>Selection tool<select id="oe-tool">'+options(['Paint region','Erase region','Rectangle region','Object bounds'],'Paint region')+'</select></label><label>Brush size<input id="oe-brush" type="range" min="1" max="20" value="4"></label><button id="oe-undo" class="secondary">Undo</button><button id="oe-reset" class="secondary">Reset attribute</button></div>'+
 '<div class="oe-canvas-wrap"><canvas id="oe-canvas" aria-label="Image preview. Drag to paint the selected attribute region."></canvas></div>'+
 '<div class="oe-toolbar"><label class="oe-check"><input id="oe-mask" type="checkbox" checked>Show selection</label><label class="oe-check"><input id="oe-before" type="checkbox">Show original</label><label>Zoom<select id="oe-zoom">'+options(['Fit','100%','200%'],'Fit')+'</select></label></div>'+
 '<p id="oe-status" role="status" aria-live="polite">Loading image…</p><p class="help">Select an object and attribute, then paint its region. Each attribute has its own mask. Object bounds identify subjects for AI edits; they do not automatically select hair or eyes.</p></div>'+
 '<div class="oe-controls form"><h3>Objects in this image</h3><p class="help">Add and name the objects you want to edit. This version uses manual selection, not automatic detection.</p><label>Selected object<select id="oe-objects"></select></label><div class="row"><label>Object type<select id="oe-type">'+Object.entries(types).map(([k,v])=>'<option value="'+k+'">'+v.name+'</option>').join('')+'</select></label><button id="oe-add" class="secondary">+ Add object</button></div><label>Object name<input id="oe-name" maxlength="100"></label><button id="oe-remove" class="secondary small">Remove object from edit</button>'+
 '<section class="oe-section"><h3>Instant color adjustments</h3><label>Attribute<select id="oe-part"></select></label><label>Target color<input id="oe-color" type="color"></label><label>Color strength <output id="oe-amount-out"></output><input id="oe-amount" type="range" min="0" max="100" value="0"></label><label>Shade <output id="oe-shade-out"></output><input id="oe-shade" type="range" min="0" max="100" value="50"></label><div class="oe-endpoints"><span>White</span><span>Original</span><span>Jet black</span></div><p class="help" id="oe-mask-info"></p></section>'+
 '<section class="oe-section"><h3>AI shape & expression edits</h3><p class="help">These change geometry and require generation. They are not instant sliders.</p><div id="oe-ai-fields"></div><label>Additional instruction<textarea id="oe-instruction" maxlength="2000" placeholder="Describe the desired change for this object"></textarea></label><p id="oe-ai-ready" class="help"></p><button id="oe-ai" class="secondary">Generate AI edit</button></section></div></div>'+
 '<div class="oe-footer"><p class="help">Save creates a new review image with object metadata. Your original is preserved.</p><button id="oe-save">Save edited copy</button></div>';
 const q=id=>dialog.querySelector('#'+id),canvas=q('oe-canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
 let base,w,h;
 function status(msg){q('oe-status').textContent=msg;}
 function list(){q('oe-objects').innerHTML=recipe.objects.map((o,i)=>'<option value="'+i+'" '+(i===oi?'selected':'')+'>'+esc(o.name)+' · '+types[o.type].name+'</option>').join('');}
 function controls(){
   list();const o=obj();q('oe-name').value=o.name;part=types[o.type].colors.includes(part)?part:types[o.type].colors[0];
   q('oe-part').innerHTML=options(types[o.type].colors,part);const a=attr();
   q('oe-color').value=a.color;q('oe-amount').value=a.amount;q('oe-shade').value=a.shade;
   q('oe-ai-fields').innerHTML=types[o.type].ai.map((name,i)=>'<label>'+esc(name)+'<input data-ai="'+i+'" maxlength="300" placeholder="Keep original" value="'+esc(o.ai[name]||'')+'"></label>').join('');
   q('oe-ai-fields').querySelectorAll('input').forEach(el=>el.oninput=()=>{snapshot();o.ai[types[o.type].ai[+el.dataset.ai]]=el.value;});
   q('oe-remove').disabled=recipe.objects.length===1;
   const ready=!!state.config.models_ready?.['qwen-image-edit-2511'];q('oe-ai').disabled=!ready;
   q('oe-ai-ready').textContent=ready?'AI editing available. Save color edits first if you want them included. Review results: precise identity and region preservation are not guaranteed.':'Qwen Image Edit is not installed. Color editing and metadata saving work now; AI edits remain unavailable until installation.';
   values();draw();
 }
 function values(){const a=attr();q('oe-amount-out').textContent=a.amount+'%';q('oe-shade-out').textContent=a.shade===50?'Unchanged':a.shade<50?Math.round((50-a.shade)*2)+'% lighter':Math.round((a.shade-50)*2)+'% darker';q('oe-mask-info').textContent=a.strokes.length?a.strokes.length+' selection strokes for '+part+'.':'Paint '+part.toLowerCase()+' on the image to enable a visible change.';}
 function buildMask(a){
   if(maskCache.has(a))return maskCache.get(a);
   const c=document.createElement('canvas');c.width=w;c.height=h;const m=c.getContext('2d',{willReadFrequently:true});
   for(const s of a.strokes){
     const pts=s.points.map(p=>[Math.round(p[0]*(w-1)),Math.round(p[1]*(h-1))]);
     m.globalCompositeOperation=s.mode==='erase'?'destination-out':'source-over';m.fillStyle='white';m.strokeStyle='white';m.lineWidth=Math.max(1,Math.round(s.width*Math.min(w,h)));m.lineCap='round';m.lineJoin='round';
     if(s.mode==='rectangle'){const p=pts[0],e=pts[pts.length-1];m.fillRect(Math.min(p[0],e[0]),Math.min(p[1],e[1]),Math.abs(e[0]-p[0])+1,Math.abs(e[1]-p[1])+1);}
     else {m.beginPath();m.moveTo(...pts[0]);for(const p of pts.slice(1))m.lineTo(...p);m.stroke();for(const p of [pts[0],pts[pts.length-1]]){m.beginPath();m.arc(...p,m.lineWidth/2,0,Math.PI*2);m.fill();}}
   }
   const mask=m.getImageData(0,0,w,h).data;maskCache.set(a,mask);return mask;
 }
 function draw(){
   if(!loaded||pending)return;pending=true;requestAnimationFrame(()=>{pending=false;
     const pixels=new Uint8ClampedArray(base.data);
     if(!original)for(const o of recipe.objects)for(const a of Object.values(o.attributes)){
       if(!a.strokes.length||(a.amount===0&&a.shade===50))continue;
       const mask=buildMask(a),rgb=[1,3,5].map(i=>parseInt(a.color.slice(i,i+2),16)),shade=(a.shade-50)/50;
       for(let i=0;i<pixels.length;i+=4){const alpha=mask[i+3]/255;if(!alpha)continue;const lum=(pixels[i]*.2126+pixels[i+1]*.7152+pixels[i+2]*.0722)/255;
         for(let c=0;c<3;c++){const v=pixels[i+c],target=Math.min(255,rgb[c]*(.4+.6*lum)+8*lum);let value=v+(target-v)*a.amount/100;value=shade>=0?value*(1-shade):value+(255-value)*(-shade);pixels[i+c]=Math.round(v+(value-v)*alpha);}
       }
     }
     if(showMask&&!original){const mask=buildMask(attr());for(let i=0;i<pixels.length;i+=4){const a=mask[i+3]/255*.28;pixels[i]=pixels[i]*(1-a);pixels[i+1]=pixels[i+1]*(1-a)+220*a;pixels[i+2]=pixels[i+2]*(1-a)+255*a;}}
     ctx.putImageData(new ImageData(pixels,w,h),0,0);
     if(obj().bounds&&!original){const b=obj().bounds;ctx.strokeStyle='#ffe600';ctx.lineWidth=2;ctx.setLineDash([8,5]);ctx.strokeRect(b[0]*w,b[1]*h,b[2]*w,b[3]*h);ctx.setLineDash([]);}
   });
 }
 const pos=e=>{const r=canvas.getBoundingClientRect();return [Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))];};
 let start;
 canvas.onpointerdown=e=>{
   if(!loaded||original)return;snapshot();canvas.setPointerCapture(e.pointerId);start=pos(e);
   if(tool==='bounds'){obj().bounds=[...start,0,0];stroke={points:[start]};}
   else{stroke={mode:tool,width:brush,points:[start]};attr().strokes.push(stroke);maskCache.delete(attr());}
   draw();
 };
 canvas.onpointermove=e=>{if(!stroke)return;const p=pos(e);
   if(tool==='bounds'){obj().bounds=[Math.min(start[0],p[0]),Math.min(start[1],p[1]),Math.abs(start[0]-p[0]),Math.abs(start[1]-p[1])];}
   else{if(tool==='rectangle')stroke.points=[start,p];else if(stroke.points.length<5000)stroke.points.push(p);maskCache.delete(attr());}draw();
 };
 const end=()=>{if(!stroke)return;stroke=null;values();status(tool==='bounds'?'Object bounds set. Now select Paint region for individual attributes.':'Selection updated. Move the color or shade sliders to preview.');};canvas.onpointerup=end;canvas.onpointercancel=end;
 q('oe-tool').onchange=e=>{tool={'Paint region':'paint','Erase region':'erase','Rectangle region':'rectangle','Object bounds':'bounds'}[e.target.value];};
 q('oe-brush').oninput=e=>brush=+e.target.value/100;
 q('oe-before').onchange=e=>{original=e.target.checked;draw();};q('oe-mask').onchange=e=>{showMask=e.target.checked;draw();};
 q('oe-zoom').onchange=e=>{canvas.className=e.target.value==='Fit'?'':e.target.value==='100%'?'oe-zoom-one':'oe-zoom-two';};
 q('oe-objects').onchange=e=>{oi=+e.target.value;controls();};
 q('oe-add').onclick=()=>{if(recipe.objects.length>=12)return status('Maximum 12 objects per image.');snapshot();recipe.objects.push(newObj(q('oe-type').value));oi=recipe.objects.length-1;part='';controls();};
 q('oe-remove').onclick=()=>{if(recipe.objects.length<2)return;snapshot();recipe.objects.splice(oi,1);oi=0;controls();};
 q('oe-name').oninput=e=>{snapshot();obj().name=e.target.value.trim()||types[obj().type].name;list();};
 q('oe-part').onchange=e=>{part=e.target.value;controls();};
 for(const [id,key] of [['oe-color','color'],['oe-amount','amount'],['oe-shade','shade']]){
   q(id).onpointerdown=()=>snapshot();q(id).onkeydown=e=>{if(e.key.startsWith('Arrow'))snapshot();};
   q(id).oninput=e=>{dirty=true;attr()[key]=key==='color'?e.target.value:+e.target.value;values();draw();};
 }
 q('oe-reset').onclick=()=>{snapshot();delete obj().attributes[part];controls();};
 q('oe-undo').onclick=()=>{if(!history.length)return;recipe=JSON.parse(history.pop());oi=Math.min(oi,recipe.objects.length-1);controls();status('Last change undone.');};
 function close(){if(dirty&&!confirm('Discard unsaved editor changes? The original image is unchanged.'))return;dialog.close();}
 q('oe-close').onclick=close;dialog.oncancel=e=>{e.preventDefault();close();};
 async function saveCopy(){
   if(!loaded)throw Error('Wait for the image to load.');
   const saved=await api('object-edits',{asset_id:source.id,recipe});dirty=false;await refresh();return saved;
 }
 q('oe-save').onclick=async()=>{q('oe-save').disabled=true;try{status('Saving full-resolution edited copy…');const saved=await saveCopy();dialog.close();navigate('images');notice('Edited copy saved with '+recipe.objects.length+' object(s). Original preserved.');}catch(e){status(e.message);}finally{q('oe-save').disabled=false;}};
 q('oe-ai').onclick=async()=>{
   const o=obj(),changes=Object.entries(o.ai).filter(([,v])=>v.trim()).map(([k,v])=>k+': '+v).join('; '),extra=q('oe-instruction').value.trim();
   if(!changes&&!extra)return status('Specify an AI attribute or additional instruction.');
   if(!o.bounds)return status('Choose Object bounds and draw a box around '+o.name+' first.');
   q('oe-ai').disabled=true;
   try{
     let ref=asset;if(dirty){status('Saving color edits before AI generation…');ref=await saveCopy();}
     const b=o.bounds.map(v=>Math.round(v*100));
     const prompt='Edit only '+o.name+' ('+types[o.type].name+'), in the region x '+b[0]+'%, y '+b[1]+'%, width '+b[2]+'%, height '+b[3]+'%. '+changes+'. '+extra+'. Preserve other objects, background, identity and composition.';
     const job=await api('image-edits',{asset_id:ref.id,story_id:asset.story_id||LEGACY_STORY,prompt});
     localStorage.setItem('ecco-image-job:'+(asset.story_id||LEGACY_STORY),job.id);dirty=false;dialog.close();await refresh();navigate('images');notice('AI edit queued. Exact region preservation requires review.');
   }catch(e){status(e.message);}finally{q('oe-ai').disabled=!state.config.models_ready?.['qwen-image-edit-2511'];}
 };
 controls();dialog.showModal();q('oe-save').disabled=true;
 const image=new Image();image.onload=()=>{w=image.naturalWidth;h=image.naturalHeight;if(w*h>20000000){status('This image exceeds the 20 megapixel editor limit.');return;}canvas.width=w;canvas.height=h;ctx.drawImage(image,0,0);base=ctx.getImageData(0,0,w,h);loaded=true;q('oe-save').disabled=false;status(w+' × '+h+' · original resolution. Paint a region to begin.');draw();};
 image.onerror=()=>status('Could not load the source image. Refresh the connection and retry.');image.src=media(source);
};
})();
