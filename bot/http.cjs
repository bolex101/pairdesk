'use strict';
/* Retry with jittered exponential backoff for transient failures only:
   network errors/timeouts, HTTP 429 and 5xx. Honours Retry-After (seconds or
   HTTP date) up to maxWaitMs; a longer server-requested wait is not retried. */
const DEFAULTS={retries:2,baseMs:400,maxDelayMs:4000,maxWaitMs:10000};
function settings(){
 const n=Number(process.env.PAIRDESK_HTTP_RETRIES);
 return {...DEFAULTS,retries:Number.isInteger(n)&&n>=0&&n<=6?n:DEFAULTS.retries};
}
const transientStatus=s=>s===429||s===408||(s>=500&&s<=599&&s!==501);
function retryAfterMs(value,now=Date.now()){
 if(value===null||value===undefined||value==='')return null;
 const s=String(value).trim();
 if(/^\d+(\.\d+)?$/.test(s))return Number(s)*1000;
 const t=Date.parse(s);return Number.isFinite(t)?Math.max(0,t-now):null;
}
function backoffMs(attempt,o,random=Math.random){const cap=Math.min(o.maxDelayMs,o.baseMs*2**attempt);return Math.round(cap/2+random()*cap/2);}
class HttpError extends Error{constructor(message,status,retryAfter){super(message);this.status=status;this.retryAfter=retryAfter;}}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// attemptFn(attempt) must resolve to a value or throw; HttpError carries status/Retry-After.
async function withRetry(attemptFn,options={}){
 const o={...settings(),...options},wait=o.sleep||sleep,random=o.random||Math.random;
 for(let attempt=0;;attempt++){
  try{return await attemptFn(attempt);}
  catch(e){
   const status=e instanceof HttpError?e.status:null;
   const transient=status===null?!(e instanceof SyntaxError)&&!e.permanent:transientStatus(status);
   if(!transient||attempt>=o.retries)throw e;
   const ra=e instanceof HttpError?retryAfterMs(e.retryAfter):null;
   if(ra!==null&&ra>o.maxWaitMs)throw e;
   await wait(Math.max(ra??0,backoffMs(attempt,o,random)));
  }
 }
}
module.exports={DEFAULTS,settings,transientStatus,retryAfterMs,backoffMs,HttpError,withRetry};
