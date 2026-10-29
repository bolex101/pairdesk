const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),P=require('./performance.cjs');
const now=1792600000000;
const plan={ready:true,venue:'Popdex',createdAt:now,expiresAt:now+300000,maxHoldMinutes:120,beta:1,alpha:0,sd:.01,tpZ:.3,stopZ:4,a:{id:'A',side:'SHORT',entry:102,units:5,notional:510,quoteTime:now},b:{id:'B',side:'LONG',entry:100,units:5,notional:500,quoteTime:now},research:P.metadata({score:83,z:2,confirm:1.3,a:{takerBps:2},b:{takerBps:2}})};
const folder=fs.mkdtempSync(path.join(__dirname,'performance-test-'));
const quote=(a,b,t)=>({a:{bid:a,ask:a,quoteTime:t},b:{bid:b,ask:b,quoteTime:t}});
function record(s,id,p=plan){P.receipt(folder,id,p);P.ingest(s,folder,now);return s.performance.records[id];}
try{
 const s={};const r=record(s,'111111111111');assert.equal(r.status,'open');assert.equal(r.score,83);
 P.observe(s,r,quote(100,100,now+30000),now+30000);
 assert.equal(r.exitReason,'TP');assert.equal(r.quotedPnl,10);
 // Entry and exit fees charged on each leg's own notional. Spread is already in bid/ask P&L.
 assert.ok(Math.abs(r.estimatedFees-.402)<1e-9);assert.ok(Math.abs(r.slippageAllowance-.603)<1e-9);assert.ok(Math.abs(r.estimatedNetBeforeFunding-8.995)<1e-9);assert.equal(r.outcome,'win');
 P.observe(s,r,quote(110,100,now+60000),now+60000);assert.equal(r.outcome,'win');
 const restart=JSON.parse(JSON.stringify(s));P.ingest(restart,folder,now+60000);assert.equal(Object.keys(restart.performance.records).length,1);assert.equal(restart.performance.records[r.id].outcome,'win');
 const stop=record(s,'222222222222');P.observe(s,stop,quote(105,100,now+30000),now+30000);assert.equal(stop.exitReason,'STOP');assert.equal(stop.outcome,'loss');
 const costly=record(s,'333333333333',{...plan,research:{...plan.research,feeBps:[100,100]}});P.observe(s,costly,quote(100,100,now+30000),now+30000);assert.equal(costly.exitReason,'TP');assert.equal(costly.outcome,'loss');
 const time=record(s,'444444444444',{...plan,maxHoldMinutes:1});P.observe(s,time,quote(102,100,now+60000),now+60000);assert.equal(time.exitReason,'TIME');
 const missing=record(s,'555555555555');P.observe(s,missing,null,now+60000);assert.equal(missing.status,'open');P.observe(s,missing,quote(100,100,now+120001),now+120001);assert.equal(missing.status,'excluded');
 const lateId='666666666666';P.receipt(folder,lateId,plan);P.ingest(s,folder,now+180000);assert.equal(s.performance.records[lateId].status,'excluded');
 assert.throws(()=>P.receipt(folder,'777777777777',{...plan,research:{...plan.research,feeBps:[null,0]}}));
 const longPlan={...plan,tpZ:-.3,stopZ:-4,a:{...plan.a,side:'LONG',entry:98},b:{...plan.b,side:'SHORT'}};
 const long=record(s,'888888888888',longPlan);P.observe(s,long,quote(100,100,now+30000),now+30000);assert.equal(long.outcome,'win');
 const report=P.report(s);assert.ok(report.includes('80–89: 5 closed; 40.0% wins'));assert.ok(report.includes('BEFORE funding'));assert.ok(report.includes('Excluded: 2'));assert.ok(P.report(s,'Arcus').includes('Closed: 0'));
 const stale=record(s,'999999999999');P.observe(s,stale,quote(100,100,now-180000),now+30000);assert.equal(stale.observations,0);
 console.log('Performance checks passed: fee/slippage arithmetic, no spread double-count, both directions, TP loss after costs, stop/time exits, gaps/late starts excluded, restart deduplication, score groups and venue filters.');
}finally{fs.rmSync(folder,{recursive:true,force:true});}
