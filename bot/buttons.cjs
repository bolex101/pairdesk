const Identity=require('./identity.cjs');
function keyboard(id,venue){
 if(!/^[a-f0-9]{12}$/.test(id))throw Error('Invalid signal ID');
 return {inline_keyboard:[[{text:'Register trade',callback_data:'open:'+id}],...(['Arcus','Popdex','Phoenix','Ondo','QFEX','RISEx'].includes(venue)?[[{text:'Link existing wallet positions',callback_data:'link:'+id}]]:[])]};
}
const testKeyboard=()=>({inline_keyboard:[[{text:'Register trade',callback_data:'test:register'}]]});
function callbackMessage(cb,chat,now){
 if(!cb||cb.message?.chat?.type!=='private'||String(cb.message.chat.id)!==String(chat)||String(cb.from?.id)!==String(chat)||cb.from?.is_bot||cb.message.from?.is_bot!==true||cb.message.from?.username?.toLowerCase()!==Identity.username())return null;
 const match=/^(open|link|linkconfirm):([a-f0-9]{12})$/.exec(cb.data||'');
 if(!match&&cb.data!=='test:register')return null;
 // The source alert may be old. A click has no Telegram timestamp; require fresh fill confirmation.
 return {text:match?'/'+match[1]+' '+match[2]:'/testbutton_clicked',date:Math.floor(now/1000),chat:cb.message.chat,from:cb.from};
}
module.exports={keyboard,testKeyboard,callbackMessage};

