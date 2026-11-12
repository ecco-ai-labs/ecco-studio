'use strict';
// Image styles (owner request 2026-11-10): Qwen-Image follows a style only when it is described first and in detail.
// Checked on Serverless with Qwen-Image 2512: "Style: X." at the end was ignored for Cartoon, Origami and Clay.
// lead goes before the picture description; avoid becomes the negative prompt. hint is the one-line label in the picker.
(()=>{
 const S=(hint,lead,avoid)=>({hint,lead,avoid});
 const STYLES={
  // Illustration
  'Cartoon':S('Bold outlines, bright flat colors',"Flat 2D cartoon illustration with bold clean black outlines, simple rounded shapes, bright flat colors and cel shading, like a children's animated TV show.",'photorealistic, photograph, 3D render, realistic lighting, painterly, watercolor, oil painting'),
  "Children's storybook":S('Soft, warm picture-book illustration',"Children's picture-book illustration: soft hand-painted gouache and colored-pencil textures, warm gentle colors, friendly rounded characters with expressive faces, cozy storybook composition.",'photorealistic, photograph, 3D render, dark, gritty, anime'),
  'Anime':S('Japanese animation look','Japanese anime illustration, cel-shaded with clean line art, large expressive eyes, vibrant colors and painted anime film background art.','photorealistic, photograph, 3D render, western cartoon, watercolor, oil painting'),
  'Manga':S('Black-and-white Japanese comic','Black-and-white Japanese manga page art: crisp black ink lines, screentone shading, dramatic expressions, no color.','color, photograph, 3D render, painting'),
  'Comic book':S('Inked panels, halftone dots','American comic book art: bold black inks, flat bright colors, halftone dot shading, dynamic poses, printed comic look.','photorealistic, photograph, 3D render, watercolor, soft painting'),
  'Classic 2D animation':S('Hand-drawn animated-film look','Hand-drawn 2D cel animation frame from a classic animated feature film: characters drawn with clean uniform ink outlines and flat cel-painted colors with simple two-tone shading, in front of a softer painted background.','photograph, 3D render, CGI, painterly characters, realistic fur texture, oil painting, pixel art'),
  'Chibi / kawaii':S('Tiny, cute, big heads','Chibi kawaii illustration: tiny characters with oversized heads, huge sparkling eyes, pastel colors, soft rounded shapes, extremely cute.','realistic proportions, photograph, dark, gritty'),
  'Flat vector':S('Clean shapes, minimal detail','Flat vector illustration: clean geometric shapes, solid colors with no gradients or texture, minimal detail, modern graphic design look.','photograph, 3D render, painterly texture, sketch lines'),
  'Line art':S('Ink outlines only','Black ink line drawing on plain white paper. Everything, including the characters, the animals, every light and the sky, is drawn only as black outlines with no color and no filled areas at all. Black and white only.','color, orange, red, yellow glow, colored fills, shading, photograph, 3D render, painting'),
  'Pencil sketch':S('Graphite on paper','Graphite pencil sketch on white paper in shades of gray only: every element, including the characters and the animals, is drawn in gray pencil lines and cross-hatching, with no color anywhere and visible paper grain.','color, orange, red, colored pencil, yellow glow, photograph, 3D render, ink, digital painting'),
  'Charcoal':S('Smudgy dark drawing','Charcoal drawing on textured paper: rich smudged blacks, soft blended shadows, expressive strokes, monochrome.','color, photograph, 3D render, clean lines'),
  // Painting
  'Watercolor':S('Soft washes on paper','Watercolor painting on textured paper, soft translucent washes, visible brush strokes, colors bleeding at the edges, white paper showing through.','photorealistic, photograph, 3D render, sharp digital lines, cartoon outlines, oil painting'),
  'Oil painting':S('Thick brush strokes on canvas','Classical oil painting on canvas, thick visible brush strokes and impasto, rich layered pigments, visible canvas texture.','photograph, 3D render, flat cartoon, smooth digital art'),
  'Acrylic':S('Bold, opaque paint','Acrylic painting on canvas: bold opaque colors, confident visible brush strokes, slightly glossy paint, vivid contrast.','photograph, 3D render, watercolor washes, cartoon outlines'),
  'Gouache':S('Matte, flat paint','Gouache painting: matte opaque paint in flat layered areas of color, soft edges, visible brush marks, mid-century illustration feel.','photograph, 3D render, glossy, cartoon outlines'),
  'Pastel':S('Soft chalky colors','Soft pastel drawing on toned paper: chalky blended colors, gentle strokes, powdery texture, soft light.','photograph, 3D render, hard ink lines, glossy'),
  'Impressionist':S('Dabs of light and color','Impressionist oil painting: short visible dabs of pure color, shimmering natural light, loose brushwork, soft edges, like 19th-century plein-air painting.','photograph, 3D render, sharp detail, cartoon outlines'),
  'Pop art':S('Bright, bold, comic-like','Pop art print: bold flat primary colors, thick black outlines, Ben-Day halftone dots, high contrast, graphic and playful.','photograph, 3D render, soft painting, muted colors'),
  'Art nouveau':S('Flowing lines, ornate borders','Art nouveau poster illustration: flowing organic lines, decorative floral frame and ornate border, muted gold and pastel palette, elegant flat shapes.','photograph, 3D render, modern minimal, pixel art'),
  // 3D and craft
  '3D animation':S('Animated-film CGI look','3D animated feature film still: stylized CGI characters with soft rounded features and expressive faces, soft global illumination, rich color.','flat 2D, photograph, sketch, painting, watercolor, oil painting, pixel art'),
  'Clay / claymation':S('Handmade plasticine','Stop-motion claymation scene: the characters and the whole set are handmade from plasticine modeling clay, with visible fingerprints, tool marks and slightly lumpy shapes, soft studio lighting on a miniature set.','photorealistic, real fur, smooth CGI, painting, drawing'),
  'Origami':S('Folded paper','Origami paper-craft diorama: every element, including the characters, the ground, the sky and every object, is made of folded colored paper with crisp creases and visible paper texture, photographed as a miniature studio set.','photograph of real people, real animal fur, painting, cartoon outlines'),
  'Paper cut-out':S('Layered cut paper','Layered paper cut-out art: every shape is cut from flat colored card stacked in layers, with soft drop shadows between layers and visible paper edges, photographed as a shadow-box.','photograph of real people, real fur, painting, 3D CGI'),
  'Felt / plush':S('Soft stitched fabric','Handmade felt and plush craft scene: characters and set sewn from soft felt and fabric, visible stitches and fuzzy fibers, photographed as a miniature set.','photorealistic people, real fur, painting, smooth CGI'),
  'Toy bricks':S('Built from plastic bricks','Everything built from colorful plastic toy building bricks, including the characters as brick minifigures, glossy studs visible, photographed as a toy brick model.','photorealistic people, real fur, painting, drawing'),
  'Isometric diorama':S('Tiny 3D world from above','Isometric 3D diorama: the scene as a tiny cube-shaped world seen from above at a 45-degree angle, clean miniature models, soft even lighting.','photograph, flat 2D, eye-level view, painting'),
  'Low-poly':S('Simple faceted 3D','Low-poly 3D render: simple faceted geometric shapes with flat-shaded triangles, limited colors, clean minimal lighting.','photograph, smooth detailed CGI, painting, realistic textures'),
  'Wood carving':S('Carved wooden figures','Hand-carved wooden diorama: the characters, the ground, the trees, the water and the mountains are all carved from wood, with visible grain and chisel marks, warm natural wood tones, photographed as a carving on a table.','real landscape, real grass, real water, photograph background, painting, plastic'),
  // Photo
  'Photographic':S('Looks like a real photo','Photorealistic photograph taken with a professional camera, natural light, real textures, fine detail, realistic proportions.','cartoon, illustration, anime, painting, drawing, 3D render, CGI'),
  'Human / realistic portrait':S('Close-up, real skin and light',"Realistic portrait photograph, close-up on the main person's face, natural skin texture, shallow depth of field, 85mm lens, soft flattering light.",'cartoon, illustration, anime, painting, 3D render, CGI'),
  'Cinematic film still':S('Movie frame, dramatic light','Cinematic film still: widescreen movie frame, dramatic lighting and color grading, shallow depth of field, real actors and locations, subtle film grain.','cartoon, illustration, anime, painting, 3D render'),
  'Black-and-white photo':S('Classic monochrome','Black-and-white photograph: classic monochrome film look, rich tonal range, real textures and light, no color.','color, cartoon, illustration, painting, 3D render'),
  'Vintage film photo':S('Faded, grainy, retro','Vintage film photograph from the 1970s: faded warm colors, visible film grain, slight light leaks, soft focus, real scene.','cartoon, illustration, painting, 3D render, crisp digital'),
  'Studio product shot':S('Clean background, crisp light','Studio photograph: the characters and key objects posed on a clean seamless studio backdrop in one solid color, crisp softbox lighting, sharp focus, no landscape and no outdoor background.','outdoor, landscape, scenery, lake, mountains, sky, cartoon, illustration, painting'),
  'Aerial / drone':S('Seen from above','Top-down aerial drone photograph taken from high above, looking straight down at the ground: the people and animals appear small, the land spreads out below, no horizon.','eye-level view, side view, close-up, horizon, cartoon, illustration, painting'),
  // Digital and retro
  'Pixel art':S('16-bit retro game','Pixel art in a 16-bit retro video game style, visible square pixels, limited color palette, crisp pixel edges.','smooth gradients, photorealistic, blurry, painting'),
  'Retro 80s synthwave':S('Neon grids and sunsets','Retro 1980s synthwave art: neon pink and cyan glow, a glowing grid horizon, a big striped sunset, chrome highlights, dark purple sky.','photograph, natural daylight, watercolor, muted colors'),
  'Neon cyberpunk':S('Glowing city at night','Neon cyberpunk scene at night: glowing neon signs, rain-soaked reflective streets, futuristic city, strong magenta and cyan light.','daylight, pastoral, watercolor, cartoon'),
  'Fantasy concept art':S('Epic painted world','Epic fantasy concept art: grand painterly digital landscape, dramatic light rays, rich atmosphere and depth, cinematic scale.','photograph, flat cartoon, pixel art, simple'),
  'Stained glass':S('Colored glass and lead lines','Stained glass window: the entire scene, including the characters, the animals, the ground, the water and the sky, is built from flat pieces of colored translucent glass joined by thick dark lead lines, with light glowing through the glass. No painted areas.','photograph, painted scene inside a frame, realistic shading, 3D render, soft gradients'),
  'Mosaic':S('Small tiles','Mosaic artwork: the whole scene made of small square stone and glass tiles with visible grout lines between them, like an ancient wall mosaic.','photograph, smooth painting, 3D render, cartoon outlines'),
  'Graffiti / street art':S('Spray paint on walls','The whole picture is a graffiti mural spray-painted on an old brick wall: the characters, the animals and the landscape are all painted in bold sprayed colors with drips, overspray and thick outlines, and the brick texture shows through the paint.','photograph of real people, real landscape beside a wall, graffiti lettering, watercolor, clean digital, 3D render'),
  'Sticker':S('Die-cut sticker look','Die-cut vinyl sticker design: bold cartoon shapes with a thick white border around the whole design, glossy finish, plain background.','photograph, painting, busy background, 3D render'),
  'Blueprint':S('White lines on blue','Technical blueprint drawing: every element, including the characters and the animals, is drawn only in thin white lines on a deep blue background, with measurement marks and a faint grid. No other colors.','orange, red, any color fills, photograph, painting, cartoon, shading'),
  'Infographic':S('Clean diagram style','Clean infographic poster: the scene drawn as flat icons and simple shapes, with short text labels, numbered callouts and arrows pointing to the characters and objects, a limited palette and a white background.','photograph, painting, 3D render, cluttered, realistic shading'),
  // Cultural
  'Indian miniature':S('Mughal and Rajput court painting','Indian miniature painting in the Mughal and Rajput tradition: fine detailed brushwork, flat perspective, rich jewel colors, gold accents and a decorative border.','photograph, 3D render, western cartoon, anime'),
  'Madhubani':S('Indian folk art from Bihar, bold patterns','Madhubani folk painting from Bihar, India: bold black outlines, every space filled with fine line patterns, bright natural colors, flat stylized figures, decorative border.','photograph, 3D render, realistic shading, anime'),
  'Warli':S('Indian tribal art, white figures on earth tones','Warli tribal painting from Maharashtra, India: every person and animal is a simple white stick figure made of circles and triangles, painted in white on a flat terracotta earth-brown background, with rhythmic dotted patterns. No realistic people or animals.','photograph, realistic people, realistic animals, color fills, 3D render, shading, tattoos'),
  'Ukiyo-e':S('Japanese woodblock print','Japanese ukiyo-e woodblock print: bold flowing outlines, flat areas of muted color, visible wood grain texture, stylized waves and clouds.','photograph, 3D render, western cartoon, gradients'),
  'Chinese ink wash':S('Brush and ink on rice paper','Chinese ink wash painting on rice paper: expressive black ink brush strokes, soft gray washes, lots of empty space, a touch of color.','photograph, 3D render, bright saturated color, cartoon outlines')};
 const GROUPS=[
  ['Popular',['Cartoon',"Children's storybook",'3D animation','Watercolor','Anime','Photographic','Comic book','Pixel art']],
  ['Illustration',['Cartoon',"Children's storybook",'Anime','Manga','Comic book','Classic 2D animation','Chibi / kawaii','Flat vector','Line art','Pencil sketch','Charcoal']],
  ['Painting',['Watercolor','Oil painting','Acrylic','Gouache','Pastel','Impressionist','Pop art','Art nouveau']],
  ['3D and craft',['3D animation','Clay / claymation','Origami','Paper cut-out','Felt / plush','Toy bricks','Isometric diorama','Low-poly','Wood carving']],
  ['Photo',['Photographic','Human / realistic portrait','Cinematic film still','Black-and-white photo','Vintage film photo','Studio product shot','Aerial / drone']],
  ['Digital and retro',['Pixel art','Retro 80s synthwave','Neon cyberpunk','Fantasy concept art','Stained glass','Mosaic','Graffiti / street art','Sticker','Blueprint','Infographic']],
  ['Cultural',['Indian miniature','Madhubani','Warli','Ukiyo-e','Chinese ink wash']]];
 // Pictures have no Story type, so suggestions follow the audience.
 const SUGGEST=[[/child|kid|toddler|pre-?school/i,["Children's storybook",'Cartoon','Watercolor']],[/teen/i,['Anime','Comic book','3D animation']],[/adult|all ages|everyone/i,['Photographic','Cinematic film still','Watercolor']]];
 const get=style=>STYLES[String(style||'').trim()]||null;
 // Style first, then the picture, then a reminder; unknown or free-text styles keep the old "Style: X." line.
 function prompt(text,style){const s=get(style);if(!s)return [text.trim(),style?'Style: '+style+'.':''].filter(Boolean).join('\n\n');return [s.lead,text.trim(),'The whole image is in this style.'].join('\n\n');}
 function negative(base,style){const s=get(style);return [String(base||'').trim(),s?.avoid||''].filter(Boolean).join(', ');}
 const suggestions=audience=>(SUGGEST.find(([re])=>re.test(String(audience||'')))||[,[]])[1];
 const el=(tag,props={},...kids)=>{const n=Object.assign(document.createElement(tag),props);n.append(...kids.filter(k=>k!=null));return n;};

 // The picker (owner-approved mock 2026-11-10): one dropdown; opened, Popular first, suggestions, search and 7 groups.
 // fill(panel,{value,audience,onPick}) draws the panel contents; the caller owns the trigger and opening/closing.
 function fill(panel,{value,audience,onPick,group='Popular'}){
  let current=group,query='';panel.classList.add('image-style-picker');
  const search=el('input',{type:'search',className:'image-style-search',placeholder:'Search '+Object.keys(STYLES).length+' styles, for example “paper” or “Indian”'});search.setAttribute('aria-label','Search image styles');
  const sug=el('div',{className:'image-style-suggest'}),nav=el('div',{className:'image-style-groups'}),list=el('div',{className:'image-style-list'}),body=el('div',{className:'image-style-body'},nav,list);
  nav.setAttribute('role','tablist');nav.setAttribute('aria-label','Style groups');
  const option=name=>{const b=el('button',{type:'button',className:'story-choice-option'},el('span',{className:'story-choice-name',textContent:name}),el('span',{className:'story-choice-description',textContent:STYLES[name].hint}));b.dataset.imageStyle=name;b.setAttribute('aria-pressed',String(name===value));b.onclick=()=>onPick(name);return b;};
  function draw(){
   const q=query.trim().toLowerCase(),names=q?Object.keys(STYLES).filter(n=>(n+' '+STYLES[n].hint).toLowerCase().includes(q)):GROUPS.find(([g])=>g===current)[1];
   sug.replaceChildren();const picks=q?[]:suggestions(audience);if(picks.length){sug.append(el('span',{className:'help',textContent:'Suggested for '+audience+':'}));for(const n of picks){const b=el('button',{type:'button',className:'secondary image-style-chip',textContent:n});b.dataset.imageStyle=n;b.onclick=()=>onPick(n);sug.append(b);}}
   sug.hidden=!picks.length;nav.hidden=!!q;nav.replaceChildren(...GROUPS.map(([g,items])=>{const b=el('button',{type:'button',role:'tab',className:'image-style-group'},el('span',{textContent:g}),el('small',{textContent:g==='Popular'?'':String(items.length)}));b.setAttribute('aria-selected',String(g===current));b.onclick=()=>{current=g;draw();};return b;}));
   list.replaceChildren(...(names.length?names.map(option):[el('p',{className:'help',textContent:'No style matches. Try another word.'})]));list.classList.toggle('image-style-wide',!!q);
  }
  search.oninput=()=>{query=search.value;draw();};
  panel.replaceChildren(search,sug,body);draw();
  // Open on the group that holds the current style.
  if(value&&!GROUPS[0][1].includes(value)){const g=GROUPS.find(([,items])=>items.includes(value));if(g){current=g[0];draw();}}
  return {search};
 }
 window.EccoImageStyles={names:Object.keys(STYLES),groups:GROUPS,get,prompt,negative,suggestions,fill};
})();
