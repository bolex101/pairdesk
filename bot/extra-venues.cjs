'use strict';
const Log=require('./log.cjs');
const D=require('./data.cjs'),Fd=require('./funding.js');
const names=['QFEX','RISEx'],Q='https://api.qfex.com',R='https://api.rise.trade',BAR=300000;
const n=v=>v===null||v===undefined||v===''?NaN:Number(v);
function parts(now,tz){return Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:tz,weekday:'long',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));}
function qSession(hours,now){
 try{const p=parts(now,hours.tz),clock=p.hour+':'+p.minute+':'+p.second;
 return (hours[p.weekday.toLowerCase()]||[]).some(s=>s.session==='open'&&clock>=s.open&&clock<s.close);}catch(e){Log.debug('QFEX market-hours parse',e);return false;}
}
// Conservative research window for the supported US stocks, ETFs and commodities.
// This is a Pairdesk policy, not a claim that RISEx closes outside these hours.
function riseSession(now){const p=parts(now,'America/New_York');return !['Saturday','Sunday'].includes(p.weekday)&&p.hour+':'+p.minute>='09:30'&&p.hour+':'+p.minute<'16:00';}
function baseRow(id,symbol,price,volume,takerBps,status,offHours,historySource){
 return {id,symbol,price:n(price),volume:n(volume),takerBps,tradfi:true,type:'linear-perpetual',status,offHours,historySource,
 bid:null,ask:null,spread:null,quoteTime:null,requireQuote:true};
}
function listQfex(contracts,ref,now=Date.now()){
 if(!Array.isArray(contracts?.data)||!Array.isArray(ref?.data))throw Error('QFEX contracts/reference schema invalid');
 const by=new Map(ref.data.map(m=>[m.symbol,m]));
 if(by.size!==ref.data.length)throw Error('QFEX duplicate market identity');
 return contracts.data.filter(c=>c.product_type==='Perpetual'&&c.target_currency==='USD').flatMap(c=>{
 const m=by.get(c.ticker_id);if(!m||m.quote_asset!=='USD'||m.base_asset!==c.base_currency)return [];
 const fee={EQUITY:10,INDEX:5,COMMODITY:5}[m.product_category];if(fee===undefined)return [];
 return [{...baseRow(m.symbol,m.base_asset,c.last_price,c.target_volume,fee,m.status==='ACTIVE'?'Trading':'Unavailable',!qSession(m.market_hours,now),'QFEX exchange candles'),funding:n(c.funding_rate),fundingHourly:Fd.perp(c.funding_rate,n(c.funding_interval_minutes)*60,'QFEX funding_rate per funding_interval_minutes')}];
 });
}
function listRise(data,now=Date.now()){
 const rows=data?.data?.markets;if(!Array.isArray(rows))throw Error('RISEx markets schema invalid');
 const ids=new Set(),symbols=new Set();
 return rows.filter(m=>['stocks','index_etf','commodity'].includes(m.category)).map(m=>{
 if(!/^\d+$/.test(m.market_id)||!/^([A-Z0-9]+)\/USDC$/.test(m.config?.name)||m.base_asset_symbol!==m.config.name||m.quote_asset_symbol!=='USDC'||ids.has(m.market_id)||symbols.has(m.config.name))throw Error('RISEx market identity invalid/duplicate');
 ids.add(m.market_id);symbols.add(m.config.name);
 // Canonical display ID avoids a slash being mistaken for a pair separator.
 const symbol=m.config.name.split('/')[0],row=baseRow(symbol+'-USDC',symbol,m.mark_price,m.quote_volume_24h,3,
 m.active===true&&m.reduce_only===false&&m.post_only===false&&m.config.unlocked===true?'Trading':'Unavailable',!riseSession(now),'RISEx exchange OHLCV');
 return {...row,marketId:m.market_id,funding:n(m.funding_rate_8h),fundingHourly:Fd.perp(m.funding_rate_8h,8*3600,'RISEx 8h funding rate')};
 });
}
let riseCache,cacheAt=0,risePending;
async function riseMarkets(){
 if(riseCache&&Date.now()-cacheAt<30000)return riseCache;
 if(!risePending)risePending=D.get(R+'/v1/markets').then(d=>{riseCache=listRise(d);cacheAt=Date.now();return riseCache;}).finally(()=>{risePending=null;});
 return risePending;
}
async function markets(venue){
 if(venue==='QFEX'){const [c,r]=await Promise.all([D.get(Q+'/md/contracts'),D.get(Q+'/refdata')]);return listQfex(c,r);}
 if(venue==='RISEx')return riseMarkets();throw Error('Unsupported extra venue');
}
async function riseId(id){const m=(await riseMarkets()).find(m=>m.id===id);if(!m)throw Error('RISEx market not verified');return m.marketId;}
function nsMs(v){
 if(typeof v!=='string'||!/^\d{18,20}$/.test(v))throw Error('Invalid nanosecond timestamp');
 const ms=Number(BigInt(v)/1000000n);if(!Number.isSafeInteger(ms))throw Error('Unsafe timestamp');return ms;
}
function quoteBook(bids,asks,time,now=Date.now()){
 if(!Array.isArray(bids)||!Array.isArray(asks))throw Error('Book sides missing');
 const side=levels=>levels.map(l=>{if(!Array.isArray(l)||l.length<2||!Number.isFinite(n(l[0]))||n(l[0])<=0||!Number.isFinite(n(l[1]))||n(l[1])<0)throw Error('Malformed book level');return l;}).filter(l=>n(l[1])>0).map(l=>n(l[0]));
 const bid=Math.max(...side(bids)),ask=Math.min(...side(asks));
 if(!Number.isFinite(bid)||!Number.isFinite(ask)||ask<bid||!Number.isSafeInteger(time)||time<=0||now-time>120000||time>now+5000)throw Error('Empty, crossed or stale/untimed book');
 return {bid,ask,price:(bid+ask)/2,spread:(ask-bid)/((bid+ask)/2)*10000,quoteTime:time};
}
function qBook(id,b,now=Date.now()){if(b?.ticker_id!==id)throw Error('QFEX book identity mismatch');return quoteBook(b.bids,b.asks,b.timestamp,now);}
function riseBook(id,m,now=Date.now()){
 if(m?.channel!=='orderbook'||m.type!=='snapshot'||String(m.market_id)!==id||String(m.data?.market_id)!==id||!Array.isArray(m.data?.bids)||!Array.isArray(m.data?.asks)||m.level_count!==m.data.bids.length+m.data.asks.length||!Number.isSafeInteger(m.block_number)||m.block_number<=0)throw Error('RISEx snapshot identity/completeness invalid');
 return quoteBook(m.data.bids.map(l=>[l.price,l.quantity]),m.data.asks.map(l=>[l.price,l.quantity]),nsMs(m.worker_timestamp),now);
}
// REST orderbook has no source timestamp. Use a full, timestamped WS snapshot,
// including snapshots arriving before the subscribe acknowledgement. Never apply deltas.
function riseSnapshots(ids){
 return new Promise((resolve,reject)=>{
 let ws,done=false;const wanted=new Set(ids),out=new Map();
 const finish=err=>{if(done)return;done=true;clearTimeout(timer);try{ws?.close();}catch(e){Log.debug('RISEx socket close',e);}err?reject(err):resolve(out);};
 const timer=setTimeout(()=>finish(),10000);
 try{ws=new WebSocket('wss://ws.rise.trade/ws');}catch(e){finish(Error('RISEx WebSocket unavailable; Node 24 required',{cause:e}));return;}
 ws.onopen=()=>{try{ws.send(JSON.stringify({method:'subscribe',params:{channel:'orderbook',market_ids:ids.map(Number)}}));}catch(e){finish(Error('RISEx quote subscription failed',{cause:e}));}};
 ws.onerror=()=>finish(Error('RISEx quote connection failed'));
 ws.onclose=()=>finish(Error('RISEx quote connection closed before snapshots'));
 ws.onmessage=e=>{try{const m=JSON.parse(e.data);if(m.channel==='orderbook'&&m.type==='snapshot'){
 const id=String(m.market_id);if(!wanted.has(id))throw Error('Unexpected market');
 out.set(id,riseBook(id,m));if(out.size===wanted.size)finish();
 }}catch(e){finish(Error('RISEx quote snapshot rejected',{cause:e}));}};
 });
}
async function quoteMany(venue,ids){
 if(venue!=='RISEx')throw Error('Batch quote venue unsupported');
 const list=await riseMarkets(),mapping=new Map(ids.map(id=>[id,list.find(m=>m.id===id)?.marketId]));
 if([...mapping.values()].some(id=>!id))throw Error('RISEx market not verified');
 if(!ids.length)return new Map();
 const result=await riseSnapshots([...new Set(mapping.values())]);
 return new Map([...mapping].filter(([id,mid])=>result.has(mid)).map(([id,mid])=>[id,result.get(mid)]));
}
async function quote(venue,id){
 if(venue==='QFEX'){if(!/^[A-Z0-9]+-USD$/.test(id))throw Error('Invalid QFEX market');return qBook(id,await D.get(Q+'/md/orderbook/'+encodeURIComponent(id)));}
 if(venue==='RISEx'){const q=(await quoteMany(venue,[id])).get(id);if(!q)throw Error('RISEx quote snapshot timed out');return q;}throw Error('Unsupported extra venue');
}
function candles(venue,id,data,now=Date.now()){
 const rows=venue==='QFEX'?data?.candles:data?.data?.data;if(!Array.isArray(rows))throw Error(venue+' candles schema invalid');
 const out=new Map();
 for(const r of rows){
 if(venue==='QFEX'?(r.ticker!==id||r.resolution!=='5MINS'):(r.market_id!==id||r.interval!=='5m'))throw Error(venue+' candle identity/resolution mismatch');
 const t=venue==='QFEX'?Date.parse(r.startedAt):nsMs(r.time),c=n(r.close);
 if(!Number.isSafeInteger(t)||t%BAR||!Number.isFinite(c)||c<=0)throw Error(venue+' malformed candle');
 if(out.has(t))throw Error(venue+' duplicate candle');
 out.set(t,{t,c,volume:n(venue==='QFEX'?r.usdVolume:r.volume)});
 }
 return [...out.values()].filter(r=>r.t+BAR<=now-2000).sort((a,b)=>a.t-b.t);
}
async function history(venue,id,now=Date.now()){
 const to=Math.floor(now/BAR)*BAR,from=to-300*BAR;
 if(venue==='QFEX')return candles(venue,id,await D.get(Q+'/candles/'+encodeURIComponent(id)+'?'+new URLSearchParams({resolution:'5MINS',fromISO:new Date(from).toISOString(),toISO:new Date(to).toISOString()})),now);
 if(venue==='RISEx'){const mid=await riseId(id);return candles(venue,mid,await D.get(R+'/v1/markets/id/'+mid+'/trading-view-data?'+new URLSearchParams({interval:'300000000000',from:String(BigInt(from)*1000000n),to:String(BigInt(to)*1000000n)})),now);}
 throw Error('Unsupported extra venue');
}
module.exports={names,markets,quote,quoteMany,riseSnapshots,history,listQfex,listRise,qSession,riseSession,nsMs,qBook,riseBook,candles};
