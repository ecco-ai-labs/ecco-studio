import assert from 'node:assert/strict';
import {JSDOM} from '../desk/node_modules/jsdom/lib/api.js';
const dom=new JSDOM('<!doctype html><body><section id="host"></section></body>',{url:'https://ecco-ai-labs.github.io/ecco-studio/desk/'});
for(const key of ['window','document','HTMLElement','Element','Node','Event','MouseEvent','KeyboardEvent','StorageEvent','location','localStorage','sessionStorage','FormData'])globalThis[key]=dom.window[key];
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});Object.defineProperty(navigator,'locks',{value:{request:async(_name,_options,callback)=>callback()}});
const me={userId:'google:customer',name:'QA Customer',email:'qa@example.invalid',role:'customer',memberId:null,notificationAdminGroup:'admins@example.invalid',notificationGroupStatus:'not_connected',canManageNotifications:false};
const finding={id:'issue-1',title:'Missing preview',severity:'high',status:'failed',expected:'Preview',actual:'Generic icon',steps:['Open Video Library','Select small icons']};
localStorage.setItem('ecco-tester-runs:v1:'+me.userId,JSON.stringify([{version:1,id:'customer-run',startedAt:'2026-11-07T12:00:00Z',status:'completed',source:'Test fixture',scope:'Video Library',checks:[finding],findings:[finding]}]));
localStorage.setItem('ecco-desk-staff-session','synthetic-session');
const data={me,tickets:[],members:[],users:[],activity:[],needsSetup:false,chatSupport:{open:false,hours:'7 AM–11:59 PM',availableAgents:0}};let posts=[],managementReads=0,groupStarts=0;
const popup={opener:'fixture',location:{href:''},close(){}};window.open=()=>popup;
globalThis.fetch=async(url,options)=>{
 if(String(url).endsWith('/notification-group/connect')){groupStarts++;assert.equal(options.headers.Authorization,'Bearer synthetic-workspace-key');assert.equal(options.body,'{}');return new Response(JSON.stringify({url:'https://accounts.google.com/o/oauth2/auth?fixture=1'}));}
 if(options.method==='POST'){const p=JSON.parse(options.body);posts.push(p);assert.equal(p.type,'support');assert.equal(p.assigneeId,null);const ticket={...p,id:1,status:'open',reporterId:me.userId};data.tickets.push(ticket);return new Response(JSON.stringify({ticket}));}
 if(String(url).includes('manageNotifications')){managementReads++;assert(me.canManageNotifications);return new Response(JSON.stringify({notificationVersion:1,notificationPresentationVersion:1,specialOfferVersion:1,notifications:[],users:[]}));}
 return new Response(JSON.stringify(data));
};
const {mount}=await import('../desk/desk-app.mjs'),host=document.querySelector('#host'),cleanup=mount(host),tick=()=>new Promise(r=>setTimeout(r,45));await tick();await tick();
const root=host.shadowRoot,button=text=>[...root.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
assert(button('Agents'),'Customer must see Agents');button('Agents').click();await tick();root.querySelector('.agent-card').click();await tick();
assert.equal(root.querySelector('h1').textContent,'Agents');assert(!root.querySelector('.support-hours'));assert(!root.querySelector('[aria-label="Assign findings to"]'));assert.equal(button('Run checks').disabled,false);
window.dispatchEvent(new StorageEvent('storage',{key:null,storageArea:sessionStorage}));await tick();assert(root.querySelector('.tester-agent'),'Studio session storage events must not reset Desk');
button('Create ticket').click();await tick();await tick();assert.equal(posts.length,1);assert.equal(posts[0].requestType,'Bug');assert.match(root.querySelector('.agent-ticket-link').textContent,/SUP-0001/);
root.querySelector('[aria-label="Refresh workspace"]').click();await tick();assert(root.querySelector('.tester-agent'),'Customer Agents view must survive refresh');
button('Notifications').click();await tick();assert(button('Connect Google'));assert.equal(managementReads,0);
button('Connect Google').click();await tick();assert.match(root.querySelector('[role=alert]').textContent,/connect.*Storage/);assert.equal(groupStarts,0);
localStorage.setItem('ecco-storage-access','synthetic-workspace-key');button('Connect Google').click();await tick();assert.equal(groupStarts,1);assert.equal(popup.opener,null);assert.match(popup.location.href,/^https:\/\/accounts.google.com\//);assert.match(root.querySelector('[role=status]').textContent,/Complete the Google approval/);
me.canManageNotifications=true;me.notificationGroupStatus='connected';button('Refresh access').click();await tick();await tick();assert(root.querySelector('[aria-label="New Notification"]'));assert.equal(root.querySelector('.notification-composer'),null);assert(managementReads>0);assert.equal(me.role,'customer','Group grant must not fabricate a staff role');
cleanup();console.log('Desk access: customer Agents, own Bug tickets, refresh persistence, actionable Google setup and verified group grant passed.');
