// Helpers for jsdom tests that drive the Library hub: pick a card, then use its details panel.
const tick=()=>new Promise(resolve=>setTimeout(resolve,35));
const pick=async(x,selector)=>{x.q(selector).click();await tick();};
const openCard=async(x,selector)=>{await pick(x,selector);x.q('.lh-details [data-act=primary]').click();await tick();};
const deleteCard=async(x,selector)=>{await pick(x,selector);x.q('.lh-details [data-act=delete]').click();await tick();await tick();};
module.exports={pick,openCard,deleteCard};
