export type Mode='ux'|'workflow'|'sweep';
export const workflows=[['libraries','All libraries'],['video','Video Library'],['image','Image Library'],['audio','Audio Library'],['story','Story entry and navigation'],['drive','Workspace Drive']] as const;
export type TestOption={id:string;label:string};
export type TestGroup={id:string;label:string;tests:TestOption[]};
export function testPlan(mode:Mode,workflow:string):TestGroup[]{
 const kinds=mode==='workflow'?(workflow==='libraries'?['story','image','audio','video','workflow']:['image','audio','video'].includes(workflow)?[workflow]:[]):['story','image','audio','video','workflow'];
 const groups:TestGroup[]=kinds.map(kind=>({id:kind,label:kind[0].toUpperCase()+kind.slice(1)+' Library',tests:[
  ['nav','Open library'],['tabs','Story tabs stay hidden'],['views','View choices and default'],['columns','File columns'],['search','Search filtering'],['sort-ascending','Sort names A–Z'],['sort-descending','Sort names Z–A'],
  ['small',['image','video'].includes(kind)?'Small thumbnails':'Small icons'],['large',['image','video'].includes(kind)?'Large thumbnails':'Large icons'],
  ...(['ux','sweep'].includes(mode)?[['width-1440','Layout at 1440px'],['width-1024','Layout at 1024px'],['width-768','Layout at 768px']]:[])
 ].map(([id,label])=>({id:kind+'-'+id,label}))}));
 if(mode==='sweep'||mode==='workflow'&&workflow==='story')groups.unshift({id:'story-entry',label:'Story entry',tests:[{id:'story-choices',label:'Story entry choices'}]});
 if(mode==='sweep'||mode==='workflow'&&workflow==='drive')groups.push({id:'drive',label:'Workspace Drive',tests:[{id:'drive-search',label:'Search control'},{id:'drive-sort',label:'Sortable columns'}]});
 return groups;
}
export function agentTestPlan(steps:{mode:Mode;workflow:string}[]):TestGroup[]{
 return steps.flatMap((s,i)=>testPlan(s.mode,s.workflow).map(g=>({id:`step-${i+1}/${g.id}`,label:`Step ${i+1} · ${g.label}`,tests:g.tests.map(t=>({...t,id:`step-${i+1}/${t.id}`}))})));
}
export function selectedTests(groups:TestGroup[],selected?:string[]):string[]{
 const all=groups.flatMap(g=>g.tests.map(t=>t.id));
 if(selected===undefined)return all;
 if(!Array.isArray(selected)||selected.some(id=>typeof id!=='string'||!all.includes(id)))throw Error('The test selection changed. Choose tests again.');
 return all.filter(id=>selected.includes(id));
}
