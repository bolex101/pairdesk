const assert=require('node:assert/strict'),B=require('./buttons.cjs'),C=require('./positions.cjs');
const now=Date.UTC(2026,9,19,12),id='aabbccddeeff';
const plan={ready:true,venue:'Popdex',a:{id:'A',side:'SHORT'},b:{id:'B',side:'LONG'},alpha:0,beta:1,sd:.01,tpZ:.3,stopZ:4,maxHoldMinutes:120,createdAt:now-3600000,expiresAt:now-3300000};
const cb={id:'click1',data:'open:'+id,from:{id:42},message:{date:1,chat:{id:42,type:'private'},from:{username:'pairdeskbot',is_bot:true}}};
const update=(n,value=cb)=>({update_id:n,callback_query:value});
let s=C.initial();C.handle(s,update(1),'42',()=>plan,now);assert.equal(s.draft.signalId,id);assert.equal(s.draft.step,0);assert.equal(Object.keys(s.positions).length,0);
C.handle(s,{update_id:2,message:{text:'100',date:now/1000,chat:{id:42,type:'private'},from:{id:42}}},'42',()=>plan,now);
assert.equal(s.draft.step,1);
C.handle(s,update(3),'42',()=>plan,now);assert.equal(s.draft.step,1);assert.equal(s.draft.values.priceA,100);
const count=s.outbox.length;C.handle(s,update(3),'42',()=>plan,now);assert.equal(s.outbox.length,count);
for(const value of [{...cb,from:{id:99}},{...cb,message:{...cb.message,chat:{id:99,type:'private'}}},{...cb,message:{...cb.message,from:{is_bot:true,username:'otherbot'}}},{...cb,data:'open:../../secret'},{...cb,data:'invalid'}]){
 const st=C.initial();C.handle(st,update(1,value),'42',()=>plan,now);assert.equal(st.draft,null);assert.equal(st.outbox.length,0);
}
const missing=C.initial();C.handle(missing,update(1),'42',()=>null,now);assert.equal(missing.draft,null);assert.ok(missing.outbox[0].text.includes('missing'));
const test=C.initial();C.handle(test,{update_id:1,message:{text:'/testbutton',date:now/1000,chat:{id:42,type:'private'},from:{id:42}}},'42',()=>plan,now);assert.deepEqual(test.outbox[0].replyMarkup,B.testKeyboard());
C.handle(test,update(2,{...cb,data:'test:register'}),'42',()=>plan,now);assert.equal(test.draft,null);assert.equal(Object.keys(test.positions).length,0);assert.ok(test.outbox.at(-1).text.includes('TEST PASSED'));
assert.equal(B.keyboard(id).inline_keyboard[0][0].text,'Register trade');assert.ok(Buffer.byteLength(B.keyboard(id).inline_keyboard[0][0].callback_data)<=64);assert.throws(()=>B.keyboard('../'));
global.fetch=async(url,o)=>{const body=JSON.parse(o.body);assert.deepEqual(body.reply_markup,B.keyboard(id));assert.equal(body.chat_id,'42');return {ok:true,json:async()=>({ok:true,result:{message_id:1}})};};
require('./telegram.cjs').client('123:TEST','42').send('Test alert',B.keyboard(id)).then(()=>console.log('Button tests passed: markup, authorized clicks, old alert clicks, duplicate taps, draft preservation, invalid/missing IDs, harmless test and Telegram payload')).catch(e=>{console.error(e);process.exitCode=1;});

