#!/usr/bin/env node
'use strict';
/* The dashboard runs the SAME research code as the Telegram bot. bot/ is the source
   of truth; this copies the shared browser-compatible modules into dashboard/dist and
   makes sure index.html loads them in dependency order.
   Usage: node scripts/sync-dashboard.cjs          (write)
          node scripts/sync-dashboard.cjs --check  (exit 1 if out of date; used by tests) */
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),bot=path.join(root,'bot'),dist=path.join(root,'dashboard','dist');
const SHARED=['thresholds.js','funding.js','feeds.js','engine.js','scan-engine.js'];
const check=process.argv.includes('--check');
function expectedHtml(html){
 // Shared modules first (in dependency order), then the dashboard's own scripts in their existing order.
 const own=[...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m=>m[1]).filter(s=>!SHARED.includes(s));
 const tags=[...SHARED,...own].map(s=>'<script src="'+s+'"></script>').join('');
 const stripped=html.replace(/<script src="[^"]+"><\/script>/g,'');
 return stripped.replace('</body>',tags+'</body>');
}
let stale=[];
for(const f of SHARED){const src=fs.readFileSync(path.join(bot,f)),dst=path.join(dist,f);if(!fs.existsSync(dst)||!src.equals(fs.readFileSync(dst))){stale.push(f);if(!check)fs.writeFileSync(dst,src);}}
const indexFile=path.join(dist,'index.html'),html=fs.readFileSync(indexFile,'utf8'),next=expectedHtml(html);
if(next!==html){stale.push('index.html');if(!check)fs.writeFileSync(indexFile,next);}
if(check&&stale.length){console.error('Dashboard out of date: '+stale.join(', ')+'. Run: node scripts/sync-dashboard.cjs');process.exit(1);}
console.log(stale.length?'Synced: '+stale.join(', '):'Dashboard already in sync');
module.exports={SHARED,expectedHtml};
