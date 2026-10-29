#!/usr/bin/env node
'use strict';
// Runs every bot/test*.cjs in its own process (they use process.exit and globals).
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const dir=path.join(__dirname,'..','bot'),only=process.argv.slice(2);
const files=fs.readdirSync(dir).filter(f=>/^test.*\.cjs$/.test(f)&&(!only.length||only.some(o=>f.includes(o)))).sort();
let failed=[];const started=Date.now();
for(const f of files){
 const t=Date.now(),r=spawnSync(process.execPath,[f],{cwd:dir,encoding:'utf8',timeout:60000,env:{...process.env,PAIRDESK_HTTP_RETRIES:process.env.PAIRDESK_HTTP_RETRIES??'2'}});
 const ok=r.status===0;if(!ok)failed.push(f);
 console.log((ok?'PASS ':'FAIL ')+f+' ('+(Date.now()-t)+' ms)');
 if(!ok)process.stdout.write((r.stdout||'')+(r.stderr||'')+(r.error?String(r.error)+'\n':''));
}
console.log('\n'+(files.length-failed.length)+'/'+files.length+' test files passed in '+((Date.now()-started)/1000).toFixed(1)+'s on Node '+process.versions.node);
if(failed.length){console.log('Failed: '+failed.join(', '));process.exit(1);}
