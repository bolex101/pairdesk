const A=require('node:assert/strict'),X=require('./extra-venues.cjs');
let connections=0,mode='ok',subscribed;
class MockWS{
 constructor(){connections++;queueMicrotask(()=>this.onopen());}
 close(){}
 send(text){
 subscribed=JSON.parse(text).params.market_ids;
 for(const id of subscribed){const m={channel:'orderbook',type:'snapshot',market_id:String(id),data:{market_id:id,bids:[{price:'99',quantity:'1'}],asks:[{price:'101',quantity:'1'}]},level_count:2,block_number:123,worker_timestamp:String(BigInt(Date.now())*1000000n)};
 if(mode==='stale')m.worker_timestamp=String(BigInt(Date.now()-121000)*1000000n);
 // Snapshot arrives without any acknowledgement, per exchange protocol.
 this.onmessage({data:JSON.stringify(m)});
 }
 }
}
global.WebSocket=MockWS;
(async()=>{
 const q=await X.riseSnapshots(['36','25','28']);A.equal(connections,1);A.deepEqual(subscribed,[36,25,28]);A.equal(q.size,3);A.equal(q.get('25').bid,99);
 mode='stale';await A.rejects(()=>X.riseSnapshots(['36','25']));A.equal(connections,2);
 console.log('RISEx batch checks passed: one subscription for multiple markets, snapshots before acknowledgement, source timestamp and fail-closed validation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
