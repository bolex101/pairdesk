'use strict';
/* Error logging that never prints secrets. Messages are scrubbed of Telegram bot
   tokens, /bot<token>/ URL segments, api_key/signature/token query values, long hex
   strings (private keys, HMACs) and long base58 strings (Solana secret keys). */
const PATTERNS=[
 [/\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g,'[telegram-token]'],
 [/\/bot[^/\s?]+/g,'/bot[redacted]'],
 [/([?&](?:api_key|apikey|key|token|secret|signature|hmac|password)=)[^&\s]+/gi,'$1[redacted]'],
 [/\b(?:0x)?[a-fA-F0-9]{40,}\b/g,'[hex-redacted]'],
 [/\b[1-9A-HJ-NP-Za-km-z]{80,}\b/g,'[key-redacted]'],
 [/(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi,'$1[redacted]']
];
function scrub(text){let s=String(text??'');for(const [re,to] of PATTERNS)s=s.replace(re,to);return s.length>300?s.slice(0,300)+'…':s;}
function safe(e){
 if(e===null||e===undefined)return 'unknown error';
 const name=e.name&&e.name!=='Error'?e.name+': ':'',msg=scrub(e.message??e),code=e.code?' ['+scrub(e.code)+']':'';
 const cause=e.cause&&e.cause!==e?' (cause: '+safe(e.cause)+')':'';
 return name+msg+code+cause;
}
const warn=(context,e)=>console.error(context+': '+safe(e));
const debug=(context,e)=>{if(process.env.PAIRDESK_DEBUG)console.error('[debug] '+context+': '+safe(e));};
module.exports={scrub,safe,warn,debug};
