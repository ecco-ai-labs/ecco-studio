'use strict';
/* Explicit, browser-local drafts. PDF bytes stay on this device, never in an AI request. */
(()=>{
 let database;
 function open(){
  if(database)return database;
  database=new Promise((resolve,reject)=>{
   if(!window.indexedDB){reject(Error('Draft storage is unavailable in this browser. Keep this popup open.'));return;}
   const request=indexedDB.open('ecco-preparation-drafts',1);
   request.onupgradeneeded=()=>request.result.createObjectStore('drafts');
   request.onsuccess=()=>resolve(request.result);
   request.onerror=()=>reject(Error('Could not open draft storage. Keep this popup open.'));
   request.onblocked=()=>reject(Error('Close older Studio tabs, then try saving again.'));
  }).catch(error=>{database=null;throw error;});return database;
 }
 async function transact(key,value,write=false){
  const db=await open();return new Promise((resolve,reject)=>{
   const transaction=db.transaction('drafts',write?'readwrite':'readonly'),store=transaction.objectStore('drafts');
   const request=write?store.put(value,key):store.get(key);let result;
   request.onsuccess=()=>{result=request.result;};
   transaction.oncomplete=()=>resolve(result);
   transaction.onerror=transaction.onabort=()=>reject(Error('Draft was not saved. Browser storage may be full or unavailable. Your open work is unchanged.'));
  });
 }
 window.EccoPopupDrafts={get:key=>transact(key),put:(key,value)=>transact(key,value,true)};
})();
