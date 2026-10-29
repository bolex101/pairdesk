#!/usr/bin/env python3
import getpass,json,os,pathlib,subprocess,tempfile,sys,shutil
if os.geteuid()!=0 or not sys.stdin.isatty(): sys.exit('Run interactively as root on the server.')
uid=input('Approved friend Telegram user ID: ').strip()
if not uid.isdigit() or uid.startswith('0') or len(uid)>16: sys.exit('Invalid user ID.')
statefile=pathlib.Path('/var/lib/pairdesk/positions.json')
def member():
 s=json.loads(statefile.read_text());m=s.get('community',{}).get('members',{}).get(uid)
 if not m or m.get('status')!='approved' or not m.get('wallets',{}).get('Ondo'):
  sys.exit('Friend must be approved and send /wallet Ondo ADDRESS first.')
 return s,m
s,m=member();address=m['wallets']['Ondo']['address']
print('Configure the separate Ondo view-only credential for friend '+uid+' and wallet '+address)
if input('Confirm VIEW ONLY permission (type VIEW ONLY): ').strip()!='VIEW ONLY': sys.exit('Stopped.')
key={'keyId':getpass.getpass('Friend Ondo key ID (hidden): ').strip(),'secretKey':getpass.getpass('Friend Ondo secret (hidden): ').strip()}
if not all(key.values()): sys.exit('Both fields required.')
code="""let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>s+=x);process.stdin.on('end',async()=>{try{const v=JSON.parse(s);const a=await require('/opt/pairdesk/ondo-wallet.cjs').fetchAccount(v.address,v.key);console.log('Friend wallet verified: '+a.rows.length+' open legs.');}catch(e){console.error('Validation failed: '+e.message);process.exitCode=1;}});"""
if subprocess.run(['/opt/pairdesk/bin/node','-e',code],input=json.dumps({'address':address,'key':key}).encode(),timeout=90).returncode:
 sys.exit('Credentials were not saved.')
folder=pathlib.Path('/etc/pairdesk');folder.mkdir(exist_ok=True)
fd,tmp=tempfile.mkstemp(prefix='.friend-ondo-',dir=folder);os.close(fd);os.unlink(tmp)
name='ondo-friend-'+uid
try:
 result=subprocess.run(['systemd-creds','encrypt','--with-key=host','--name='+name,'-',tmp],input=json.dumps(key).encode(),stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 if result.returncode: sys.exit('Credential encryption failed; tracking not enabled.')
 os.chmod(tmp,0o600)
 active=subprocess.run(['systemctl','is-active','--quiet','pairdesk-monitor.service']).returncode==0
 subprocess.run(['systemctl','stop','pairdesk-monitor.service'],check=True)
 try:
  s,m=member()
  if m['wallets']['Ondo']['address']!=address: sys.exit('Wallet changed during setup. Nothing enabled.')
  shutil.copy2(statefile,statefile.with_name('positions.before-friend-ondo-'+uid+'.json'))
  os.replace(tmp,folder/(name+'.cred'))
  drop=pathlib.Path('/etc/systemd/system/pairdesk-monitor.service.d');drop.mkdir(exist_ok=True)
  (drop/(name+'.conf')).write_text('[Service]\nLoadCredentialEncrypted='+name+':/etc/pairdesk/'+name+'.cred\n')
  m['wallets']['Ondo']['enabled']=True;m['epoch']=m.get('epoch',0)+1
  fd,t=tempfile.mkstemp(prefix='.positions-',dir=statefile.parent)
  with os.fdopen(fd,'w') as f: json.dump(s,f);f.flush();os.fsync(f.fileno())
  os.chmod(t,0o600);shutil.copystat(statefile,t);os.chown(t,statefile.stat().st_uid,statefile.stat().st_gid);os.replace(t,statefile)
  subprocess.run(['systemctl','daemon-reload'],check=True)
 finally:
  if active: subprocess.run(['systemctl','start','pairdesk-monitor.service'],check=True)
finally:
 if os.path.exists(tmp): os.unlink(tmp)
print('Friend Ondo credential saved separately. Have the friend check /wallets privately.')
