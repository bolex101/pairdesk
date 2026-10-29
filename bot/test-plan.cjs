const assert=require('node:assert/strict'),P=require('./trade-plan.cjs'),A=require('./alert-rules.cjs'),S=require('./scan-engine.js'),E=require('./engine.js');
const now=Date.UTC(2026,9,19,12),epsilon=1e-9;
const near=(x,y)=>assert.ok(Math.abs(x-y)<epsilon, x+' != '+y);
function pair(z=2,beta=2) {
 const b=50,alpha=0.2,sd=.01,a=Math.exp(alpha+beta*Math.log(b)+z*sd);
 const market=(id,mid)=>({id,bid:mid*.9999,ask:mid*1.0001,quoteTime:now});
 return {a:market('TEST-A',a),b:market('TEST-B',b),alpha,beta,sd,z,edge:Math.abs(z)*sd/(1+beta)*10000,cost:4,setup:true,eligible:true,score:70,confirm:z,half:30,corr:.8,rows:[{t:now-300000,a,b}]};
}
for(const z of [2,-2]){
 const p=pair(z),plan=P.build(p,'Popdex',now);assert.equal(plan.ready,true);near(plan.a.notional+plan.b.notional,1000);near(plan.b.notional/plan.a.notional,2);
 near(plan.a.units*plan.a.entry,plan.a.notional);near(plan.b.units*plan.b.entry,plan.b.notional);
 near(plan.z,z);near((Math.log(plan.ratios.tp)-p.alpha)/p.sd,Math.sign(z)*.3);
 near((Math.log(plan.ratios.stop)-p.alpha)/p.sd,Math.sign(z)*4);
 assert.ok(plan.ratios.entryLow<plan.ratios.entry&&plan.ratios.entryHigh>plan.ratios.entry);
 assert.equal(plan.a.side,z>0?'SHORT':'LONG');assert.equal(plan.b.side,z>0?'LONG':'SHORT');
 near(plan.a.entry,z>0?p.a.bid:p.a.ask);near(plan.b.entry,z>0?p.b.ask:p.b.bid);
 assert.equal(plan.tpOperator,z>0?'≤':'≥');assert.equal(plan.stopOperator,z>0?'≥':'≤');
 near(plan.targetNet,1000*1.7*.01/3-.4);near(plan.stopLoss,1000*2*.01/3+.4);
 const double=P.build(p,'Popdex',now,{gross:2000});near(double.targetNet,2*plan.targetNet);near(double.a.units,2*plan.a.units);
 assert.equal(plan.expiresAt,now+300000);
 const text=A.message({venue:'Popdex',pair:p,side:'TEST',plan});
 assert.ok(text.includes('PAIR TAKE PROFIT'));assert.ok(text.includes('close BOTH legs'));assert.ok(text.includes('not contract counts'));assert.ok(text.length<4096);
}
let p=pair();
for(const changed of [{quoteTime:null},{quoteTime:now-120001},{quoteTime:now+5001},{bid:0},{bid:p.a.ask+1},{bid:NaN}]){
 assert.equal(P.build({...p,a:{...p.a,...changed}},'Popdex',now).ready,false);
}
assert.equal(P.build({...p,b:{...p.b,quoteTime:now-61000}},'Popdex',now).ready,false);
assert.equal(P.build({...p,alpha:NaN},'Popdex',now).ready,false);
assert.equal(P.build({...p,rows:[{t:now-1000000}]},'Popdex',now).ready,false);
assert.equal(P.build({...p,rows:[{t:now}]},'Popdex',now).ready,false);
assert.equal(P.build({...pair(1),z:2},'Popdex',now).ready,false);
assert.equal(P.build({...pair(-2),z:2},'Popdex',now).ready,false);
assert.equal(P.build({...p,cost:100},'Popdex',now).ready,false);
for(const config of [{gross:0},{gross:NaN},{exitZ:2},{stopZ:3},{maxHoldMinutes:0}])assert.throws(()=>P.settings(config));
assert.equal(P.lines(P.build(p,'Variational',now)).join('\n').includes('USD-equivalent'),true);
// Real analysis preserves exactly the fitted parameters needed to freeze the plan.
const rows=E.demo(4).slice(-240),fit=E.stats(rows,60),result=S.analyze({a:p.a,b:p.b},rows,E,rows.at(-1).t+300000);
near(result.alpha,fit.alpha);near(result.sd,fit.sd);near(result.beta,fit.beta);
// Frozen plan remains unchanged if a later rolling fit changes.
const frozen=P.build(p,'Popdex',now),oldTarget=frozen.ratios.tp;p.alpha+=.001;near(frozen.ratios.tp,oldTarget);
console.log('Trade plan checks passed: hedge sizing, both directions, targets, costs, expiry, fresh quotes and frozen fit');
if(process.argv.includes('--preview')){
 const demo=pair();const plan=P.build(demo,'Popdex',now);
 console.log('\nSYNTHETIC EXAMPLE — NOT A LIVE SETUP\n'+A.message({venue:'Popdex',pair:demo,side:'Short TEST-A / Long TEST-B',plan}));
}

