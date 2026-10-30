const A=require('node:assert/strict'),Fd=require('./funding.js'),F=require('./feeds.js'),S=require('./scan-engine.js'),P=require('./trade-plan.cjs'),Perf=require('./performance.cjs'),Rules=require('./alert-rules.cjs'),X=require('./extra-venues.cjs'),N=require('./new-venues.cjs');
const near=(a,b,e=1e-9)=>A.ok(Math.abs(a-b)<=e,a+' != '+b);
// Normalisation: positive perp rate => long pays, short receives; converted to per hour.
const h=Fd.perp('0.0008',8*3600);near(h.long,0.0001);near(h.short,-0.0001);
A.equal(Fd.perp(null,3600),null);A.equal(Fd.perp('0.001',null),null);A.equal(Fd.perp('x',3600),null);
const sw=Fd.swap('0.0002','0.0001',86400);near(sw.long,0.0002/24);near(sw.short,-0.0001/24);
// Expected hold from half-life: z 2 -> exit 0.5 is two half-lives; capped by max hold; floor 5 minutes.
near(Fd.expectedHoldMinutes(30,2,0.5,120),60);A.equal(Fd.expectedHoldMinutes(30,6,0.01,120),120);A.equal(Fd.expectedHoldMinutes(1,0.31,0.3,120),5);
// Pair carry in bps of gross: beta 1 => equal weights. Short A pays when A funding negative.
const a={id:'A',fundingHourly:Fd.perp(-0.0001,3600)},b={id:'B',fundingHourly:Fd.perp(0.0001,3600)};
let c=Fd.pairCarry(a,b,1,1,60);A.equal(c.known,true);A.equal(c.sideA,'SHORT');near(c.hourlyBps.a,1);near(c.hourlyBps.b,1);near(c.bps,1);
c=Fd.pairCarry(a,b,-1,1,60);near(c.bps,-1);A.ok(Fd.describe(c).includes('income'));
// Unknown funding is flagged, never treated as known zero.
c=Fd.pairCarry({id:'A'},b,1,1,60);A.equal(c.known,false);A.deepEqual(c.missing,['A']);A.equal(c.bps,null);A.ok(Fd.describe(c).startsWith('unknown'));
A.equal(Fd.describe(null),'unknown');
// Venue adapters.
const arcus=F.normalize('Arcus',{markets:[{marketDisplayName:'NVDA-USD',category:'EQUITIES',status:'ONLINE',markPrice:'100',fundingRate:'0.0001',type:'PERPETUAL'}]})[0];
A.equal(arcus.fundingHourly,null,'Arcus interval unverified unless configured');
Fd.setIntervals({Arcus:3600});near(F.normalize('Arcus',{markets:[{marketDisplayName:'X',markPrice:'1',fundingRate:'0.0001'}]})[0].fundingHourly.long,0.0001);Fd.setIntervals({Arcus:null});
const v=F.normalize('Variational',{listings:[{ticker:'NVDA-PERP',name:'NVIDIA Corporation',contract_type:'perpetual',mark_price:'1',funding:{last:{interval_rate:'0.0004'},next:{interval_rate:'0.0008'},interval_seconds:28800}},{ticker:'T-SWAP',name:'Gold',contract_type:'swap',mark_price:'1',funding:{next:{interval_long_rate:'0.0024',interval_short_rate:'0.0012'},interval_seconds:86400}},{ticker:'Z',name:'Gold',contract_type:'perpetual',mark_price:'1'}]});
near(v[0].fundingHourly.long,0.0001);near(v[1].fundingHourly.long,0.0001);near(v[1].fundingHourly.short,-0.00005);A.equal(v[2].fundingHourly,null);
const pop=F.normalize('Popdex',{code:'200',data:[{symbol:'NVDAUSDT',markPrice:'1',fundingRate:'0.0001'}]},{code:'200',data:[{symbol:'NVDAUSDT',assetClass:'Rwa',fundingInterval:'1',feeRates:[]},{symbol:'B',assetClass:'Rwa',feeRates:[]}]});
near(pop[0].fundingHourly.long,0.0001);A.equal(pop[1].fundingHourly,null);
const ph=N.listPhoenix({exchange:{active:true},markets:[{symbol:'XAU',marketStatus:'active',takerFee:0.0005,commodityMetadata:{isCommodity:true,isAfterHours:false}}]},{markets:[{symbol:'XAU',mark_price:1,eight_hour_funding_rate:0.08}]})[0];near(ph.fundingHourly.long,0.0001);near(ph.funding,0.0008);
// Phoenix reports PERCENT: live BTC sample (2026-10-31) 8h 0.0283772463881 % => 0.0035 %/h => ~31 %/yr, not ~3,100 %/yr.
near(N.phoenixEightHourFraction({eight_hour_funding_rate:0.0283772463881}),0.000283772463881);
const btc=N.listPhoenix({exchange:{active:true},markets:[{symbol:'BTC',marketStatus:'active',takerFee:0.00035}]},{markets:[{symbol:'BTC',mark_price:77187,eight_hour_funding_rate:0.0283772463881,annualized_funding_rate:31.0730847949}]})[0];
near(btc.fundingHourly.long*24*365*100,31.0730847949,1e-6);A.ok(btc.fundingHourly.long*24*365<1,'Phoenix BTC funding must be a sane fraction');
A.equal(N.listPhoenix({exchange:{active:true},markets:[{symbol:'X',marketStatus:'active'}]},{markets:[{symbol:'X'}]})[0].fundingHourly,null);
const ondo=N.listOndo({success:true,result:[{productType:'perpetual',contractType:'linear',market:'NVDA-USD.P',tags:['Stock'],bid:'1',ask:'1',fundingRate:'0.0001',takerFee:'0.0005',isClosed:false}]})[0];A.equal(ondo.fundingHourly,null);
// Scan analysis: funding raises the bar when the pair pays, income credit is capped at half the friction.
const now=1800000000000,bar=300000,rows=Array.from({length:240},(_,i)=>({t:now-(240-i)*bar,a:Math.exp(4+i*.001+.01*Math.sin(i*.4)),b:Math.exp(4+i*.001)}));
const q={id:'A',type:'PERPETUAL',status:'ONLINE',price:100,bid:99.99,ask:100.01,spread:2,takerBps:2,volume:1e7,quoteTime:now,requireQuote:true};
const engine={stats:()=>({beta:1,alpha:0,sd:.01,z:2,confirm:2}),fit:()=>({alpha:0,beta:1}),corr:()=>.8};
const base=S.analyze({a:q,b:{...q,id:'B'}},rows,engine,now);A.equal(base.funding.known,false);A.equal(base.eligible,true);A.equal(base.totalCost,base.cost);
const paying=S.analyze({a:{...q,fundingHourly:Fd.perp(-0.002,3600)},b:{...q,id:'B',fundingHourly:Fd.perp(0.002,3600)}},rows,engine,now);
A.equal(paying.funding.known,true);A.ok(paying.funding.bps>0);near(paying.totalCost,paying.cost+paying.funding.bps);A.equal(paying.eligible,false);A.ok(paying.reasons.includes('Estimated move less than twice friction plus funding'));
const earning=S.analyze({a:{...q,fundingHourly:Fd.perp(0.002,3600)},b:{...q,id:'B',fundingHourly:Fd.perp(-0.002,3600)}},rows,engine,now);
near(earning.totalCost,earning.cost*0.5);
A.ok(S.analyze({a:q,b:{...q,id:'B'}},rows,engine,now,3,{requireKnownFunding:true}).reasons.includes('Funding unknown'));
// Plan and alert text show funding; unknown is explicit; performance metadata no longer 'unavailable'.
const fit={beta:1,alpha:0,sd:.01};
const pairFor=f=>({setup:true,eligible:true,...fit,z:2,cost:10,totalCost:10+(f.known?f.bps:0),funding:f,rows:[{t:now-300000}],a:{id:'A',bid:Math.exp(.02)-.001,ask:Math.exp(.02)+.001,quoteTime:now,takerBps:2},b:{id:'B',bid:.999,ask:1.001,quoteTime:now,takerBps:2},score:80,confirm:2,corr:.9,half:30,edge:50});
const known={known:true,missing:[],sideA:'SHORT',sideB:'LONG',holdMinutes:60,hourlyBps:{a:1,b:1},perHourBps:1,bps:1,source:[]};
const plan=P.build(pairFor(known),'Popdex',now),noF=P.build(pairFor({known:false,missing:['A']}),'Popdex',now);
A.equal(plan.ready,true);near(plan.funding.usd,0.1);near(noF.targetNet-plan.targetNet,0.1);
A.ok(P.lines(plan).some(l=>l.startsWith('Expected funding: pay 0.10')));A.ok(P.lines(noF).some(l=>l.includes('unknown')&&l.includes('NOT included')));
const msg=Rules.message({venue:'Popdex',side:'Short A / Long B',pair:pairFor(known),plan});A.ok(msg.includes('• Expected funding: +1.00 bps'));
const meta=Perf.metadata(pairFor(known));A.deepEqual(meta.funding.hourlyBps,[1,1]);A.equal(meta.funding.known,true);A.equal(Perf.metadata(pairFor({known:false,missing:['B']})).funding.known,false);
// Paper trade accrues funding at frozen rates over the actual holding time.
const research={...meta,feeBps:[0,0],slippageBpsPerSide:0};
const rec={id:'x',status:'open',enteredAt:now,lastSeen:now,deadline:now+7200000,priceA:102,priceB:100,notionalA:510,notionalB:500,plan:{venue:'Popdex',createdAt:now,expiresAt:now+300000,maxHoldMinutes:120,beta:1,alpha:0,sd:.01,tpZ:.3,stopZ:4,a:{id:'A',side:'SHORT',entry:102,units:5,notional:510,quoteTime:now},b:{id:'B',side:'LONG',entry:100,units:5,notional:500,quoteTime:now},research},observations:0,score:80};
const s={performance:{version:1,startedAt:now,records:{x:rec}}};
Perf.observe(s,rec,null,now+60000);A.equal(rec.status,'open');// missing quotes never invent an outcome
const rec2={...rec,id:'y',status:'open',lastSeen:now+3540000};s.performance.records.y=rec2;
Perf.observe(s,rec2,{a:{bid:100,ask:100,quoteTime:now+3600000},b:{bid:100,ask:100,quoteTime:now+3600000}},now+3600000);
A.equal(rec2.exitReason,'TP');near(rec2.estimatedFunding,(510+500)/10000);near(rec2.estimatedNetAfterFunding,rec2.estimatedNetBeforeFunding-(1010/10000));
A.ok(Perf.report(s).includes('1 closed with known funding'));
// QFEX / RISEx funding.
const qf=X.listQfex({data:[{product_type:'Perpetual',target_currency:'USD',ticker_id:'AAPL-USD',base_currency:'AAPL',last_price:'1',target_volume:'1',funding_rate:'0.0001',funding_interval_minutes:60}]},{data:[{symbol:'AAPL-USD',quote_asset:'USD',base_asset:'AAPL',product_category:'EQUITY',status:'ACTIVE',market_hours:{tz:'America/New_York'}}]})[0];near(qf.fundingHourly.long,0.0001);
const ri=X.listRise({data:{markets:[{market_id:'5',category:'stocks',config:{name:'AAPL/USDC',unlocked:true},base_asset_symbol:'AAPL/USDC',quote_asset_symbol:'USDC',mark_price:'1',quote_volume_24h:'1',active:true,reduce_only:false,post_only:false,funding_rate_8h:'0.0008'}]}})[0];near(ri.fundingHourly.long,0.0001);
console.log('Funding checks passed: per-hour normalisation, swap legs, unknown intervals flagged, half-life hold, pair carry sign, cost gate, capped income credit, plan/alert text, paper accrual');
