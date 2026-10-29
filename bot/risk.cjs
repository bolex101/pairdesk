'use strict';
// Position risk checks: distance to liquidation and hedge-ratio drift. Notifications only.
const DEFAULTS=Object.freeze({liquidationAlertPct:15,hedgeDriftAlertPct:10});
let settings={...DEFAULTS};
function configure(o={}){
 const next={...DEFAULTS,...o};
 if(!(next.liquidationAlertPct>0&&next.liquidationAlertPct<100)||!(next.hedgeDriftAlertPct>0&&next.hedgeDriftAlertPct<100))throw Error('Invalid risk settings');
 settings=next;return settings;
}
// Liquidation price, only when an exchange position object exposes one. Never estimated.
const LIQ_FIELDS=['liquidation_price','liquidationPrice','liqPrice','liquidationPriceUsd','estimatedLiquidationPrice','estLiqPrice'];
function pickLiquidation(raw){
 for(const k of LIQ_FIELDS){const v=raw?.[k];if(v===null||v===undefined||v==='')continue;const n=Number(v);if(Number.isFinite(n)&&n>0)return n;}
 return null;
}
const withLiquidation=(row,raw)=>{const liq=pickLiquidation(raw);return liq?{...row,liquidationPrice:liq}:row;};
// Fraction of the current price the market must move against the leg to reach liquidation.
function liquidationDistance(side,mark,liq){
 if(!(mark>0)||!(liq>0))return null;
 const d=side==='LONG'?(mark-liq)/mark:side==='SHORT'?(liq-mark)/mark:NaN;
 return Number.isFinite(d)?d:null;
}
// Current value-weighted hedge ratio relative to the plan's beta (B value / A value = beta).
function hedgeDrift(p,midA,midB){
 if(![p.notionalA,p.notionalB,p.priceA,p.priceB,p.plan?.beta].every(v=>Number.isFinite(v)&&v>0))return null;
 const va=p.notionalA/p.priceA*(midA>0?midA:p.priceA),vb=p.notionalB/p.priceB*(midB>0?midB:p.priceB);
 const ratio=vb/va;return {ratio,drift:ratio/p.plan.beta-1};
}
/* Episode-based de-duplication: alert on entering the zone, again only if it gets
   materially worse (liquidation distance halves / drift doubles), and re-arm only
   after a clear recovery (hysteresis), so a value hovering at the line cannot spam. */
function episode(state,breached,level,worse,recovered){
 if(!state.active){if(breached){state.active=true;state.level=level;return true;}return false;}
 if(recovered){state.active=false;state.level=null;return false;}
 if(worse(level,state.level)){state.level=level;return true;}
 return false;
}
function check(s,p,quotes,now,queue){
 if(p.closedAt||p.test)return;
 p.risk??={};
 const label=p.id+': '+p.plan.venue+' '+p.plan.a.id+' / '+p.plan.b.id;
 const mid=q=>q&&q.bid>0&&q.ask>=q.bid?(q.bid+q.ask)/2:null;
 const mids={a:mid(quotes?.a),b:mid(quotes?.b)};
 const zone=settings.liquidationAlertPct/100;
 for(const leg of ['a','b']){
  const liq=p.liquidation?.[leg],side=p.plan[leg].side,d=liquidationDistance(side,mids[leg],liq);
  if(d===null)continue;
  const st=p.risk['liq_'+leg]??={active:false,level:null};
  if(episode(st,d<=zone,d,(n,o)=>n<=o/2,d>zone*4/3))queue(s,p.id+':risk:liq:'+leg+':'+now,['PAIRDESK — LIQUIDATION RISK',label,
   '• '+side+' '+p.plan[leg].id+' is '+(Math.max(d,0)*100).toFixed(1)+'% from its liquidation price '+Number(liq.toPrecision(8))+' (mid '+Number(mids[leg].toPrecision(8))+').',
   '• Alert threshold: '+settings.liquidationAlertPct+'%. Add margin or reduce BOTH legs together to keep the hedge.',
   '• Liquidation price as reported by the exchange account feed. I have not changed anything.'].join('\n'));
 }
 const h=hedgeDrift(p,mids.a,mids.b);
 if(h){
  const limit=settings.hedgeDriftAlertPct/100,mag=Math.abs(h.drift),st=p.risk.drift??={active:false,level:null};
  if(episode(st,mag>limit,mag,(n,o)=>n>=o+limit,mag<limit*0.8))queue(s,p.id+':risk:drift:'+now,['PAIRDESK — HEDGE DRIFT',label,
   '• Current value ratio '+p.plan.b.id+'/'+p.plan.a.id+' = '+h.ratio.toFixed(3)+' vs plan beta '+p.plan.beta.toFixed(3)+' ('+(h.drift>0?'+':'')+(h.drift*100).toFixed(1)+'%).',
   '• Alert threshold: '+settings.hedgeDriftAlertPct+'%. The pair is no longer delta-matched; rebalance one leg or close both.',
   '• Based on '+(mids.a&&mids.b?'live mid prices':'entry prices')+' and '+(p.wallet?'synced wallet sizes':'registered sizes')+'.'].join('\n'));
 }
}
module.exports={DEFAULTS,configure,settings:()=>settings,LIQ_FIELDS,pickLiquidation,withLiquidation,liquidationDistance,hedgeDrift,check};
