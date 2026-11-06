'use strict';
/* Dead-man checks. The long-running monitor watches the scanner's status.json; the
   scanner (when run with --send) watches the monitor's last completed cycle. One alert
   when a process goes quiet, a reminder every remindMinutes while it stays quiet, and one
   "recovered" note when it comes back. */
const fs=require('node:fs'),path=require('node:path');
const REMIND_MINUTES=180;
function evaluate(entry,lastAt,now,staleMinutes,remindMinutes=REMIND_MINUTES){
 const e=entry||{stale:false,alertedAt:null};
 if(!Number.isFinite(lastAt))return {entry:e,event:null};
 const age=now-lastAt,stale=age>staleMinutes*60000;
 if(stale&&(!e.stale||now-e.alertedAt>=remindMinutes*60000))return {entry:{stale:true,alertedAt:now},event:'stale',ageMinutes:Math.floor(age/60000)};
 if(!stale&&e.stale)return {entry:{stale:false,alertedAt:null},event:'recovered'};
 return {entry:e,event:null};
}
const iso=t=>new Date(t).toISOString().replace('.000Z','Z');
function message(name,result,lastAt,staleMinutes){
 if(result.event==='stale')return 'PAIRDESK — '+name.toUpperCase()+' HEARTBEAT MISSING\nLast successful '+name+' run: '+iso(lastAt)+' ('+result.ageMinutes+' min ago; limit '+staleMinutes+' min).\nCheck the server: systemctl status pairdesk-'+(name==='scanner'?'alerts.timer':'monitor.service')+'. No trading action was taken.';
 if(result.event==='recovered')return 'PAIRDESK — '+name+' heartbeat restored. Last run: '+iso(lastAt)+'.';
 return null;
}
// Scanner status.json -> finishedAt (ms) or null when absent/unreadable (absent = never ran; no alert).
function scannerLastRun(dir){
 try{const t=Date.parse(JSON.parse(fs.readFileSync(path.join(dir,'status.json'),'utf8')).finishedAt);return Number.isFinite(t)?t:null;}
 catch(e){if(e.code!=='ENOENT')console.error('Heartbeat: scanner status unreadable ('+(e.code||e.name)+')');return null;}
}
function monitorLastCycle(dir){
 try{const t=JSON.parse(fs.readFileSync(path.join(dir,'positions.json'),'utf8')).lastCycle;return Number.isFinite(t)?t:null;}
 catch(e){if(e.code!=='ENOENT')console.error('Heartbeat: monitor state unreadable ('+(e.code||e.name)+')');return null;}
}
module.exports={REMIND_MINUTES,evaluate,message,scannerLastRun,monitorLastCycle};
