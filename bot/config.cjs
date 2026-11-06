'use strict';
// Loads optional threshold overrides and applies them to every module that uses them.
const fs=require('node:fs'),path=require('node:path'),T=require('./thresholds.js'),Fd=require('./funding.js'),Risk=require('./risk.cjs');
const file=()=>process.env.PAIRDESK_CONFIG||path.join(__dirname,'pairdesk-config.json');
function apply(overrides={}){
 const t=T.set(overrides);
 Fd.setIntervals(t.fundingIntervalSeconds);
 Risk.configure({liquidationAlertPct:t.liquidationAlertPct,hedgeDriftAlertPct:t.hedgeDriftAlertPct});
 return t;
}
function load(target=file()){
 let raw;
 try{raw=fs.readFileSync(target,'utf8');}
 catch(e){if(e.code==='ENOENT'&&!process.env.PAIRDESK_CONFIG)return apply({});throw Error('Cannot read Pairdesk config '+target+': '+e.code);}
 let parsed;try{parsed=JSON.parse(raw);}catch(e){throw Error('Invalid JSON in Pairdesk config '+target+': '+e.message);}
 return apply(parsed.thresholds??parsed);
}
const thresholds=load();
module.exports={load,apply,thresholds,get:T.get,file};
