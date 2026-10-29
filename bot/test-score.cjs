const A=require('node:assert/strict'),Module=require('node:module'),original=Module._load;
// Selection tests need no plan renderer or production files.
Module._load=function(id,...args){if(id==='./trade-plan.cjs')return {};return original.call(this,id,...args);};
const R=require('./alert-rules.cjs');Module._load=original;
const now=1793058360000,p={a:{id:'A'},b:{id:'B'},rows:[{t:now-300000}],setup:true,eligible:true,score:65,z:2};
for(const venue of ['Popdex','Arcus','Variational','Ondo','Phoenix','QFEX','RISEx']){
 for(const score of [0,56,64,64.999,NaN,Infinity,-Infinity])A.equal(R.selectAlerts(venue,[{...p,score}],{},now).alerts.length,0);
 for(const score of [65,65.001,83,100])A.equal(R.selectAlerts(venue,[{...p,score}],{},now).alerts.length,1);
 A.equal(R.selectAlerts(venue,[{...p,eligible:false}],{},now).alerts.length,0);
 A.equal(R.selectAlerts(venue,[{...p,setup:false}],{},now).alerts.length,0);
 const first=R.selectAlerts(venue,[p],{},now),key=first.alerts[0].key;first.next[key].sentAt=now;
 A.equal(R.selectAlerts(venue,[p],first.next,now+1000).alerts.length,0);
 const below=R.selectAlerts(venue,[{...p,score:64}],first.next,now+2000);
 A.equal(R.selectAlerts(venue,[p],below.next,now+3000).alerts.length,0);
 A.equal(R.selectAlerts(venue,[{...p,rows:[{t:now+3300000}]}],below.next,now+3600001).alerts.length,1);
 A.deepEqual(R.selectAlerts(venue,[],first.next,now).next,first.next);
}
console.log('Score filter passed: below 65 blocked, 65 included, all seven exchanges, existing qualification and cooldown preserved.');
