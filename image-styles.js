'use strict';
// Image styles (owner request 2026-11-10): Qwen-Image follows a style only when it is described first and in detail.
// Checked on Serverless with Qwen-Image 2512: "Style: X." at the end was ignored for Cartoon, Origami and Clay.
// lead goes before the picture description; avoid becomes the negative prompt.
(()=>{
 const STYLES={
  'Cartoon':{lead:"Flat 2D cartoon illustration with bold clean black outlines, simple rounded shapes, bright flat colors and cel shading, like a children's animated TV show.",avoid:'photorealistic, photograph, 3D render, realistic lighting, painterly, watercolor, oil painting'},
  '3D animation':{lead:'3D animated feature film still: stylized CGI characters with soft rounded features and expressive faces, soft global illumination, rich color.',avoid:'flat 2D, photograph, sketch, painting, watercolor, oil painting, pixel art'},
  'Origami':{lead:'Origami paper-craft diorama: every element, including the characters, the ground, the sky and every object, is made of folded colored paper with crisp creases and visible paper texture, photographed as a miniature studio set.',avoid:'photograph of real people, real animal fur, painting, cartoon outlines'},
  'Clay / claymation':{lead:'Stop-motion claymation scene: the characters and the whole set are handmade from plasticine modeling clay, with visible fingerprints, tool marks and slightly lumpy shapes, soft studio lighting on a miniature set.',avoid:'photorealistic, real fur, smooth CGI, painting, drawing'},
  'Human / realistic portrait':{lead:'Realistic portrait photograph, close-up on the main person\'s face, natural skin texture, shallow depth of field, 85mm lens, soft flattering light.',avoid:'cartoon, illustration, anime, painting, 3D render, CGI'},
  'Photographic':{lead:'Photorealistic photograph taken with a professional camera, natural light, real textures, fine detail, realistic proportions.',avoid:'cartoon, illustration, anime, painting, drawing, 3D render, CGI'},
  'Anime':{lead:'Japanese anime illustration, cel-shaded with clean line art, large expressive eyes, vibrant colors and painted anime film background art.',avoid:'photorealistic, photograph, 3D render, western cartoon, watercolor, oil painting'},
  'Watercolor':{lead:'Watercolor painting on textured paper, soft translucent washes, visible brush strokes, colors bleeding at the edges, white paper showing through.',avoid:'photorealistic, photograph, 3D render, sharp digital lines, cartoon outlines, oil painting'},
  'Oil painting':{lead:'Classical oil painting on canvas, thick visible brush strokes and impasto, rich layered pigments, visible canvas texture.',avoid:'photograph, 3D render, flat cartoon, smooth digital art'},
  'Pixel art':{lead:'Pixel art in a 16-bit retro video game style, visible square pixels, limited color palette, crisp pixel edges.',avoid:'smooth gradients, photorealistic, blurry, painting'}};
 const get=style=>STYLES[String(style||'').trim()]||null;
 // Style first, then the picture, then a reminder; unknown or free-text styles keep the old "Style: X." line.
 function prompt(text,style){const s=get(style);if(!s)return [text.trim(),style?'Style: '+style+'.':''].filter(Boolean).join('\n\n');return [s.lead,text.trim(),'The whole image is in this style.'].join('\n\n');}
 function negative(base,style){const s=get(style);return [String(base||'').trim(),s?.avoid||''].filter(Boolean).join(', ');}
 window.EccoImageStyles={names:Object.keys(STYLES),get,prompt,negative};
})();
