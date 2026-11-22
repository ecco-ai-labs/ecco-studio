/* The production HTML/CSS/JS runs unchanged; only service data is synthetic. */
(() => {
  const records=[
    {id:'qa-story',kind:'story',title:'QA Sample Story',created:1700000000},
    {id:'qa-workflow',kind:'workflow',name:'QA Sample Workflow',created:1700000000},
    ...['image','audio','video'].flatMap((media,i)=>[0,1].map(n=>({
      id:`qa-${media}-${n}`,kind:'asset',media,stage:'prod',story_id:'qa-story',
      title:`${n?'Zebra':'Alpha'} ${media} sample`,prompt:`Synthetic ${media} fixture`,
      path:`qa/fixtures/sample.${media==='image'?'svg':media==='audio'?'wav':'mp4'}`,
      created:1700000000+n*1000+i,size_bytes:2048,duration:1,settings:{model:'qa-fixture',width:160,height:90,steps:20}
    })))
  ];
  state={records,config:{models_ready:{},storage:{volume:'qa-fixture'}},storage_pending:false};
  for(const item of records.filter(r=>r.kind==='asset'))mediaCache.set(item.id,'/'+item.path);
  const sourceFit=new URLSearchParams(location.search).get('sourceFit');
  if(['fiction','clarification','cast','castRetry','audioPreview','audioDone','drafts','picture'].includes(sourceFit))Object.defineProperty(window.EccoAI,'enabled',{get:()=>true});
  window.__qaCalls=[];
  api=async(path,body)=>{
    window.__qaCalls.push({path,body});
    if(window.__qaHold&&path==='ai/enhance')await window.__qaHold;
    if(path==='state')return state;
    // Audio Queue (final mocks, 21 Nov 2026): tests set window.qaAudioQueue; Cancel is /api/generation/stop.
    if(path.startsWith('audio/queue?')){const q=window.qaAudioQueue||{items:[],models:[]},p=new URLSearchParams(path.split('?')[1]),items=q.items.filter(x=>(!p.get('model')||x.model===p.get('model'))&&(!p.get('search')||x.name.toLowerCase().includes(p.get('search').toLowerCase())));
     return {items,total:items.length,parallel:2,offset:0,limit:50,models:q.models||[...new Set(q.items.map(x=>x.model))],reorder:false,mine:{waiting:q.items.length,running:q.running||0,done:q.done||0},last_wait_seconds:q.items.length*60};}
    if(path==='generation/stop'&&window.qaAudioQueue){window.qaAudioQueue.items=window.qaAudioQueue.items.filter(x=>x.id!==body.job_id);return {status:'cancelled'};}
    // Create Images: synthetic jobs finish at once; nothing reaches a GPU.
    if((path==='images'||path==='image-edits'||path==='image-resize'||path==='image-upscale')&&!window.qaImageRequests){
      const n=window.__qaCalls.length,asset={id:'qa-made-'+n,kind:'asset',media:'image',stage:'dev',story_id:body.story_id,title:({images:'Generated ','image-resize':'Reshaped ','image-upscale':'4K '}[path]||'Edited ')+n,prompt:body.prompt,settings:path==='image-resize'?{resize:body.size}:path==='image-upscale'?{upscale:'3840x2160'}:undefined,path:'qa/fixtures/sample.svg',job_id:'qa-job-'+n,created:1700001000+n};
      state.records.push(asset,{id:'qa-job-'+n,kind:'job',status:'done',result:asset.id,created:1700001000+n});mediaCache.set(asset.id,'/'+asset.path);return {id:'qa-job-'+n,status:'queued'};
    }
    if(path==='ai/enhance'&&body.fields?.[0]?.id==='image_enhancement'){
      const ref=state.records.find(r=>r.id===body.reference_ids?.[0]),type=/zebra/i.test(ref?.title||'')?'animal':'person';
      return {revisions:[{id:'image_enhancement',text:JSON.stringify({type,suggestions:type==='animal'?[{key:'fur_color',value:'Silver'}]:[{key:'hair_color',value:'Auburn'},{key:'age',value:'Younger'}]})}],notes:[],questions:[]};
    }
    if(path==='approve'){const r=state.records.find(x=>x.id===body.asset_id);if(r)r.stage='prod';return r;}
    if(path==='library/folders'){const f={id:'qa-folder-'+window.__qaCalls.length,kind:'image_folder',name:body.name,created:1700000000};state.records.push(f);return f;}
    if(path==='library/save'){const l={id:'qa-item-'+window.__qaCalls.length,kind:'library_item',asset_id:body.asset_id,folder_id:body.folder_id};state.records.push(l);return l;}
    if(['audioPreview','castRetry','audioDone'].includes(sourceFit)&&path==='ai/enhance'&&body.fields?.[0]?.id==='audio_directed_script'){
      const draft=JSON.parse(body.context.summary).draft,part=p=>({...p,performance:{emotion:'neutral',direction:'Clear speech.',pause_before:0}});
      return {revisions:[{id:'audio_directed_script',text:JSON.stringify({...draft,opening:draft.opening?part(draft.opening):null,segments:draft.segments.map(part),expressiveness:null})}]};
    }

    if(sourceFit==='picture'&&path==='ai/enhance'&&body.fields?.[0]?.id==='picture_description'){const n=window.__qaCalls.filter(c=>c.body?.fields?.[0]?.id==='picture_description').length;return {revisions:[{id:'picture_description',text:'Picture '+n+': '+body.fields[0].text+', '+JSON.parse(body.context.summary).image_style+'.'}]};}
    if(sourceFit==='drafts'&&path==='ai/enhance'&&body.fields?.[0]?.id==='source_excerpt'){const n=window.__qaCalls.filter(c=>c.body?.fields?.[0]?.id==='source_excerpt').length;return {revisions:[{id:'source_excerpt',text:'Version '+n+' of the cave story.'}]};}
    if(['cast','castRetry'].includes(sourceFit)&&path==='ai/enhance'){
      const id=body.fields?.[0]?.id,story={characters:[
        {id:'n',name:'Narrator',role:'Narration',gender:'Female',age_group:'Adult',language:'English',dialect:'Indian English',style:'Warm',emotion:'neutral',delivery:'Clear and measured.'},
        {id:'a',name:'Ali',role:'Woodcutter',gender:'Male',age_group:'Adult',language:'English',dialect:'Indian English',style:'Curious',personality:'Brave and kind',emotion:'surprise',delivery:'Bright and expressive.',appearance:'A woodcutter wearing a blue tunic.'},
        {id:'m',name:'Morgiana',role:'Resourceful helper',gender:'Female',age_group:'Adult',language:'English',dialect:'Indian English',style:'Confident',emotion:'neutral',delivery:'Calm and decisive.',appearance:'A woman carrying a lantern.'}
      ],segments:[{character_id:'n',text:'At the cave.'},{character_id:'a',text:'Open sesame!'},{character_id:'m',text:'I will help.'}],reason:'Narration and two distinct speaking roles.'};
      if(id==='source_excerpt')return {revisions:[{id,text:'Narrator: At the cave.\n\nAli: Open sesame!\n\nMorgiana: I will help.'}]};
      if(id==='source_compatibility')return {revisions:[{id,text:JSON.stringify({verdict:'match',source_kind:'Storybook',reason:'The selected scene matches the storybook.'})}]};
      if(id==='story_workspace'){
        const context=JSON.parse(body.context.summary),units=context.source_units;
        if(units){
          const failFirst=sourceFit==='castRetry'&&window.__qaCalls.filter(c=>c.body?.fields?.[0]?.id==='story_workspace').length===1;
          const names=[...new Set(units.map(u=>u.label).filter(Boolean))];
          for(const name of names)if(!story.characters.some(c=>c.name===name))story.characters.push({id:'label-'+name,name,role:'Speaker',language:'English',emotion:'neutral'});
          if(failFirst)story.characters=[story.characters[0]];
          story.assignments=units.map(u=>({unit_id:u.id,character_id:failFirst?'n':u.label?story.characters.find(c=>c.name===u.label).id:u.dialogue?(u.text.includes('sesame')?'a':'m'):'n'}));delete story.segments;
        }
        return {revisions:[{id,text:JSON.stringify(story)}],questions:window.__qaAsk?['Should the saved title be retained?']:[]};
      }
    }
    if(sourceFit==='fiction'&&path==='ai/enhance'&&body.fields?.[0]?.id==='story_workspace'){const units=JSON.parse(body.context.summary).source_units||[];return{revisions:[{id:'story_workspace',text:JSON.stringify({characters:[{id:'n',name:'Narrator'}],assignments:units.map(u=>({unit_id:u.id,character_id:'n'}))})}]};}
    if(['fiction','clarification','cast'].includes(sourceFit)&&path==='ai/enhance'){const id=body.fields?.[0]?.id;if(id==='source_excerpt'&&sourceFit==='clarification')return body.context.instructions.includes('User selected this answer')?{questions:[],notes:[],revisions:[{id,text:body.context.instructions.includes('User selected this answer to the clarification: Set burial count to 38')?'Thirty-nine jars held one jar of oil and thirty-eight robbers. They buried thirty-eight robbers.':'Thirty-nine jars hid thirty-nine robbers. The oil was stored separately.'}]}:{questions:['With 39 jars total and one holding oil, only 38 can hide robbers, but the source later buries 39 robbers. Should the burial count be 38, or should the oil be stored separately?'],notes:['Recommendation: Keep the stated jar total and oil location; change the burial count to 38.','Recommended choice: Set burial count to 38','Choice: Store oil separately'],revisions:[{id,text:'Thirty-nine jars stood ready, one holding oil. Later, thirty-nine robbers were buried.'}]};if(id==='source_excerpt')return {revisions:[{id,text:'Alibaba discovered a hidden cave.'}]};if(id==='source_compatibility')return {revisions:[{id,text:JSON.stringify({verdict:'mismatch',source_kind:'Fictional storybook',reason:'This is fiction about Alibaba, not a sports news report.'})}]};}
    if(sourceFit==='picture'&&path.startsWith('media/qa-photo-'))return {buffer:Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0)).buffer,mime:'image/png'};
    if(sourceFit==='picture'&&path==='images/upload'){const record={id:'qa-photo-'+window.__qaCalls.length,kind:'asset',media:'image',stage:'dev',story_id:body.story_id,title:body.name,prompt:body.name,path:'qa/fixtures/sample.svg',settings:{model:'uploaded-image'},created:1700000000};state.records.push(record);return record;}
    // Voice Studio: synthetic voices and jobs; nothing reaches the storage server or an audio worker.
    if(path==='audio/status')return {routing_version:1,instances:[],compute:{a100:{ready:true,models:['qwen3-tts','voxcpm2','indic-parler','indicf5','chatterbox']}}};
    {
      const v=window.__qaVoice||(window.__qaVoice={jobs:new Map(),n:0});
      const asset=(extra)=>{v.n++;const a={id:'qa-voice-'+v.n,kind:'asset',media:'audio',stage:'prod',title:'Voice '+v.n,path:'qa/fixtures/sample.wav',seconds:12,duration:12,created:1700002000+v.n,...extra};state.records.push(a);mediaCache.set(a.id,'/'+a.path);return a;};
      if(path==='audio/upload')return asset({title:body.name,source:'upload'});
      if(path==='audio/voices/create'){const a=asset({title:body.character+' · default',voice_reference:{character:body.character,emotion:'default',source:body.source,consent:body.consent,source_asset_id:body.asset_id}});return {id:a.id,...a.voice_reference};}
      if(path==='audio/voices/design'||(path==='audio/generate'&&!window.EccoAudioStudio?.connected)){const id='qa-voice-job-'+(v.jobs.size+1);v.jobs.set(id,{path,body});return {id,status:'queued'};}
      if(path.startsWith('audio/jobs/')){
       const job=v.jobs.get(decodeURIComponent(path.slice(11)));if(!job)throw Error('QA fixture: unknown audio job');
       if(job.path==='audio/voices/design'){const a=asset({title:job.body.character+' · default (designed voice)',source:'generated',voice_reference:{character:job.body.character,emotion:'default',language:job.body.language,description:job.body.description,source:'designed'}});return {status:'done',asset_id:a.id,voice_reference_id:a.id};}
       const a=asset({title:job.body.title,source:'generated'});return {status:'done',asset_id:a.id};
      }
      if(path==='audio/folders'){const f={id:'qa-audio-folder-'+window.__qaCalls.length,kind:'audio_folder',name:body.name,created:1700000000};state.records.push(f);return f;}
      if(path==='audio/labels'){for(const folder_id of body.folder_ids)state.records.push({id:'qa-audio-item-'+window.__qaCalls.length+'-'+folder_id,kind:'library_item',asset_id:body.asset_id,folder_id});const a=state.records.find(r=>r.id===body.asset_id);if(a)a.title=body.title;return a;}
    }
    if(path==='stories'){
      const record={id:'qa-created-'+window.__qaCalls.length,kind:'story',created:1700000000,...body};
      state.records.push(record);return record;
    }
    throw Error('QA fixture: '+path+' is not configured; no real action was submitted.');
  };
  refresh=async()=>true;
  Object.defineProperty(window.EccoStorage,'ready',{get:()=>true});
  if(['audioPreview','castRetry','audioDone'].includes(sourceFit)){
    const jobs=new Map();let sampleURL;
    window.EccoAudioStudio.connect({storageIndependentOfGPU:true,
      status:async()=>({routing_version:1,compute:{cpu:{ready:true,models:['indic-mio'],character_controls_version:1,mixed_models_version:1,long_form_version:1}}}),
      // audioDone: a recording finishes after two polls, so Story Generation can be reviewed.
      list:async({story_id}={})=>[...jobs.entries()].filter(([,j])=>j.done&&j.body.story_id===story_id).map(([id,j])=>({id:'qa-recording-'+id,media:'audio',kind:'asset',stage:'dev',story_id,title:j.body.title||'Recording',created:1700000100+j.polls,duration:4})),
      generate:async body=>{window.__qaCalls.push({path:'audio/generate',body});const id='qa-audio-job-'+(jobs.size+1);jobs.set(id,{body,polls:0});return{id,status:'queued',media:'audio',kind:'audio_job',story_id:body.story_id};},
      job:async id=>{const job=jobs.get(id);job.polls++;const preview=job.body.title.startsWith('Voice preview');if(sourceFit==='audioDone'&&!preview&&window.__qaAudioFail)return{id,status:'failed',error:window.__qaAudioFail,progress:'Generating speech · 0 of 2 passages complete'};if(sourceFit==='audioDone'&&!preview){if(job.polls>2)job.done=true;return{id,status:job.done?'done':'running',progress:job.done?'Audio saved.':'Generating speech · 1 of 2 passages complete',asset_id:'qa-recording-'+id};}return{id,status:preview&&job.polls>1?'done':'running',asset_id:'qa-preview'};},
      mediaURL:async()=>sampleURL||(sampleURL=URL.createObjectURL(await(await fetch('/qa/fixtures/sample.wav')).blob())),download:async()=>{}
    });
  }
  storyControls();
  window.__qaReady=true;
})();
