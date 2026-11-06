// Alerts must make the BUY leg and SELL leg impossible to misread.
const assert=require('node:assert/strict'),P=require('./trade-plan.cjs'),A=require('./alert-rules.cjs'),S=require('./shared-channel.cjs'),C=require('./positions.cjs');
const now=Date.UTC(2026,9,30,12);
assert.equal(P.sideLabel('LONG'),'🟢 BUY (LONG)');assert.equal(P.sideLabel('SHORT'),'🔴 SELL (SHORT)');
const plan={ready:true,venue:'Arcus',a:{id:'SNDK-USD',side:'LONG',notional:497.2,entry:1271.5,units:.39,quoteTime:now},b:{id:'MU-USD',side:'SHORT',notional:502.8,entry:900.05,units:.56,quoteTime:now}};
assert.deepEqual(P.actionLines(plan),['🟢 BUY (LONG) SNDK-USD — $497 at 1271.50','🔴 SELL (SHORT) MU-USD — $503 at 900.05',P.LEG_REMINDER]);
// BUY line always comes first, whichever leg is A.
const flipped={...plan,a:{...plan.b},b:{...plan.a}};assert.match(P.actionLines(flipped)[0],/^🟢 BUY \(LONG\) SNDK-USD/);
// Never render two same-direction legs as an instruction.
assert.deepEqual(P.actionLines({...plan,b:{...plan.b,side:'LONG'}}),[]);
assert.equal(P.legLine({id:'X',side:'SHORT',notional:1500,entry:.012345}),'🔴 SELL (SHORT) X — $1,500 at 0.01235');
// Scanner alert: legs and reminder appear right after the header, before signal details.
for(const z of [2,-2]){
 const b=50,alpha=.2,beta=1,sd=.01,a=Math.exp(alpha+beta*Math.log(b)+z*sd),m=(id,mid)=>({id,bid:mid*.9999,ask:mid*1.0001,quoteTime:now});
 const pair={a:m('AAA',a),b:m('BBB',b),alpha,beta,sd,z,edge:Math.abs(z)*sd/(1+beta)*10000,cost:4,setup:true,eligible:true,score:85,confirm:z,half:30,corr:.8,rows:[{t:now-300000,a,b}]};
 const built=P.build(pair,'Arcus',now);assert.equal(built.ready,true);
 const text=A.message({venue:'Arcus',pair,side:'x',plan:built}),lines=text.split('\n');
 const buy=z>0?'BBB':'AAA',sell=z>0?'AAA':'BBB';
 assert.match(lines[3],new RegExp('^🟢 BUY \\(LONG\\) '+buy+' — \\$\\d+ at \\d+\\.\\d\\d$'));
 assert.match(lines[4],new RegExp('^🔴 SELL \\(SHORT\\) '+sell+' — \\$\\d+ at \\d+\\.\\d\\d$'));
 assert.equal(lines[5],P.LEG_REMINDER);
 assert.ok(text.indexOf(P.LEG_REMINDER)<text.indexOf('SIGNAL DETAILS'));
 assert.ok(text.includes('PAIR TAKE PROFIT')&&text.includes('Score: 85/100'));
 assert.ok(!/\bLONG [A-Z]{3}:/.test(text.replace(/\(LONG\) /g,'')),'plan legs labelled');
 const shared=S.message({venue:'Arcus',pair,plan:built});assert.ok(shared.includes(P.LEG_REMINDER));assert.ok(shared.includes('🟢 BUY (LONG) '+buy));
}
// Without a ready plan, direction falls back to the signal z sign.
const bare=A.message({venue:'Arcus',pair:{a:{id:'AAA'},b:{id:'BBB'},z:2,score:80,rows:[{t:now}]},side:'x'});
assert.ok(bare.includes('🟢 BUY (LONG) BBB')&&bare.includes('🔴 SELL (SHORT) AAA')&&bare.includes(P.LEG_REMINDER));
// Position registration restates the legs with labels and the reminder.
const s=C.initial(),pp={ready:true,venue:'Arcus',a:{id:'A',side:'SHORT'},b:{id:'B',side:'LONG'},alpha:0,beta:1,sd:.01,z:2,tpZ:.3,stopZ:4,maxHoldMinutes:120,createdAt:now-60000,expiresAt:now+240000};
C.handle(s,{update_id:1,message:{text:'/open aabbccddeeff',date:now/1000,chat:{id:42,type:'private'},from:{id:42,is_bot:false}}},'42',()=>pp,now);
const out=s.outbox.map(x=>x.text).join('\n');assert.ok(out.includes('🔴 SELL (SHORT) A')&&out.includes('🟢 BUY (LONG) B')&&out.includes(P.LEG_REMINDER),out);
console.log('Leg label checks passed: BUY/SELL lines, reminder, ordering, fallback, shared channel, registration');
if(process.argv.includes('--preview')){const b=50,z=2.1,a=Math.exp(.2+Math.log(b)+z*.01),m=(id,mid)=>({id,bid:mid*.9999,ask:mid*1.0001,quoteTime:now});const pair={a:m('MU-USD',a),b:m('SNDK-USD',b),alpha:.2,beta:1,sd:.01,z,edge:10.5,cost:4,setup:true,eligible:true,score:86,confirm:z,half:30,corr:.8,rows:[{t:now-300000,a,b}]};console.log(A.message({venue:'Arcus',pair,side:'x',plan:P.build(pair,'Arcus',now)}));}
