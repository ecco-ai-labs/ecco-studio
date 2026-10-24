const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('storage-client.js','utf8');
const body=source.slice(source.indexOf(' async function connectSession(){'),source.indexOf(" document.addEventListener('ecco:auth-change'"));
function harness({role='tester',fail=false,owner=false}={}){
 const calls=[],values={authEpoch:0,key:owner?'owner-private-key':'',sessionMode:false,verified:false,errorShown:false};
 const context=vm.createContext({...values,window:{EccoAuth:{user:{id:'google:test'}}},sessionStorage:{getItem:()=> 'personal-session'},
 storageRequest:async(path,unused,token)=>{calls.push([path,token]);if(fail)throw Error('Not a member');return path==='workspace/access'?{role}:{records:[],config:{}};},
 refresh:async()=>calls.push(['refresh']),connectAudio:()=>calls.push(['audio']),
 document:{dispatchEvent:()=>calls.push(['event'])},Event:class{},notice:()=>calls.push(['denied']),
 disconnect:()=>calls.push(['disconnect']),navigate:()=>{throw Error('Must not navigate')}});
 vm.runInContext(body,context);return {context,calls};
}
test('authorized tester uses personal session only and stays on current screen',async()=>{
 const {context,calls}=harness();await context.connectSession();
 assert.equal(context.key,'personal-session');assert.equal(context.sessionMode,true);
 assert.deepEqual(calls.slice(0,2),[['workspace/access','personal-session'],['state','personal-session']]);
 assert(calls.some(c=>c[0]==='refresh'));
});
test('nonmember never receives workspace data or storage credentials',async()=>{
 const {context,calls}=harness({fail:true});await context.connectSession();
 assert.equal(context.key,'');assert.equal(context.sessionMode,false);
 assert.equal(calls.filter(c=>c[0]==='state').length,0);
});
test('existing owner connection is preserved',async()=>{
 const {context,calls}=harness({owner:true});await context.connectSession();
 assert.equal(context.key,'owner-private-key');assert.equal(calls.length,0);
});
test('late response after account change cannot authorize the old account',async()=>{
 const {context,calls}=harness();
 context.storageRequest=async()=>{context.authEpoch++;return {role:'tester'};};
 await context.connectSession();assert.equal(context.key,'');assert.equal(calls.length,0);
});
