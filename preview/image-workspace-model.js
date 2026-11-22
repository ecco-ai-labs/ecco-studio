'use strict';
/* Data-only helpers for the Create Images workspace and its regression tests.
   Enhance Image shows controls picked for what the image shows (owner request 2026-11-10):
   a person, an animal, a place, a single object or a vehicle each get their own controls.
   Choices are sent to generation with or without a prompt. */
(function(root){
 const sw=(name,hex)=>({name,hex});
 const LIGHT={key:'light',label:'Light',options:['Brighter','Darker','Warmer','Cooler','Moody','Golden hour']};
 const BACKGROUND={key:'background',label:'Background',options:['Blur','Plain studio','Remove']};
 const TYPES={
  person:{name:'Person',sections:[
   {title:'Look',groups:[
    {key:'skin_tone',label:'Skin tone',swatch:true,options:[sw('Fair','#f6dcc6'),sw('Light','#e7bf9c'),sw('Medium','#c99572'),sw('Tan','#a26c48'),sw('Brown','#7a4b2e'),sw('Deep','#4e2f1d')]},
    {key:'hair_color',label:'Hair color',swatch:true,options:[sw('Black','#1d1714'),sw('Brown','#4b2e1e'),sw('Auburn','#8c3b1f'),sw('Blonde','#d8b26a'),sw('Gray','#b9b6b0'),sw('White','#eeeae4')]},
    {key:'hairstyle',label:'Hairstyle',options:['Short','Long and loose','Curly','Braided','Tied back','Bald']},
    {key:'eye_color',label:'Eye color',swatch:true,options:[sw('Brown','#5a3b22'),sw('Hazel','#8a6a3a'),sw('Green','#4f7a4a'),sw('Blue','#4a6f9c'),sw('Gray','#707780')]},
    {key:'age',label:'Age',options:['Child','Teen','Younger','Older','Elderly']},
    {key:'facial_hair',label:'Facial hair',options:['None','Stubble','Beard','Mustache']}
   ]},
   {title:'Mood and styling',groups:[
    {key:'expression',label:'Expression',options:['Smiling','Calm','Worried','Determined','Surprised','Sad']},
    {key:'makeup',label:'Makeup',options:['None','Natural','Bold']},
    {key:'clothing',label:'Clothing',options:['Casual','Formal','Traditional','Rain coat','Work clothes']},
    {key:'pose',label:'Pose',options:['Looking at camera','Looking away','Over the shoulder','Walking']}
   ]},
   {title:'Light and background',groups:[LIGHT,BACKGROUND]}
  ]},
  animal:{name:'Animal',sections:[
   {title:'Look',groups:[
    {key:'fur_color',label:'Fur or feather color',swatch:true,options:[sw('Red','#b5532a'),sw('Brown','#6b4a2f'),sw('Golden','#c99a3c'),sw('Silver','#9aa0a6'),sw('White','#eeeeee'),sw('Black','#222222')]},
    {key:'fur_look',label:'Fur look',options:['Fluffy','Sleek','Wet','Snowy']},
    {key:'eye_color',label:'Eye color',swatch:true,options:[sw('Amber','#c8891f'),sw('Brown','#5a3b22'),sw('Green','#4f7a4a'),sw('Blue','#4a6f9c')]},
    {key:'age',label:'Age',options:['Baby','Young','Adult','Old']}
   ]},
   {title:'Character',groups:[
    {key:'mood',label:'Mood',options:['Alert','Playful','Sleepy','Curious','Fierce']},
    {key:'pose',label:'Pose',options:['Sitting','Standing','Running','Curled up','Looking back']},
    {key:'accessories',label:'Accessories',multi:true,options:['Scarf','Collar','Little hat','Backpack']}
   ]},
   {title:'Light and background',groups:[LIGHT,BACKGROUND]}
  ]},
  scenery:{name:'Scenery',sections:[
   {title:'Time and weather',groups:[
    {key:'time_of_day',label:'Time of day',options:['Dawn','Midday','Golden hour','Dusk','Night']},
    {key:'weather',label:'Weather',options:['Clear','Fog','Rain','Storm','Snow']},
    {key:'season',label:'Season',options:['Spring','Summer','Autumn','Winter']},
    {key:'sky',label:'Sky',options:['Clear sky','Clouds','Stars','Northern lights']}
   ]},
   {title:'Scene',groups:[
    {key:'water',label:'Water',options:['Calm','Choppy','Waves crashing','No water']},
    {key:'add',label:'Add to scene',multi:true,options:['People','Animals','Birds','Lit windows','Boats','Vehicles']},
    {key:'mood',label:'Mood',options:['Peaceful','Busy','Eerie','Hopeful']},
    {key:'camera',label:'Camera',options:['Wider','Closer','From above','Eye level']}
   ]},
   {title:'Color',groups:[{key:'color',label:'Color',options:['Natural','Warm','Cool','Faded film']}]}
  ]},
  object:{name:'Object',sections:[
   {title:'Look',groups:[
    {key:'color',label:'Color',swatch:true,options:[sw('Red','#b8322a'),sw('Blue','#2f5fa8'),sw('Green','#3d7a4a'),sw('Gold','#c9a23c'),sw('Black','#222222'),sw('White','#eeeeee')]},
    {key:'material',label:'Material',options:['Wood','Metal','Glass','Stone','Fabric','Plastic']},
    {key:'condition',label:'Condition',options:['New','Worn','Antique','Broken']},
    {key:'size',label:'Size in frame',options:['Smaller','Larger']}
   ]},
   {title:'Light and background',groups:[LIGHT,BACKGROUND]}
  ]},
  vehicle:{name:'Vehicle',sections:[
   {title:'Look',groups:[
    {key:'color',label:'Color',swatch:true,options:[sw('Red','#b8322a'),sw('Blue','#2f5fa8'),sw('Green','#3d7a4a'),sw('Silver','#a4a8ad'),sw('Black','#222222'),sw('White','#eeeeee')]},
    {key:'finish',label:'Finish',options:['Glossy','Matte','Metallic','Rusty']},
    {key:'condition',label:'Condition',options:['New','Weathered','Damaged']},
    {key:'era',label:'Era',options:['Vintage','Modern','Futuristic']}
   ]},
   {title:'Light and background',groups:[LIGHT,BACKGROUND]}
  ]}
 };
 const TYPE_IDS=Object.keys(TYPES);
 const name=option=>typeof option==='string'?option:option.name;
 // Style is offered for every type; its options are Studio's image styles.
 function sections(type,styles){
  const base=TYPES[type];if(!base)throw Error('Unknown image type.');
  const list=base.sections.map(s=>({title:s.title,groups:s.groups.map(g=>({...g,options:g.options.slice()}))}));
  if(styles&&styles.length)list.push({title:'Style',groups:[{key:'style',label:'Style',options:styles.slice()}]});
  return list;
 }
 const groups=(type,styles)=>sections(type,styles).flatMap(s=>s.groups);
 function toggle(choices,group,value){
  const next={...(choices||{})},current=next[group.key];
  if(group.multi){const list=Array.isArray(current)?current.filter(v=>v!==value):[];if(!Array.isArray(current)||!current.includes(value))list.push(value);if(list.length)next[group.key]=list;else delete next[group.key];}
  else if(current===value)delete next[group.key];else next[group.key]=value;
  return next;
 }
 // Only values the catalog offers count; anything else (an old save, a changed catalog) is ignored.
 function chosen(type,choices,styles){
  const out=[];if(!TYPES[type])return out;
  for(const g of groups(type,styles)){
   const value=(choices||{})[g.key],allowed=g.options.map(name);
   const picked=g.multi?(Array.isArray(value)?value.filter(v=>allowed.includes(v)):[]):(allowed.includes(value)?[value]:[]);
   if(picked.length)out.push({key:g.key,label:g.label,value:picked.join(', ')});
  }
  return out;
 }
 const canGenerate=(prompt,type,choices,styles)=>Boolean(String(prompt||'').trim())||chosen(type,choices,styles).length>0;
 // "Image 2" in a prompt brings that selected image along as a reference.
 function referenced(prompt,count){
  const found=new Set();for(const m of String(prompt||'').matchAll(/\bimage\s+([1-9])\b/gi)){const n=+m[1];if(n>=1&&n<=count)found.add(n);}
  return [...found].sort((a,b)=>a-b);
 }
 function compose({number,type,prompt,choices,styles}){
  const list=chosen(type,choices,styles).filter(c=>c.key!=='style');
  const parts=[String(prompt||'').trim()];
  if(list.length)parts.push('Change Image '+number+': '+list.map(c=>c.label+': '+c.value).join('; ')+'.');
  const style=(choices||{}).style&&(styles||[]).includes(choices.style)?choices.style:'';
  return {prompt:parts.filter(Boolean).join('\n'),style};
 }
 // What the AI chooses from: {type: {control key: [option names]}}.
 function catalog(styles){
  const out={};for(const id of TYPE_IDS){out[id]={};for(const g of groups(id,styles))out[id][g.key]=g.options.map(name);}return out;
 }
 function parseAnalysis(text,styles){
  let value;try{value=JSON.parse(text);}catch{throw Error('AI returned an unreadable image analysis.');}
  if(!value||!TYPES[value.type])throw Error('AI could not tell what this image shows.');
  const list=groups(value.type,styles),suggestions={};
  for(const s of Array.isArray(value.suggestions)?value.suggestions:[]){
   const g=list.find(x=>x.key===s?.key);if(!g||!g.options.map(name).includes(s.value))continue;
   if(g.multi)suggestions[g.key]=[...new Set([...(suggestions[g.key]||[]),s.value])];else if(!suggestions[g.key])suggestions[g.key]=s.value;
  }
  return {type:value.type,suggestions};
 }
 const isSuggested=(analysis,key,value)=>{const s=analysis?.suggestions?.[key];return Array.isArray(s)?s.includes(value):s===value;};
 const api={TYPES,TYPE_IDS,sections,groups,toggle,chosen,canGenerate,referenced,compose,catalog,parseAnalysis,isSuggested,optionName:name};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.EccoImageWorkspaceModel=api;
})(typeof window==='undefined'?globalThis:window);
