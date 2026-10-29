const Log=require('./log.cjs');
function client(token,chat){
 if(!/^\d+:[A-Za-z0-9_-]+$/.test(token||'')||!/^[1-9]\d*$/.test(String(chat||'')))throw Error('Invalid Telegram configuration');
 async function api(method,data={}){
  try{
   const r=await fetch('https://api.telegram.org/bot'+token+'/'+method,{method:'POST',redirect:'error',signal:AbortSignal.timeout(25000),headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
   const result=await r.json();
   if(!r.ok||!result.ok)throw Error();
   return result.result;
  }catch(e){throw Error('Telegram request failed; credentials hidden',{cause:Error(Log.safe(e))});}
 }
 async function send(text,replyMarkup){if(text.length>4000)throw Error('Message too long');return api('sendMessage',{chat_id:chat,text,...(replyMarkup?{reply_markup:replyMarkup}:{})});}
 return {api,send};
}
module.exports={client};
