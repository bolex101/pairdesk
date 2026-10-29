'use strict';
// Telegram bot username the code expects. Production default: pairdeskbot.
// A separate test bot sets PAIRDESK_BOT_USERNAME (see TESTING.md).
function username(){
 const u=String(process.env.PAIRDESK_BOT_USERNAME||'pairdeskbot').replace(/^@/,'').toLowerCase();
 if(!/^[a-z][a-z0-9_]{3,31}$/.test(u))throw Error('Invalid PAIRDESK_BOT_USERNAME');
 return u;
}
module.exports={username};
