const A=require('node:assert/strict'),X=require('./extra-venues.cjs'),N=require('./new-venues.cjs'),C=require('./positions.cjs'),S=require('./shared-channel.cjs'),Policy=require('./alert-rules.cjs'),Scan=require('./scan-engine.js'),Feeds=require('./monitor-feeds.cjs');
const now=Date.parse('2026-10-28T15:00:03Z'),t=Math.floor(now/300000)*300000-300000;
A.equal(Policy.MIN_ALERT_SCORE,65);A.equal(Scan.MIN_CONFIRM_Z,1);
A.equal(X.riseSession(now),true);A.equal(X.riseSession(Date.parse('2026-10-31T15:00:00Z')),false);
A.equal(X.qSession({tz:'America/New_York',wednesday:[{session:'open',open:'09:30:00',close:'16:00:00'}]},now),true);
A.equal(X.qSession({},now),false);
const book={ticker_id:'NVDA-USD',bids:[['99','1'],['100','0']],asks:[['101','1']],timestamp:now};
A.equal(X.qBook('NVDA-USD',book,now).bid,99);
for(const change of [{ticker_id:'MU-USD'},{timestamp:now-120001},{timestamp:now+5001},{bids:[]},{bids:[['102','1']]},{asks:[['bad','1']]}])A.throws(()=>X.qBook('NVDA-USD',{...book,...change},now));
const snap={channel:'orderbook',type:'snapshot',market_id:'36',data:{market_id:36,bids:[{price:'99',quantity:'1'}],asks:[{price:'101',quantity:'1'}]},level_count:2,block_number:123,worker_timestamp:String(BigInt(now)*1000000n)};
A.equal(X.riseBook('36',snap,now).quoteTime,now);A.equal(X.riseBook('36',snap,now).ask,101); // human decimal, not wei
for(const change of [{type:'update'},{market_id:'25'},{level_count:1},{worker_timestamp:String(now)},{worker_timestamp:String(BigInt(now-120001)*1000000n)},{data:{...snap.data,market_id:25}}])A.throws(()=>X.riseBook('36',{...snap,...change},now));
const c={ticker:'NVDA-USD',resolution:'5MINS',startedAt:new Date(t).toISOString(),close:'100',usdVolume:'1'};
A.equal(X.candles('QFEX','NVDA-USD',{candles:[c,{...c,startedAt:new Date(t+300000).toISOString()}]},now).length,1);
A.throws(()=>X.candles('QFEX','NVDA-USD',{candles:[c,c]},now));A.throws(()=>X.candles('QFEX','MU-USD',{candles:[c]},now));
const rc={market_id:'36',interval:'5m',time:String(BigInt(t)*1000000n),close:'100',volume:'1'};
A.equal(X.candles('RISEx','36',{data:{data:[rc]}},now)[0].t,t);
A.throws(()=>X.candles('RISEx','36',{data:{data:[{...rc,interval:'1m'}]}},now));
A.throws(()=>X.candles('RISEx','36',{data:{data:[{...rc,time:String(t)}]}},now));
const ref={data:[{symbol:'NVDA-USD',base_asset:'NVDA',quote_asset:'USD',product_category:'EQUITY',status:'ACTIVE'}]};
A.equal(X.listQfex({data:[{ticker_id:'NVDA-USD',base_currency:'NVDA',target_currency:'USD',product_type:'Perpetual',last_price:'100',target_volume:'1'}]},ref,now)[0].takerBps,10);
const rm={market_id:'36',config:{name:'NVDA/USDC',unlocked:true},base_asset_symbol:'NVDA/USDC',quote_asset_symbol:'USDC',category:'stocks',mark_price:'100',quote_volume_24h:'1',active:true,reduce_only:false,post_only:false};
A.equal(X.listRise({data:{markets:[rm]}},now)[0].id,'NVDA-USDC');
A.equal(X.listRise({data:{markets:[{...rm,post_only:true}]}},now)[0].status,'Unavailable');
A.throws(()=>X.listRise({data:{markets:[rm,rm]}},now));
for(const venue of X.names){
 let update=0;const s=C.initial(),plan={ready:true,venue,a:{id:'NVDA-USD',side:'SHORT'},b:{id:'MU-USD',side:'LONG'},beta:1,alpha:0,sd:.01,tpZ:.3,stopZ:4,maxHoldMinutes:120,createdAt:now,expiresAt:now+300000};
 const cmd=text=>C.handle(s,{update_id:++update,message:{date:Math.floor(now/1000),text,chat:{id:42,type:'private'},from:{id:42}}},'42',()=>plan,now);
 for(const text of ['/open abcdef123456','102','500','100','500','0','CONFIRM'])cmd(text);
 const pos=Object.values(s.positions)[0];A.equal(pos.plan.venue,venue);
 C.evaluate(s,pos,{a:{bid:100,ask:100,quoteTime:now},b:{bid:100,ask:100,quoteTime:now}},now);
 A.ok(s.outbox.some(e=>e.text.includes('PAIR Z-TARGET')));
 const msg=S.message({venue,pair:{score:70,z:2,confirm:1.1,corr:.8,half:60,edge:30,cost:10},plan:{...plan,z:2,tpOperator:'≤',stopOperator:'≥',gross:'SECRET',wallet:'SECRET'}});
 A.ok(msg.includes(venue));A.ok(!msg.includes('SECRET'));
}
(async()=>{
 const original=N.quote;N.quoteMany=async(v,ids)=>new Map(ids.map(id=>[id,{bid:99,ask:101,quoteTime:now}]));N.quote=async(v,id)=>({bid:99,ask:101,quoteTime:now});
 const p=X.names.map(venue=>({plan:{venue,a:{id:'A'},b:{id:'B'}}}));const lookup=await Feeds.quotes(p);
 for(const row of p)A.equal(lookup(row).a.bid,99);N.quote=original;
 console.log('QFEX/RISEx checks passed: market identities, fees, source timestamps, malformed/stale books, closed candles, no gap filling, manual registration, monitoring and public privacy.');
})().catch(e=>{console.error(e);process.exitCode=1;});
