(function(root){
const groups={semiconductors:['NVDA','AMD','MU','INTC','SNDK','MRVL','AVGO','TSM'],platforms:['GOOGL','META'],cloud:['MSFT','ORCL','AMZN','CRWV'],metals:['XAU','XAG','GLD','SLV'],energy:['CL','BZ','USO'],indices:['SPY','QQQ','US500','TECH100'],cryptoEquities:['COIN','MSTR','HOOD','CRCL']};
function base(r){return r.symbol.replace(/USDT$|-USD$|-PERP$|-SWAP$/g,'');}
function universe(rows,limit=16){const valid=rows.filter(r=>r.tradfi&&r.price>0&&Object.values(groups).some(g=>g.includes(base(r))));const members=valid.filter(r=>valid.some(b=>b.id!==r.id&&b.type===r.type&&Object.values(groups).some(g=>g.includes(base(r))&&g.includes(base(b))))).sort((a,b)=>(b.volume||0)-(a.volume||0));return {rows:members.slice(0,limit),eligible:members.length};}
function pairs(rows){const out=[];for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){const a=rows[i],b=rows[j],group=Object.keys(groups).find(k=>groups[k].includes(base(a))&&groups[k].includes(base(b)));if(group&&a.type===b.type)out.push({a,b,group});}return out;}
const finite=x=>Number.isFinite(x);const clamp=x=>Math.max(0,Math.min(1,x));
function analyze(pair,rows,E,now=Date.now(),slip=3){
 const {a,b}=pair,result={...pair,rows,eligible:false,score:null,reasons:[],z:null,corr:null,half:null,cost:null,edge:null};
 if(rows.length<240){result.reasons.push('Fewer than 240 matched bars');return result;}
 const tail=rows.slice(-240),last=tail.at(-1),gaps=tail.slice(1).filter((r,i)=>r.t-tail[i].t!==300000).length;
 if(now-last.t>900000)result.reasons.push('Latest candle is older than 15 minutes');
 if(now<last.t+300000)result.reasons.push('Incomplete or future candle');
 if(gaps>2)result.reasons.push('Too many gaps in recent history');
 const flat=tail.slice(1).filter((r,i)=>r.a===tail[i].a||r.b===tail[i].b).length/239;if(flat>.2)result.reasons.push('More than 20% unchanged-price bars');
 if([a,b].some(r=>r.offHours||r.session==='BREAK'))result.reasons.push('Outside regular trading session');
 if([a,b].some(r=>!['ONLINE','Trading','Listed'].includes(r.status)))result.reasons.push('Market not open for normal trading');
 if([a,b].some(r=>r.quoteTime&&now-r.quoteTime>120000))result.reasons.push('Quote older than two minutes');
 const s=E.stats(tail,60),f=E.fit(tail.slice(0,-1));if(!s||!f){result.reasons.push('No stable positive hedge fit');return result;}
 result.z=s.z;result.corr=E.corr(tail);result.beta=s.beta;result.confirm=s.confirm;
 const c1=E.corr(tail.slice(0,120)),c2=E.corr(tail.slice(120));
 if(result.corr<.5||c1<.3||c2<.3)result.reasons.push('Weak or unstable return correlation');
 const residual=tail.map(r=>Math.log(r.a)-f.alpha-f.beta*Math.log(r.b));let numerator=0,denominator=0;
 for(let i=1;i<residual.length;i++){numerator+=residual[i-1]*(residual[i]-residual[i-1]);denominator+=residual[i-1]**2;}
 const phi=1+numerator/denominator;result.half=phi>0&&phi<1?-Math.log(2)/Math.log(phi)*5:null;
 if(!result.half||result.half<5||result.half>120)result.reasons.push('Mean-reversion estimate outside 5–120 minutes');
 const wa=1/(1+s.beta),wb=1-wa;
 if(finite(a.takerBps)&&finite(b.takerBps)&&finite(a.spread)&&finite(b.spread))result.cost=2*(wa*a.takerBps+wb*b.takerBps)+wa*a.spread+wb*b.spread+2*slip;
 result.edge=Math.abs(s.z)*s.sd/(1+s.beta)*10000;
 if(result.cost===null)result.reasons.push('Execution cost incomplete');
 else if(result.edge<2*result.cost)result.reasons.push('Estimated move less than twice friction');
 result.eligible=result.reasons.length===0;
 const costQuality=result.cost===null?0:clamp((result.edge/result.cost-1)/3);
 result.score=Math.round(35*clamp((Math.min(c1,c2)-.3)/.7)+25*(result.half?clamp(1-Math.abs(Math.log(result.half/30))/Math.log(8)):0)+20*costQuality+20*clamp(Math.log10(Math.max(1,Math.min(a.volume||0,b.volume||0)))/7));
 result.setup=result.eligible&&Math.abs(s.z)>=1.5&&Math.abs(s.z)<=3&&s.confirm!==null&&s.z*s.confirm>0;
 return result;
}
root.PairScan={groups,universe,pairs,analyze};if(typeof module!=='undefined')module.exports=root.PairScan;
})(typeof globalThis!=='undefined'?globalThis:this);
