const A=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),H=require('./heartbeat.cjs');
const now=1800000000000,m=60000;
let r=H.evaluate(undefined,now-10*m,now,30);A.equal(r.event,null);
r=H.evaluate(undefined,null,now,30);A.equal(r.event,null,'never ran: no alert');
r=H.evaluate(undefined,now-31*m,now,30);A.equal(r.event,'stale');A.equal(r.ageMinutes,31);
const msg=H.message('scanner',r,now-31*m,30);A.ok(msg.includes('SCANNER HEARTBEAT MISSING')&&msg.includes('31 min ago'));
let e=r.entry;r=H.evaluate(e,now-31*m,now+5*m,30);A.equal(r.event,null,'deduplicated');
r=H.evaluate(e,now-31*m,now+180*m,30);A.equal(r.event,'stale','reminder after 3h');e=r.entry;
r=H.evaluate(e,now+181*m,now+182*m,30);A.equal(r.event,'recovered');A.ok(H.message('monitor',r,now+181*m,30).includes('restored'));
r=H.evaluate(r.entry,now+181*m,now+183*m,30);A.equal(r.event,null);
// File readers: missing files are silent; status.json and positions.json parsed.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdhb-'));A.equal(H.scannerLastRun(dir),null);A.equal(H.monitorLastCycle(dir),null);
fs.writeFileSync(path.join(dir,'status.json'),JSON.stringify({finishedAt:new Date(now).toISOString()}));fs.writeFileSync(path.join(dir,'positions.json'),JSON.stringify({lastCycle:now}));
A.equal(H.scannerLastRun(dir),now);A.equal(H.monitorLastCycle(dir),now);fs.rmSync(dir,{recursive:true});
console.log('Heartbeat checks passed: stale alert, de-duplication, reminders, recovery, file readers');
