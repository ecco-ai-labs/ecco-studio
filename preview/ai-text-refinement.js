'use strict';
/* Shared instruction → suggestion → refine again → Apply experience. */
(()=>{
 function open({id='ai-review-dialog',text,sourceLabel='Selected Text',maxLength=4000,valid,request,apply,opener,onError=()=>{}}){
  document.getElementById(id)?.remove();
  const dialog=document.createElement('dialog');dialog.id=id;dialog.className='generation-dialog';dialog.dataset.aiTextRefinement='';dialog.setAttribute('aria-label','Improve with AI');
  dialog.innerHTML='<form class="form"><div class="section-head"><h2>Improve with AI</h2><button type="button" class="secondary" data-close data-cancel aria-label="Close">×</button></div><label>How should AI change this?<textarea data-instructions rows="3" maxlength="2000" required placeholder="Use a better word, make this more engaging, or use simpler language."></textarea></label><label><span data-source-label></span><textarea data-selected-text readonly rows="3" dir="auto"></textarea></label><button type="submit" data-improve>Improve</button><label data-suggestion-label hidden>Suggested Replacement<textarea data-replacement data-suggestion rows="4" dir="auto"></textarea></label><p role="status" data-apply-status></p><button type="button" data-apply hidden disabled>Apply</button></form>';
  document.body.append(dialog);const q=s=>dialog.querySelector(s),button=q('[data-improve]'),status=q('[role=status]'),commit=q('[data-apply]');let busy=false,closed=false;
  q('[data-source-label]').textContent=sourceLabel;q('[data-selected-text]').value=text;q('[data-replacement]').maxLength=maxLength;
  const current=()=>{if(closed)throw Error('This editor was closed.');valid();};
  q('[data-close]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{closed=true;dialog.remove();if(opener?.isConnected)opener.focus();},{once:true});
  q('form').onsubmit=async event=>{
   event.preventDefault();if(busy||!q('form').reportValidity())return;
   try{
    current();busy=true;button.disabled=true;button.setAttribute('aria-busy','true');button.innerHTML='<span class="generation-spinner" aria-hidden="true"></span>Improving…';commit.hidden=true;commit.disabled=true;status.textContent='';status.classList.remove('ai-questions');
    const revision=await request(q('[data-suggestion-label]').hidden?text:q('[data-replacement]').value,q('[data-instructions]').value.trim());current();
    if(typeof revision!=='string'||revision.length>maxLength)throw Error('AI returned an invalid suggestion. Your text is unchanged.');
    q('[data-replacement]').value=revision;q('[data-suggestion-label]').hidden=false;commit.hidden=false;commit.disabled=false;status.textContent='Review the replacement, improve again if needed, then Apply.';
   }catch(error){if(!closed){status.textContent=error.message;status.classList.toggle('ai-questions',!!error.questions);onError(error);}}
   finally{busy=false;if(!closed){button.disabled=false;button.setAttribute('aria-busy','false');button.textContent=q('[data-suggestion-label]').hidden?'Improve':'Improve Again';}}
  };
  commit.onclick=()=>{try{current();if(busy||commit.disabled)return;if(q('[data-replacement]').value.length>maxLength)throw Error('Keep the replacement within '+maxLength+' characters.');apply(q('[data-replacement]').value);dialog.close();}catch(error){status.textContent=error.message;onError(error);}};
  dialog.showModal();q('[data-instructions]').focus();return dialog;
 }
 window.EccoTextRefinement={open};
})();
