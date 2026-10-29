const F=require('./feeds.js');
const VAR_URL='https://omni-client-api.prod.ap-northeast-1.variational.io/metadata/v2/stats';
const BAR=300000;
function arcusQuote(market,data){
 const bid=Number(data.bestBid?.price),ask=Number(data.bestAsk?.price),time=Number(data.timestamp)/1000;
 const valid=bid>0&&ask>=bid&&Number(data.bestBid?.size)>0&&Number(data.bestAsk?.size)>0;
 return {...market,bid:valid?bid:null,ask:valid?ask:null,spread:valid?(ask-bid)/((ask+bid)/2)*10000:null,quoteTime:Number.isFinite(time)&&time>0?time:null,requireQuote:true,historySource:'Arcus oracle candles'};
}
function variationalMarkets(data){return F.normalize('Variational',data).map(r=>({...r,takerBps:0,requireQuote:true,historySource:'Locally sampled Variational mark prices; indicative quotes',quoteSize:r.bid&&r.ask?'API indicative quote':null}));}
// Observations are received mark prices, not exchange OHLC candles. Never fill missing buckets.
// Keep only observations made near a bucket's end so the price approximates that close.
function record(previous,markets,now){
 const next={version:1,updatedAt:now,markets:{...previous.markets}};
 for(const m of markets.filter(r=>r.tradfi&&r.price>0)){
  const old=next.markets[m.id]||[],t=Math.floor(now/BAR)*BAR;
  const rows=old.filter(r=>r.t>=now-14*86400000&&r.t!==t);
  rows.push({t,c:m.price,observedAt:now});next.markets[m.id]=rows;
 }
 return next;
}
function sampledHistory(store,id,now){return (store.markets?.[id]||[]).filter(r=>Number.isSafeInteger(r.t)&&r.t%BAR===0&&Number.isFinite(r.c)&&r.c>0&&r.t+BAR<=now-2000&&r.observedAt>=r.t+BAR-90000&&r.observedAt<r.t+BAR).sort((a,b)=>a.t-b.t).map(r=>({t:r.t,c:r.c,volume:null}));}
async function get(url){const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 Pairdesk'},redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Market HTTP '+r.status);return r.json();}
module.exports={VAR_URL,arcusQuote,variationalMarkets,record,sampledHistory,get};
