const assert=require('node:assert/strict'),D=require('./data.cjs'),F=require('./monitor-feeds.cjs');
const now=Date.now(),calls=[];
D.get=async url=>{
 calls.push(url);
 if(url.includes('market/tickers'))return {code:'200',total:2,data:[{symbol:'A',bid1Price:'99',ask1Price:'101',updatedTime:now},{symbol:'B',bid1Price:'49',ask1Price:'51',updatedTime:now}]};
 if(url.includes('/bbo/'))return {bestBid:{price:'99',size:'10'},bestAsk:{price:'101',size:'10'},timestamp:now*1000};
 return {listings:[{ticker:'A',name:'NVIDIA Corporation',contract_type:'perpetual',mark_price:'100',quotes:{updated_at:new Date(now).toISOString(),size_1k:{bid:'99',ask:'101'}}},{ticker:'B',name:'Intel Corporation',contract_type:'perpetual',mark_price:'50',quotes:{updated_at:new Date(now).toISOString(),size_1k:{bid:'49',ask:'51'}}}]};
};
(async()=>{
 const positions=['Popdex','Arcus','Variational'].map(venue=>({plan:{venue,a:{id:'A'},b:{id:'B'}}}));
 const lookup=await F.quotes(positions);
 for(const p of positions){assert.equal(lookup(p).a.bid,99);assert.equal(lookup(p).a.ask,101);assert.equal(lookup(p).a.quoteTime,now);}
 assert.equal(calls.length,4);
 D.get=async()=>{throw Error('outage');};
 const unavailable=await F.quotes(positions);assert.equal(unavailable(positions[0]).a,undefined);
 console.log('Monitor adapter tests passed for all three venues and API outages');
})().catch(e=>{console.error(e);process.exitCode=1;});

