import assert from 'node:assert/strict';
import {JSDOM} from '../desk/node_modules/jsdom/lib/api.js';
const dom=new JSDOM('<!doctype html><body></body>',{url:'https://ecco-ai-labs.github.io/ecco-studio/desk/'});
for(const k of ['window','document','HTMLElement','HTMLTextAreaElement','Element','Node','Event','MouseEvent','KeyboardEvent','location','localStorage','sessionStorage','FormData'])globalThis[k]=dom.window[k];
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
document.hasFocus=()=>true;
Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});
const interval=globalThis.setInterval,clear=globalThis.clearInterval;
const polls=new Map();
globalThis.setInterval=(fn,ms)=>{if([1500,3000,10000].includes(ms)){polls.set(ms,fn);return ms}return interval(fn,ms)};
globalThis.clearInterval=id=>{if(typeof id==='number')polls.delete(id);else clear(id)};
Object.defineProperty(dom.window.HTMLElement.prototype,'scrollHeight',{get(){return 1000+(this.querySelectorAll?.('.comment').length||0)*100}});
Object.defineProperty(dom.window.HTMLElement.prototype,'clientHeight',{get(){return 400}});
const tick=(ms=35)=>new Promise(r=>setTimeout(r,ms));
let staff=false,fail=false,typing=null,posts=[],heldSend=null;
const ticket={id:1,type:'support',title:'Long conversation',description:'Test',reporterId:'customer',reporterName:'Customer',status:'open',priority:'normal',category:'General',version:1,assigneeId:'m1'};
let comments=Array.from({length:30},(_,i)=>({id:'msg'+i,authorName:'Agent',body:'Message '+i,visibility:'public',channel:'chat'}));
const me=()=>staff?{userId:'agent',name:'Agent',role:'staff',memberId:'m1'}:{userId:'customer',name:'Customer',role:'customer',memberId:null};
globalThis.fetch=async(url,opts)=>{
 const p=opts.body?JSON.parse(opts.body):null;
 if(p){
  posts.push(p);
  if(p.op==='chatTyping')assert.deepEqual(Object.keys(p).sort(),['id','op','typing']);
  if(p.op==='chatMessage'){
   if(fail)return new Response(JSON.stringify({error:'Temporary failure'}),{status:503});
   if(heldSend)await new Promise(resolve=>{heldSend=resolve});
   comments.push({id:'sent'+comments.length,authorName:me().name,body:p.body,visibility:'public',channel:'chat'});
  }
  return new Response(JSON.stringify({ok:true}));
 }
 if(String(url).includes('?ticket='))return new Response(JSON.stringify({ticket,comments,events:[],chat:{state:'live',open:true,hours:'7 AM–11:59 PM Pacific time, daily',assignedToMe:staff,agentName:'Agent',typing}}));
 return new Response(JSON.stringify({me:me(),tickets:[ticket],members:[{id:'m1',userId:'agent',name:'Agent',active:1}],users:[],activity:[],needsSetup:false}));
};
sessionStorage.setItem('ecco-user-session','fixture');localStorage.setItem('ecco-desk-staff-session','fixture');
const {mount}=await import('../desk/desk-app.mjs');
const change=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}))};
const button=(root,text)=>[...root.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
async function open(){const host=document.createElement('section');document.body.append(host);const cleanup=mount(host,{portalOnly:!staff,embedded:!staff});await tick();await tick();const root=host.shadowRoot;root.querySelector('.ticket-title').click();await tick();await tick();return {root,cleanup}}
let {root,cleanup}=await open();
let input=root.querySelector('[aria-label="Chat message"]'),scroller=root.querySelector('.drawer-scroll'),form=root.querySelector('.reply-box');
assert(form.parentElement===root.querySelector('.drawer'),'composer must be outside scroll container');
assert(!scroller.contains(form));assert(root.activeElement===input,'focus composer on open');
change(input,'Unsent draft');await tick();assert(posts.some(p=>p.op==='chatTyping'&&p.typing));
input.setSelectionRange(3,3);scroller.scrollTop=120;scroller.dispatchEvent(new Event('scroll'));
comments.push({id:'incoming',authorName:'Agent',body:'Incoming reply',visibility:'public'});
typing={name:'Agent',expiresInMs:8000};polls.get(1500)();await tick();await tick();
assert.equal(scroller.scrollTop,120,'incoming reply must preserve history reading position');
assert(root.activeElement===input);assert.equal(input.value,'Unsent draft');assert.equal(input.selectionStart,3);
assert.equal(root.querySelector('.typing-dots').children.length,3);assert(root.querySelector('.typing-indicator').textContent.includes('Agent is typing'));
// A failed send preserves the draft and focuses the same textbox.
fail=true;button(root,'Send chat').focus();form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();
assert.equal(input.value,'Unsent draft');assert(root.activeElement===input);assert.equal(posts.filter(p=>p.op==='chatTyping').at(-1).typing,false);
// New text typed while a send is pending must not be discarded with the old draft.
fail=false;heldSend=true;form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await tick();change(input,'Next message');await tick();heldSend();heldSend=null;await tick();await tick();
assert.equal(input.value,'Next message');assert(root.activeElement===input);assert.equal(scroller.scrollTop,scroller.scrollHeight);
// Typing stops after inactivity; stale incoming signals expire even without polling.
await tick(4200);assert.equal(posts.filter(p=>p.op==='chatTyping').at(-1).typing,false);
typing={name:'Agent',expiresInMs:80};polls.get(1500)();await tick();assert(root.querySelector('.typing-dots'));await tick(100);assert(!root.querySelector('.typing-dots'));
// Incoming updates do not steal focus from another control, including History.
button(root,'History').focus();button(root,'History').click();await tick();polls.get(1500)();await tick();assert(root.activeElement===button(root,'History'));assert(!root.querySelector('.reply-box'));
cleanup();
staff=true;posts=[];typing={name:'Customer',expiresInMs:8000};({root,cleanup}=await open());input=root.querySelector('[aria-label="Chat message"]');
assert(root.activeElement===input);assert(root.querySelector('.typing-indicator').textContent.includes('Customer is typing'));
change(input,'Agent draft');await tick();assert(posts.some(p=>p.op==='chatTyping'&&p.typing));
button(root,'Internal note').focus();button(root,'Internal note').click();await tick();
assert.equal(posts.filter(p=>p.op==='chatTyping').at(-1).typing,false);
const before=posts.length;change(root.querySelector('textarea'),'Private note draft');await tick();assert.equal(posts.length,before);
cleanup();dom.window.close();globalThis.setInterval=interval;globalThis.clearInterval=clear;
console.log('PASS: pinned composer, customer/staff focus, draft/caret retention, scroll preservation, typing privacy, inactivity/expiry, send failure and in-flight edits.');
