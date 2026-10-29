#!/usr/bin/env python3
"""Read-only authentication comparison; never saves or displays credentials."""
import getpass,hashlib,hmac,json,os,subprocess,sys,time,urllib.request,urllib.error
CODES={'api_key_not_found','timestamp_too_far','failed_to_parse_timestamp','failed_to_decode_hex_signature','signature_mismatch','key_doesnt_have_scope','ip_not_permitted','auth_missing','auth_invalid','auth_expired','account_not_allowed','account_closed','forbidden'}
def safe_result(status,data):
 code=data.get('error_code') if isinstance(data,dict) else None
 return 'HTTP '+str(status)+'; '+('success' if isinstance(data,dict) and data.get('success') is True else 'code='+(code if code in CODES else 'unclassified'))
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs): return None
NODE=r"""
let text='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>text+=x);
process.stdin.on('end',async()=>{try{
 const key=JSON.parse(text),O=require('/opt/pairdesk/ondo-wallet.cjs');
 if(typeof O.headers!=='function'){console.log('Pairdesk: installed signing helper unavailable');return;}
 const route='/v1/account';
 const r=await fetch('https://api.ondoperps.xyz'+route,{method:'GET',headers:O.headers(key,route),redirect:'error',signal:AbortSignal.timeout(15000)});
 const d=await r.json().catch(()=>({}));
 const known=['api_key_not_found','timestamp_too_far','failed_to_parse_timestamp','failed_to_decode_hex_signature','signature_mismatch','key_doesnt_have_scope','ip_not_permitted','auth_missing','auth_invalid','auth_expired','account_not_allowed','account_closed','forbidden'];
 console.log('Pairdesk: HTTP '+r.status+'; '+(d.success===true?'success':'code='+(known.includes(d.error_code)?d.error_code:'unclassified')));
}catch{console.log('Pairdesk: request or installed-module failure; details hidden');}});
"""
def main():
 if not sys.stdin.isatty(): sys.exit('Run interactively in your server SSH terminal.')
 raw_id=getpass.getpass('Ondo key ID (hidden): ')
 raw_secret=getpass.getpass('Ondo secret (hidden): ')
 key_id,secret=raw_id.strip(),raw_secret.strip()
 print('Key ID has documented ondoKeyId_ prefix:',key_id.startswith('ondoKeyId_'))
 print('Secret has documented ondoApiSecret_ prefix:',secret.startswith('ondoApiSecret_'))
 print('Outer whitespace removed:',raw_id!=key_id or raw_secret!=secret)
 bad=any(not x.isascii() or any(c.isspace() for c in x) or any(c in x for c in ('"',"'")) for x in (key_id,secret))
 print('Unexpected whitespace, quotes or non-ASCII characters:',bad)
 if not key_id or not secret or bad: sys.exit('Stopped before requests. Copy the raw values without quotes or embedded spaces.')
 route='/v1/account';timestamp=str(int(time.time()*1000))
 signature=hmac.new(secret.encode(),(timestamp+'GET'+route).encode(),hashlib.sha256).hexdigest()
 req=urllib.request.Request('https://api.ondoperps.xyz'+route,headers={'ONDO-KEY-ID':key_id,'ONDO-TIMESTAMP':timestamp,'ONDO-SIGN':signature},method='GET')
 try:
  response=urllib.request.build_opener(NoRedirect).open(req,timeout=15)
 except urllib.error.HTTPError as e: response=e
 except Exception:
  response=None;print('Independent Python: network failure; details hidden')
 if response is not None:
  try: data=json.loads(response.read())
  except Exception: data={}
  print('Independent Python:',safe_result(response.code,data))
 payload=json.dumps({'keyId':key_id,'secretKey':secret}).encode()
 try: subprocess.run(['/opt/pairdesk/bin/node','-e',NODE],input=payload,timeout=25,check=True)
 except Exception: print('Pairdesk comparison could not complete; details hidden')
 print('Diagnostic finished. No credentials saved; no account settings or positions changed.')
if __name__=='__main__': main()
