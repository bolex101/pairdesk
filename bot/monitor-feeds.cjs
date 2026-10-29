const Log=require('./log.cjs');
const D=require('./data.cjs'),N=require('./new-venues.cjs');
async function quotes(positions){
 const out=new Map(),want=new Map();
 for(const p of positions)for(const m of [p.plan.a,p.plan.b])want.set(p.plan.venue+':'+m.id,{venue:p.plan.venue,id:m.id});
 const tasks=[];
 if([...want.values()].some(m=>m.venue==='Popdex'))tasks.push(async()=>{
  const d=await D.get('https://app.popdex.xyz/web/v1/market/tickers?category=FUTURES&limit=100');
  if(String(d.code)!=='200'||!Array.isArray(d.data)||Number(d.total)>d.data.length)throw Error();
  for(const r of d.data)out.set('Popdex:'+r.symbol,{bid:Number(r.bid1Price),ask:Number(r.ask1Price),quoteTime:Number(r.updatedTime)});
 });
 if([...want.values()].some(m=>m.venue==='Variational'))tasks.push(async()=>{
  for(const r of D.variationalMarkets(await D.get(D.VAR_URL)))out.set('Variational:'+r.id,r);
 });
 for(const m of want.values())if(m.venue==='Arcus')tasks.push(async()=>{
  out.set('Arcus:'+m.id,D.arcusQuote({id:m.id},await D.get('https://api.arcus.xyz/v1/bbo/'+encodeURIComponent(m.id))));
 });
 const rise=[...want.values()].filter(m=>m.venue==='RISEx');
 if(rise.length)tasks.push(async()=>{for(const [id,q] of await N.quoteMany('RISEx',rise.map(m=>m.id)))out.set('RISEx:'+id,q);});
 for(const m of want.values())if(N.names.includes(m.venue)&&m.venue!=='RISEx')tasks.push(async()=>{out.set(m.venue+':'+m.id,await N.quote(m.venue,m.id));});
 // Bound public endpoint concurrency; a failed quote remains unavailable rather than using a cache.
 let index=0;await Promise.all(Array.from({length:Math.min(4,tasks.length)},async()=>{while(index<tasks.length){const task=tasks[index++];try{await task();}catch(e){Log.warn('Monitor quote fetch failed; affected trades keep stale-price handling',e);}}}));
 return p=>({a:out.get(p.plan.venue+':'+p.plan.a.id),b:out.get(p.plan.venue+':'+p.plan.b.id)});
}
module.exports={quotes};
