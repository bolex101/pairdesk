// Repo-level check: skipped when only bot/ is present (e.g. a server copy).
if(!require('node:fs').existsSync(require('node:path').join(__dirname,'..','scripts'))){console.log('Skipped: scripts/ not present');process.exit(0);}
const A=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..'),dist=path.join(root,'dashboard','dist');
// Dashboard copies must be byte-identical to the bot's research code (same confirm rule, thresholds, funding).
execFileSync(process.execPath,[path.join(root,'scripts','sync-dashboard.cjs'),'--check'],{stdio:'pipe'});
// Load the shared files the way the browser does (globals, no require) and run the same analysis.
const ctx={console};ctx.globalThis=ctx;vm.createContext(ctx);
for(const f of ['thresholds.js','funding.js','feeds.js','engine.js','scan-engine.js'])vm.runInContext(fs.readFileSync(path.join(dist,f),'utf8'),ctx,{filename:f});
A.equal(typeof ctx.PairScan.analyze,'function');A.equal(ctx.PairScan.MIN_CONFIRM_Z,1);
const E=require('./engine.js'),S=require('./scan-engine.js'),rows=E.demo(4).slice(-240),now=rows.at(-1).t+300000;
const q=id=>({id,type:'PERPETUAL',status:'ONLINE',price:1,volume:1e7,spread:1,takerBps:1});
const browser=ctx.PairScan.analyze({a:q('A'),b:q('B')},rows,ctx.PairEngine,now,3),bot=S.analyze({a:q('A'),b:q('B')},rows,E,now,3);
for(const k of ['z','beta','sd','half','cost','edge','score','setup','eligible'])A.deepEqual(browser[k],bot[k],k);
A.equal(JSON.stringify(browser.reasons),JSON.stringify(bot.reasons));
// Confirm rule identical: weak 15m confirmation is rejected in both.
const mock={stats:()=>({beta:1,alpha:0,sd:.01,z:2,confirm:.5}),fit:()=>({alpha:0,beta:1}),corr:()=>.8};
A.equal(ctx.PairScan.analyze({a:q('A'),b:q('B')},rows,mock,now,3).setup,false);
console.log('Dashboard sync checks passed: identical shared code, browser load, same results and confirm rule');
