const A=require('node:assert/strict'),Q=require('./qfex-wallet.cjs');
const key={publicKey:'qfex_pub_TEST',secretKey:'qfex_secret_TEST'},now=Date.now(),calls=[],frames=[];
let changed=false,authFailure=false;
const rest={id:'fill1',symbol:'NVDA-USD',side:'BUY',price:100,quantity:2,order_timestamp:1};
global.fetch=async(url,opts)=>{
 A.equal(opts.method||'GET','GET');A.equal(opts.redirect,'error');A.ok(url.startsWith('https://api.qfex.com/user/'));calls.push(url);
 if(url.includes('/positions'))return {ok:true,headers:new Headers({date:new Date().toUTCString()}),json:async()=>({balance:{},positions:[{symbol:'NVDA-USD',position:changed&&calls.filter(x=>x.includes('/positions')).length>1?3:2,average_price:100}]})};
 A.ok(url.includes('/trade?'));return {ok:true,headers:new Headers({date:new Date().toUTCString()}),json:async()=>({data:[rest],count:1})};
};
class WS{
 constructor(url){A.ok(url.startsWith('wss://trade.qfex.com?api_key='));queueMicrotask(()=>this.onopen());}
 close(){}
 send(raw){
 const m=JSON.parse(raw);frames.push(m.type);
 A.ok(['auth','get_user_trades'].includes(m.type));
 if(m.type==='auth')queueMicrotask(()=>this.onmessage({data:JSON.stringify({type:'auth',result:authFailure?'failure':'success'})}));
 else queueMicrotask(()=>this.onmessage({data:JSON.stringify({user_trades:[{trade_id:'fill1',symbol:'NVDA-USD',price:100,quantity:2,aggressor_side:'SELL',timestamp:(now-1000)/1000}],count:1})}));
 }
}
global.WebSocket=WS;
(async()=>{
 const a=await Q.fetchAccount({keyFingerprint:Q.fingerprint(key)},key);
 A.equal(a.rows[0].side,'LONG');A.equal(a.rows[0].generation,'fill1');A.equal(a.rows[0].enteredAt,now-1000);
 A.equal(calls.length,3);A.deepEqual(frames,['auth','get_user_trades']);
 await A.rejects(()=>Q.fetchAccount({keyFingerprint:'wrong'},key));A.equal(calls.length,3);
 changed=true;calls.length=0;await A.rejects(()=>Q.fetchAccount({},key),/changed/);
 authFailure=true;await A.rejects(()=>Q.executions(key),/rejected/);
 console.log('QFEX integration passed: signed GET-only routes, auth-before-read, execution timestamp and user-side cross-check, changing positions rejected, credential binding and failed auth.');
})().catch(e=>{console.error(e);process.exitCode=1;});
