const Log=require('./log.cjs');
const D=require('./data.cjs'),X=require('./extra-venues.cjs'),Fd=require('./funding.js'),Sol=require('./solana.cjs');
const ONDO='https://api.ondoperps.xyz',PHOENIX='https://perp-api.phoenix.trade';
const names=['Ondo','Phoenix',...X.names];
const number=v=>v===null||v===undefined||v===''?NaN:Number(v);
function listOndo(data){
 if(data?.success!==true||!Array.isArray(data.result))throw Error('Ondo contracts response invalid');
 return data.result.filter(r=>r.productType==='perpetual'&&r.contractType==='linear').map(r=>({
  id:r.market,symbol:r.baseCurrency,tradfi:Array.isArray(r.tags)&&r.tags.some(t=>['Stock','Commodity','ETF'].includes(t)),type:'linear-perpetual',
  status:!r.disabled&&!r.reduceOnly?'Trading':'Unavailable',offHours:r.isClosed!==false,
  price:(number(r.bid)+number(r.ask))/2,volume:number(r.usdVolume),takerBps:number(r.takerFee)*10000,
  funding:number(r.fundingRate),fundingHourly:Fd.perp(r.fundingRate,Fd.interval('Ondo'),'Ondo reported rate (configured interval)'),
  bid:null,ask:null,spread:null,quoteTime:null,requireQuote:true,historySource:'Locally sampled Ondo order-book midpoints; not exchange candles'
 }));
}
/* Phoenix /v1/markets/stats/latest reports funding in PERCENT, not as a fraction:
   current_funding_rate is %/hour, eight_hour_funding_rate = 8x that, annualized_funding_rate = 8h x 1095.
   Verified 2026-10-31 against the live API: BTC current_funding_rate 0.00355 sits below the market's
   maxFundingRatePerIntervalPercentage cap (~0.23 %/h) only if read as percent, and it tracks the
   mark/oracle premium (%) / 24 (fundingPeriodSeconds 86400). Read as a fraction it would be ~3,100%/yr.
   Returns the 8-hour rate as a FRACTION of notional (positive = longs pay), or NaN. */
function phoenixEightHourFraction(r){const v=number(r?.eight_hour_funding_rate);return Number.isFinite(v)?v/100:NaN;}
function listPhoenix(config,stats){
 if(!Array.isArray(config?.markets)||!Array.isArray(stats?.markets)||config.exchange?.active!==true)throw Error('Phoenix market response invalid/inactive');
 const by=new Map(stats.markets.map(r=>[r.symbol,r]));
 return config.markets.map(m=>{const r=by.get(m.symbol)||{};return {
  id:m.symbol,symbol:m.symbol,tradfi:m.commodityMetadata?.isCommodity===true,type:'linear-perpetual',
  status:m.marketStatus==='active'?'Trading':'Unavailable',offHours:m.commodityMetadata?.isAfterHours!==false,
  price:number(r.mark_price),volume:number(r.day_volume_usd),takerBps:number(m.takerFee)*10000,
  funding:phoenixEightHourFraction(r),fundingHourly:Fd.perp(phoenixEightHourFraction(r),8*3600,'Phoenix 8h funding rate (API percent /100)'),
  bid:null,ask:null,spread:null,quoteTime:null,requireQuote:true,statsTime:number(r.timestamp_ms),historySource:'Phoenix exchange candles (external backfills excluded)'
 };});
}
async function markets(venue){
 if(X.names.includes(venue))return X.markets(venue);
 if(venue==='Ondo')return listOndo(await D.get(ONDO+'/v1/perps/contracts'));
 if(venue==='Phoenix'){const [config,stats]=await Promise.all([D.get(PHOENIX+'/v1/exchange/snapshot'),D.get(PHOENIX+'/v1/markets/stats/latest')]);return listPhoenix(config,stats);}
 throw Error('Unsupported venue');
}
function book(venue,id,data,quoteTime){
 const b=venue==='Ondo'?(data?.success===true?data.result:null):data;
 if(!b||(venue==='Ondo'?b.market:b.symbol)!==id||!Array.isArray(b.bids)||!Array.isArray(b.asks))throw Error('Invalid book identity/schema');
 const bids=b.bids.filter(l=>number(l[0])>0&&number(l[1])>0).map(l=>number(l[0]));
 const asks=b.asks.filter(l=>number(l[0])>0&&number(l[1])>0).map(l=>number(l[0]));
 const bid=Math.max(...bids),ask=Math.min(...asks),time=venue==='Ondo'?Date.parse(b.time):quoteTime;
 if(![bid,ask,time].every(Number.isFinite)||bid<=0||ask<bid)throw Error('Empty, crossed or untimed book');
 return {bid,ask,price:(bid+ask)/2,spread:(ask-bid)/((ask+bid)/2)*10000,quoteTime:time};
}
// Use the book's actual Solana block time; never relabel an old snapshot as fresh.
async function blockTime(slot){
 if(!Number.isSafeInteger(slot)||slot<0)throw Error('Invalid Phoenix book slot');
 try{return await Sol.blockTime(slot);}catch(e){throw Error('Phoenix block time unverified: '+e.message);}
}
async function quote(venue,id){
 if(X.names.includes(venue))return X.quote(venue,id);
 if(venue==='Ondo')return book(venue,id,await D.get(ONDO+'/v1/perps/depth?'+new URLSearchParams({market:id,depth:'5'})));
 if(venue==='Phoenix'){const b=await D.get(PHOENIX+'/v1/view/orderbook/'+encodeURIComponent(id));return book(venue,id,b,await blockTime(b.slot));}
 throw Error('Unsupported venue');
}
async function enrich(venue,rows){
 if(venue==='RISEx'){let quotes=new Map();try{quotes=await X.quoteMany(venue,rows.map(m=>m.id));}catch(e){Log.warn('RISEx quotes unavailable',e);}return rows.map(m=>({...m,...(quotes.get(m.id)||{bid:null,ask:null,spread:null,quoteTime:null})}));}
 const out=[];let next=0;
 await Promise.all(Array.from({length:3},async()=>{while(next<rows.length){const m=rows[next++];try{out.push({...m,...await quote(venue,m.id)});}catch(e){Log.debug(venue+' '+m.id+' quote unavailable',e);out.push({...m,bid:null,ask:null,spread:null,quoteTime:null});}}}));return out;
}
function candles(id,data,now=Date.now()){
 if(data?.symbol!==id||data.timeframe!=='5m'||!Array.isArray(data.bars)||data.page?.hasMore!==false)throw Error('Invalid/incomplete Phoenix candles');
 const map=new Map();
 for(const r of data.bars){
  if(r.isFinal!==true||r.externalSource||r.isExternal===true)continue;
  const t=number(r.time),c=number(r.close);
  if(!Number.isSafeInteger(t)||t%300000||t+300000>now-2000||!Number.isFinite(c)||c<=0)continue;
  if(map.has(t))throw Error('Duplicate Phoenix candle');map.set(t,{t,c,volume:number(r.volume)});
 }return [...map.values()].sort((a,b)=>a.t-b.t);
}
async function history(venue,id,now=Date.now()){
 if(X.names.includes(venue))return X.history(venue,id,now);
 if(venue!=='Phoenix')throw Error('Ondo requires locally sampled history');
 const to=Math.floor(now/300000)*300000;
 return candles(id,await D.get(PHOENIX+'/v1/candles_v2/'+encodeURIComponent(id)+'?'+new URLSearchParams({timeframe:'5m',from:String(to-300*300000),to:String(to),limit:'1000',includePartial:'false'})),now);
}
module.exports={quoteMany:X.quoteMany,names,markets,listOndo,listPhoenix,phoenixEightHourFraction,book,quote,enrich,candles,history};
