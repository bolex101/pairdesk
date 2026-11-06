'use strict';
const Http=require('./http.cjs');
// Public mainnet RPC by default; set PAIRDESK_SOLANA_RPC_URL to a private/keyed endpoint.
const DEFAULT_RPC='https://api.mainnet-beta.solana.com';
const rpcUrl=()=>process.env.PAIRDESK_SOLANA_RPC_URL||DEFAULT_RPC;
// A slot's block time never changes, so successful lookups are cached (bounded).
const cache=new Map,LIMIT=2000;
async function blockTime(slot,options={}){
 if(!Number.isSafeInteger(slot)||slot<0)throw Error('Invalid Solana slot');
 if(cache.has(slot))return cache.get(slot);
 const ms=await Http.withRetry(async()=>{
  const r=await fetch(rpcUrl(),{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getBlockTime',params:[slot]})});
  if(!r.ok)throw new Http.HttpError('Solana RPC HTTP '+r.status,r.status,r.headers?.get?.('retry-after'));
  const d=await r.json();
  if(d.error||!Number.isSafeInteger(d.result)||d.result<=0){const e=Error('Solana block time unverified');e.permanent=true;throw e;}
  return d.result*1000;
 },options);
 cache.set(slot,ms);if(cache.size>LIMIT)cache.delete(cache.keys().next().value);
 return ms;
}
module.exports={DEFAULT_RPC,rpcUrl,blockTime,_cache:cache};
