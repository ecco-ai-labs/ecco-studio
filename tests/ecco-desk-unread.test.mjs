import assert from 'node:assert/strict';
import {JSDOM} from '../desk/node_modules/jsdom/lib/api.js';
const dom=new JSDOM('<!doctype html><body><section id="host"></section></body>',{url:'https://ecco-ai-labs.github.io/ecco-studio/desk/'});
for(const key of ['window','document','HTMLElement','Element','Node','Event','MouseEvent','KeyboardEvent','location','localStorage','sessionStorage','FormData'])globalThis[key]=dom.window[key];
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
let focused=true,hidden=false,visible=false,poll;
document.hasFocus=()=>focused;
Object.defineProperty(document,'visibilityState',{get:()=>hidden?'hidden':'visible'});
dom.window.HTMLElement.prototype.getBoundingClientRect=function(){return this.classList?.contains('reply-read-marker')?{top:visible?100:700,bottom:visible?101:701,height:1}:{top:0,bottom:500,height:500}};
const nativeInterval=globalThis.setInterval;
globalThis.setInterval=(fn,ms)=>{if(ms===10000)poll=fn;return 1};globalThis.clearInterval=()=>{};
const me={userId:'alice',name:'Alice',email:'alice@example.test',role:'customer',memberId:null};
const tickets=[1,2].map(id=>({id,type:'support',title:`Issue ${id}`,description:'Please help',reporterId:'alice',reporterName:'Alice',status:'open',priority:'normal',category:'General',version:1}));
const comments={1:[{id:'reply1',authorName:'Support',body:'First response',visibility:'public',channel:'email'}],2:[{id:'reply2',authorName:'Support',body:'Second response',visibility:'public',channel:'email'}]};
let unread={1:1,2:1},calls=[],holdRead=false,finishRead;
const notification=()=>({unreadTickets:Object.values(unread).filter(Boolean).length,unreadByTicket:{...unread}});
globalThis.fetch=async(url,options)=>{
 const p=options.body?JSON.parse(options.body):null;calls.push(p||{url});
 if(p?.op==='closeIssue'||p?.op==='reopenIssue'){const ticket=tickets[p.id-1];assert.equal(p.version,ticket.version);ticket.status=p.op==='closeIssue'?'closed':'open';ticket.version++;return new Response(JSON.stringify({ticket}));}
 if(p?.op==='readTicket'){
  const finish=()=>{unread[p.id]=comments[p.id].at(-1).id===p.through?0:1;return new Response(JSON.stringify(notification()))};
  if(holdRead)return new Promise(resolve=>{finishRead=()=>resolve(finish())});
  return finish();
 }
 const id=new URL(url).searchParams.get('ticket');
 if(id)return new Response(JSON.stringify({ticket:tickets[id-1],comments:comments[id],events:[],readThrough:comments[id].at(-1).id}));
 return new Response(JSON.stringify({me,tickets,members:[],users:[],activity:[],needsSetup:false,...notification()}));
};
const tick=()=>new Promise(r=>setTimeout(r,35));
sessionStorage.setItem('ecco-user-session','fixture');
localStorage.setItem('ecco-desk-staff-session','staff-fixture');
const {mount}=await import('../desk/desk-app.mjs');
const host=document.querySelector('#host'),cleanup=mount(host,{portalOnly:true,embedded:true});
await tick();await tick();const root=host.shadowRoot;
const open=id=>root.querySelector(`[aria-label="Open SUP-000${id}"]`).click();
const scroll=()=>root.querySelector('.drawer-scroll').dispatchEvent(new Event('scroll'));
const marked=()=>[...root.querySelectorAll('tr.has-support-reply')].map(r=>r.textContent);
assert.equal(marked().length,2);assert(root.textContent.includes('Support replied'));
open(1);await tick();await tick();assert(!calls.some(p=>p?.op==='readTicket'));assert(root.querySelector('.detail-tabs').textContent.includes('New reply'));
// Loading and polling an open ticket must not consume a reply below the fold.
poll();await tick();await tick();assert(!calls.some(p=>p?.op==='readTicket'));
visible=true;hidden=true;scroll();await tick();assert(!calls.some(p=>p?.op==='readTicket'));
hidden=false;focused=false;window.dispatchEvent(new Event('focus'));await tick();assert(!calls.some(p=>p?.op==='readTicket'));
focused=true;scroll();await tick();await tick();assert.equal(calls.filter(p=>p?.op==='readTicket').length,1);
assert.equal(marked().length,1);assert(marked()[0].includes('Issue 2'));assert(!root.querySelector('.detail-tabs').textContent.includes('New reply'));
root.querySelector('[aria-label="Close ticket"]').click();await tick();visible=false;open(2);await tick();await tick();
// A newer reply arriving while acknowledgement is pending stays unread.
holdRead=true;visible=true;scroll();await tick();visible=false;
comments[2].push({id:'reply3',authorName:'Support',body:'Newer response',visibility:'public',channel:'email'});unread[2]=2;
finishRead();await tick();await tick();poll();await tick();await tick();
assert.equal(marked().length,1);assert(root.querySelector('.detail-tabs').textContent.includes('New reply'));
assert(!calls.some(p=>p?.through==='reply3'));
// Viewing History never clears an unseen conversation.
[...root.querySelectorAll('.detail-tabs button')].find(b=>b.textContent==='History').click();await tick();visible=true;scroll();await tick();assert(!calls.some(p=>p?.through==='reply3'));
holdRead=false;[...root.querySelectorAll('.detail-tabs button')].find(b=>b.textContent.startsWith('Conversation')).click();await tick();await tick();
assert.equal(marked().length,0);assert(calls.some(p=>p?.through==='reply3'));
const conversationBefore=root.querySelector('.comments').textContent;
[...root.querySelectorAll('button')].find(b=>b.textContent.trim()==='Close issue').click();await tick();await tick();
assert.equal(tickets[1].status,'closed');assert([...root.querySelectorAll('button')].some(b=>b.textContent.trim()==='Reopen issue'));
assert.equal(root.querySelector('.comments').textContent,conversationBefore);
[...root.querySelectorAll('button')].find(b=>b.textContent.trim()==='Reopen issue').click();await tick();await tick();assert.equal(tickets[1].status,'open');
cleanup();dom.window.close();globalThis.setInterval=nativeInterval;
console.log('PASS: exact-ticket indicators, off-screen/background/history isolation, visible-read clearing and newer-reply race.');
