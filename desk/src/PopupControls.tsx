import {useEffect,useLayoutEffect,useRef,useState,type RefObject} from 'react';
import {Minus,X} from 'lucide-react';

const focusedElement=():HTMLElement|null=>{
 let element=document.activeElement;
 while(element?.shadowRoot?.activeElement)element=element.shadowRoot.activeElement;
 return element as HTMLElement|null;
};

export function usePopupControls(ref:RefObject<HTMLElement|null>,title:string,close:()=>void){
 const [minimized,setMinimized]=useState(false),controller=useRef<any>(null),closeRef=useRef(close),focus=useRef<HTMLElement|null>(null);
 closeRef.current=close;
 useEffect(()=>{
  const element=ref.current;if(!element)return;
  controller.current=(window as any).EccoPopups.registerPanel(element,{
   title,onMinimize(){focus.current=focusedElement();setMinimized(true);},onResume(){setMinimized(false);},
   captureContext:()=>element.closest('.is-embedded')?(window as any).EccoWorkspaceUI?.capturePopupContext():null
  });
  const escape=(event:KeyboardEvent)=>{
   if(event.key==='Escape'&&!controller.current?.isMinimized()){
    event.preventDefault();event.stopPropagation();closeRef.current();
   }
  };
  element.addEventListener('keydown',escape);
  return()=>{element.removeEventListener('keydown',escape);controller.current?.dispose();};
 },[title]);
 useLayoutEffect(()=>{if(!minimized&&focus.current?.isConnected){focus.current.focus();focus.current=null;}},[minimized]);
 return {minimized,minimize:()=>controller.current?.minimize()};
}

export function PopupControls({minimize,close,closeLabel}:{minimize:()=>void;close:()=>void;closeLabel:string}){
 return <div className="popup-window-controls">
  <button type="button" className="ecco-popup-minimize" aria-label="Minimize popup" title="Minimize" onClick={minimize}><Minus/></button>
  <button type="button" className="icon-button ecco-popup-close" aria-label={closeLabel} title="Close" onClick={close}><X/></button>
 </div>;
}
