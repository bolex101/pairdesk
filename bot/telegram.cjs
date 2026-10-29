const Log=require('./log.cjs');
// Long polls (getUpdates timeout=N s) must outlive Telegram's own wait, so the client
// timeout is the poll wait plus a margin; plain calls keep a short fixed timeout.
const timeoutMs=data=>Math.max(0,Number(data?.timeout)||0)*1000+15000;
function client(token,chat){
 if(!/^\d+:[A-Za-z0-9_-]+$/.test(token||'')||!/^[1-9]\d*$/.test(String(chat||'')))throw Error('Invalid Telegram configuration');
 async function api(method,data={}){
  let r,result;
  try{
   r=await fetch('https://api.telegram.org/bot'+token+'/'+method,{method:'POST',redirect:'error',signal:AbortSignal.timeout(timeoutMs(data)),headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
   result=await r.json().catch(e=>({ok:false,description:'non-JSON response ('+(e?.name||'parse error')+')'}));
  }catch(e){
   // Network/timeout failures: keep the error name and low-level code (e.g. TimeoutError, ECONNRESET).
   const inner=e?.cause,detail=(e?.name||'Error')+': '+(e?.message||'no message')+(inner?' / '+(inner.code||inner.name||'')+' '+(inner.message||''):'');
   throw Object.assign(Error('Telegram '+method+' request failed; credentials hidden',{cause:Error(Log.scrub(detail.trim()))}),{method,network:true});
  }
  if(!r.ok||!result?.ok){
   const code=result?.error_code||r.status,desc=Log.scrub(result?.description||r.statusText||'no description');
   const retry=result?.parameters?.retry_after;
   throw Object.assign(Error('Telegram '+method+' request failed; credentials hidden',{cause:Error('HTTP '+r.status+' error_code '+code+': '+desc+(retry?' (retry after '+retry+'s)':''))}),{method,status:r.status,errorCode:code,retryAfter:Number(retry)||null});
  }
  return result.result;
 }
 async function send(text,replyMarkup){if(text.length>4000)throw Error('Message too long');return api('sendMessage',{chat_id:chat,text,...(replyMarkup?{reply_markup:replyMarkup}:{})});}
 return {api,send};
}
module.exports={client,timeoutMs};
