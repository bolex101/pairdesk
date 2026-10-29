const A=require('node:assert/strict'),Q=require('./qfex-wallet.cjs');
const key={publicKey:'qfex_pub_TEST',secretKey:'qfex_secret_TEST'};
let mode='modern',requests=0,offsets=[];
class WS{
 constructor(){queueMicrotask(()=>this.onopen());}
 close(){}
 send(raw){
 const m=JSON.parse(raw);A.ok(['auth','get_user_trades'].includes(m.type));
 if(m.type==='auth')queueMicrotask(()=>this.onmessage({data:JSON.stringify(mode==='denied'?{authenticated:false}:mode==='err'?{err:{secret:'DO_NOT_PRINT'}}:mode==='legacy'?{type:'auth',result:'success'}:{authenticated:true})}));
 else{
 requests++;offsets.push(m.params.offset);
 const batch=mode==='pages'&&m.params.offset===0?Array.from({length:1000},(_,i)=>({trade_id:'id'+i})):mode==='bad'?{}:[];
 queueMicrotask(()=>this.onmessage({data:JSON.stringify(mode==='legacy'?{user_trades:batch}:{user_trades_response:batch})}));
 }
 }
}
global.WebSocket=WS;
(async()=>{
 A.deepEqual(await Q.executions(key),[]);A.equal(requests,1);
 mode='legacy';A.deepEqual(await Q.executions(key),[]);
 mode='denied';await A.rejects(()=>Q.executions(key),/authentication rejected/);
 mode='err';await A.rejects(()=>Q.executions(key),e=>e.message.includes('read request rejected')&&!e.message.includes('DO_NOT_PRINT'));
 mode='bad';await A.rejects(()=>Q.executions(key),/schema invalid/);
 mode='pages';offsets=[];A.equal((await Q.executions(key)).length,1000);A.deepEqual(offsets,[0,1000]);
 console.log('QFEX protocol checks passed: official authenticated/user_trades_response shapes, legacy replies, empty history, pagination, denied auth and redacted errors.');
})().catch(e=>{console.error(e);process.exitCode=1;});
