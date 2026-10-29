const fs=require('node:fs'),path=require('node:path'),A=require('node:assert/strict');
const dir=fs.mkdtempSync(path.join(__dirname,'friend-daemon-test-'));process.on('exit',()=>fs.rmSync(dir,{recursive:true,force:true}));
process.env.PAIRDESK_STATE_DIR=dir;process.env.PAIRDESK_WALLET_CONFIG=path.join(dir,'disabled.json');process.env.TELEGRAM_BOT_TOKEN='123:TEST';process.env.TELEGRAM_CHAT_ID='42';
const base=1793058360000;let now=base;Date.now=()=>now;
const Store=require('./storage.cjs');
const id=Store.signal(dir,{ready:true,venue:'Popdex',a:{id:'AAA',side:'SHORT'},b:{id:'BBB',side:'LONG'},alpha:0,beta:1,sd:.01,tpZ:.3,stopZ:4,maxHoldMinutes:120,createdAt:base-1000,expiresAt:base+300000});
fs.mkdirSync(path.join(dir,'shared-signals'));Store.save(path.join(dir,'shared-signals',id+'.json'),{publishedAt:base});
require('./monitor-feeds.cjs').quotes=async()=>()=>({a:{bid:100*Math.exp(.002),ask:100*Math.exp(.002),quoteTime:now},b:{bid:100,ask:100,quoteTime:now}});
const actions=[['100','/start'],['200','/start'],['42','/approve 100'],['42','/approve 200'],['100','/start trade_'+id],...['101','500','100','500','0','CONFIRM'].map(t=>['100',t]),['200','/positions']];
let poll=0,registered=false,target=false,otherEmpty=false;const sent=[];
const timer=setTimeout(()=>{console.error('Friend daemon test timed out');process.exit(1);},5000);
global.fetch=async(url,opts)=>{
 await new Promise(r=>setTimeout(r,1));
 const method=url.split('/').at(-1),data=JSON.parse(opts.body);let result={};
 if(method==='getMe')result={username:'pairdeskbot'};
 else if(method==='getWebhookInfo')result={url:''};
 else if(method==='getUpdates'){
  now+=1000;
  if(poll<actions.length){const [id,text]=actions[poll];result=[{update_id:++poll,message:{chat:{type:'private',id:Number(id)},from:{id:Number(id),first_name:'Friend'},date:now/1000,text}}];}else result=[];
 }else if(method==='sendMessage'){
  sent.push(data);
  if(data.text.includes('registered. Monitoring starts')){A.equal(String(data.chat_id),'100');registered=true;}
  if(data.text.includes('PAIR Z-TARGET')){A.equal(String(data.chat_id),'100');target=true;}
  if(data.text.includes('No registered open positions')){A.equal(String(data.chat_id),'200');otherEmpty=true;}
  A.ok(!data.text.includes('SECRET_OWNER_VALUE'));
  if(registered&&target&&otherEmpty){
   const s=JSON.parse(fs.readFileSync(path.join(dir,'positions.json')));
   A.equal(Object.keys(s.positions).length,0);A.equal(Object.keys(s.community.members['100'].state.positions).length,1);A.equal(Object.keys(s.community.members['200'].state.positions).length,0);
   A.ok(sent.filter(x=>String(x.chat_id)==='42').every(x=>!x.text.includes('Estimated position P&L')));
   clearTimeout(timer);console.log('Friend daemon integration passed: request -> owner approval -> private deep link -> fill registration -> private z-target; other friend and owner cannot see the position.');process.exit(0);
  }
 }else throw Error('Unexpected API method '+method);
 return {ok:true,json:async()=>({ok:true,result})};
};
require('./monitor.cjs');
