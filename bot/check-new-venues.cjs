const N=require('./new-venues.cjs'),S=require('./scan-engine.js');
(async()=>{
 for(const venue of N.names){try{
  const rows=await N.markets(venue),selected=S.universe(rows);
  console.log(venue+': '+rows.length+' markets; '+selected.eligible+' supported related markets');
  const id=venue==='Ondo'?'NVDA-USD.P':'NVDA',q=await N.quote(venue,id),age=(Date.now()-q.quoteTime)/1000;
  if(age>120||age< -5)throw Error('Quote timestamp is not fresh');
  console.log(venue+': '+id+' bid/ask OK; timestamp age '+age.toFixed(1)+' seconds');
  if(venue==='Phoenix')console.log('Phoenix: '+(await N.history(venue,id)).length+' closed, non-backfilled 5m candles');
  else console.log('Ondo: sampled history required; collector must build at least 240 usable 5m samples.');
 }catch(e){console.error(venue+': '+e.message);process.exitCode=1;}}
})().catch(e=>{console.error('Exchange check failed ('+require('./log.cjs').safe(e)+')');process.exitCode=1;});
