#!/usr/bin/env node
'use strict';
// Crypto version of scripts/backtest-rules.cjs: same scoring (S.analyze), same alert rules, same
// fixed-fit plan exits, same costs (taker fees both sides + spread + 3 bps slippage per side) and
// funding, on 5m candles. Only the universe changes: crypto perps grouped by sector.
//   node scripts/backtest-crypto.cjs fetch  [--venues Popdex,Arcus,Phoenix] [--days 365] [--data DIR]
//   node scripts/backtest-crypto.cjs run    [--venues ...] [--data DIR] [--out FILE]
//   node scripts/backtest-crypto.cjs report [--in FILE]
// Venues: only Popdex, Arcus and Phoenix list crypto perps AND publish public 5m history.
// QFEX/RISEx list no crypto; Ondo and Variational have no public candle history.
// Funding: Arcus = real hourly funding history (/v1/fundingRates, rate per hour). Popdex/Phoenix =
// today's snapshot applied to all history (as in the stock run). Phoenix's eight_hour_funding_rate is
// a PERCENT (annualized_funding_rate = 8h*3*365); bot/new-venues.cjs (phoenixEightHourFraction) divides by 100.
// Spreads/fees: today's snapshot applied to all history (historical books are not public).
const fs=require('node:fs'),path=require('node:path');
const bot=path.join(__dirname,'..','bot');
const F=require(path.join(bot,'feeds.js')),S=require(path.join(bot,'scan-engine.js')),E=require(path.join(bot,'engine.js'));
const D=require(path.join(bot,'data.cjs')),N=require(path.join(bot,'new-venues.cjs'));
const Plan=require(path.join(bot,'trade-plan.cjs')),Fd=require(path.join(bot,'funding.js')),Config=require(path.join(bot,'config.cjs'));
const BAR=300000,DAY=86400000,HOUR=3600000,pop='https://app.popdex.xyz/web/v1/',PHX='https://perp-api.phoenix.trade';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i>0?process.argv[i+1]:d;};
const venues=arg('venues','Popdex,Arcus,Phoenix').split(','),dataDir=arg('data',path.join(process.cwd(),'pairdesk-bt-data','crypto'));
const maxDays=Number(arg('days','365')),pause=ms=>new Promise(r=>setTimeout(r,ms));
const plan=Plan.settings(JSON.parse(fs.readFileSync(path.join(bot,'plan-config.json'),'utf8')));
const groups={
 majors:['BTC','ETH','SOL','BNB','XRP','DOGE'],
 l1:['SOL','NEAR','SUI','APT','AVAX','ADA'],
 l2:['ARB','OP','STRK','ZRO'],
 memes:['DOGE','PEPE','WIF','BONK','FARTCOIN','PENGU','TRUMP','SHIB'],
 defi:['AAVE','UNI','LINK','ENA','CRV','MORPHO','JUP','DYDX']
};
const base=r=>{let s=String(r.symbol).replace(/USDT$|-USD$|-PERP$/,'');if(/^(k|K|1000)(PEPE|BONK|SHIB)$/.test(s))s=s.replace(/^(k|K|1000)/,'');return s.toUpperCase();};
const inGroups=b=>Object.values(groups).some(g=>g.includes(b));
function cryptoPairs(rows){const out=[];for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){const a=rows[i],b=rows[j],group=Object.keys(groups).find(k=>groups[k].includes(base(a))&&groups[k].includes(base(b)));if(group)out.push({a,b,group});}return out;}
function pickUniverse(rows){
 // One market per base (prefer the k-/1000- contract the venue actually trades most), crypto only.
 const by=new Map;for(const r of rows.filter(r=>!r.tradfi&&r.price>0&&inGroups(base(r)))){const b=base(r),o=by.get(b);if(!o||(r.volume||0)>(o.volume||0))by.set(b,r);}
 const u=[...by.values()];return u.filter(r=>u.some(x=>x!==r&&Object.values(groups).some(g=>g.includes(base(r))&&g.includes(base(x))))).sort((a,b)=>(b.volume||0)-(a.volume||0));
}
async function marketRows(v){
 if(v==='Popdex'){const [d,c]=await Promise.all([D.get(pop+'market/tickers?category=FUTURES&limit=100'),D.get(pop+'config/symbols')]);return F.normalize(v,d,c);}
 if(v==='Arcus'){const rows=F.normalize(v,await D.get('https://api.arcus.xyz/v1/markets')),u=pickUniverse(rows),out=[];
  for(const r of rows){if(!u.includes(r)){out.push(r);continue;}let q={};try{q=await D.get('https://api.arcus.xyz/v1/bbo/'+encodeURIComponent(r.id));}catch{}out.push(D.arcusQuote(r,q));await pause(300);}return out;}
 if(v==='Phoenix'){const rows=await N.markets(v); // percent->fraction handled by N.phoenixEightHourFraction
  const u=pickUniverse(rows),q=new Map((await N.enrich(v,u)).map(m=>[m.id,m]));return rows.map(r=>q.get(r.id)||r);}
 throw Error('Unsupported venue '+v);
}
async function page(v,id,before){
 if(v==='Popdex')return F.candles(v,await D.get(pop+'public/market/candles?'+new URLSearchParams({category:'FUTURES',symbol:id,interval:'5m',limit:'1000',endTime:String(before-1)})));
 if(v==='Arcus')return F.candles(v,await D.get('https://api.arcus.xyz/v1/candles?'+new URLSearchParams({market:id,timeframe:'5m',to:String(before*1000),countback:'1500'})));
 const from=before-1000*BAR;return N.candles(id,await D.get(PHX+'/v1/candles_v2/'+encodeURIComponent(id)+'?'+new URLSearchParams({timeframe:'5m',from:String(from),to:String(before),limit:'1000',includePartial:'false'})));
}
async function arcusFunding(id,stop){
 const out=new Map;let to=Date.now()*1000;
 for(let k=0;k<20;k++){let d;try{d=await D.get('https://api.arcus.xyz/v1/fundingRates?'+new URLSearchParams({market:id,to:String(to)}));}catch(e){console.error('Arcus funding',id,e.message);break;}
  const rows=(d.fundingRates||[]).filter(r=>r.marketDisplayName===id);if(!rows.length)break;
  for(const r of rows)out.set(r.time/1000,Number(r.fundingRate));const min=Math.min(...rows.map(r=>r.time));if(min/1000<stop||min>=to)break;to=min-1;await pause(300);}
 return [...out.entries()].sort((a,b)=>a[0]-b[0]);
}
async function fetchVenue(v){
 const rows=await marketRows(v),universe=pickUniverse(rows),histories={},funding={},stop=Date.now()-maxDays*DAY;
 console.log(v,'universe',universe.map(r=>r.id).join(' '));
 for(const r of universe){
  const map=new Map;let before=Math.floor(Date.now()/BAR)*BAR+BAR,empty=0;
  while(before>stop){
   let got;try{got=await page(v,r.id,before);}catch(e){console.error(v,r.id,'page failed:',e.message);break;}
   const older=got.filter(x=>x.t<before);for(const x of older)map.set(x.t,x);
   if(!older.length){if(v!=='Phoenix'||++empty>=3)break;before-=1000*BAR;}else{empty=0;before=v==='Phoenix'?before-1000*BAR:Math.min(...older.map(x=>x.t));}
   await pause(250);
  }
  histories[r.id]=[...map.values()].filter(x=>x.t>=stop).sort((a,b)=>a.t-b.t);
  if(v==='Arcus')funding[r.id]=await arcusFunding(r.id,stop);
  const h=histories[r.id];console.log(v,r.id,h.length,'bars',h.length?new Date(h[0].t).toISOString()+' .. '+new Date(h.at(-1).t).toISOString():'',v==='Arcus'?'funding '+funding[r.id].length:'');
 }
 fs.mkdirSync(dataDir,{recursive:true});
 fs.writeFileSync(path.join(dataDir,v+'.json'),JSON.stringify({venue:v,fetchedAt:Date.now(),rows,universe:universe.map(r=>r.id),histories,funding}));
}

function legReturn(side,notional,entry,exit){return (side==='SHORT'?-1:1)*notional*(exit/entry-1);}
// Arcus historical funding: rate per hour, keyed by hour start (ms). Rate in force at time t.
function fundingLookup(series){if(!series||!series.length)return null;const ts=series.map(x=>x[0]),rs=series.map(x=>x[1]);
 const med=[...rs].sort((a,b)=>a-b)[rs.length>>1];
 // Before the published history starts (or across gaps), fall back to that market's median hourly rate.
 return t=>{if(t<ts[0])return {rate:med,real:false};let lo=0,hi=ts.length-1;while(lo<hi){const m=(lo+hi+1)>>1;if(ts[m]<=t)lo=m;else hi=m-1;}return t-ts[lo]<=3*HOUR?{rate:rs[lo],real:true}:{rate:med,real:false};};}
function simulate(data,variant){
 const all=data.rows,byId=new Map(all.map(r=>[r.id,r])),universe=data.universe.map(id=>byId.get(id)).filter(Boolean);
 const pairs=cryptoPairs(universe).filter(p=>data.histories[p.a.id]?.length&&data.histories[p.b.id]?.length);
 const fl=Object.fromEntries(Object.entries(data.funding||{}).map(([k,s])=>[k,fundingLookup(s)]));
 const legAt=(r,now)=>{const f=fl[r.id];if(!f)return r;const x=f(now);return {...r,fundingReal:x.real,fundingHourly:Fd.perp(x.rate,3600,x.real?'Arcus historical hourly funding':'Arcus median hourly funding (no history at this time)')};};
 const trades=[],skipped={},dedupe={};
 for(const pair of pairs){
  const rows=F.align(data.histories[pair.a.id].map(r=>({t:r.t,c:r.c})),data.histories[pair.b.id].map(r=>({t:r.t,c:r.c})));
  let pos=null,pendingEntry=null,pendingExit=null,alert={active:false,side:null,sentAt:null};
  const key=pair.a.id+'/'+pair.b.id;
  for(let i=0;i<rows.length;i++){
   const bar=rows[i],close=bar.t+BAR;
   if(pendingExit&&pos){const fA=bar.a,fB=bar.b;const gross=legReturn(pos.a.side,pos.a.notional,pos.a.entry,fA)+legReturn(pos.b.side,pos.b.notional,pos.b.entry,fB);
    const hours=(close-pos.openedAt)/3600000,funding=pos.fundingHourlyBps===null?null:plan.gross*pos.fundingHourlyBps*hours/10000;
    trades.push({pair:key,group:pair.group,side:pos.side,openedAt:pos.openedAt,closedAt:close,holdMin:(close-pos.openedAt)/60000,reason:pendingExit.reason,z0:pos.z0,score:pos.score,adf:pos.adf,gross,cost:pos.costUsd,funding,net:gross-pos.costUsd-(funding||0),fundingKnown:pos.fundingHourlyBps!==null,fundingReal:pos.fundingReal,gapFill:bar.t-pendingExit.t>BAR});
    pos=null;pendingExit=null;}
   if(pendingEntry&&!pos){if(bar.t-pendingEntry.t===BAR){const p=pendingEntry.p,dir=Math.sign(p.z),aN=plan.gross/(1+p.beta);
     pos={side:dir>0?'Short A/Long B':'Long A/Short B',openedAt:close,deadline:close+plan.maxHoldMinutes*60000,alpha:p.alpha,beta:p.beta,sd:p.sd,dir,z0:p.z,score:p.score,adf:p.adf?.p??null,
      a:{side:dir>0?'SHORT':'LONG',notional:aN,entry:bar.a},b:{side:dir>0?'LONG':'SHORT',notional:plan.gross-aN,entry:bar.b},
      costUsd:plan.gross*p.cost/10000,fundingHourlyBps:pendingEntry.fundingHourlyBps,fundingReal:pendingEntry.fundingReal};}
    pendingEntry=null;}
   const now=close;
   if(pos&&!pendingExit){const z=(Math.log(bar.a)-pos.alpha-pos.beta*Math.log(bar.b))/pos.sd;
    const r=pos.dir*z>=plan.stopZ?'stop':pos.dir*z<=plan.exitZ?'tp':now>=pos.deadline?'time':null;
    if(r)pendingExit={reason:r,t:bar.t};}
   if(i<239)continue;
   // Crypto trades 24/7: no session gate.
   const a={...legAt(pair.a,now),quoteTime:now,offHours:false},b={...legAt(pair.b,now),quoteTime:now,offHours:false};
   const p=S.analyze({...pair,a,b},rows.slice(i-239,i+1),E,now,undefined,{exitZ:plan.exitZ,maxHoldMinutes:plan.maxHoldMinutes,adfLevel:variant.adfLevel});
   if(p.reasons.some(r=>/Fewer than|older than|Quote older|Fresh two-sided|Incomplete or future|Too many gaps|Execution cost incomplete/.test(r)))continue;
   if(!Number.isFinite(p.cost)){skipped.noFitOrCost=(skipped.noFitOrCost||0)+1;alert={...alert,active:false};continue;}
   const mag=Math.abs(p.z),f=p.funding&&p.funding.known?p.funding.bps:0,eff=Number.isFinite(p.totalCost)?p.totalCost:p.cost;
   const planOk=p.setup&&p.eligible&&p.beta>0&&p.beta<10&&mag*p.sd/(1+p.beta)*1e4>=2*eff&&plan.gross*(mag-plan.exitZ)*p.sd/(1+p.beta)>plan.gross*p.cost/1e4+Math.max(plan.gross*f/1e4,0);
   if(p.setup&&!planOk)continue;
   const qualifying=p.setup===true&&p.eligible===true&&Number.isFinite(p.score)&&p.score>=Config.get().minAlertScore,side=p.z>0?'S':'L';
   const send=qualifying&&(!alert.active||alert.side!==side)&&(!alert.sentAt||now-alert.sentAt>=3600000);
   alert={...alert,active:qualifying,side};
   if(send){alert.sentAt=now;if(!pos&&!pendingEntry)pendingEntry={p,t:bar.t,fundingHourlyBps:p.funding&&p.funding.known&&Number.isFinite(p.funding.perHourBps)?p.funding.perHourBps:null,fundingReal:a.fundingReal!==false&&b.fundingReal!==false};
    else dedupe[key]=(dedupe[key]||0)+1;}
  }
  if(pos)skipped.openAtEnd=(skipped.openAtEnd||0)+1;
 }
 return {trades,pairs:pairs.length,pairList:pairs.map(p=>p.a.id+'/'+p.b.id+':'+p.group),skipped,stackedSignalsIgnored:Object.values(dedupe).reduce((s,x)=>s+x,0)};
}
function stats(tr){
 const n=tr.length;if(!n)return {trades:0};
 const sorted=[...tr].sort((a,b)=>a.closedAt-b.closedAt);let eq=0,peak=0,dd=0,streak=0,longest=0;
 for(const t of sorted){eq+=t.net;peak=Math.max(peak,eq);dd=Math.max(dd,peak-eq);streak=t.net<0?streak+1:0;longest=Math.max(longest,streak);}
 const sum=k=>tr.reduce((s,t)=>s+(t[k]||0),0),gross=sum('gross'),cost=sum('cost'),funding=sum('funding'),net=sum('net');
 return {trades:n,winRate:tr.filter(t=>t.net>0).length/n,grossWinRate:tr.filter(t=>t.gross>0).length/n,avgGrossBps:gross/n/plan.gross*1e4,avgCostBps:cost/n/plan.gross*1e4,avgFundingBps:funding/n/plan.gross*1e4,
  avgNetUsd:net/n,totalNetUsd:net,fundingUsd:funding,maxDrawdownUsd:dd,longestLosingStreak:longest,fundingUnknownTrades:tr.filter(t=>!t.fundingKnown).length,
  tStat:n>1?(()=>{const m=net/n,sd=Math.sqrt(tr.reduce((s,t)=>s+(t.net-m)**2,0)/(n-1));return sd>0?m/(sd/Math.sqrt(n)):null;})():null};
}
const hold=t=>t.holdMin<=30?'<=30m':'>30m';
const scoreB=t=>t.score>=90?'90+':t.score>=80?'80-89':'65-79';
async function run(){
 const variants=[{name:'ADF on (0.10)',adfLevel:0.10},{name:'ADF off',adfLevel:null}],out={generatedAt:new Date().toISOString(),plan,groups,venues:{}};
 for(const v of venues){const file=path.join(dataDir,v+'.json');if(!fs.existsSync(file)){console.error('missing',file);continue;}
  const data=JSON.parse(fs.readFileSync(file,'utf8')),ids=Object.keys(data.histories).filter(k=>data.histories[k].length);
  const range=ids.length?[Math.min(...ids.map(k=>data.histories[k][0].t)),Math.max(...ids.map(k=>data.histories[k].at(-1).t))]:null;
  out.venues[v]={range:range&&range.map(t=>new Date(t).toISOString()),markets:ids.map(k=>k+':'+data.histories[k].length),variants:{}};
  for(const variant of variants){const t0=Date.now(),r=simulate(data,variant);
   out.venues[v].variants[variant.name]={pairs:r.pairs,pairList:r.pairList,skipped:r.skipped,stackedSignalsIgnored:r.stackedSignalsIgnored,overall:stats(r.trades),trades:r.trades};
   console.error(v,variant.name,r.trades.length,'trades',((Date.now()-t0)/1000).toFixed(0)+'s');}
 }
 const file=arg('out',path.join(dataDir,'results-'+venues.join('-')+'.json'));fs.writeFileSync(file,JSON.stringify(out,null,1));console.log('wrote',file);
}
function report(){
 const files=arg('in','').split(',').filter(Boolean),all={},vo={};
 for(const f of files){const r=JSON.parse(fs.readFileSync(f,'utf8'));for(const [v,x] of Object.entries(r.venues)){vo[v]=x;for(const [k,y] of Object.entries(x.variants))(all[k]??=[]).push(...y.trades.map(t=>({...t,venue:v})));}}
 const fmt=(label,s)=>s.trades?console.log([label.padEnd(30),String(s.trades).padStart(5),(100*s.winRate).toFixed(0).padStart(4)+'%',(100*s.grossWinRate).toFixed(0).padStart(4)+'%',s.avgGrossBps.toFixed(1).padStart(7),s.avgCostBps.toFixed(1).padStart(6),s.avgFundingBps.toFixed(2).padStart(6),s.avgNetUsd.toFixed(2).padStart(7),s.totalNetUsd.toFixed(0).padStart(7),s.maxDrawdownUsd.toFixed(0).padStart(6),(s.tStat??NaN).toFixed(1).padStart(6),String(s.fundingUnknownTrades).padStart(5)].join(' ')):console.log(label.padEnd(30),'    0 trades');
 const hdr=()=>console.log('label                          trades netW grsW  grossbp costbp fundbp  net$/t   tot$    DD  tstat fUnk');
 const block=(name,tr)=>{fmt(name,stats(tr));for(const k of ['65-79','80-89','90+'])fmt('   score '+k,stats(tr.filter(t=>scoreB(t)===k)));for(const k of ['<=30m','>30m'])fmt('   hold '+k,stats(tr.filter(t=>hold(t)===k)));
  for(const g of Object.keys(groups))fmt('   group '+g,stats(tr.filter(t=>t.group===g)));};
 for(const [v,x] of Object.entries(vo)){console.log('\n'+v+'  '+(x.range||[]).join(' .. ')+'  ('+x.markets.length+' markets)');hdr();for(const [k,y] of Object.entries(x.variants))block(v+' '+k+' ['+y.pairs+'p]',y.trades);}
 console.log('\nCOMBINED');hdr();for(const [k,tr] of Object.entries(all))block('All '+k,tr);
 for(const [k,tr] of Object.entries(all)){const by={};for(const t of tr)(by[t.venue+' '+t.pair]??=[]).push(t);const rows=Object.entries(by).map(([p,x])=>[p,x.length,x.reduce((s,t)=>s+t.net,0),x.filter(t=>t.net>0).length/x.length]).filter(r=>r[1]>=5).sort((a,b)=>b[2]-a[2]);
  console.log('\n'+k+' pairs (>=5 trades) best/worst by total net $:');for(const r of [...rows.slice(0,6),['...'],...rows.slice(-6)])console.log('  '+(r.length>1?r[0].padEnd(34)+String(r[1]).padStart(5)+r[2].toFixed(1).padStart(9)+(100*r[3]).toFixed(0).padStart(5)+'%':'...'));}
}
(async()=>{const cmd=process.argv[2];if(cmd==='fetch'){await Promise.all(venues.map(v=>fetchVenue(v).catch(e=>console.error(v,'FAILED',e.message))));}else if(cmd==='run')await run();else if(cmd==='report')report();else{console.error('usage: backtest-crypto.cjs fetch|run|report');process.exit(2);}})().catch(e=>{console.error(e);process.exit(1);});
