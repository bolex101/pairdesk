const X=require('./extra-venues.cjs'),S=require('./scan-engine.js');
(async()=>{
 for(const venue of X.names)try{
 const rows=await X.markets(venue),u=S.universe(rows),id=venue==='QFEX'?'NVDA-USD':'NVDA-USDC';
 console.log(venue+': '+rows.length+' TradFi markets; '+u.rows.length+' selected related markets');
 const q=await X.quote(venue,id);console.log(venue+': '+id+' two-sided quote OK, source age '+((Date.now()-q.quoteTime)/1000).toFixed(1)+' seconds');
 const h=await X.history(venue,id);if(h.length<240||Date.now()-h.at(-1).t>900000)throw Error('Insufficient or stale closed-bar history');
 console.log(venue+': '+h.length+' completed 5m bars; latest '+new Date(h.at(-1).t).toISOString());
 console.log(venue+': '+u.rows.filter(m=>!m.offHours).length+' selected markets inside research session; off-session alerts remain blocked');
 }catch(e){console.error(venue+': '+e.message);process.exitCode=1;}
 console.log('Read-only checks. No Telegram messages, trades or wallet changes.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
