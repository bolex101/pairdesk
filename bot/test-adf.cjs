const A=require('node:assert/strict'),E=require('./engine.js'),S=require('./scan-engine.js'),near=(a,b,e=1e-9)=>A.ok(Math.abs(a-b)<=e,a+' != '+b);
// Deterministic series; reference statistics computed with statsmodels adfuller(regression='n', autolag=None).
let seed=7;const r=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296-.5};
const x=[0];for(let i=1;i<150;i++)x.push(.8*x[i-1]+r());const w=[0];for(let i=1;i<150;i++)w.push(w[i-1]+r());
const ax=E.adf(x,1),aw=E.adf(w,2);
near(ax.stat,-4.2190429364297275,1e-9);near(aw.stat,-0.9459991951923651,1e-9);
A.equal(ax.p,'<0.01');A.equal(aw.p,'>0.10');A.equal(E.adfPass(ax,0.05),true);A.equal(E.adfPass(aw,0.10),false);
// MacKinnon (2010) Engle-Granger critical values, N=2 with constant (matches statsmodels mackinnoncrit(2,'c',T)).
const c=E.egCritical(148);near(c['0.01'],-3.97196996,1e-6);near(c['0.05'],-3.37772596,1e-6);near(c['0.1'],-3.07323093,1e-6);
A.equal(E.adf(x.slice(0,10),1),null,'too short');A.equal(E.adfPass(null,0.05),false);
// Half-life of AR(1) phi=0.8 on 5-minute bars ~ 15.5 minutes.
A.ok(Math.abs(E.halfLife(x)-(-Math.log(2)/Math.log(.8)*5))<6);
// analyze: z, beta, sd, half-life and ADF share one window; no lookahead (changing the current bar changes z only).
const rows=E.demo(4).slice(-240),now=rows.at(-1).t+300000;
const q=id=>({id,type:'PERPETUAL',status:'ONLINE',price:1,volume:1e7,spread:1,takerBps:1});
const r1=S.analyze({a:q('A'),b:q('B')},rows,E,now,3,{adfLevel:null});
const fitRows=rows.slice(-S.MODEL_DEFAULTS.fitWindow-1,-1),f=E.fit(fitRows);
A.equal(r1.fitWindow,S.MODEL_DEFAULTS.fitWindow);near(r1.beta,f.beta);near(r1.sd,f.sd);near(r1.half,E.halfLife(E.residuals(fitRows,f)),1e-9);
near(r1.adf.stat,E.adf(E.residuals(fitRows,f),1).stat);
const bumped=rows.slice();bumped[bumped.length-1]={...bumped.at(-1),a:bumped.at(-1).a*1.01};
const r2=S.analyze({a:q('A'),b:q('B')},bumped,E,now,3,{adfLevel:null});near(r2.beta,r1.beta);near(r2.half,r1.half);near(r2.adf.stat,r1.adf.stat);A.ok(r2.z>r1.z);
// Gate: a random-walk spread fails the configured ADF level.
const rw=[];let b=100,sp=0;seed=3;for(let i=0;i<240;i++){b*=Math.exp(r()*.002);sp+=r()*.004;rw.push({t:now-(240-i)*300000,a:b*Math.exp(sp),b});}
const g=S.analyze({a:q('A'),b:q('B')},rw,E,now);A.ok(g.adf&&!E.adfPass(g.adf,.10));A.ok(g.reasons.some(x=>x.startsWith('No cointegration evidence')));
A.ok(!S.analyze({a:q('A'),b:q('B')},rw,E,now,3,{adfLevel:null}).reasons.some(x=>x.startsWith('No cointegration')),'gate can be disabled');
console.log('ADF checks passed: statistic matches statsmodels, MacKinnon critical values, single fit window, no lookahead, configurable gate');
