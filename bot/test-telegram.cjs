const A=require('node:assert/strict'),T=require('./telegram.cjs'),L=require('./log.cjs');
const token='1234567890:'+'B'.repeat(35);
(async()=>{
 global.fetch=async()=>({ok:false,status:409,statusText:'Conflict',json:async()=>({ok:false,error_code:409,description:'Conflict: terminated by other getUpdates request; make sure that only one bot instance is running'})});
 let e=await T.client(token,'42').api('getUpdates',{timeout:10}).catch(x=>x);let s=L.safe(e);A.ok(/HTTP 409.*Conflict/.test(s),s);A.ok(!s.includes('BBBBBBBB'));A.equal(e.status,409);
 global.fetch=async(u,o)=>{A.equal(o.signal instanceof AbortSignal,true);throw Object.assign(new TypeError('fetch failed'),{cause:Object.assign(Error('connect ETIMEDOUT https://api.telegram.org/bot'+token+'/x'),{code:'ETIMEDOUT'})});};
 e=await T.client(token,'42').api('getUpdates',{timeout:10}).catch(x=>x);s=L.safe(e);A.ok(/TypeError: fetch failed \/ ETIMEDOUT/.test(s),s);A.ok(!s.includes('BBBBBBBB'),s);
 A.equal(T.timeoutMs({timeout:10}),25000);A.equal(T.timeoutMs({}),15000);
 console.log('Telegram error checks passed: status/description/network cause logged, token scrubbed, long-poll timeout margin');
})();
