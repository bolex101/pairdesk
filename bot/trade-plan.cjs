// Fixed-fit, log-spread reference plans. No orders or leverage assumptions.
const Fd=require('./funding.js');
const DEFAULTS=Object.freeze({gross:1000,exitZ:0.3,stopZ:4,maxHoldMinutes:120,entryValidMinutes:5});
function settings(input={}){
 const c={...DEFAULTS,...input};
 for(const k of Object.keys(DEFAULTS))if(!Number.isFinite(c[k]))throw Error('Invalid plan setting: '+k);
 if(c.gross<=0||c.gross>1e7||c.exitZ<0||c.exitZ>=1.5||c.stopZ<=3||c.stopZ>10||c.maxHoldMinutes<5||c.maxHoldMinutes>1440||c.entryValidMinutes<=0||c.entryValidMinutes>5)throw Error('Plan settings out of range');
 return c;
}
function build(p,venue,now=Date.now(),input={}){
 const c=settings(input),reject=reason=>({ready:false,reason});
 if(!p.setup||!p.eligible)return reject('Pair does not currently qualify');
 if(!Number.isFinite(p.beta)||p.beta<=0||p.beta>=10||!Number.isFinite(p.alpha)||!Number.isFinite(p.sd)||p.sd<=1e-8||!Number.isFinite(p.z)||!Number.isFinite(p.cost)||p.cost<0)return reject('Missing fitted model or costs');
 if(!p.rows?.length||now-p.rows.at(-1).t>900000||p.rows.at(-1).t+300000>now)return reject('Stale or incomplete signal bar');
 for(const m of [p.a,p.b])if(!Number.isFinite(m.bid)||!Number.isFinite(m.ask)||m.bid<=0||m.ask<m.bid||!Number.isFinite(m.quoteTime)||now-m.quoteTime>120000||m.quoteTime>now+5000)return reject('Fresh bid/ask required on both legs');
 if(Math.abs(p.a.quoteTime-p.b.quoteTime)>60000)return reject('Leg quote timestamps are more than one minute apart');
 const midA=(p.a.bid+p.a.ask)/2,midB=(p.b.bid+p.b.ask)/2;
 const z=(Math.log(midA)-p.alpha-p.beta*Math.log(midB))/p.sd;
 if(!Number.isFinite(z)||z*p.z<=0||Math.abs(z)<1.5||Math.abs(z)>3)return reject('Live midpoint relationship has moved outside the entry range');
 const magnitude=Math.abs(z),direction=Math.sign(z),cost=c.gross*p.cost/10000;
 // Expected funding over the half-life-based hold (bps of gross); unknown funding is flagged, not assumed zero in the text.
 const f=p.funding&&typeof p.funding==='object'?p.funding:{known:false,missing:[p.a.id,p.b.id]};
 const fundingBps=f.known&&Number.isFinite(f.bps)?f.bps:0,fundingCost=c.gross*fundingBps/10000;
 const effectiveCost=Number.isFinite(p.totalCost)?p.totalCost:p.cost;
 const targetGross=c.gross*(magnitude-c.exitZ)*p.sd/(1+p.beta);
 if(magnitude*p.sd/(1+p.beta)*10000<2*effectiveCost||targetGross<=cost+Math.max(fundingCost,0))return reject('Current move no longer covers the cost filter and take-profit costs');
 const aNotional=c.gross/(1+p.beta),bNotional=c.gross-aNotional;
 const entryA=direction>0?p.a.bid:p.a.ask,entryB=direction>0?p.b.ask:p.b.bid;
 const ratio=level=>Math.exp(p.alpha+level*p.sd);
 const ratios={entry:Math.exp(Math.log(midA)-p.beta*Math.log(midB)),tp:ratio(direction*c.exitZ),stop:ratio(direction*c.stopZ),entryLow:ratio(direction>0?1.5:-3),entryHigh:ratio(direction>0?3:-1.5)};
 if(Object.values(ratios).some(v=>!Number.isFinite(v)||v<=0))return reject('Spread ratio cannot be represented');
 return {ready:true,venue,...c,createdAt:now,expiresAt:now+c.entryValidMinutes*60000,beta:p.beta,alpha:p.alpha,sd:p.sd,z,
  a:{id:p.a.id,side:direction>0?'SHORT':'LONG',notional:aNotional,entry:entryA,units:aNotional/entryA,quoteTime:p.a.quoteTime},
  b:{id:p.b.id,side:direction>0?'LONG':'SHORT',notional:bNotional,entry:entryB,units:bNotional/entryB,quoteTime:p.b.quoteTime},
  tpZ:direction*c.exitZ,stopZ:direction*c.stopZ,tpOperator:direction>0?'≤':'≥',stopOperator:direction>0?'≥':'≤',ratios,
  cost,funding:{...f,usd:f.known&&Number.isFinite(f.bps)?fundingCost:null},
  targetNet:targetGross-cost-fundingCost,stopLoss:c.gross*(c.stopZ-magnitude)*p.sd/(1+p.beta)+cost+fundingCost};
}
const price=n=>Number(n.toPrecision(8)).toString();
// Unmistakable leg instructions shown at the top of every alert: one BUY, one SELL.
const LEG_REMINDER='⚠️ One leg BUY, one leg SELL. Never both the same direction.';
function sideLabel(side){return side==='LONG'?'🟢 BUY (LONG)':side==='SHORT'?'🔴 SELL (SHORT)':'⚠️ UNKNOWN SIDE';}
const money=n=>Number.isFinite(n)?'$'+Math.round(n).toLocaleString('en-US'):'$?';
const entryPrice=n=>!Number.isFinite(n)?'?':Math.abs(n)>=1?n.toFixed(2):Number(n.toPrecision(4)).toString();
function legLine(m){return sideLabel(m.side)+' '+m.id+(Number.isFinite(m.notional)?' — '+money(m.notional):'')+(Number.isFinite(m.entry)?' at '+entryPrice(m.entry):'');}
// Returns [] unless the plan has exactly one LONG and one SHORT leg.
function actionLines(p){
 if(!p?.a||!p?.b||[p.a.side,p.b.side].sort().join()!=='LONG,SHORT')return [];
 const order=p.a.side==='LONG'?[p.a,p.b]:[p.b,p.a];
 return [...order.map(legLine),LEG_REMINDER];
}
function lines(p){
 if(!p.ready)return ['MANAGEMENT PLAN UNAVAILABLE: '+p.reason];
 const currency=p.venue==='Popdex'?'USDT':'USD-equivalent';
 const leg=m=>`${sideLabel(m.side)} ${m.id}: ${m.notional.toFixed(2)} ${currency} @ ~${price(m.entry)} (${price(m.units)} underlying-equivalent units)`;
 return ['MANUAL PAIR PLAN',`Gross ${p.gross.toFixed(2)} ${currency}, both legs combined (not margin)`,
  `Hedge beta ${p.beta.toPrecision(12)}: B notional / A notional`,leg(p.a),leg(p.b),
  'Entry refs: short at bid, long at ask; indicative, not guaranteed fills.',
  `Live midpoint z ${p.z.toFixed(2)}; entry window expires ${new Date(p.expiresAt).toISOString()}`,
  'Entry only while same-direction |fixed z| is 1.5–3; recheck quotes and costs before entry.',
  `PAIR TAKE PROFIT: z ${p.tpOperator} ${p.tpZ.toFixed(2)}; close BOTH legs`,
  `PAIR STOP: z ${p.stopOperator} ${p.stopZ.toFixed(2)}; close BOTH legs`,
  `Pair ratio R = midpoint(${p.a.id}) / midpoint(${p.b.id})^beta`,
  `R now ${p.ratios.entry.toPrecision(12)} | TP ${p.tpOperator} ${p.ratios.tp.toPrecision(12)} | stop ${p.stopOperator} ${p.ratios.stop.toPrecision(12)}`,
  `Entry R range ${p.ratios.entryLow.toPrecision(12)}–${p.ratios.entryHigh.toPrecision(12)}`,
  `Approx. net at TP +${p.targetNet.toFixed(2)} ${currency}; at stop -${p.stopLoss.toFixed(2)} ${currency}; estimated round-trip friction ${p.cost.toFixed(2)} ${currency}`,
  'Expected funding: '+(p.funding?.known&&Number.isFinite(p.funding.usd)?(p.funding.usd>=0?'pay ':'receive ')+Math.abs(p.funding.usd).toFixed(2)+' '+currency+' — '+Fd.describe(p.funding):Fd.describe(p.funding))+(p.funding?.known?'; included in the TP/stop estimates above':'; NOT included'),
  `Time exit: close both legs after ${p.maxHoldMinutes} minutes from actual entry if neither exit occurs.`,
  'Keep this alert’s beta and ratio thresholds fixed; later alerts may use a different fit.',
  'Quantities are estimates, not contract counts: verify lot sizes, multipliers and minimums. Funding is estimated from current rates and can change; market impact excluded; losses may exceed estimates.',
  'No orders/stops placed. Monitoring begins after verified wallet matching (Arcus/Popdex) or Telegram registration. Check /positions.'];
}
module.exports={DEFAULTS,settings,build,lines,sideLabel,legLine,actionLines,LEG_REMINDER};
