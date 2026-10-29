(function(root){
const node=typeof module!=='undefined'&&typeof require==='function';
const Fd=node?require('./funding.js'):root.PairFunding,T=node?require('./thresholds.js'):root.PairThresholds;
const groups={semiconductors:['NVDA','AMD','MU','INTC','SNDK','MRVL','AVGO','TSM'],platforms:['GOOGL','META'],cloud:['MSFT','ORCL','AMZN','CRWV'],metals:['XAU','XAG','GLD','SLV'],energy:['CL','BZ','USO'],indices:['SPY','QQQ','US500','TECH100'],cryptoEquities:['COIN','MSTR','HOOD','CRCL']};
function base(r){return r.symbol.replace(/USDT$|-USD$|-PERP$|-SWAP$/g,'');}
function universe(rows,limit=16){const valid=rows.filter(r=>r.tradfi&&r.price>0&&Object.values(groups).some(g=>g.includes(base(r))));const members=valid.filter(r=>valid.some(b=>b.id!==r.id&&b.type===r.type&&Object.values(groups).some(g=>g.includes(base(r))&&g.includes(base(b))))).sort((a,b)=>(b.volume||0)-(a.volume||0));return {rows:members.slice(0,limit),eligible:members.length};}
function pairs(rows){const out=[];for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){const a=rows[i],b=rows[j],group=Object.keys(groups).find(k=>groups[k].includes(base(a))&&groups[k].includes(base(b)));if(group&&a.type===b.type)out.push({a,b,group});}return out;}
const MIN_CONFIRM_Z=T.DEFAULTS.minConfirmZ;
const finite=x=>Number.isFinite(x);const clamp=x=>Math.max(0,Math.min(1,x));
// Funding income may offset at most this share of friction, so projected income alone never justifies a trade.
const FUNDING_DEFAULTS=Object.freeze({exitZ:0.3,maxHoldMinutes:120,fundingIncomeCreditMax:T.DEFAULTS.fundingIncomeCreditMax,requireKnownFunding:T.DEFAULTS.requireKnownFunding});
/* One fit window for z, beta, sd, half-life and the cointegration test. The fit uses the
   fitWindow bars BEFORE the current bar (no lookahead); z is the current bar vs that fit. */
const MODEL_DEFAULTS=Object.freeze({fitWindow:T.DEFAULTS.fitWindow,adfLags:T.DEFAULTS.adfLags,adfLevel:T.DEFAULTS.adfLevel,minHalfLife:T.DEFAULTS.minHalfLife,maxHalfLife:T.DEFAULTS.maxHalfLife});
// Thresholds come from the shared config (thresholds.js); explicit options win.
function analyze(pair,rows,E,now=Date.now(),slip,options={}){
 const o={exitZ:FUNDING_DEFAULTS.exitZ,maxHoldMinutes:FUNDING_DEFAULTS.maxHoldMinutes,...T.get(),...options};slip??=o.slippageBps;
 const bars=o.minBars,half=Math.floor(bars/2),maxAge=o.maxQuoteAgeMs;
 const {a,b}=pair,result={...pair,rows,eligible:false,score:null,reasons:[],z:null,corr:null,half:null,cost:null,funding:null,totalCost:null,edge:null};
 if(rows.length<bars){result.reasons.push('Fewer than '+bars+' matched bars');return result;}
 const tail=rows.slice(-bars),last=tail.at(-1),gaps=tail.slice(1).filter((r,i)=>r.t-tail[i].t!==300000).length;
 if(now-last.t>900000)result.reasons.push('Latest candle is older than 15 minutes');
 if(now<last.t+300000)result.reasons.push('Incomplete or future candle');
 if(gaps>2)result.reasons.push('Too many gaps in recent history');
 const flat=tail.slice(1).filter((r,i)=>r.a===tail[i].a||r.b===tail[i].b).length/(bars-1);if(flat>.2)result.reasons.push('More than 20% unchanged-price bars');
 if([a,b].some(r=>r.offHours||r.session==='BREAK'))result.reasons.push('Outside regular trading session');
 if([a,b].some(r=>!['ONLINE','Trading','Listed'].includes(r.status)))result.reasons.push('Market not open for normal trading');
 if([a,b].some(r=>r.quoteTime&&now-r.quoteTime>maxAge))result.reasons.push('Quote older than two minutes');
 if([a,b].some(r=>r.requireQuote&&(!Number.isFinite(r.quoteTime)||r.quoteTime<=0||now-r.quoteTime>maxAge||r.quoteTime>now+5000||!(r.bid>0)||!(r.ask>=r.bid))))result.reasons.push('Fresh two-sided quote unavailable');
 const w=Math.min(o.fitWindow,tail.length-1),s=E.stats(tail,w);if(!s){result.reasons.push('No stable positive hedge fit');return result;}
 result.z=s.z;result.corr=E.corr(tail);result.beta=s.beta;result.alpha=s.alpha;result.sd=s.sd;result.confirm=s.confirm;result.fitWindow=w;
 const c1=E.corr(tail.slice(0,half)),c2=E.corr(tail.slice(half));
 if(result.corr<o.minCorrelation||c1<o.minHalfCorrelation||c2<o.minHalfCorrelation)result.reasons.push('Weak or unstable return correlation');
 // Half-life and ADF use the residuals of the SAME fit, over the same window (current bar excluded).
 const residual=tail.slice(-w-1,-1).map(r=>Math.log(r.a)-s.alpha-s.beta*Math.log(r.b));let numerator=0,denominator=0;
 for(let i=1;i<residual.length;i++){numerator+=residual[i-1]*(residual[i]-residual[i-1]);denominator+=residual[i-1]**2;}
 const phi=1+numerator/denominator;result.half=phi>0&&phi<1?-Math.log(2)/Math.log(phi)*5:null;
 if(!result.half||result.half<o.minHalfLife||result.half>o.maxHalfLife)result.reasons.push('Mean-reversion estimate outside '+o.minHalfLife+'–'+o.maxHalfLife+' minutes');
 result.adf=typeof E.adf==='function'?E.adf(residual,o.adfLags):null;
 if(o.adfLevel&&typeof E.adf==='function'&&!E.adfPass(result.adf,o.adfLevel))result.reasons.push('No cointegration evidence (ADF p '+(result.adf?.p||'n/a')+')');
 const wa=1/(1+s.beta),wb=1-wa;
 if(finite(a.takerBps)&&finite(b.takerBps)&&finite(a.spread)&&finite(b.spread))result.cost=2*(wa*a.takerBps+wb*b.takerBps)+wa*a.spread+wb*b.spread+2*slip;
 result.edge=Math.abs(s.z)*s.sd/(1+s.beta)*10000;
 // Net funding carry over the half-life-based expected hold, on both legs, in bps of gross.
 const hold=Fd.expectedHoldMinutes(result.half,s.z,o.exitZ,o.maxHoldMinutes);
 result.funding=Fd.pairCarry(a,b,Math.sign(s.z)||1,s.beta,hold);
 if(o.requireKnownFunding&&!result.funding.known)result.reasons.push('Funding unknown');
 if(result.cost!==null){
  const carry=result.funding.known?Math.max(result.funding.bps,-o.fundingIncomeCreditMax*result.cost):0;
  result.totalCost=result.cost+carry;
 }
 if(result.cost===null)result.reasons.push('Execution cost incomplete');
 else if(result.edge<2*result.totalCost)result.reasons.push(result.funding.known&&result.funding.bps>0?'Estimated move less than twice friction plus funding':'Estimated move less than twice friction');
 result.eligible=result.reasons.length===0;
 const costQuality=result.cost===null||!(result.totalCost>0)?0:clamp((result.edge/result.totalCost-1)/3);
 result.score=Math.round(35*clamp((Math.min(c1,c2)-.3)/.7)+25*(result.half?clamp(1-Math.abs(Math.log(result.half/30))/Math.log(8)):0)+20*costQuality+20*clamp(Math.log10(Math.max(1,Math.min(a.volume||0,b.volume||0)))/7));
 result.setup=result.eligible&&Math.abs(s.z)>=o.entryZMin&&Math.abs(s.z)<=o.entryZMax&&Number.isFinite(s.confirm)&&Math.abs(s.confirm)>=o.minConfirmZ&&s.z*s.confirm>0;
 return result;
}
root.PairScan={MIN_CONFIRM_Z,FUNDING_DEFAULTS,MODEL_DEFAULTS,groups,universe,pairs,analyze};if(typeof module!=='undefined')module.exports=root.PairScan;
})(typeof globalThis!=='undefined'?globalThis:this);
