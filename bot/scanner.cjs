const fs=require('node:fs'),path=require('node:path');
const F=require('./feeds.js'),S=require('./scan-engine.js'),E=require('./engine.js'),A=require('./alert-rules.cjs'),D=require('./data.cjs'),Plan=require('./trade-plan.cjs'),Store=require('./storage.cjs'),Buttons=require('./buttons.cjs'),Performance=require('./performance.cjs'),N=require('./new-venues.cjs');
const planSettings=Plan.settings(JSON.parse(fs.readFileSync(path.join(__dirname,'plan-config.json'),'utf8')));
const dir=process.env.PAIRDESK_STATE_DIR||path.join(__dirname,'state'),send=process.argv.includes('--send');
fs.mkdirSync(dir,{recursive:true,mode:0o700});
const file=path.join(dir,'alerts.json');
let state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
function save(){const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(state),{mode:0o600});fs.renameSync(tmp,file);}
const pop='https://app.popdex.xyz/web/v1/';
async function markets(v){
 if(N.names.includes(v))return N.markets(v);
 if(v==='Popdex'){
  const [d,c]=await Promise.all([D.get(pop+'market/tickers?category=FUTURES&limit=100'),D.get(pop+'config/symbols')]);
  if(Number(d.total)>d.data.length)throw Error('Incomplete market coverage');return F.normalize(v,d,c);
 }
 return v==='Arcus'?F.normalize(v,await D.get('https://api.arcus.xyz/v1/markets')):D.variationalMarkets(await D.get(D.VAR_URL));
}
async function history(v,id){if(N.names.includes(v))return N.history(v,id);return F.candles(v,await D.get(v==='Popdex'?pop+'public/market/candles?'+new URLSearchParams({category:'FUTURES',symbol:id,interval:'5m',limit:'1000'}):'https://api.arcus.xyz/v1/candles?'+new URLSearchParams({market:id,timeframe:'5m',to:String(Date.now()*1000),countback:'1500'})));}
async function telegram(text,replyMarkup){
 const token=process.env.TELEGRAM_BOT_TOKEN,chat=process.env.TELEGRAM_CHAT_ID;
 if(!token||!chat)throw Error('Telegram is not configured');
 try{const r=await fetch('https://api.telegram.org/bot'+token+'/sendMessage',{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chat,text,reply_markup:replyMarkup})});if(!r.ok||!(await r.json()).ok)throw Error();}
 catch{throw Error('Telegram delivery failed or could not be confirmed');}
}
const Shared=require('./shared-channel.cjs');
const pause=()=>new Promise(r=>setTimeout(r,350));
(async()=>{
 let failures=0;const reports=[];
 for(const venue of ['Popdex','Arcus','Variational',...N.names]){
  try{
   const initial=await markets(venue),universe=S.universe(initial).rows,histories=new Map();
   let store={markets:{}};
   if(['Variational','Ondo'].includes(venue)){
    const historyFile=path.join(dir,venue==='Ondo'?'ondo-history.json':'variational-history.json');
    if(fs.existsSync(historyFile))store=JSON.parse(fs.readFileSync(historyFile,'utf8'));
   }
   for(const r of universe){
    try{histories.set(r.id,['Variational','Ondo'].includes(venue)?D.sampledHistory(store,r.id,Date.now()):await history(venue,r.id));}
    catch{console.log(venue+' '+r.id+': history unavailable');}
    if(!['Variational','Ondo'].includes(venue))await pause();
   }
   const fresh=new Map((await markets(venue)).map(r=>[r.id,r]));
   if(venue==='Arcus')for(const r of universe){
    if(!fresh.has(r.id))continue;
    try{fresh.set(r.id,D.arcusQuote(fresh.get(r.id),await D.get('https://api.arcus.xyz/v1/bbo/'+encodeURIComponent(r.id))));}
    catch{fresh.set(r.id,D.arcusQuote(fresh.get(r.id),{}));console.log('Arcus '+r.id+': quote unavailable');}
    await pause();
   }
   if(N.names.includes(venue))for(const m of await N.enrich(venue,universe.map(r=>fresh.get(r.id)).filter(Boolean)))fresh.set(m.id,m);
   const results=S.pairs(universe.map(r=>fresh.get(r.id)).filter(Boolean))
    .filter(p=>histories.has(p.a.id)&&histories.has(p.b.id))
    .map(p=>S.analyze(p,F.align(histories.get(p.a.id),histories.get(p.b.id)),E,Date.now(),3,{exitZ:planSettings.exitZ,maxHoldMinutes:planSettings.maxHoldMinutes}));
   // Data outages and warm-up are not observed signal exits; preserve alert deduplication state.
   const observable=results.filter(p=>!p.reasons.some(r=>/Fewer than|older than|Quote older|Fresh two-sided|Incomplete or future|Too many gaps|Execution cost incomplete/.test(r)));
   const planned=observable.map(p=>({...p,plan:Plan.build(p,venue,Date.now(),planSettings)}));
   for(const p of planned.filter(p=>p.setup&&!p.plan.ready))console.log(venue+' '+p.a.id+'/'+p.b.id+': management plan withheld: '+p.plan.reason);
   // Preserve state when an otherwise valid setup lacks a fresh reference plan.
   const {alerts,next}=A.selectAlerts(venue,planned.filter(p=>!p.setup||p.plan.ready),state);
   for(const a of alerts){a.plan=a.pair.plan;a.plan.research=Performance.metadata(a.pair);}
   const blockers={};for(const p of results)for(const reason of p.reasons)blockers[reason]=(blockers[reason]||0)+1;
   const report={venue,pairs:results.length,setups:results.filter(p=>p.setup).length,newAlerts:alerts.length,blockers};
   reports.push(report);
   console.log(venue+': '+report.pairs+' pairs checked, '+report.setups+' setups, '+alerts.length+' new alerts'+(send?'':' (dry run)'));
   if(['Variational','Ondo'].includes(venue))console.log(venue+' sampled history: '+universe.map(r=>r.id+' '+(histories.get(r.id)?.length||0)+'/240').join(', '));
   if(Object.keys(blockers).length)console.log(venue+' filters: '+JSON.stringify(blockers));
   if(send){
    state=next;save();
    for(const a of alerts){
     // Persist before delivery to suppress duplicates following an ambiguous network timeout.
     state[a.key].sentAt=Date.now();save();
     let signalId;
     try{signalId=Store.signal(dir,a.plan);await telegram(A.message(a)+'\n\nSignal ID: '+signalId+'\nAfter filling BOTH legs, tap Register trade below (or use /open '+signalId+').',Buttons.keyboard(signalId,a.venue));Performance.receipt(dir,signalId,a.plan);console.log('Alert delivered: '+a.key);}
     catch{failures++;console.error('Alert delivery unconfirmed: '+a.key+'; suppressed until setup re-arms and cooldown expires');}
     if(signalId)try{if(await Shared.deliver(a,signalId,dir))console.log('Shared research alert delivered: '+a.key);}
     catch{failures++;console.error('Shared channel delivery unconfirmed: '+a.key+'; private monitoring unchanged; no automatic retry of expired signals');}

    }
   }
  }catch{failures++;console.error(venue+': scan failed; previous alert history preserved');}
 }
 const status={version:7,finishedAt:new Date().toISOString(),failures,deliveryEnabled:send,reports};
 fs.writeFileSync(path.join(dir,'status.json'),JSON.stringify(status,null,2),{mode:0o600});
 if(failures)process.exitCode=1;
})().catch(()=>{console.error('Scanner stopped; inspect configuration and state permissions');process.exitCode=1;});
