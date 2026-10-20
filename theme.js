'use strict';
/* Color-only bridge for existing styles. No geometry, typography or media edits. */
(()=>{
 const KEY='ecco-theme-preset-v1';
 const PALETTE={background:['Page Background','#17152f'],surface:['Panels and Popups','#252039'],control:['Buttons and Inputs','#302a54'],text:['Primary Text','#ffffff'],contrast:['Text on Accent','#211b33'],muted:['Secondary Text','#b1acc9'],accent:['Accent and Selection','#ffdc24'],border:['Borders','#51496f'],error:['Errors','#ff6b6b'],success:['Success','#7bcf9b'],shadow:['Shadows','#000000']};
 const PRESETS={
  default:{label:'Default',colors:{}},
  dark:{label:'Dark Mode',colors:{background:'#0d0d0f',surface:'#242428',control:'#303035',text:'#f5f5f5',contrast:'#151517',muted:'#c3c3ca',accent:'#c7c7ce',border:'#b5b5bd',error:'#ff6b6b',success:'#7bcf9b',shadow:'#000000'}},
  forest:{label:'Forest',colors:{background:'#123d2a',surface:'#285a40',control:'#34714e',text:'#ffffff',contrast:'#123d2a',muted:'#d2e8d8',accent:'#ffffff',border:'#ffffff',error:'#ffb1ad',success:'#b7edbc',shadow:'#071e13'}},
  desert:{label:'Desert',colors:{background:'#dbc49a',surface:'#f4e6cb',control:'#ead6b2',text:'#3c2c20',contrast:'#fff6e5',muted:'#67513d',accent:'#6b4226',border:'#8c6844',error:'#a52424',success:'#2f633b',shadow:'#503b25'}}
 };
 const validPreset=value=>typeof value==='string'&&Object.hasOwn(PRESETS,value)?value:'default';
 let saved='default';try{saved=validPreset(localStorage.getItem(KEY));}catch{}
 function apply(name){const colors=PRESETS[validPreset(name)].colors;for(const key of Object.keys(PALETTE)){const variable='--ecco-theme-'+key;if(colors[key])document.documentElement.style.setProperty(variable,colors[key]);else document.documentElement.style.removeProperty(variable);}}
 apply(saved);
 const COLOR=/url\([^)]*\)|#[\da-f]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black|red|yellow|gray|grey|orange|green|blue|purple)\b/gi;
 const NAMES={white:'#ffffff',black:'#000000',red:'#ff0000',yellow:'#ffff00',gray:'#808080',grey:'#808080',orange:'#ffa500',green:'#008000',blue:'#0000ff',purple:'#800080'};
 function channels(raw){let v=NAMES[raw.toLowerCase()]||raw;if(v[0]==='#'){v=v.slice(1);if(v.length===3||v.length===4)v=[...v].map(c=>c+c).join('');if(v.length!==6&&v.length!==8)return null;return [parseInt(v.slice(0,2),16),parseInt(v.slice(2,4),16),parseInt(v.slice(4,6),16),v.length===8?parseInt(v.slice(6),16)/255:1];}const parts=v.match(/[\d.]+%?/g);if(!parts||parts.length<3)return null;return parts.map((p,i)=>p.endsWith('%')?parseFloat(p)*(i<3?2.55:.01):Number(p)).concat(parts.length===3?[1]:[]);}
 function role(raw,property,selector){const c=channels(raw);if(!c)return null;const [r,g,b]=c,max=Math.max(r,g,b),min=Math.min(r,g,b),sat=max-min;
  if(/shadow/.test(property))return 'shadow';
  if(/^--(?:bg|background|page-background)$/.test(property))return 'background';
  if(sat>55&&max>130){if(r>g*1.25&&r>b*1.15)return 'error';if(g>r*1.15&&g>b*1.08)return 'success';if(r>150&&g>110&&b<Math.min(r,g)*.72)return 'accent';}
  if(/border|outline/.test(property))return 'border';
  if(/background/.test(property)||/^--(?:panel|surface)/.test(property)){if(/button|input|select|textarea|summary|control|\.secondary/.test(selector))return 'control';return /^(?:html|body|:root)$/.test(selector.trim())?'background':'surface';}
  if(property==='color'||/fill|stroke|color$/.test(property)||property.startsWith('--'))return max>205?'text':max>105?'muted':'contrast';
  return null;
 }
 const allowed=p=>p.startsWith('--')||/^(?:color|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left))?(?:-color)?|outline(?:-color)?|box-shadow|text-shadow|fill|stroke|caret-color|accent-color|text-decoration-color|column-rule-color)$/.test(p);
 // Each source color has its own fallback, preserving the exact default palette.
 function colorValue(value,property,selector){if(!allowed(property)||property.startsWith('--ecco-theme-')||value.includes('--ecco-theme-'))return value;return value.replace(COLOR,raw=>{if(/^url/i.test(raw))return raw;const key=role(raw,property,selector),c=channels(raw);if(!key||!c||c[3]===0)return raw;const base='var(--ecco-theme-'+key+', '+(c[3]<1?'rgb('+c.slice(0,3).join(',')+')':raw)+')';return c[3]<1?'color-mix(in srgb, '+base+' '+(c[3]*100).toFixed(6)+'%, transparent)':base;});}
 const seen=new WeakMap();
 function declaration(style,selector){if(!style)return;let before=seen.get(style);if(before===style.cssText)return;for(const property of [...style]){const value=style.getPropertyValue(property),next=colorValue(value,property,selector);if(next!==value)style.setProperty(property,next,style.getPropertyPriority(property));}seen.set(style,style.cssText);}
 function rules(list){for(const rule of list){if(rule.style)declaration(rule.style,rule.selectorText||'');if(rule.cssRules)rules(rule.cssRules);}}
 function scanStyles(){for(const sheet of document.styleSheets){try{rules(sheet.cssRules);}catch{/* Cross-origin third-party styles are not editable. */}}}
 function inline(root){if(root.nodeType!==1)return;const skip=el=>el.closest('svg,#workspace-entry,#story-choice-screen')||el.matches('img,video,audio,canvas');if(root.hasAttribute('style')&&!skip(root))declaration(root.style,root.tagName.toLowerCase()+' '+root.className);for(const el of root.querySelectorAll('[style]'))if(!skip(el))declaration(el.style,el.tagName.toLowerCase()+' '+el.className);}
 function mount(){
  const menu=document.querySelector('[data-category="Account"] .workspace-menu-items');if(!menu||document.querySelector('#theme-colors-open'))return;
  const button=document.createElement('button');button.type='button';button.id='theme-colors-open';button.className='secondary';button.textContent='Theme';button.dataset.ribbonClose='1';button.setAttribute('aria-controls','workspace-theme-drawer');button.setAttribute('aria-expanded','false');
  const drawer=document.createElement('div');drawer.id='workspace-theme-drawer';drawer.setAttribute('role','radiogroup');drawer.setAttribute('aria-label','Theme');drawer.hidden=true;drawer.inert=true;
  for(const [key,preset] of Object.entries(PRESETS)){
   const row=document.createElement('label');row.className='theme-preset-option';
   const input=document.createElement('input');input.type='radio';input.name='ecco-theme';input.value=key;input.checked=key===saved;
   const title=document.createElement('span');title.textContent=preset.label;row.append(input,title);drawer.append(row);
   input.onchange=()=>{if(!input.checked)return;try{localStorage.setItem(KEY,key);saved=key;apply(saved);}catch(error){for(const radio of drawer.querySelectorAll('input'))radio.checked=radio.value===saved;window.EccoErrors?.show(error);}};
  }
  function show(open){drawer.hidden=!open;drawer.inert=!open;button.setAttribute('aria-expanded',String(open));if(open){const billing=document.querySelector('#workspace-billing-drawer');if(billing){billing.hidden=true;billing.inert=true;}document.querySelector('button[data-category="Billing"]')?.setAttribute('aria-expanded','false');}}
  button.onclick=e=>{e.preventDefault();e.stopPropagation();show(true);};button.addEventListener('pointerenter',()=>show(true));
  menu.addEventListener('pointerleave',()=>show(false));
  menu.addEventListener('pointerover',e=>{if(e.target.closest('button[data-category="Billing"]'))show(false);});
  menu.addEventListener('keydown',e=>{if(e.key==='Escape'&&!drawer.hidden){e.stopPropagation();show(false);button.focus();}});
  menu.addEventListener('focusout',e=>{if(!menu.contains(e.relatedTarget))show(false);});
  menu.closest('details').addEventListener('toggle',()=>{if(!menu.closest('details').open)show(false);});
  menu.append(button,drawer);
 }
 let pending=false,styleDirty=false;const inlineRoots=new Set();function schedule(){if(pending)return;pending=true;queueMicrotask(()=>{pending=false;if(styleDirty){styleDirty=false;scanStyles();}for(const root of inlineRoots)inline(root);inlineRoots.clear();mount();});}
 function start(){scanStyles();inline(document.body);mount();new MutationObserver(records=>{for(const r of records){if(r.type==='attributes'){inlineRoots.add(r.target);}else{if(r.target.nodeName==='STYLE'||r.target.parentElement?.nodeName==='STYLE')styleDirty=true;for(const n of r.addedNodes){if(n.nodeType===1){inlineRoots.add(n);if(n.matches('style,link[rel="stylesheet"]')||n.querySelector('style,link[rel="stylesheet"]'))styleDirty=true;}}}}schedule();}).observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['style']});document.addEventListener('load',e=>{if(e.target.matches?.('link[rel="stylesheet"]')){styleDirty=true;schedule();}},true);}
 window.EccoTheme={presets:PRESETS,validPreset,colorValue};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
