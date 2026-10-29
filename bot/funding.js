/* Funding normalisation and carry estimates. Pure functions; no network, no secrets.
   Convention: a leg's hourly cost is a fraction of that leg's notional per hour.
   Positive = the leg PAYS funding, negative = the leg RECEIVES funding. */
(function(root){
const HOUR=3600;
// Venues whose API reports a rate without a verified interval. null = unknown (funding flagged, never guessed).
// Override with pairdesk-config.json "fundingIntervalSeconds": {"Arcus":3600}.
const intervals={Arcus:null,Ondo:null,Popdex:null};
function interval(venue){const v=intervals[venue];return Number.isFinite(v)&&v>0?v:null;}
function setIntervals(o){for(const [k,v] of Object.entries(o||{}))intervals[k]=v===null?null:Number(v);}
const num=v=>v===null||v===undefined||v===''?NaN:Number(v);
// Standard perpetual: positive rate means longs pay shorts.
function perp(rate,intervalSeconds,source){
 rate=num(rate);intervalSeconds=num(intervalSeconds);
 if(!Number.isFinite(rate)||!Number.isFinite(intervalSeconds)||intervalSeconds<=0)return null;
 const hourly=rate*HOUR/intervalSeconds;
 return {long:hourly,short:-hourly,source:source||'perpetual funding'};
}
// Variational-style swap: long pays its rate, short receives its (different) rate.
function swap(longRate,shortRate,intervalSeconds,source){
 longRate=num(longRate);shortRate=num(shortRate);intervalSeconds=num(intervalSeconds);
 if(![longRate,shortRate].every(Number.isFinite)||!Number.isFinite(intervalSeconds)||intervalSeconds<=0)return null;
 return {long:longRate*HOUR/intervalSeconds,short:-shortRate*HOUR/intervalSeconds,source:source||'swap payment'};
}
function legHourly(row,side){
 const f=row&&row.fundingHourly;
 if(!f)return null;
 const v=side==='LONG'?f.long:side==='SHORT'?f.short:NaN;
 return Number.isFinite(v)?v:null;
}
// Expected time for the spread to revert from |z| to the exit z, given an exponential half-life.
function expectedHoldMinutes(halfLifeMinutes,z,exitZ,maxHoldMinutes){
 const m=Math.abs(z),e=Math.max(Math.abs(exitZ),1e-3);
 if(!Number.isFinite(halfLifeMinutes)||halfLifeMinutes<=0||!Number.isFinite(m))return Number.isFinite(maxHoldMinutes)?maxHoldMinutes:null;
 const t=m<=e?0:halfLifeMinutes*Math.log2(m/e);
 return Number.isFinite(maxHoldMinutes)?Math.min(Math.max(t,5),maxHoldMinutes):Math.max(t,5);
}
/* Net carry for a beta-weighted pair, in bps of combined gross notional.
   direction>0 => short A / long B (z>0); direction<0 => long A / short B. */
function pairCarry(a,b,direction,beta,holdMinutes){
 const sideA=direction>0?'SHORT':'LONG',sideB=direction>0?'LONG':'SHORT';
 const wa=1/(1+beta),wb=1-wa,ha=legHourly(a,sideA),hb=legHourly(b,sideB);
 const missing=[ha===null?(a&&a.id)||'A':null,hb===null?(b&&b.id)||'B':null].filter(Boolean);
 const out={known:!missing.length,missing,sideA,sideB,holdMinutes:Number.isFinite(holdMinutes)?holdMinutes:null,
  hourlyBps:{a:ha===null?null:ha*10000,b:hb===null?null:hb*10000},bps:null,perHourBps:null,
  source:[a&&a.fundingHourly&&a.fundingHourly.source,b&&b.fundingHourly&&b.fundingHourly.source].filter(Boolean)};
 if(!out.known||!Number.isFinite(holdMinutes))return out;
 out.perHourBps=(wa*ha+wb*hb)*10000;
 out.bps=out.perHourBps*holdMinutes/60;
 return out;
}
function describe(f){
 if(!f)return 'unknown';
 if(!f.known)return 'unknown (no verified funding interval for '+f.missing.join(', ')+')';
 const sign=v=>(v>0?'+':'')+v.toFixed(2);
 return sign(f.bps)+' bps of gross over ~'+Math.round(f.holdMinutes)+' min ('+(f.bps>0?'cost':'income')+'; A '+f.sideA.toLowerCase()+' '+sign(f.hourlyBps.a)+' bps/h, B '+f.sideB.toLowerCase()+' '+sign(f.hourlyBps.b)+' bps/h)';
}
root.PairFunding={interval,setIntervals,perp,swap,legHourly,expectedHoldMinutes,pairCarry,describe};
if(typeof module!=='undefined')module.exports=root.PairFunding;
})(typeof globalThis!=='undefined'?globalThis:this);
