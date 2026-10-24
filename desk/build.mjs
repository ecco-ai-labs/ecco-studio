import {build} from 'esbuild';
await build({entryPoints:['src/entry.tsx'],outfile:'desk-app.mjs',bundle:true,minify:true,format:'esm',target:'es2022',jsx:'automatic',loader:{'.css':'text'},define:{'process.env.NODE_ENV':'"production"'},legalComments:'external'});
