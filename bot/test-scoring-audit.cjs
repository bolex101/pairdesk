// Scoring-audit fixes: edge to take-profit, hourly Arcus/Ondo funding, size-aware costs, gaps by duration.
const A=require('node:assert/strict'),S=require('./scan-engine.js'),T=require('./thresholds.js'),Fd=require('./funding.js'),F=require('./feeds.js'),D=require('./data.cjs'),N=require('./new-venues.cjs'),X=require('./extra-venues.cjs'),P=require('./trade-plan.cjs');
const near=(a,b,e=1e-9)=>A.ok(Math.abs(a-b)<=e,a+' != '+b);
const now=1800000000000,bar=300000,rows=Array.from({length:240},(_,i)=>({t:now-(240-i)*bar,a:Math.exp(4+i*.001+.01*Math.sin(i*.4)),b:Math.exp(4+i*.001)}));
const q={id:'A',type:'PERPETUAL',status:'ONLINE',price:100,bid:99.99,ask:100.01,spread:2,takerBps:2,volume:1e7,quoteTime:now,requireQuote:true};
const engine={stats:()=>({beta:1,alpha:0,sd:.01,z:2,confirm:2}),fit:()=>({alpha:0,beta:1}),corr:()=>.8};
const run=(a,b,r=rows,o={})=>S.analyze({a:{...q,...a},b:{...q,id:'B',...b}},r,engine,now,undefined,o);

// 1. Edge is the move to the take-profit exit: (|z| - exitZ) * sd / (1 + beta), not to z = 0.
let r=run({},{});
near(r.edge,(2-0.3)*0.01/2*10000);near(r.edgeToZero,2*0.01/2*10000);
near(run({},{},rows,{exitZ:0.5}).edge,(2-0.5)*0.01/2*10000);
// The cost-coverage filter uses the take-profit edge: a cost that passed the old 2x check now fails.
const tight=run({takerBps:19},{takerBps:19});near(tight.cost,46);
A.ok(tight.edgeToZero>=2*tight.cost&&tight.edge<2*tight.cost,'edge-to-TP is stricter than edge-to-zero');A.equal(tight.eligible,false);
A.ok(tight.reasons.includes('Estimated move less than twice friction'));
// Trade plan applies the same rule: live z 2 (A mid 102, B mid 100), cost 46 bps -> rejected now; 40 bps -> accepted.
const pa={...q,bid:101.99,ask:102.01},zLive=Math.log(1.02)/0.01;A.ok(zLive>1.5&&zLive<3);
const planOf=c=>P.build({setup:true,eligible:true,rows:[{t:now-300000}],a:pa,b:{...q,id:'B'},alpha:0,beta:1,sd:.01,z:zLive,cost:c,totalCost:c,funding:{known:false}},'Arcus',now,P.settings({}));
A.equal(planOf(46).ready,false,'plan rejects when the move to take-profit is under twice the cost');A.equal(planOf(40).ready,true);

// 2. Arcus and Ondo funding are hourly by default (no longer "unknown" = zero carry).
A.equal(T.DEFAULTS.fundingIntervalSeconds.Arcus,3600);A.equal(T.DEFAULTS.fundingIntervalSeconds.Ondo,3600);A.equal(T.DEFAULTS.fundingIntervalSeconds.Popdex,null);
const ar=F.normalize('Arcus',{markets:[{marketDisplayName:'SNDK-USD',markPrice:'1000',fundingRate:'0.0001',status:'ONLINE'}]})[0];near(ar.fundingHourly.long,0.0001);
const on=N.listOndo({success:true,result:[{productType:'perpetual',contractType:'linear',market:'MU-USD.P',tags:['Stock'],bid:'1',ask:'1',fundingRate:'0.0002',takerFee:'0.0005',isClosed:false}]})[0];near(on.fundingHourly.long,0.0002);
const carry=run({fundingHourly:Fd.perp(0.0001,3600)},{fundingHourly:Fd.perp(0.0001,3600)});A.equal(carry.funding.known,true);

// 3. Order-size-aware costs.
// No book: unchanged old rule (quoted spread per leg).
near(r.cost,2*2+2+2*3);
const flat=S.legImpact({...q},500,T.DEFAULTS);A.equal(flat.model,'spread');A.equal(flat.bps,2);
// Deep top level fills the whole order: round-trip impact equals the spread.
const deep={bids:[[99.99,100]],asks:[[100.01,100]],complete:true};
near(S.legImpact({...q,book:deep},500,T.DEFAULTS).bps,2);A.equal(S.legImpact({...q,book:deep},500,T.DEFAULTS).unfilled,0);
// Full book walked: $500 buy = ~$100 at 100.01 + ~$400 at 100.11.
const walk={bids:[[99.99,1],[99.89,10]],asks:[[100.01,1],[100.11,10]],complete:true};
const w=S.legImpact({...q,book:walk},500,T.DEFAULTS);
const buyBps=(100.01*0.01+(500-100.01)*0.11)/100/500*1e4,sellBps=(99.99*0.01+(500-99.99)*0.11)/100/500*1e4;
near(w.bps,buyBps+sellBps,1e-6);A.ok(w.bps>8,'walking the book costs more than the 2 bps top-of-book spread');
A.ok(run({book:walk},{book:walk}).cost>r.cost);
// Bigger orders cost more on the same book.
A.ok(S.legImpact({...q,book:walk},900,T.DEFAULTS).bps>w.bps);
// Full book exhausted: unfilled share pays depthPenaltyBps per side.
const tiny={bids:[[99.99,1]],asks:[[100.01,1]],complete:true};const ex=S.legImpact({...q,book:tiny},500,T.DEFAULTS);
near(ex.unfilled,1-99.99/500,1e-9);A.ok(ex.bps>2+T.DEFAULTS.depthPenaltyBps*1.5);
// Top-of-book-only (Arcus): beyond the published size pays unknownDepthBps; Popdex pays the extra thin-book penalty.
const top={bids:[[99.99,1]],asks:[[100.01,1]],complete:false,source:'Arcus'},popTop={...top,source:'Popdex'};
const arc=S.legImpact({...q,book:top},500,T.DEFAULTS),pdx=S.legImpact({...q,book:popTop},500,T.DEFAULTS);
const share=1-100.01/500,shareSell=1-99.99/500;
near(arc.bps,2+share*T.DEFAULTS.unknownDepthBps+shareSell*T.DEFAULTS.unknownDepthBps,1e-6);
near(pdx.bps-arc.bps,(share+shareSell)*T.DEFAULTS.popdexThinBookPenaltyBps,1e-6);
// Leg notional follows the hedge weights of the configured gross.
A.ok(run({book:popTop},{book:popTop},rows,{gross:2000}).cost>run({book:popTop},{book:popTop},rows,{gross:200}).cost);
// Adapters now carry book depth.
const aq=D.arcusQuote({id:'SNDK-USD'},{bestBid:{price:'100',size:'0.5'},bestAsk:{price:'100.02',size:'0.25'},timestamp:now*1000});
A.deepEqual(aq.book,{bids:[[100,0.5]],asks:[[100.02,0.25]],complete:false,source:'Arcus'});
const pt=F.normalize('Popdex',{code:'200',data:[{symbol:'SNDKUSDT',markPrice:'100',bid1Price:'99.9',ask1Price:'100.1',bid1Size:'2',ask1Size:'0.07',fundingRate:'0'}]},{code:'200',data:[{symbol:'SNDKUSDT',assetClass:'Rwa',fundingInterval:'1',feeRates:[]}]})[0];
A.deepEqual(pt.book,{bids:[[99.9,2]],asks:[[100.1,0.07]],complete:false,source:'Popdex'});
const pb=N.book('Phoenix','MU',{symbol:'MU',bids:[[100,1],[99,2]],asks:[[101,1],[102,0]]},now);A.equal(pb.book.complete,true);A.deepEqual(pb.book.asks,[[101,1]]);
const qb=X.qBook('MU-USD',{ticker_id:'MU-USD',bids:[['100','1'],['99','0']],asks:[['101','2']],timestamp:now},now);A.deepEqual(qb.book,{bids:[[100,1]],asks:[[101,2]],complete:true});
const ob=N.book('Ondo','MU-USD.P',{success:true,result:{market:'MU-USD.P',time:new Date(now).toISOString(),bids:[['100','1']],asks:[['101','1']]}});A.equal(ob.book.complete,false);

// 4. Gaps counted by duration: a weekend closure is hundreds of missing bars, not one gap.
A.equal(S.missingBars(rows),0);
const weekend=rows.map((x,i)=>i<120?{...x,t:x.t-2*86400000}:x);A.equal(S.missingBars(weekend),576);
const ok=run({},{},weekend);A.ok(ok.reasons.includes('Too many gaps in recent history'));A.equal(ok.missingBars,576);
const twoSmall=rows.filter((x,i)=>i!==50&&i!==150);A.equal(S.missingBars(twoSmall),2);A.ok(!run({},{},[rows[0],...twoSmall]).reasons.includes('Too many gaps in recent history'));
const oneLong=rows.map((x,i)=>i<100?{...x,t:x.t-15*60000}:x);A.equal(S.missingBars(oneLong),3);A.ok(run({},{},oneLong).reasons.includes('Too many gaps in recent history'),'a single 20-minute hole used to count as one gap');
A.equal(run({},{},oneLong,{maxMissingBars:3}).reasons.includes('Too many gaps in recent history'),false);

// Optional: Popdex overnight exclusion, off by default.
A.equal(run({session:'OVERNIGHT'},{}).reasons.includes('Popdex overnight session excluded'),false);
A.ok(run({session:'OVERNIGHT'},{},rows,{excludePopdexOvernight:true}).reasons.includes('Popdex overnight session excluded'));
A.equal(run({session:'TRADING'},{},rows,{excludePopdexOvernight:true}).reasons.includes('Popdex overnight session excluded'),false);
console.log('Scoring audit checks passed: edge to take-profit, hourly Arcus/Ondo funding, size-aware book costs with Popdex thin-book penalty, gaps by duration, optional Popdex overnight exclusion.');
