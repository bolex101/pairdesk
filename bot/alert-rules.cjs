const Plan=require('./trade-plan.cjs'),Fd=require('./funding.js');
const Config=require('./config.cjs');
// Effective alert floor (default 65; override via pairdesk-config.json).
const MIN_ALERT_SCORE=Config.get().minAlertScore;
// Pure alert policy shared by Mac/server runners. No network or secrets.
const keyFor=(venue,pair)=>venue+':'+[pair.a.id,pair.b.id].sort().join('/');
function selectAlerts(venue,results,previous={},now=Date.now(),cooldown=3600000){
 const next={...previous},alerts=[];
 for(const p of results){const key=keyFor(venue,p),old=previous[key]||{},fresh=p.rows?.length&&now-p.rows.at(-1).t<=900000;
 const qualifying=p.setup===true&&p.eligible===true&&fresh&&Number.isFinite(p.score)&&p.score>=Config.get().minAlertScore;
 const side=p.z>0?'Short '+p.a.id+' / Long '+p.b.id:'Long '+p.a.id+' / Short '+p.b.id;
 // Re-arm only after an observed nonqualifying scan. Missing/failed scans are not resets.
 const eligibleToSend=qualifying&&(!old.active||old.side!==side)&&(!old.sentAt||now-old.sentAt>=cooldown);
 next[key]={...old,active:qualifying,side,observedAt:now};
 if(eligibleToSend)alerts.push({key,side,pair:p,venue});
 }
 return {alerts,next};
}
function message(a){
 const p=a.pair,number=v=>Number.isFinite(v)?v.toFixed(2):'unavailable';
 const plan=Plan.lines(a.plan||{ready:false,reason:'Plan not supplied'});
 // Fall back to the signal z sign (z>0: sell A, buy B) when no ready plan carries leg sizes.
 const fallback={a:{id:p.a.id,side:p.z>0?'SHORT':'LONG'},b:{id:p.b.id,side:p.z>0?'LONG':'SHORT'}};
 const legs=Plan.actionLines(a.plan?.ready?a.plan:fallback);
 const direction=[a.plan?.ready?a.plan:fallback].map(q=>Plan.sideLabel(q.a.side)+' '+q.a.id+' / '+Plan.sideLabel(q.b.side)+' '+q.b.id)[0];
 return [
  'Pairdesk: new research setup',
  a.venue+' · '+p.a.id+' / '+p.b.id,
  '',
  ...legs,
  '',
  'SIGNAL DETAILS',
  '• Direction: '+direction,
  '• Score: '+p.score+'/100',
  '• Signal z: '+number(p.z),
  '• 15m z: '+number(p.confirm),
  '• Correlation: '+number(p.corr),
  '• Estimated half-life: '+number(p.half)+' min',
  '• Full-reversion move: '+number(p.edge)+' bps',
  '• Round-trip friction: '+number(p.cost)+' bps',
  '• Expected funding: '+Fd.describe(p.funding),
  '• Price history: '+(p.a.historySource||'Exchange candles'),
  '• Bar / observation bucket opened: '+new Date(p.rows.at(-1).t).toISOString(),
  '',
  plan[0],
  ...plan.slice(1).map(line=>'• '+line),
  '',
  '• Passes configured research filters. Funding estimate included in the cost check where known; market impact excluded. Review before trading.'
 ].join('\n');
}
module.exports={MIN_ALERT_SCORE,keyFor,selectAlerts,message};
