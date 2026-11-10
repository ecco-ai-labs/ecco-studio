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
  if(['fiction','clarification','cast','castRetry','audioPreview','drafts','picture'].includes(sourceFit))Object.defineProperty(window.EccoAI,'enabled',{get:()=>true});
  window.__qaCalls=[];
  api=async(path,body)=>{
    window.__qaCalls.push({path,body});
    if(window.__qaHold&&path==='ai/enhance')await window.__qaHold;
    if(path==='state')return state;
    if(['audioPreview','castRetry'].includes(sourceFit)&&path==='ai/enhance'&&body.fields?.[0]?.id==='audio_directed_script'){
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
    if(path==='stories'){
      const record={id:'qa-created-'+window.__qaCalls.length,kind:'story',created:1700000000,...body};
      state.records.push(record);return record;
    }
    throw Error('QA fixture: '+path+' is not configured; no real action was submitted.');
  };
  refresh=async()=>true;
  Object.defineProperty(window.EccoStorage,'ready',{get:()=>true});
  if(['audioPreview','castRetry'].includes(sourceFit)){
    const jobs=new Map();let sampleURL;
    window.EccoAudioStudio.connect({storageIndependentOfGPU:true,
      status:async()=>({routing_version:1,compute:{cpu:{ready:true,models:['indic-mio'],character_controls_version:1,mixed_models_version:1,long_form_version:1}}}),list:async()=>[],
      generate:async body=>{window.__qaCalls.push({path:'audio/generate',body});const id='qa-audio-job-'+(jobs.size+1);jobs.set(id,{body,polls:0});return{id,status:'queued',media:'audio',kind:'audio_job',story_id:body.story_id};},
      job:async id=>{const job=jobs.get(id);job.polls++;return{id,status:job.body.title.startsWith('Voice preview')&&job.polls>1?'done':'running',asset_id:'qa-preview'};},
      mediaURL:async()=>sampleURL||(sampleURL=URL.createObjectURL(await(await fetch('/qa/fixtures/sample.wav')).blob())),download:async()=>{}
    });
  }
  storyControls();
  window.__qaReady=true;
})();
