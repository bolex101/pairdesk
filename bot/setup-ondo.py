#!/usr/bin/env python3
import getpass,json,os,pathlib,subprocess,tempfile,sys
if os.geteuid()!=0: sys.exit('Run this setup as root.')
if not sys.stdin.isatty(): sys.exit('Run interactively in your SSH terminal so credentials stay hidden.')
base=pathlib.Path('/opt/pairdesk')
config_file=base/'wallet-config.json'
config=json.loads(config_file.read_text())
if input('Confirm the key has VIEW ONLY permission (type VIEW ONLY): ').strip()!='VIEW ONLY':
 sys.exit('Create a view-only key before continuing.')
key={'keyId':getpass.getpass('Ondo key ID (hidden): ').strip(),'secretKey':getpass.getpass('Ondo secret (hidden): ').strip()}
if not all(key.values()): sys.exit('Both fields are required. Nothing changed.')
code="""let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>input+=s);process.stdin.on('end',async()=>{try{const c=JSON.parse(require('node:fs').readFileSync('/opt/pairdesk/wallet-config.json','utf8'));const a=await require('/opt/pairdesk/ondo-wallet.cjs').fetchAccount(c.address,JSON.parse(input));console.log('Ondo wallet verified: '+a.rows.length+' open legs; '+a.rows.filter(r=>r.generation).length+' with verified opening times.');}catch(e){console.error('Validation failed: '+e.message);process.exitCode=1;}});"""
payload=json.dumps(key).encode()
check=subprocess.run(['/opt/pairdesk/bin/node','-e',code],input=payload,timeout=90)
if check.returncode: sys.exit('Nothing changed. Check key permissions, server IP restriction and clock, then rerun setup.')
folder=pathlib.Path('/etc/pairdesk');folder.mkdir(mode=0o700,exist_ok=True)
fd,temp=tempfile.mkstemp(prefix='.ondo-',dir=folder);os.close(fd);os.unlink(temp)
try:
 result=subprocess.run(['systemd-creds','encrypt','--with-key=host','--name=ondo-key','-',temp],input=payload,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 if result.returncode: sys.exit('Credential encryption failed. Nothing enabled. Check systemd-creds availability.')
 os.chmod(temp,0o600);os.replace(temp,folder/'ondo-key.cred')
finally:
 if os.path.exists(temp): os.unlink(temp)
drop=pathlib.Path('/etc/systemd/system/pairdesk-monitor.service.d');drop.mkdir(exist_ok=True)
(drop/'ondo-credentials.conf').write_text('[Service]\nLoadCredentialEncrypted=ondo-key:/etc/pairdesk/ondo-key.cred\n')
config['ondo']={'enabled':True}
fd,temp=tempfile.mkstemp(prefix='.wallet-',dir=base)
with os.fdopen(fd,'w') as f: json.dump(config,f);f.write('\n');f.flush();os.fsync(f.fileno())
os.chmod(temp,0o644);os.replace(temp,config_file)
subprocess.run(['systemctl','daemon-reload'],check=True)
subprocess.run(['systemctl','restart','pairdesk-monitor.service'],check=True)
print('Ondo view-only credentials encrypted and saved. Tracking enabled. Check /wallets in Telegram after two monitoring cycles.')
