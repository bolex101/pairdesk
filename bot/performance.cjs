const fs=require('node:fs'),path=require('node:path'),Store=require('./storage.cjs'),Core=require('./positions.cjs');
const VERSION='paper-v1-confirm1',MAX_GAP=120000;
function metadata(pair){return {version:VERSION,score:pair.score,signalZ:pair.z,confirmZ:pair.confirm,minConfirmZ:1,slippageBpsPerSide:3,feeBps:[pair.a.takerBps,pair.b.takerBps],funding:'unavailable',feeBasis:'Public quoted taker rate at signal time; frozen for exit',execution:'Indicative bid/ask; fixed entry units; slippage deducted as cash cost'};}
function valid(p){const m=p?.research;return p?.ready&&m?.version===VERSION&&Number.isFinite(m.score)&&m.score>=0&&m.score<=100&&Array.isArray(m.feeBps)&&m.feeBps.length===2&&m.feeBps.every(n=>Number.isFinite(n)&&n>=0)&&Number.isFinite(m.slippageBpsPerSide)&&m.slippageBpsPerSide>=0&&[p.createdAt,p.expiresAt,p.maxHoldMinutes,p.beta,p.alpha,p.sd,p.tpZ,p.stopZ].every(Number.isFinite)&&p.maxHoldMinutes>0&&p.sd>0&&p.beta>0&&[p.a,p.b].every(l=>l&&['LONG','SHORT'].includes(l.side)&&[l.entry,l.units,l.notional,l.quoteTime].every(Number.isFinite)&&l.entry>0&&l.units>0&&l.notional>0);}
// Scanner writes a separate immutable receipt only after Telegram confirms delivery.
function receipt(dir,id,plan){
 if(!/^[a-f0-9]{12}$/.test(id)||!valid(plan))throw Error('Invalid performance receipt');
 const folder=path.join(dir,'performance-signals');fs.mkdirSync(folder,{recursive:true,mode:0o700});
 Store.save(path.join(folder,id+'.json'),{id,plan,deliveredAt:Date.now()});
}
function state(s){s.performance??={version:1,startedAt:Date.now(),records:{}};if(s.performance.version!==1||!s.performance.records)throw Error('Unsupported performance state');return s.performance;}
function ingest(s,dir,now=Date.now()){
 const st=state(s),folder=path.join(dir,'performance-signals');if(!fs.existsSync(folder))return;
 for(const file of fs.readdirSync(folder).filter(f=>/^[a-f0-9]{12}\.json$/.test(f))){
  const id=file.slice(0,12);if(st.records[id])continue;
  // Never silently turn malformed input into a reported win or loss.
  let item;try{item=JSON.parse(fs.readFileSync(path.join(folder,file),'utf8'));}catch{continue;}
  if(item.id!==id||!valid(item.plan)){st.records[id]={id,status:'excluded',reason:'Invalid saved signal metadata'};continue;}
  const p=item.plan;
  const r={id,signalId:id,plan:p,score:p.research.score,venue:p.venue,status:'open',enteredAt:p.createdAt,deadline:p.createdAt+p.maxHoldMinutes*60000,lastSeen:p.createdAt,priceA:p.a.entry,priceB:p.b.entry,notionalA:p.a.units*p.a.entry,notionalB:p.b.units*p.b.entry,observations:0};
  st.records[id]=r;
  if(now-p.createdAt>MAX_GAP||now<p.createdAt||[p.a,p.b].some(l=>p.createdAt-l.quoteTime>MAX_GAP||l.quoteTime>p.createdAt+5000)){r.status='excluded';r.reason='Monitoring started too late or entry quotes were stale';}
 }
}
function open(s){return Object.values(state(s).records).filter(r=>r.status==='open');}
function observe(s,r,quotes,now=Date.now()){
 if(r.status!=='open')return;
 // A gap can hide the first stop/target crossing. Exclude instead of inventing an outcome.
 if(now-r.lastSeen>MAX_GAP){r.status='excluded';r.reason='Observation gap exceeded two minutes';r.excludedAt=now;return;}
 const value=Core.readQuotes(r,quotes,now);if(!value)return;
 r.lastSeen=now;r.observations++;r.last=value;
 const short=r.plan.a.side==='SHORT';
 const stop=short?value.z>=r.plan.stopZ:value.z<=r.plan.stopZ;
 const tp=short?value.z<=r.plan.tpZ:value.z>=r.plan.tpZ;
 // At/after the deadline, classify as TIME; a prior crossing cannot be inferred.
 const reason=now>=r.deadline?'TIME':stop?'STOP':tp?'TP':null;
 if(!reason)return;
 let fees=0,slippage=0;
 for(const [i,leg] of [r.plan.a,r.plan.b].entries()){
  const q=i===0?quotes.a:quotes.b,exit=leg.side==='LONG'?q.bid:q.ask;
  const turnover=leg.units*(leg.entry+exit);
  fees+=turnover*r.plan.research.feeBps[i]/10000;
  slippage+=turnover*r.plan.research.slippageBpsPerSide/10000;
 }
 const net=value.pnl-fees-slippage,gross=r.notionalA+r.notionalB;
 Object.assign(r,{status:'closed',exitReason:reason,exitedAt:now,exitQuotes:quotes,quotedPnl:value.pnl,estimatedFees:fees,slippageAllowance:slippage,estimatedNetBeforeFunding:net,returnBps:net/gross*10000,outcome:Math.abs(net)<1e-8?'flat':net>0?'win':'loss'});
}
function report(s,venue){
 const st=state(s),all=Object.values(st.records),rows=all.filter(r=>!venue||r.venue===venue),closed=rows.filter(r=>r.status==='closed');
 const lines=['SIMULATED SIGNAL PERFORMANCE'+(venue?' — '+venue:''),'Since '+new Date(st.startedAt).toISOString().slice(0,10)+' UTC · '+VERSION,'After quoted spreads, estimated fees and 3 bps/side slippage; BEFORE funding. Not actual fills or actual trading returns.',''];
 for(const [lo,hi] of [[0,49],[50,59],[60,69],[70,79],[80,89],[90,100]]){
  const set=rows.filter(r=>r.score>=lo&&r.score<=hi),done=set.filter(r=>r.status==='closed'),wins=done.filter(r=>r.outcome==='win').length;
  const mean=done.length?done.reduce((n,r)=>n+r.returnBps,0)/done.length:null;
  lines.push('• '+lo+'–'+hi+': '+done.length+' closed; '+(done.length?(wins/done.length*100).toFixed(1)+'% wins':'win rate pending')+'; avg '+(mean===null?'—':mean.toFixed(2)+' bps')+'; '+set.filter(r=>r.status==='open').length+' open; '+set.filter(r=>r.status==='excluded').length+' excluded');
 }
 const losses=closed.filter(r=>r.outcome==='loss').length,flats=closed.filter(r=>r.outcome==='flat').length;
 lines.push('','Closed: '+closed.length+'; wins '+closed.filter(r=>r.outcome==='win').length+', losses '+losses+', flat '+flats+'. Wins / all closed (flats included).','Exits: TP '+closed.filter(r=>r.exitReason==='TP').length+', stop '+closed.filter(r=>r.exitReason==='STOP').length+', time '+closed.filter(r=>r.exitReason==='TIME').length+'. TP is not automatically a net win.','Excluded: '+rows.filter(r=>r.status==='excluded').length+' (late/missing/invalid data); excluded results are not counted as wins or losses.');
 if(!venue)lines.push('By exchange: /performance Popdex, /performance Arcus, /performance Variational, /performance Ondo, /performance Phoenix, /performance QFEX, /performance RISEx');
 lines.push('All delivered signals are independent paper trades, including overlaps. Small samples, correlated signals and data exclusions can distort results. Quotes are sampled, not executable fills. Older signals are not backfilled.');
 return lines.join('\n');
}
module.exports={metadata,valid,receipt,ingest,open,observe,report,VERSION};
