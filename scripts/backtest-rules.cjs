#!/usr/bin/env node
'use strict';
// Walk-forward research backtest of the live Pairdesk alert rules on real 5m candles.
//   node scripts/backtest-rules.cjs fetch [--venues Popdex,Arcus,QFEX] [--days 365] [--data DIR]
//   node scripts/backtest-rules.cjs run   [--venues ...] [--data DIR] [--out FILE]
//   node scripts/backtest-rules.cjs report [--in FILE[,FILE...]]
// "fetch" pages back through each venue's public 5m candle API for the scanner universe and
// saves a snapshot of today's market rows (fees, spreads, funding). "run" replays every bar:
// signal on the bar close with S.analyze + the alert rules, fill on the NEXT bar close, exit on
// the plan's fixed-fit TP/stop/time rules (signal on close, fill next bar). One position per pair.
// Research only: historical spreads/fees/funding are not available, so today's are applied.
const fs=require('node:fs'),path=require('node:path');
const bot=path.join(__dirname,'..','bot');
const F=require(path.join(bot,'feeds.js')),S=require(path.join(bot,'scan-engine.js')),E=require(path.join(bot,'engine.js'));
const D=require(path.join(bot,'data.cjs')),X=require(path.join(bot,'extra-venues.cjs')),N=require(path.join(bot,'new-venues.cjs'));
const Plan=require(path.join(bot,'trade-plan.cjs')),Fd=require(path.join(bot,'funding.js')),Config=require(path.join(bot,'config.cjs'));
const BAR=300000,DAY=86400000,pop='https://app.popdex.xyz/web/v1/';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i>0?process.argv[i+1]:d;};
const venues=arg('venues','Popdex,Arcus,QFEX').split(','),dataDir=arg('data',path.join(process.cwd(),'pairdesk-bt-data'));
const maxDays=Number(arg('days','365')),pause=ms=>new Promise(r=>setTimeout(r,ms));
const plan=Plan.settings(JSON.parse(fs.readFileSync(path.join(bot,'plan-config.json'),'utf8')));

async function marketRows(v){
 if(v==='Popdex'){const [d,c]=await Promise.all([D.get(pop+'market/tickers?category=FUTURES&limit=100'),D.get(pop+'config/symbols')]);return F.normalize(v,d,c);}
 if(v==='Arcus'){const rows=F.normalize(v,await D.get('https://api.arcus.xyz/v1/markets')),u=S.universe(rows).rows,out=[];
  for(const r of rows){if(!u.some(x=>x.id===r.id)){out.push(r);continue;}let q={};try{q=await D.get('https://api.arcus.xyz/v1/bbo/'+encodeURIComponent(r.id));}catch{}out.push(D.arcusQuote(r,q));await pause(300);}return out;}
 if(v==='QFEX'){const rows=await N.markets(v),u=S.universe(rows).rows,enriched=new Map((await N.enrich(v,u)).map(m=>[m.id,m]));
  const ref=await D.get('https://api.qfex.com/refdata'),hours=new Map(ref.data.map(m=>[m.symbol,m.market_hours]));
  return rows.map(r=>({...(enriched.get(r.id)||r),marketHours:hours.get(r.id)||null}));}
 throw Error('Unsupported venue '+v);
}
async function page(v,id,before){
 if(v==='Popdex'){const d=await D.get(pop+'public/market/candles?'+new URLSearchParams({category:'FUTURES',symbol:id,interval:'5m',limit:'1000',endTime:String(before-1)}));return F.candles(v,d);}
 if(v==='Arcus'){const d=await D.get('https://api.arcus.xyz/v1/candles?'+new URLSearchParams({market:id,timeframe:'5m',to:String(before*1000),countback:'1500'}));return F.candles(v,d);}
 const from=before-30*DAY;return X.candles('QFEX',id,await D.get('https://api.qfex.com/candles/'+encodeURIComponent(id)+'?'+new URLSearchParams({resolution:'5MINS',fromISO:new Date(from).toISOString(),toISO:new Date(before-BAR).toISOString()})));
}
async function fetchVenue(v){
 const rows=await marketRows(v),universe=S.universe(rows).rows,histories={},stop=Date.now()-maxDays*DAY;
 for(const r of universe){
  const map=new Map;let before=Math.floor(Date.now()/BAR)*BAR+BAR,empty=0;
  while(before>stop){
   let got;try{got=await page(v,r.id,before);}catch(e){console.error(v,r.id,'page failed:',e.message);break;}
   const older=got.filter(x=>x.t<before);for(const x of older)map.set(x.t,x);
   if(!older.length){if(v!=='QFEX'||++empty>=2)break;before-=30*DAY;}else{empty=0;before=Math.min(...older.map(x=>x.t));}
   await pause(300);
  }
  histories[r.id]=[...map.values()].filter(x=>x.t>=stop).sort((a,b)=>a.t-b.t);
  const h=histories[r.id];console.log(v,r.id,h.length,'bars',h.length?new Date(h[0].t).toISOString()+' .. '+new Date(h.at(-1).t).toISOString():'');
 }
 fs.mkdirSync(dataDir,{recursive:true});
 fs.writeFileSync(path.join(dataDir,v+'.json'),JSON.stringify({venue:v,fetchedAt:Date.now(),rows,universe:universe.map(r=>r.id),histories}));
}

// Session per bar: QFEX publishes market hours; Popdex/Arcus do not, so no session gate is applied
// beyond the engine's own flat-bar/gap filters (which knock out most closed-market bars).
const sessionOpen=(m,t)=>m.marketHours?X.qSession(m.marketHours,t):true;
function legReturn(side,notional,entry,exit){return (side==='SHORT'?-1:1)*notional*(exit/entry-1);}
function simulate(data,variant){
 const all=data.rows,byId=new Map(all.map(r=>[r.id,r])),universe=data.universe.map(id=>byId.get(id)).filter(Boolean);
 const pairs=S.pairs(universe).filter(p=>data.histories[p.a.id]?.length&&data.histories[p.b.id]?.length);
 const trades=[],skipped={},dedupe={};
 for(const pair of pairs){
  const rows=F.align(data.histories[pair.a.id].map(r=>({t:r.t,c:r.c})),data.histories[pair.b.id].map(r=>({t:r.t,c:r.c})));
  let pos=null,pendingEntry=null,pendingExit=null,alert={active:false,side:null,sentAt:null};
  const key=pair.a.id+'/'+pair.b.id;
  for(let i=0;i<rows.length;i++){
   const bar=rows[i],close=bar.t+BAR;
   // Fills happen at this bar's close (the bar after the signal bar).
   if(pendingExit&&pos){const fA=bar.a,fB=bar.b;const gross=legReturn(pos.a.side,pos.a.notional,pos.a.entry,fA)+legReturn(pos.b.side,pos.b.notional,pos.b.entry,fB);
    const hours=(close-pos.openedAt)/3600000,funding=pos.fundingHourlyBps===null?null:plan.gross*pos.fundingHourlyBps*hours/10000;
    trades.push({pair:key,side:pos.side,openedAt:pos.openedAt,closedAt:close,holdMin:(close-pos.openedAt)/60000,reason:pendingExit.reason,z0:pos.z0,score:pos.score,adf:pos.adf,gross,cost:pos.costUsd,funding,net:gross-pos.costUsd-(funding||0),fundingKnown:pos.fundingHourlyBps!==null,gapFill:bar.t-pendingExit.t>BAR});
    pos=null;pendingExit=null;}
   if(pendingEntry&&!pos){if(bar.t-pendingEntry.t===BAR){const p=pendingEntry.p,dir=Math.sign(p.z),aN=plan.gross/(1+p.beta);
     pos={side:dir>0?'Short A/Long B':'Long A/Short B',openedAt:close,deadline:close+plan.maxHoldMinutes*60000,alpha:p.alpha,beta:p.beta,sd:p.sd,dir,z0:p.z,score:p.score,adf:p.adf?.p??null,
      a:{side:dir>0?'SHORT':'LONG',notional:aN,entry:bar.a},b:{side:dir>0?'LONG':'SHORT',notional:plan.gross-aN,entry:bar.b},
      costUsd:plan.gross*p.cost/10000,fundingHourlyBps:pendingEntry.fundingHourlyBps};}
    pendingEntry=null;}
   const now=close;
   if(pos&&!pendingExit){const z=(Math.log(bar.a)-pos.alpha-pos.beta*Math.log(bar.b))/pos.sd;
    // Exit rules mirror positions.cjs: stop beyond stopZ, TP at/through tpZ (incl. sign flip), time limit.
    const r=pos.dir*z>=plan.stopZ?'stop':pos.dir*z<=plan.exitZ?'tp':now>=pos.deadline?'time':null;
    if(r)pendingExit={reason:r,t:bar.t};}
   if(i<239)continue;
   const a={...pair.a,quoteTime:now,offHours:!sessionOpen(pair.a,now)},b={...pair.b,quoteTime:now,offHours:!sessionOpen(pair.b,now)};
   const p=S.analyze({...pair,a,b},rows.slice(i-239,i+1),E,now,undefined,{exitZ:plan.exitZ,maxHoldMinutes:plan.maxHoldMinutes,adfLevel:variant.adfLevel});
   if(p.reasons.some(r=>/Fewer than|older than|Quote older|Fresh two-sided|Incomplete or future|Too many gaps|Execution cost incomplete/.test(r)))continue; // unobservable: keep alert state
   if(!Number.isFinite(p.cost)){skipped.noFitOrCost=(skipped.noFitOrCost||0)+1;alert={...alert,active:false};continue;} // observed non-qualifying scan
   // Plan.build's cost/TP filter at the signal bar (mid = close; spreads are inside p.cost).
   const mag=Math.abs(p.z),f=p.funding&&p.funding.known?p.funding.bps:0,eff=Number.isFinite(p.totalCost)?p.totalCost:p.cost;
   const planOk=p.setup&&p.eligible&&p.beta>0&&p.beta<10&&mag*p.sd/(1+p.beta)*1e4>=2*eff&&plan.gross*(mag-plan.exitZ)*p.sd/(1+p.beta)>plan.gross*p.cost/1e4+Math.max(plan.gross*f/1e4,0);
   if(p.setup&&!planOk)continue; // scanner withholds and preserves state
   const qualifying=p.setup===true&&p.eligible===true&&Number.isFinite(p.score)&&p.score>=Config.get().minAlertScore,side=p.z>0?'S':'L';
   const send=qualifying&&(!alert.active||alert.side!==side)&&(!alert.sentAt||now-alert.sentAt>=3600000);
   alert={...alert,active:qualifying,side};
   if(send){alert.sentAt=now;if(!pos&&!pendingEntry)pendingEntry={p,t:bar.t,fundingHourlyBps:p.funding&&p.funding.known&&Number.isFinite(p.funding.perHourBps)?p.funding.perHourBps:null};
    else dedupe[key]=(dedupe[key]||0)+1;}
  }
  if(pos)skipped.openAtEnd=(skipped.openAtEnd||0)+1;
 }
 return {trades,pairs:pairs.length,skipped,stackedSignalsIgnored:Object.values(dedupe).reduce((s,x)=>s+x,0)};
}
function stats(tr){
 const n=tr.length;if(!n)return {trades:0};
 const sorted=[...tr].sort((a,b)=>a.closedAt-b.closedAt);let eq=0,peak=0,dd=0,streak=0,longest=0;
 for(const t of sorted){eq+=t.net;peak=Math.max(peak,eq);dd=Math.max(dd,peak-eq);streak=t.net<0?streak+1:0;longest=Math.max(longest,streak);}
 const sum=k=>tr.reduce((s,t)=>s+(t[k]||0),0),gross=sum('gross'),cost=sum('cost'),funding=sum('funding'),net=sum('net');
 const worst=tr.reduce((w,t)=>t.net<w.net?t:w);
 return {trades:n,avgGrossBps:gross/n/plan.gross*1e4,avgCostBps:cost/n/plan.gross*1e4,avgFundingBps:funding/n/plan.gross*1e4,winRate:tr.filter(t=>t.net>0).length/n,avgNetUsd:net/n,avgNetBps:net/n/plan.gross*1e4,totalNetUsd:net,grossUsd:gross,costUsd:cost,fundingUsd:funding,
  costShareOfGross:gross>0?cost/gross:null,fundingShareOfGross:gross>0?funding/gross:null,worstUsd:worst.net,worstTrade:worst.pair+' '+new Date(worst.openedAt).toISOString()+' '+worst.reason,
  maxDrawdownUsd:dd,longestLosingStreak:longest,fundingUnknownTrades:tr.filter(t=>!t.fundingKnown).length,exits:tr.reduce((m,t)=>(m[t.reason]=(m[t.reason]||0)+1,m),{}),
  tStat:n>1?(()=>{const m=net/n,sd=Math.sqrt(tr.reduce((s,t)=>s+(t.net-m)**2,0)/(n-1));return sd>0?m/(sd/Math.sqrt(n)):null;})():null};
}
const nyOpen=t=>{const p=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",weekday:"short",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(new Date(t)).map(x=>[x.type,x.value]));const hm=p.hour.replace("24","00")+":"+p.minute;return !["Sat","Sun"].includes(p.weekday)&&hm>="09:30"&&hm<"16:00";};
const bucket=t=>t.holdMin<=30?'<=30m':t.holdMin<=60?'30-60m':'60-120m/time';
const split=tr=>({usRegularSession:stats(tr.filter(t=>nyOpen(t.openedAt))),outsideUsSession:stats(tr.filter(t=>!nyOpen(t.openedAt)))});
async function run(){
 const variants=[{name:'A (ADF gate 0.10)',adfLevel:0.10},{name:'B (ADF off)',adfLevel:null}],out={generatedAt:new Date().toISOString(),plan,venues:{},combined:{}};
 const allTrades={};
 for(const v of venues){const file=path.join(dataDir,v+'.json');if(!fs.existsSync(file)){console.error('missing',file);continue;}
  const data=JSON.parse(fs.readFileSync(file,'utf8')),ids=Object.keys(data.histories).filter(k=>data.histories[k].length);
  const range=ids.length?[Math.min(...ids.map(k=>data.histories[k][0].t)),Math.max(...ids.map(k=>data.histories[k].at(-1).t))]:null;
  out.venues[v]={range:range&&range.map(t=>new Date(t).toISOString()),markets:ids.map(k=>k+':'+data.histories[k].length),variants:{}};
  for(const variant of variants){const t0=Date.now(),r=simulate(data,variant);(allTrades[variant.name]??=[]).push(...r.trades.map(t=>({...t,venue:v})));
   const buckets={};for(const t of r.trades)(buckets[bucket(t)]??=[]).push(t);
   out.venues[v].variants[variant.name]={pairs:r.pairs,skipped:r.skipped,stackedSignalsIgnored:r.stackedSignalsIgnored,overall:stats(r.trades),byHold:Object.fromEntries(Object.entries(buckets).map(([k,x])=>[k,stats(x)])),bySession:split(r.trades),trades:r.trades};
   console.error(v,variant.name,r.trades.length,'trades',((Date.now()-t0)/1000).toFixed(0)+'s');}
 }
 for(const [k,tr] of Object.entries(allTrades)){const buckets={};for(const t of tr)(buckets[bucket(t)]??=[]).push(t);out.combined[k]={overall:stats(tr),byHold:Object.fromEntries(Object.entries(buckets).map(([b,x])=>[b,stats(x)])),bySession:split(tr)};}
 const file=arg('out',path.join(dataDir,'results.json'));fs.writeFileSync(file,JSON.stringify(out,null,1));console.log('wrote',file);
}
function report(){
 // Merge one or more run outputs (e.g. venues run separately) and print a compact table.
 const files=arg("in",path.join(dataDir,"results.json")).split(","),venuesOut={},all={};
 for(const f of files){const r=JSON.parse(fs.readFileSync(f,"utf8"));for(const [v,x] of Object.entries(r.venues)){venuesOut[v]=x;for(const [k,y] of Object.entries(x.variants))(all[k]??=[]).push(...y.trades.map(t=>({...t,venue:v})));}}
 const fmt=(label,s)=>s.trades?console.log([label.padEnd(34),String(s.trades).padStart(5),(100*s.winRate).toFixed(0).padStart(4)+"%",s.avgGrossBps.toFixed(1).padStart(7),s.avgCostBps.toFixed(1).padStart(6),s.avgFundingBps.toFixed(2).padStart(6),s.avgNetBps.toFixed(1).padStart(7),s.avgNetUsd.toFixed(2).padStart(7),s.totalNetUsd.toFixed(0).padStart(7),s.worstUsd.toFixed(2).padStart(7),s.maxDrawdownUsd.toFixed(0).padStart(6),String(s.longestLosingStreak).padStart(4),(s.tStat??NaN).toFixed(1).padStart(6),String(s.fundingUnknownTrades).padStart(5)].join(" ")):console.log(label.padEnd(34),"    0 trades");
 console.log("label                              trades  win  gross   cost  fund    net   net$   tot$  worst$    DD  str  t-stat fUnk  (bps per trade on $"+plan.gross+" gross)");
 const block=(name,tr)=>{const b={};for(const t of tr)(b[bucket(t)]??=[]).push(t);fmt(name,stats(tr));for(const k of ["<=30m","30-60m","60-120m/time"])fmt("   hold "+k,b[k]?stats(b[k]):{trades:0});const sp=split(tr);fmt("   entry in US regular session",sp.usRegularSession);fmt("   entry outside US session",sp.outsideUsSession);};
 for(const [v,x] of Object.entries(venuesOut)){console.log("\n"+v+"  "+x.range.join(" .. ")+"  ("+x.markets.length+" markets)");for(const [k,y] of Object.entries(x.variants))block(v+" "+k+" ["+y.pairs+" pairs]",y.trades);}
 console.log("\nCOMBINED");for(const [k,tr] of Object.entries(all))block("All "+k,tr);
}
(async()=>{const cmd=process.argv[2];if(cmd==='fetch'){for(const v of venues)await fetchVenue(v);}else if(cmd==='run')await run();else if(cmd==='report')report();else{console.error('usage: backtest-rules.cjs fetch|run|report');process.exit(2);}})().catch(e=>{console.error(e);process.exit(1);});
