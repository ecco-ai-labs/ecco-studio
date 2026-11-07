import assert from 'node:assert/strict';
import {JSDOM} from '../desk/node_modules/jsdom/lib/api.js';
const dom=new JSDOM('<!doctype html><body><section id="host"></section></body>',{url:'https://ecco-ai-labs.github.io/ecco-studio/desk/'});
for(const key of ['window','document','HTMLElement','Element','Node','Event','MouseEvent','KeyboardEvent','location','localStorage','sessionStorage','FormData'])globalThis[key]=dom.window[key];
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
const me={userId:'google:owner',name:'Test Admin',email:'owner@example.test',role:'admin',memberId:'m1'}, users=[{id:'google:alice',name:'Alice',email:'alice@example.test'}];
const data={me,tickets:[],members:[],users,activity:[],needsSetup:false};
let fail=true,posts=[],notices=[];
globalThis.fetch=async(url,options)=>{
 if(options.method==='POST'){
  const p=JSON.parse(options.body);posts.push(p);if(fail)return new Response(JSON.stringify({error:'Temporary failure'}),{status:503});
  if(p.op==='createNotification')notices.unshift({...p,id:'n1',createdAt:new Date().toISOString(),expiresAt:null,status:'active',readCount:0,recipientName:'Alice',recipientEmail:'alice@example.test'});
  if(p.op==='withdrawNotification')notices[0].status='withdrawn';
  return new Response(JSON.stringify({notificationVersion:1,id:'n1'}));
 }
 return new Response(JSON.stringify(String(url).includes('manageNotifications')?{notificationVersion:1,notifications:notices,users}:data));
};
localStorage.setItem('ecco-desk-staff-session','fixture-only');
const {mount}=await import('../desk/desk-app.mjs');
const host=document.querySelector('#host'),cleanup=mount(host,{onSignIn(){}}),tick=()=>new Promise(r=>setTimeout(r,35));
await tick();await tick();const root=host.shadowRoot;
const button=text=>[...root.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
button('User Notifications').click();await tick();await tick();
const form=root.querySelector('.notification-composer');assert(form);
assert.equal(form.elements.durationDays.value,'3');assert.equal(button('Create task'),undefined);assert.equal(root.querySelector('.metrics'),null);
const select=(name,value)=>{form.elements[name].value=value;form.elements[name].dispatchEvent(new Event('change',{bubbles:true}))};
select('audience','user');await tick();select('recipientId','google:alice');select('severity','error');select('lifetime','read');await tick();assert.equal(form.elements.durationDays,undefined);
form.elements.title.value='Account notice';form.elements.body.value='Only Alice sees this.';form.elements.title.focus();
form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await tick();
assert.match(root.querySelector('[role="alert"]').textContent,/Temporary failure/);assert.equal(form.elements.title.value,'Account notice');
assert.equal(posts[0].audience,'user');assert.equal(posts[0].recipientId,'google:alice');assert.equal(posts[0].durationDays,null);assert.equal(posts[0].severity,'error');
fail=false;form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();
assert.equal(posts[1].requestId,posts[0].requestId);assert.equal(form.elements.title.value,'');assert.equal(form.elements.audience.value,'all');assert.equal(form.elements.durationDays.value,'3');
assert(root.querySelector('.notification-history').textContent.includes('alice@example.test'));assert.match(root.querySelector('.notification-success').textContent,/published/);
button('Withdraw').click();await tick();await tick();assert(root.querySelector('.notification-history').textContent.includes('Withdrawn'));
cleanup();
const staffHost=document.createElement('section');document.body.append(staffHost);data.me={...me,role:'staff'};const cleanStaff=mount(staffHost,{onSignIn(){}});await tick();await tick();assert(!staffHost.shadowRoot.textContent.includes('User Notifications'));cleanStaff();
console.log('PASS: admin tab, recipient/severity/duration, failure retains draft, idempotent retry, reset, history, withdrawal, staff restriction.');
