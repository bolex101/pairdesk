const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const folder=fs.mkdtempSync(path.join(__dirname,'paper-daemon-test-'));
process.on('exit',()=>fs.rmSync(folder,{recursive:true,force:true}));
process.env.PAIRDESK_STATE_DIR=folder;process.env.PAIRDESK_WALLET_CONFIG=path.join(folder,'disabled.json');process.env.TELEGRAM_BOT_TOKEN='123:TEST_ONLY';process.env.TELEGRAM_CHAT_ID='42';
let clock=1792600000000,polls=0;Date.now=()=>clock;
const P=require('./performance.cjs'),Store=require('./storage.cjs');
const plan={ready:true,venue:'Popdex',createdAt:clock,expiresAt:clock+300000,maxHoldMinutes:120,beta:1,alpha:0,sd:.01,tpZ:.3,stopZ:4,a:{id:'A',side:'SHORT',entry:102,units:5,notional:510,quoteTime:clock},b:{id:'B',side:'LONG',entry:100,units:5,notional:500,quoteTime:clock},research:P.metadata({score:83,z:2,confirm:1.3,a:{takerBps:2},b:{takerBps:2}})};
const id=Store.signal(folder,plan);P.receipt(folder,id,plan);
require('./monitor-feeds.cjs').quotes=async positions=>{assert.equal(positions.length,1);return ()=>({a:{bid:100,ask:100,quoteTime:clock},b:{bid:100,ask:100,quoteTime:clock}});};
const timer=setTimeout(()=>{console.error('Paper daemon test timed out');process.exit(1);},5000);
global.fetch=async(url,options)=>{
 assert.ok(url.startsWith('https://api.telegram.org/bot123:TEST_ONLY/'));const method=url.split('/').at(-1),body=JSON.parse(options.body);let result;
 if(method==='getMe')result={username:'pairdeskbot'};
 else if(method==='getWebhookInfo')result={url:''};
 else if(method==='getUpdates'){polls++;result=[{update_id:polls,message:{text:'/performance Popdex',date:clock/1000,chat:{type:'private',id:polls===1?99:42},from:{id:polls===1?99:42}}}];}
 else if(method==='sendMessage'){
  assert.equal(polls,2,'Unauthorized chat must not receive a report');assert.ok(body.text.includes('80–89: 1 closed; 100.0% wins'));assert.ok(body.text.includes('BEFORE funding'));
  const s=JSON.parse(fs.readFileSync(path.join(folder,'positions.json'),'utf8'));assert.equal(Object.keys(s.positions).length,0,'No real trade registered');assert.equal(s.performance.records[id].status,'closed');clearTimeout(timer);console.log('Paper daemon integration passed: delivered receipt -> quotes -> persisted outcome -> authorized Telegram performance report, with no real position.');process.exit(0);
 }else throw Error('Unexpected request');return {ok:true,json:async()=>({ok:true,result})};
};
require('./monitor.cjs');
