const A=require('node:assert/strict'),H=require('./http.cjs');
(async()=>{
 // Backoff: exponential, capped, jittered within [cap/2, cap].
 const o={...H.DEFAULTS};A.equal(H.backoffMs(0,o,()=>0),200);A.equal(H.backoffMs(0,o,()=>1),400);A.equal(H.backoffMs(3,o,()=>1),3200);A.equal(H.backoffMs(9,o,()=>1),4000);
 A.equal(H.retryAfterMs('3'),3000);A.equal(H.retryAfterMs(new Date(Date.now()+5000).toUTCString())>3000,true);A.equal(H.retryAfterMs('soon'),null);A.equal(H.retryAfterMs(null),null);
 A.equal(H.transientStatus(429),true);A.equal(H.transientStatus(503),true);A.equal(H.transientStatus(404),false);A.equal(H.transientStatus(501),false);
 const waits=[],sleep=ms=>{waits.push(ms);return Promise.resolve();};
 // data.get retries 429 honouring Retry-After, then 503, then succeeds.
 const D=require('./data.cjs');let calls=0;
 const reply=(status,body,headers={})=>({ok:status<400,status,headers:{get:k=>headers[k.toLowerCase()]??null},json:async()=>body});
 global.fetch=async()=>{calls++;return calls===1?reply(429,{}, {'retry-after':'2'}):calls===2?reply(503,{}):reply(200,{ok:1});};
 A.deepEqual(await D.get('https://x.test',{sleep,random:()=>0}),{ok:1});A.equal(calls,3);A.deepEqual(waits,[2000,400]);
 // Permanent errors are not retried.
 calls=0;waits.length=0;global.fetch=async()=>{calls++;return reply(404,{});};
 await A.rejects(D.get('https://x.test',{sleep}),/Market HTTP 404/);A.equal(calls,1);
 // Timeouts / network errors retried up to the limit, then the last error surfaces.
 calls=0;global.fetch=async()=>{calls++;const e=new Error('timed out');e.name='TimeoutError';throw e;};
 await A.rejects(D.get('https://x.test',{sleep,retries:3}),/timed out/);A.equal(calls,4);
 // A Retry-After longer than the cap is not waited on.
 calls=0;waits.length=0;global.fetch=async()=>{calls++;return reply(429,{}, {'retry-after':'600'});};
 await A.rejects(D.get('https://x.test',{sleep}),/429/);A.equal(calls,1);A.equal(waits.length,0);
 // Invalid JSON is not retried.
 calls=0;global.fetch=async()=>{calls++;return {ok:true,status:200,headers:{get:()=>null},json:async()=>{throw new SyntaxError('bad json');}};};
 await A.rejects(D.get('https://x.test',{sleep}),SyntaxError);A.equal(calls,1);
 // Env override for retry count.
 process.env.PAIRDESK_HTTP_RETRIES='0';A.equal(H.settings().retries,0);process.env.PAIRDESK_HTTP_RETRIES='99';A.equal(H.settings().retries,2);delete process.env.PAIRDESK_HTTP_RETRIES;
 // Solana: configurable RPC URL, public default, cached block times, retry on 5xx.
 const Sol=require('./solana.cjs');A.equal(Sol.rpcUrl(),'https://api.mainnet-beta.solana.com');
 process.env.PAIRDESK_SOLANA_RPC_URL='https://rpc.example.test/';const urls=[];calls=0;
 global.fetch=async url=>{urls.push(url);calls++;return calls===1?reply(502,{}):reply(200,{result:1700000000});};
 A.equal(await Sol.blockTime(123,{sleep}),1700000000000);A.equal(await Sol.blockTime(123,{sleep}),1700000000000);
 A.equal(calls,2,'second lookup served from cache');A.deepEqual([...new Set(urls)],['https://rpc.example.test/']);
 global.fetch=async()=>reply(200,{error:{message:'slot skipped'}});await A.rejects(Sol.blockTime(124,{sleep}),/unverified/);A.equal(Sol._cache.has(124),false);
 await A.rejects(Sol.blockTime(-1),/Invalid/);delete process.env.PAIRDESK_SOLANA_RPC_URL;
 console.log('Retry checks passed: jittered backoff, Retry-After, transient vs permanent, env limits, Solana RPC env and cache');
})().catch(e=>{console.error(e);process.exit(1);});
