const Log=require('./log.cjs');
const D=require('./data.cjs');
const ATTEMPTS=3,TIMEOUT=8000,BUDGET=35000;
function failure(message,retry=false,delay=null){const e=new Error(message);e.safeMessage=message;e.retry=retry;e.delay=delay;return e;}
function retryAfter(value,now){if(!value)return null;const seconds=Number(value);if(Number.isFinite(seconds)&&seconds>=0)return seconds*1000;const date=Date.parse(value);return Number.isFinite(date)?Math.max(0,date-now):null;}
async function markets({fetchImpl=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now,log=console.log}={}){
 const started=now();
 for(let attempt=1;attempt<=ATTEMPTS;attempt++){
  let data;
  try{
   const remaining=BUDGET-(now()-started);if(remaining<=0)throw failure('request budget exhausted');
   const response=await fetchImpl(D.VAR_URL,{headers:{'User-Agent':'Mozilla/5.0 Pairdesk'},redirect:'error',signal:AbortSignal.timeout(Math.min(TIMEOUT,remaining))});
   if(!response.ok){const code=response.status;throw failure('HTTP '+code,[408,425,429,500,502,503,504].includes(code),retryAfter(response.headers.get('retry-after'),now()));}
   try{data=await response.json();}catch(e){if(e.name==='TimeoutError'||e.name==='AbortError')throw e;throw failure('invalid JSON response',true);}
  }catch(original){
   const e=original.safeMessage?original:failure(original.name==='TimeoutError'||original.name==='AbortError'?'request timed out after up to 8 seconds':'network connection failed',true);
   log('Variational fetch attempt '+attempt+'/'+ATTEMPTS+' failed: '+e.safeMessage);
   const delay=Math.max(attempt*2000,e.delay??0);
   if(!e.retry||attempt===ATTEMPTS||now()-started+delay+TIMEOUT>BUDGET){
    throw failure(e.safeMessage+'; '+(!e.retry?'not retryable':attempt===ATTEMPTS?'retry limit reached':'retry wait exceeds collection budget; next scheduled run will try again'));
   }
   log('Variational retry in '+(delay/1000).toFixed(1)+' seconds');await sleep(delay);continue;
  }
  let result;
  try{result=D.variationalMarkets(data);}catch(e){Log.warn('Variational schema check',e);throw failure('response schema invalid; expected usable Variational listings');}
  if(!result.length||!result.some(r=>r.tradfi&&Number.isFinite(r.price)&&r.price>0))throw failure('response contains no usable TradFi marks');
  if(attempt>1)log('Variational fetch recovered on attempt '+attempt+'/'+ATTEMPTS);
  return result;
 }
}
module.exports={markets,retryAfter,failure,ATTEMPTS,TIMEOUT,BUDGET};
