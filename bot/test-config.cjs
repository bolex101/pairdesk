const A=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const T=require('./thresholds.js'),C=require('./config.cjs'),S=require('./scan-engine.js'),R=require('./risk.cjs'),Fd=require('./funding.js'),Rules=require('./alert-rules.cjs');
A.equal(T.DEFAULTS.minAlertScore,65);A.equal(T.DEFAULTS.minConfirmZ,1);A.equal(Rules.MIN_ALERT_SCORE,65);A.equal(S.MIN_CONFIRM_Z,1);
A.equal(C.get().fitWindow,S.MODEL_DEFAULTS.fitWindow);
// Overrides validate and propagate to risk + funding modules.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdcfg-')),file=path.join(dir,'c.json');
fs.writeFileSync(file,JSON.stringify({thresholds:{minAlertScore:70,liquidationAlertPct:20,hedgeDriftAlertPct:5,fundingIntervalSeconds:{Arcus:3600}}}));
const t=C.load(file);A.equal(t.minAlertScore,70);A.equal(R.settings().liquidationAlertPct,20);A.equal(R.settings().hedgeDriftAlertPct,5);A.equal(Fd.interval('Arcus'),3600);A.equal(Fd.interval('Ondo'),null);
// Alert floor follows config.
for(const bad of [{unknownKey:1},{minAlertScore:500},{entryZMin:3,entryZMax:2},{adfLevel:0.2},{fitWindow:300}])A.throws(()=>T.validate(bad));
fs.writeFileSync(file,'{not json');A.throws(()=>C.load(file),/Invalid JSON/);
A.equal(C.load(path.join(dir,'missing.json')).minAlertScore,65,'missing optional file falls back to defaults');
process.env.PAIRDESK_CONFIG=path.join(dir,'missing.json');A.throws(()=>C.load(),/Cannot read/,'explicit PAIRDESK_CONFIG must exist');delete process.env.PAIRDESK_CONFIG;
C.apply({});A.equal(R.settings().liquidationAlertPct,15);A.equal(Fd.interval('Arcus'),null);A.equal(C.get().minAlertScore,65);
fs.rmSync(dir,{recursive:true});
console.log('Config checks passed: shared defaults, overrides, validation, propagation');
