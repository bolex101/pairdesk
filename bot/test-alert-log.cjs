const A=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),L=require('./alert-log.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pd-alertlog-'));delete process.env.PAIRDESK_ALERT_LOG;
const plan={z:-2.1,beta:1.1,alpha:.01,sd:.004,gross:1000,a:{id:'X',side:'LONG',entry:10,notional:476,units:47.6,quoteTime:1},b:{id:'Y',side:'SHORT',entry:20,notional:524,units:26.2,quoteTime:1},tpZ:-.3,stopZ:-4,ratios:{tp:1,stop:2,entry:1.5},maxHoldMinutes:120,createdAt:0,expiresAt:300000,cost:1.5,funding:{known:false,usd:null},targetNet:3,stopLoss:9};
const f=L.append(dir,{venue:'Arcus',side:'Long X / Short Y',pair:{a:{id:'X'},b:{id:'Y'},score:83,z:-2,half:20,adf:{p:'0.05-0.10'}},plan},'abcdef123456',0);
L.append(dir,{venue:'Arcus',side:'s',pair:{a:{id:'X'},b:{id:'Y'},score:81},plan},'abcdef123457',1);
const rows=fs.readFileSync(f,'utf8').trim().split('\n').map(JSON.parse);
A.equal(rows.length,2);A.equal(rows[0].pair,'X/Y');A.equal(rows[0].score,83);A.equal(rows[0].a.entry,10);A.equal(rows[0].tpZ,-.3);A.equal(rows[0].timeExitAt,'1970-01-01T02:00:00.000Z');
A.equal(path.basename(f),'alerts-log.jsonl');
console.log('Alert log checks passed: one JSON line per delivered alert with entries and plan levels');
