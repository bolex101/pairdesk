(function(root){
const mean=x=>x.reduce((a,b)=>a+b,0)/x.length;
function fit(rows){const x=rows.map(r=>Math.log(r.b)),y=rows.map(r=>Math.log(r.a)),mx=mean(x),my=mean(y),v=x.reduce((s,t)=>s+(t-mx)**2,0);if(v<1e-12)return null;const beta=x.reduce((s,t,i)=>s+(t-mx)*(y[i]-my),0)/v,alpha=my-beta*mx,res=x.map((t,i)=>y[i]-alpha-beta*t),sd=Math.sqrt(mean(res.map(t=>t*t)));return sd>1e-8&&beta>0&&beta<10?{beta,alpha,sd}:null;}
const z=(r,f)=>(Math.log(r.a)-f.alpha-f.beta*Math.log(r.b))/f.sd;
function corr(rows){const a=rows.slice(1).map((r,i)=>Math.log(r.a/rows[i].a)),b=rows.slice(1).map((r,i)=>Math.log(r.b/rows[i].b));const ma=mean(a),mb=mean(b);return a.reduce((s,v,i)=>s+(v-ma)*(b[i]-mb),0)/Math.sqrt(a.reduce((s,v)=>s+(v-ma)**2,0)*b.reduce((s,v)=>s+(v-mb)**2,0))||0;}
function aggregate(rows,minutes){const map=new Map;for(const r of rows){const key=Math.floor(r.t/(minutes*60000));const g=map.get(key)||[];g.push(r);map.set(key,g);}return [...map.values()].filter(g=>g.length===minutes/5&&g.every((r,i)=>!i||r.t-g[i-1].t===300000)).map(g=>g[g.length-1]);}
function stats(rows,w=60){if(rows.length<=w)return null;const f=fit(rows.slice(-w-1,-1));if(!f)return null;const slow=aggregate(rows,15),sf=slow.length>21?fit(slow.slice(-21,-1)):null;return {...f,z:z(rows.at(-1),f),correlation:corr(rows.slice(-w)),confirm:sf?z(slow.at(-1),sf):null};}
// Residuals of a fixed fit over the rows it was estimated on.
function residuals(rows,f){return rows.map(r=>Math.log(r.a)-f.alpha-f.beta*Math.log(r.b));}
// AR(1) half-life of a residual series, in minutes.
function halfLife(res,barMinutes=5){let n=0,d=0;for(let i=1;i<res.length;i++){n+=res[i-1]*(res[i]-res[i-1]);d+=res[i-1]**2;}if(!(d>0))return null;const phi=1+n/d;return phi>0&&phi<1?-Math.log(2)/Math.log(phi)*barMinutes:null;}
// Small dense least squares via normal equations + Gauss-Jordan; returns coefficients and their standard errors.
function ols(X,y){const k=X[0].length,n=X.length;if(n<=k)return null;const A=Array.from({length:k},(_,i)=>Array.from({length:2*k},(_,j)=>j<k?X.reduce((s,r)=>s+r[i]*r[j],0):+(j-k===i)));const Xy=Array.from({length:k},(_,i)=>X.reduce((s,r,t)=>s+r[i]*y[t],0));
 for(let c=0;c<k;c++){let p=c;for(let r=c+1;r<k;r++)if(Math.abs(A[r][c])>Math.abs(A[p][c]))p=r;if(Math.abs(A[p][c])<1e-18)return null;[A[c],A[p]]=[A[p],A[c]];const v=A[c][c];for(let j=0;j<2*k;j++)A[c][j]/=v;for(let r=0;r<k;r++)if(r!==c){const m=A[r][c];if(m)for(let j=0;j<2*k;j++)A[r][j]-=m*A[c][j];}}
 const inv=A.map(r=>r.slice(k)),b=inv.map(r=>r.reduce((s,v,j)=>s+v*Xy[j],0)),rss=X.reduce((s,r,t)=>s+(y[t]-r.reduce((u,v,j)=>u+v*b[j],0))**2,0),s2=rss/(n-k);return {b,se:inv.map((r,i)=>Math.sqrt(Math.max(r[i]*s2,0)))};}
/* Engle-Granger critical values for a 2-variable cointegrating regression with constant,
   MacKinnon (2010) response surfaces: c(T)=b0+b1/T+b2/T^2. */
const EG_CRIT={0.01:[-3.89644,-10.9519,-33.527],0.05:[-3.33613,-6.1101,-6.823],0.10:[-3.04445,-4.2412,-2.720]};
function egCritical(T){const out={};for(const [l,[b0,b1,b2]] of Object.entries(EG_CRIT))out[l]=b0+b1/T+b2/T/T;return out;}
/* Augmented Dickey-Fuller on cointegration residuals (no constant: OLS residuals are mean zero).
   Δe_t = γ e_{t-1} + Σ_{i=1..p} φ_i Δe_{t-i} + ε. Statistic = γ / se(γ). The p-value is reported as a
   bracket from the critical values, not an exact number. */
function adf(res,lags=1){const d=res.slice(1).map((v,i)=>v-res[i]),X=[],y=[];for(let t=lags;t<d.length;t++){X.push([res[t],...Array.from({length:lags},(_,i)=>d[t-1-i])]);y.push(d[t]);}
 if(X.length<20)return null;const r=ols(X,y);if(!r||!(r.se[0]>0))return null;const stat=r.b[0]/r.se[0],crit=egCritical(X.length);
 const p=stat<crit['0.01']?'<0.01':stat<crit['0.05']?'0.01-0.05':stat<crit['0.1']?'0.05-0.10':'>0.10';return {stat,lags,n:X.length,crit,p};}
// True when the ADF statistic rejects "no cointegration" at the given level (0.01, 0.05 or 0.10).
function adfPass(a,level){const c=a?.crit?.[String(level)];return Number.isFinite(c)&&a.stat<c;}
function backtest(rows,o){let pos=null,pending=null,trades=[],equity=[{t:rows[0].t,v:0}],cash=0,peak=0,drawdown=0;const day=r=>new Date(r.t).toISOString().slice(0,10);const cost=o.cost/10000;const close=(r,i,reason)=>{const gross=pos.qa*(r.a-pos.a)+pos.qb*(r.b-pos.b);const exitCost=(Math.abs(pos.qa*r.a)+Math.abs(pos.qb*r.b))*cost;const carry=o.gross*o.funding/10000*(r.t-pos.t)/86400000;const net=gross-pos.entryCost-exitCost-carry;cash+=gross-exitCost-carry;trades.push({...pos,exit:r.t,exitA:r.a,exitB:r.b,net,reason,bars:i-pos.i});pos=null;};
for(let i=o.window;i<rows.length;i++){const r=rows[i],last=i===rows.length-1||day(rows[i+1])!==day(r);if(pending){if(pending.type==='exit'&&pos)close(r,i,pending.reason);else if(pending.type==='entry'&&!pos&&!last&&day(rows[i-1])===day(r)){const f=pending.f,na=o.gross/(1+f.beta),nb=o.gross-na;pos={t:r.t,i,a:r.a,b:r.b,qa:pending.side*na/r.a,qb:-pending.side*nb/r.b,f,side:pending.side,entryCost:o.gross*cost};cash-=pos.entryCost;}pending=null;}
if(pos&&last)close(r,i,'Session end');
let mtm=cash;if(pos)mtm+=pos.qa*(r.a-pos.a)+pos.qb*(r.b-pos.b)-o.gross*o.funding/10000*(r.t-pos.t)/86400000;peak=Math.max(peak,mtm);drawdown=Math.max(drawdown,peak-mtm);equity.push({t:r.t,v:mtm});
if(last)continue;if(pos){const zz=z(r,pos.f);if(Math.abs(zz)<=o.exit||zz*pos.side>=0)pending={type:'exit',reason:'Mean reversion'};else if(Math.abs(zz)>=o.stop)pending={type:'exit',reason:'Z stop'};else if(i-pos.i>=o.hold)pending={type:'exit',reason:'Time limit'};}else {const f=fit(rows.slice(i-o.window,i));if(!f)continue;const zz=z(r,f);if(Math.abs(zz)>=o.entry&&Math.abs(zz)<o.stop){let confirmed=true;if(o.confirm){const slow=aggregate(rows.slice(0,i+1),15),sf=slow.length>21?fit(slow.slice(-21,-1)):null;confirmed=!!sf&&z(slow.at(-1),sf)*zz>0;}if(confirmed)pending={type:'entry',side:zz>0?-1:1,f};}}}
return {trades,equity,net:cash,drawdown,win:trades.length?trades.filter(t=>t.net>0).length/trades.length:null};}
function parseCSV(text){const lines=text.trim().split(/\r?\n/);if(lines.shift().trim().toLowerCase()!=='timestamp,asset_a,asset_b')throw Error('Use exactly these columns: timestamp,asset_a,asset_b');if(lines.length<100||lines.length>50000)throw Error('Import between 100 and 50,000 rows.');const rows=lines.map((line,i)=>{const p=line.split(',').map(x=>x.trim());const t=Date.parse(p[0]),a=Number(p[1]),b=Number(p[2]);if(p.length!==3||!/(Z|[+-]\d\d:\d\d)$/.test(p[0])||!Number.isFinite(t)||!Number.isFinite(a)||!Number.isFinite(b)||a<=0||b<=0)throw Error('Invalid timestamp or positive price on row '+(i+2));return {t,a,b};});rows.forEach((r,i)=>{if(i&&(r.t<=rows[i-1].t||(r.t-rows[i-1].t)%300000!==0))throw Error('Rows must be ascending, unique, and on a 5-minute grid.');});return rows;}
function demo(seed=1){let state=seed;const rand=()=>{state=(state*1664525+1013904223)>>>0;return state/4294967296;};let b=100+seed*12,spread=0;const rows=[];for(let d=0;d<20;d++){let date=new Date(Date.UTC(2026,8,7+d,13,30));if([0,6].includes(date.getUTCDay()))continue;for(let j=0;j<78;j++){b*=Math.exp((rand()-.49)*.004);spread=.88*spread+(rand()-.5)*.007;rows.push({t:+date+j*300000,b,a:Math.exp(.55+1.08*Math.log(b)+spread)});}}return rows;}
root.PairEngine={fit,z,stats,residuals,halfLife,ols,adf,adfPass,egCritical,corr,aggregate,backtest,parseCSV,demo};if(typeof module!=='undefined')module.exports=root.PairEngine;
})(typeof globalThis!=='undefined'?globalThis:this);
