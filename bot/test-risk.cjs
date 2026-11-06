const A=require('node:assert/strict'),R=require('./risk.cjs'),P=require('./positions.cjs'),near=(a,b,e=1e-9)=>A.ok(Math.abs(a-b)<=e,a+' != '+b);
// Liquidation field pick: only real exchange fields, never invented.
A.equal(R.pickLiquidation({liquidation_price:'90.5'}),90.5);A.equal(R.pickLiquidation({liqPrice:0}),null);A.equal(R.pickLiquidation({}),null);
A.deepEqual(R.withLiquidation({symbol:'X'},{}),{symbol:'X'});A.deepEqual(R.withLiquidation({symbol:'X'},{liquidationPrice:'5'}),{symbol:'X',liquidationPrice:5});
near(R.liquidationDistance('LONG',100,90),.1);near(R.liquidationDistance('SHORT',100,120),.2);A.equal(R.liquidationDistance('LONG',100,null),null);
// Hedge drift: B value / A value versus beta.
const now=1800000000000;
const pos=(o={})=>({id:'P1',openedAt:now-60000,deadline:now+3600000,priceA:100,priceB:50,notionalA:1000,notionalB:1000,
 plan:{venue:'Popdex',beta:1,alpha:Math.log(2),sd:.01,tpZ:.3,stopZ:4,a:{id:'A',side:'LONG'},b:{id:'B',side:'SHORT'}},notified:{},...o});
near(R.hedgeDrift(pos(),100,50).drift,0);near(R.hedgeDrift(pos(),100,60).drift,.2);near(R.hedgeDrift(pos({notionalB:1250}),null,null).drift,.25);
A.equal(R.hedgeDrift(pos({priceA:0}),1,1),null);
// End-to-end through positions.evaluate with de-duplication.
const q=(a,b,t)=>({a:{bid:a*.9999,ask:a*1.0001,quoteTime:t},b:{bid:b*.9999,ask:b*1.0001,quoteTime:t}});
const s={positions:{},outbox:[]},p=pos({liquidation:{a:84,b:null}});s.positions.P1=p;
const liqN=o=>o.outbox.filter(x=>x.text.includes('LIQUIDATION RISK')).length;
const run=(a,b,t)=>P.evaluate(s,p,q(a,b,t),t,true);
run(100,50,now);A.equal(liqN(s),0,'healthy: no alerts');
run(98,50,now+60000);A.ok(s.outbox.some(x=>x.text.includes('LIQUIDATION RISK')&&x.text.includes('14.3%')),'within 15% of liquidation');
const n1=liqN(s);run(97.5,50,now+120000);run(98,50,now+180000);A.equal(liqN(s),n1,'no repeat while in the same zone');
run(89,50,now+240000);A.equal(liqN(s),n1+1,'re-alert when distance halves');
run(110,50,now+300000);run(98,50,now+360000);A.equal(liqN(s),n1+2,'re-armed after recovery above 20%, alerts again');
const s2={positions:{},outbox:[]},p2=pos();s2.positions.P1=p2;
const run2=(a,b,t)=>P.evaluate(s2,p2,q(a,b,t),t,true);
run2(100,50,now);run2(100,54,now+1);A.equal(s2.outbox.filter(x=>x.text.includes('HEDGE DRIFT')).length,0,'8% drift below 10% threshold');
run2(100,56,now+2);A.equal(s2.outbox.filter(x=>x.text.includes('HEDGE DRIFT')).length,1);
run2(100,57,now+3);run2(100,55.5,now+4);A.equal(s2.outbox.filter(x=>x.text.includes('HEDGE DRIFT')).length,1,'de-duplicated');
run2(100,62,now+5);A.equal(s2.outbox.filter(x=>x.text.includes('HEDGE DRIFT')).length,2,'escalation at +10pp more drift');
run2(100,50,now+6);run2(100,56,now+7);A.equal(s2.outbox.filter(x=>x.text.includes('HEDGE DRIFT')).length,3,'new episode after recovery');
// Test positions and configurable thresholds.
R.configure({liquidationAlertPct:5,hedgeDriftAlertPct:30});const s3={positions:{},outbox:[]},p3=pos({liquidation:{a:85,b:null}});
P.evaluate(s3,p3,q(98,56,now),now,true);A.ok(!s3.outbox.some(x=>/LIQUIDATION|DRIFT/.test(x.text)),'custom thresholds respected');
const p4=pos({test:true,liquidation:{a:99,b:null}});P.evaluate(s3,p4,q(99.5,80,now),now,true);A.ok(!s3.outbox.some(x=>/LIQUIDATION|DRIFT/.test(x.text)),'test positions skipped');
A.throws(()=>R.configure({liquidationAlertPct:0}));R.configure();
// Wallet sync: liquidation price changes do not destabilise snapshots.
const W=require('./wallet-sync.cjs');A.equal(typeof W.reconcile,'function');
console.log('Risk checks passed: liquidation distance, hedge drift, hysteresis de-duplication, escalation, thresholds');
