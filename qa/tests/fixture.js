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
  if(['fiction','clarification','cast'].includes(sourceFit))Object.defineProperty(window.EccoAI,'enabled',{get:()=>true});
  window.__qaCalls=[];
  api=async(path,body)=>{
    window.__qaCalls.push({path,body});
    if(path==='state')return state;
    if(sourceFit==='cast'&&path==='ai/enhance'){
      const id=body.fields?.[0]?.id,story={characters:[
        {id:'n',name:'Narrator',role:'Narration',gender:'Female',age_group:'Adult',language:'English',dialect:'Indian English',style:'Warm',emotion:'neutral',delivery:'Clear and measured.'},
        {id:'a',name:'Ali',role:'Woodcutter',gender:'Male',age_group:'Adult',language:'English',dialect:'Indian English',style:'Curious',emotion:'surprise',delivery:'Bright and expressive.',appearance:'A woodcutter wearing a blue tunic.'},
        {id:'m',name:'Morgiana',role:'Resourceful helper',gender:'Female',age_group:'Adult',language:'English',dialect:'Indian English',style:'Confident',emotion:'neutral',delivery:'Calm and decisive.',appearance:'A woman carrying a lantern.'}
      ],segments:[{character_id:'n',text:'At the cave.'},{character_id:'a',text:'Open sesame!'},{character_id:'m',text:'I will help.'}],reason:'Narration and two distinct speaking roles.'};
      if(id==='source_excerpt')return {revisions:[{id,text:'Narrator: At the cave.\n\nAli: Open sesame!\n\nMorgiana: I will help.'}]};
      if(id==='source_compatibility')return {revisions:[{id,text:JSON.stringify({verdict:'match',source_kind:'Storybook',reason:'The selected scene matches the storybook.'})}]};
      if(id==='story_workspace')return {revisions:[{id,text:JSON.stringify(story)}]};
    }
    if(['fiction','clarification','cast'].includes(sourceFit)&&path==='ai/enhance'){const id=body.fields?.[0]?.id;if(id==='source_excerpt'&&sourceFit==='clarification')return body.context.instructions.includes('User selected this answer')?{questions:[],notes:[],revisions:[{id,text:body.context.instructions.includes('User selected this answer to the clarification: Set burial count to 38')?'Thirty-nine jars held one jar of oil and thirty-eight robbers. They buried thirty-eight robbers.':'Thirty-nine jars hid thirty-nine robbers. The oil was stored separately.'}]}:{questions:['With 39 jars total and one holding oil, only 38 can hide robbers, but the source later buries 39 robbers. Should the burial count be 38, or should the oil be stored separately?'],notes:['Recommendation: Keep the stated jar total and oil location; change the burial count to 38.','Recommended choice: Set burial count to 38','Choice: Store oil separately'],revisions:[{id,text:'Thirty-nine jars stood ready, one holding oil. Later, thirty-nine robbers were buried.'}]};if(id==='source_excerpt')return {revisions:[{id,text:'Alibaba discovered a hidden cave.'}]};if(id==='source_compatibility')return {revisions:[{id,text:JSON.stringify({verdict:'mismatch',source_kind:'Fictional storybook',reason:'This is fiction about Alibaba, not a sports news report.'})}]};}
    if(path==='stories'){
      const record={id:'qa-created-'+window.__qaCalls.length,kind:'story',created:1700000000,...body};
      state.records.push(record);return record;
    }
    throw Error('QA fixture: '+path+' is not configured; no real action was submitted.');
  };
  refresh=async()=>true;
  Object.defineProperty(window.EccoStorage,'ready',{get:()=>true});
  storyControls();
  window.__qaReady=true;
})();
