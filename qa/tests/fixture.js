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
  window.__qaCalls=[];
  api=async(path,body)=>{
    window.__qaCalls.push({path,body});
    if(path==='state')return state;
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
