const assert=require('node:assert/strict'),N=require('./new-venues.cjs'),C=require('./positions.cjs'),Feeds=require('./monitor-feeds.cjs');
const now=1793057405000,t=Math.floor(now/300000)*300000-300000;
const ondo=N.listOndo({success:true,result:[{market:'NVDA-USD.P',baseCurrency:'NVDA',productType:'perpetual',contractType:'linear',tags:['Stock'],disabled:false,reduceOnly:false,isClosed:false,bid:'100',ask:'101',usdVolume:'1000000',takerFee:'.00025'}]})[0];
assert.equal(ondo.takerBps,2.5);assert.equal(ondo.tradfi,true);assert.equal(ondo.quoteTime,null);assert.ok(ondo.historySource.includes('sampled'));
assert.throws(()=>N.listOndo({success:false,result:[]}));
const phoenix=N.listPhoenix({exchange:{active:true},markets:[{symbol:'NVDA',marketStatus:'active',takerFee:.00035,commodityMetadata:{isCommodity:true,isAfterHours:false}}]},{markets:[{symbol:'NVDA',mark_price:100,day_volume_usd:1e6,timestamp_ms:String(now)}]})[0];
assert.equal(phoenix.takerBps,3.5);assert.equal(phoenix.offHours,false);assert.equal(phoenix.tradfi,true);
const b={symbol:'NVDA',bids:[[99,2],[100,1]],asks:[[102,2],[101,1]]};assert.equal(N.book('Phoenix','NVDA',b,now).bid,100);assert.equal(N.book('Phoenix','NVDA',b,now).ask,101);
assert.throws(()=>N.book('Phoenix','WRONG',b,now));assert.throws(()=>N.book('Phoenix','NVDA',{...b,bids:[]},now));assert.throws(()=>N.book('Phoenix','NVDA',{...b,bids:[[103,1]]},now));assert.throws(()=>N.book('Phoenix','NVDA',b,null));
const q=N.book('Ondo','NVDA-USD.P',{success:true,result:{market:'NVDA-USD.P',time:new Date(now).toISOString(),bids:[['99','1']],asks:[['101','1']]}});assert.equal(q.quoteTime,now);
const candle={time:t,close:100,isFinal:true,volume:1};
const data={symbol:'NVDA',timeframe:'5m',page:{hasMore:false},bars:[candle,{...candle,time:t-300000,externalSource:'other'},{...candle,time:t-600000,isFinal:false},{...candle,time:t+300000}]};
assert.equal(N.candles('NVDA',data,now+3000).length,1);assert.throws(()=>N.candles('NVDA',{...data,page:{hasMore:true}}));assert.throws(()=>N.candles('NVDA',{...data,bars:[candle,candle]}));
for(const venue of N.names){const s=C.initial();C.handle(s,{update_id:1,message:{date:now/1000,text:'/open abcdef123456',chat:{id:42,type:'private'},from:{id:42}}},'42',()=>({ready:true,venue,a:{id:'A',side:'LONG'},b:{id:'B',side:'SHORT'},beta:1,alpha:0,sd:.01,tpZ:-.3,stopZ:-4,maxHoldMinutes:120,createdAt:now}),now);assert.equal(s.draft.plan.venue,venue);}
(async()=>{
 const called=[];N.quote=async(v,id)=>{called.push(v+':'+id);if(id==='FAIL')throw Error();return {bid:99,ask:101,quoteTime:now};};
 const a={plan:{venue:'Ondo',a:{id:'NVDA-USD.P'},b:{id:'MU-USD.P'}}},b={plan:{venue:'Phoenix',a:{id:'NVDA'},b:{id:'FAIL'}}};
 const lookup=await Feeds.quotes([a,b]);assert.equal(called.length,4);assert.equal(lookup(a).a.bid,99);assert.equal(lookup(b).b,undefined);
 console.log('New exchange checks passed: market/fee mapping, timed order books, closed-only exchange candles, external-history rejection, manual registration and quote-monitor routing.');
})().catch(e=>{console.error(e);process.exitCode=1;});
