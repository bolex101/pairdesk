const A=require('node:assert/strict'),L=require('./log.cjs'),fs=require('node:fs'),path=require('node:path');
const token='1234567890:'+'A'.repeat(35);
const s=L.safe(Error('POST https://api.telegram.org/bot'+token+'/sendMessage failed token '+token));
A.ok(!s.includes(token)&&!s.includes('AAAAAAAAAA'),s);
A.ok(!L.scrub('wss://trade.qfex.com?api_key=pk_live_123&x=1').includes('pk_live_123'));
A.ok(!L.scrub('key '+'ab'.repeat(32)).includes('ab'.repeat(32)));
A.ok(!L.scrub('Authorization: Bearer abc.def.ghi').includes('abc.def.ghi'));
A.ok(L.safe(Error('outer',{cause:Object.assign(Error('inner'),{code:'ECONNRESET'})})).includes('cause: inner [ECONNRESET]'));
A.equal(L.safe(null),'unknown error');A.ok(L.scrub('x'.repeat(400)).length<=301);
// No bare catch{} left in runtime code.
for(const f of fs.readdirSync(__dirname).filter(f=>/\.(c?js)$/.test(f)&&!f.startsWith('test')))A.ok(!/catch\s*\{/.test(fs.readFileSync(path.join(__dirname,f),'utf8')),f+' has a bare catch');
console.log('Logging checks passed: secrets scrubbed, causes kept, no bare catch blocks');
