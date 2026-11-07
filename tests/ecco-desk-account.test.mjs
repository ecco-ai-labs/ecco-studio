import assert from 'node:assert/strict';
import {JSDOM} from '../desk/node_modules/jsdom/lib/api.js';
const dom=new JSDOM('<!doctype html><body></body>',{url:'https://ecco-ai-labs.github.io/ecco-studio/desk/'});
for(const key of ['window','document','HTMLElement','Element','Node','Event','MouseEvent','KeyboardEvent','StorageEvent','location','localStorage','sessionStorage','FormData'])globalThis[key]=dom.window[key];
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
const tick=()=>new Promise(r=>setTimeout(r,35));
const me={userId:'google:admin',name:'Example Admin',email:'admin@example.test',role:'admin',memberId:'m1'};
const data={me,tickets:[],members:[],users:[],activity:[],needsSetup:false};
const response=x=>new Response(JSON.stringify(x));
let calls=[],googleOptions,finishSignIn;
const google={accounts:{id:{initialize(options){googleOptions=options},renderButton(host){const b=document.createElement('button');b.textContent='Sign in with Google';b.onclick=()=>googleOptions.callback({credential:'test-credential'});host.append(b)}}}};
window.google=google;
globalThis.fetch=async(url,options)=>{
 calls.push({url:String(url),options});
 if(String(url).endsWith('/logout'))throw Error('Network unavailable');
 if(String(url).endsWith('/challenge'))return response({client_id:'test-client',nonce:'test-nonce',challenge:'test-challenge'});
 if(String(url).endsWith('/google'))return new Promise(resolve=>{finishSignIn=x=>resolve(response(x))});
 if(String(url).includes('manageNotifications'))return response({notificationVersion:1,specialOfferVersion:1,notifications:[],users:[]});
 return response(data);
};
const {mount}=await import('../desk/desk-app.mjs');
const create=async(options={})=>{const host=document.createElement('section');document.body.append(host);const cleanup=mount(host,options);await tick();await tick();return {root:host.shadowRoot,cleanup}};
sessionStorage.setItem('ecco-user-session','customer-session');localStorage.setItem('ecco-desk-staff-session','staff-session');
let {root,cleanup}=await create();
let trigger=root.querySelector('.account-trigger');
assert.equal(trigger.getAttribute('aria-expanded'),'false');trigger.click();await tick();
assert.equal(root.querySelector('[role="menu"]').textContent,'Example Adminadmin@example.testAdministratorSign out');
assert.equal(root.activeElement,root.querySelector('[role="menuitem"]'));
root.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,composed:true,cancelable:true}));await tick();
assert(!root.querySelector('[role="menu"]'));assert.equal(root.activeElement,trigger);
trigger.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,composed:true,cancelable:true}));await tick();
assert(root.querySelector('[role="menu"]'));
root.querySelector('[aria-label="Refresh workspace"]').focus();await tick();assert(!root.querySelector('[role="menu"]'));
trigger.click();await tick();document.body.dispatchEvent(new Event('pointerdown',{bubbles:true,composed:true}));await tick();assert(!root.querySelector('[role="menu"]'));
trigger.click();await tick();root.querySelector('[role="menuitem"]').click();await tick();await tick();
assert.equal(localStorage.getItem('ecco-desk-staff-session'),null);assert.equal(sessionStorage.getItem('ecco-user-session'),'customer-session');
assert(root.textContent.includes('Sign in to Ecco Desk'));assert(!document.querySelector('dialog'));
assert.equal(calls.find(c=>c.url.endsWith('/logout')).options.headers.Authorization,'Bearer staff-session');
assert(root.querySelector('.google-signin-button button'));assert.equal(googleOptions.auto_select,false);
// A response from a disposed sign-in cannot overwrite a newer account.
root.querySelector('.google-signin-button button').click();await tick();
localStorage.setItem('ecco-desk-staff-session','newer-session');window.dispatchEvent(new StorageEvent('storage',{key:'ecco-desk-staff-session'}));await tick();
finishSignIn({session_token:'late-session',user:{id:'google:old'}});await tick();
assert.equal(localStorage.getItem('ecco-desk-staff-session'),'newer-session');
assert(calls.some(c=>c.url.endsWith('/logout')&&c.options.headers.Authorization==='Bearer late-session'));
cleanup();
// Navigation stays visible for staff and customers, without fetching admin data.
for(const role of ['staff','customer']){
 data.me={...me,role};({root,cleanup}=await create());const before=calls.length;
 Array.from(root.querySelectorAll('nav button')).find(b=>b.textContent==='User Notifications').click();await tick();
 assert.equal(root.querySelector('h1').textContent,'User Notifications');assert(root.textContent.includes('Administrator access required'));
 assert(!calls.slice(before).some(c=>c.url.includes('manageNotifications')));assert(!root.querySelector('.user-notifications'));cleanup();
}
// Administrators reach the publishing form from the same navigation item.
data.me=me;({root,cleanup}=await create());Array.from(root.querySelectorAll('nav button')).find(b=>b.textContent==='User Notifications').click();await tick();
assert(root.textContent.includes('Publish notification'));cleanup();
// Failure to load Google has an in-place retry, and successful sign-in enters Desk.
localStorage.removeItem('ecco-desk-staff-session');delete window.google;({root,cleanup}=await create());
const script=document.querySelector('script[src="https://accounts.google.com/gsi/client"]');script.onerror();await tick();
assert(root.querySelector('[role="alert"]').textContent.includes('could not load'));
window.google=google;Array.from(root.querySelectorAll('button')).find(b=>b.textContent==='Try again').click();await tick();await tick();
root.querySelector('.google-signin-button button').click();await tick();finishSignIn({session_token:'signed-in-session',user:{id:me.userId}});await tick();await tick();
assert.equal(localStorage.getItem('ecco-desk-staff-session'),'signed-in-session');assert(root.querySelector('.account-trigger'));
assert.equal(sessionStorage.getItem('ecco-user-session'),'customer-session');cleanup();
console.log('PASS: account menu, keyboard/outside dismissal, offline sign-out, separate sessions, stale sign-in protection, inline retry, and notification navigation permissions.');
